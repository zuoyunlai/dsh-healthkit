// B2：规则层只读采集层交来的事实，不再碰文件系统（守门测试见 test/layering.mjs）。

function fpOf(o) {
  var m = o.measured || {};
  // 审计反哺 V03：退役只该静音它自己。多实例规则（R13 跨 profile、R17 跨目录、R22 跨 profile）
  // 必须在 measured 里带标识（profile/dir/dep），否则 fp 退化成裸规则号，退役一条会静音一串。
  var tail = m.tag || m.dir || (m.packages && m.packages[0]) || (m.stale && m.stale[0] && m.stale[0].entry) || (m.dead && m.dead[0]) || (m.broken && m.broken[0] && m.broken[0].dep) || m.profile || '';
  return o.ruleId + (tail ? '#' + String(tail).slice(0, 60) : '');
}

function F(o) {
  return { id: o.id, ruleId: o.ruleId, dimension: o.dimension, severity: o.severity, title: o.title,
    evidence: o.evidence || [], measured: o.measured || {}, confidence: o.confidence || 'MEASURED', advisory: o.advisory === true,
    fixHint: o.fixHint || null, fp: o.fp || fpOf(o) };
}
export function runRules(facts, allowlist) {
  var out = [];
  var cfg = allowlist || {};
  // 审计反哺 V05：降级不许崩（§16.3「删采集源出 UNKNOWN 而非崩」）。
  // collect 是这些字段的唯一供应商，但宿主升级/文件缺失可能让个别字段缺席——
  // 规则层入口对关键字段做默认化，缺了按「没有」处理，不抛 TypeError。
  (facts.profiles || []).forEach(function (p) {
    if (!Array.isArray(p.deps)) p.deps = [];
    if (!Array.isArray(p.bundles)) p.bundles = [];
    if (!Array.isArray(p.thirdPartyBundles)) p.thirdPartyBundles = [];
    if (!Array.isArray(p.depsNotBundled)) p.depsNotBundled = [];
    if (!Array.isArray(p.bakFiles)) p.bakFiles = [];
    if (!Array.isArray(p.localDeps)) p.localDeps = [];
    if (!p.installed || typeof p.installed !== 'object') p.installed = {};
    if (!p.depSpecs || typeof p.depSpecs !== 'object') p.depSpecs = {};
  });
  if (!facts.logs || typeof facts.logs !== 'object') facts.logs = {};
  if (!Array.isArray(facts.profileErrors)) facts.profileErrors = [];
  if (!Array.isArray(facts.disk)) facts.disk = [];
  if (!Array.isArray(facts.engineAssets)) facts.engineAssets = [];
  var allow = cfg.depsNotBundled || {};

  for (var i = 0; i < facts.profiles.length; i++) {
    var p = facts.profiles[i];

    // 2026-11-20 反哺 P1：《停用 ≠ 该卸载》。
    // 市场停用只把包从 bundles 摘掉、依赖留着（启用时再加回）。旧版一律判
    // 「装了但未挂载」P1 并给 `dsh plugin remove`——照着修就把用户主动保留的插件删了，
    // 重新启用还得重装。所以先按「用户停用」解释并降噪，剩下的才按未启用报。
    var intent = {};
    (Array.isArray(p.marketDisabled) ? p.marketDisabled : []).forEach(function (n) { intent[n] = 'market'; });
    var realNotBundled = p.depsNotBundled.filter(function (d) { return !allow[d] && !intent[d]; });
    var intentNotBundled = p.depsNotBundledRaw.filter(function (d) { return !allow[d] && !!intent[d]; });
    if (intentNotBundled.length) out.push(F({ ruleId: 'R1b', dimension: 'consistency', severity: 'INFO',
      title: '按你的停用选择未挂载 ' + intentNotBundled.length + ' 个（' + p.name + '）：符合预期',
      evidence: [p.dir + '/package.json', p.dir + '/.dsh-market/state.json'],
      measured: { count: intentNotBundled.length, packages: intentNotBundled, profile: p.name },
      confidence: 'MEASURED',
      fixHint: '不用改。停用但没卸载会继续占磁盘；要收回空间再卸载（重新启用需重装）。' }));
    if (realNotBundled.length) out.push(F({ ruleId: 'R1', dimension: 'consistency', severity: 'P1',
      title: '装了但未启用 ' + realNotBundled.length + ' 个（' + p.name + '）',
      evidence: [p.dir + '/package.json'], measured: { count: realNotBundled.length, packages: realNotBundled, profile: p.name },
      // 市场停用记录读不到时，「未启用」可能包含未记录的主动停用 → 不许当成已证故障
      confidence: p.marketStateReadable === true ? 'MEASURED' : 'MEDIUM',
      fixHint: 'L3-plan: 先确认这些包是否还需要。需要 → 加回 dsh.profile.bundles；确认不再需要 → 再卸载（停用/移除后重新启用需重装）：' + realNotBundled.join(' ') }));

    var entries = facts.patchEntries[p.name];
    if (Array.isArray(entries)) {
      var coreIds = entries.filter(function (e) { return e.name && e.name.indexOf('@deepseek-ai/') === 0; }).map(function (e) { return e.id; });
      var disabledIds = entries.filter(function (e) { return e.disabled; }).map(function (e) { return e.id; });
      // id ≠ npm 包名：只能按已知映射对账，对不上就保留「疑似」，不猜。
      // 市场停用记录里的包（可能已卸载）会留下 disabled 条目——那是用户的开关记录，
      // 删条目等于撤销记录，所以先摘出来，不进「疑似空转」。
      var isIntentRecord = function (id) {
        var tail = String(id || '').split('/').pop();
        return (p.marketDisabled || []).some(function (n) { return n === id || String(n).split('/').pop() === tail; });
      };
      var suspicious = disabledIds.filter(function (id) {
        if (coreIds.indexOf(id) !== -1) return false;
        if (isIntentRecord(id)) return false;
        if (facts.bundleIndex) return !((facts.bundleIndex.idToBundles || {})[id]);
        if ((cfg.corePatchIds || []).indexOf(id) !== -1) return false;
        var guesses = [id, '@michengai/' + id, '@deepseek-ai/' + id];
        return guesses.every(function (g) { return !p.deps.includes(g); });
      });
      var intentRecords = disabledIds.filter(isIntentRecord);
      if (suspicious.length) out.push(F({ ruleId: 'R2', dimension: 'consistency', severity: 'P2',
        title: 'disabled 指向的包不在依赖里（疑似空转） ' + suspicious.length + ' 条',
        evidence: [p.dir + '/cordis.patch.yml'], measured: { suspicious: suspicious, profile: p.name },
        confidence: facts.bundleIndex ? 'MEASURED' : 'MEDIUM',
        fixHint: '先确认这些 id 是否真的不存在于组合树，再删条目（不要凭猜删）；如果它是你主动停用的记录，保留它，删了等于撤销记录' }));
      if (intentRecords.length) out.push(F({ ruleId: 'R2b', dimension: 'consistency', severity: 'INFO',
        title: 'disabled 条目对应你的停用记录 ' + intentRecords.length + ' 条（保留，不需处理）',
        evidence: [p.dir + '/cordis.patch.yml', p.dir + '/.dsh-market/state.json'],
        measured: { ids: intentRecords, profile: p.name }, confidence: 'MEASURED' }));
    } else if (entries && entries.error) {
      // 审计反哺 V01（docs/REVIEW-2026-11-16.md）：
      // 「体检器取不到 YAML 解析器」是体检器自己的能力缺口，不是用户配置坏了。
      // 报 P0 会触发总分封顶（≥1 条 P0 ⇒ ≤5.0），等于让用户替体检器背锅 → 降 P2/UNKNOWN。
      // 只有「解析器在、文件语法错」才是真 P0。
      var yamlUnavailable = entries.error === 'YAML_UNAVAILABLE';
      out.push(F({ ruleId: 'R2c', dimension: 'consistency',
        severity: yamlUnavailable ? 'P2' : 'P0',
        title: yamlUnavailable ? '无法读取 patch（体检器缺 YAML 解析器，不代表配置有问题）' : 'patch YAML 解析失败：' + entries.error,
        evidence: [p.dir + '/cordis.patch.yml'],
        confidence: yamlUnavailable ? 'UNKNOWN' : 'MEASURED',
        fixHint: yamlUnavailable ? '这是体检器的取证缺口：给 profile 的依赖里补上 yaml（或用 --probe-all 走宿主通道），补上后此条自动消失' : null }));
    }

    var excl = facts.exclusions[p.name];
    if (Array.isArray(excl)) {
      var dead = [], stale = [], unresolved = [];
      excl.forEach(function (entry) {
        var m = String(entry).match(/^(@?[^@]+)@(.+)$/);
        if (!m) return;
        var nm = m[1];
        var vers = m[2].split('||').map(function (s) { return s.trim(); });
        // B2：版本一律吃采集层事实，规则层不再碰文件系统。
        var inst = (p.installedExclusions && Object.prototype.hasOwnProperty.call(p.installedExclusions, nm))
          ? p.installedExclusions[nm]
          : ((p.installed && Object.prototype.hasOwnProperty.call(p.installed, nm)) ? p.installed[nm] : null);
        if (inst === null) { if (!(cfg.exclusionsDead && cfg.exclusionsDead[entry])) dead.push(entry); return; }
        if (vers.indexOf(inst) === -1) {
          if (vers.length === 1) stale.push({ entry: entry, installed: inst });
          else unresolved.push({ entry: entry, installed: inst });
        }
      });
      if (dead.length) out.push(F({ ruleId: 'R3', dimension: 'consistency', severity: 'P2',
        title: '冷静期豁免打在未安装的包上 ' + dead.length + ' 条', evidence: [p.dir + '/pnpm-workspace.yaml'],
        measured: { dead: dead, total: excl.length }, fixHint: 'L2: 删除这些条目（零收益、纯风险）' }));
      if (stale.length) out.push(F({ ruleId: 'R3b', dimension: 'consistency', severity: 'P2',
        title: '豁免锁定的版本与实装不符 ' + stale.length + ' 条', evidence: [p.dir + '/pnpm-workspace.yaml'],
        measured: { stale: stale }, fixHint: 'L2: 改成实装版本，或删除条目' }));
      if (unresolved.length) out.push(F({ ruleId: 'R3c', dimension: 'consistency', severity: 'INFO',
        title: '豁免含历史多版本列表且不含实装版本（需人工判断）', measured: { unresolved: unresolved }, confidence: 'MEDIUM' }));
    } else if (excl === null) {
      out.push(F({ ruleId: 'R3d', dimension: 'consistency', severity: 'INFO', title: '无法读取冷静期豁免（YAML 不可用或无该文件）', confidence: 'UNKNOWN' }));
    }

    if (p.bakFiles.length) out.push(F({ ruleId: 'R4', dimension: 'consistency', severity: p.bakFiles.length > 10 ? 'P1' : 'P2',
      title: '.bak/副本堆积 ' + p.bakFiles.length + ' 个（' + p.name + '）', evidence: [p.dir], measured: { count: p.bakFiles.length, files: p.bakFiles.slice(0, 15) },
      fixHint: 'L2: 归档到 _backup/profile-bak-<date>/ 后删除' }));

    var perm = (Array.isArray(entries) ? entries : []).filter(function (e) { return e.id === 'permission'; })[0];
    if (!perm) {
      out.push(F({ ruleId: 'R7', dimension: 'security', severity: 'P2', title: '未显式声明权限 preset（' + p.name + ' 走宿主默认）', confidence: 'UNKNOWN' }));
    } else {
      var cfg = perm.config || {};
      var presetName = cfg.defaultPreset;
      var preset = (cfg.presets || {})[presetName] || {};
      var approval = preset.approval, sandbox = preset.sandbox;
      if (presetName === 'danger-full-access' && approval === 'never') {
        out.push(F({ ruleId: 'R7a', dimension: 'security', severity: 'P0',
          title: '默认档位 = danger-full-access 且 approval = never（' + p.name + '）',
          evidence: [p.dir + '/cordis.patch.yml'], measured: { defaultPreset: presetName, sandbox: sandbox, approval: approval },
          fixHint: '价值判断，不自动改：可选 A 保持+加护栏 / B 改 workspace-write+ask / C 不动' }));
      } else if (approval === 'never') {
        out.push(F({ ruleId: 'R7b', dimension: 'security', severity: 'P1', title: 'approval = never（' + p.name + '/' + presetName + '）', evidence: [p.dir + '/cordis.patch.yml'], measured: { defaultPreset: presetName, approval: approval } }));
      }
    }
  }

  if (!facts.vcs) out.push(F({ ruleId: 'R5', dimension: 'consistency', severity: 'P1', title: '配置未纳入版本控制（profiles/.git 不存在）', evidence: [facts.home + '/profiles'], fixHint: 'L2: git init + 只跟踪 manifests' }));

  // R9 优先吃 facts.machines（采集期快照 / 测试夹具），没有再回落到活文件——
  // 否则 fixture 测试会偷偷依赖真实注册表，改一次真配置就让 P0 用例变红。
  // B2：machines 的读取已在采集层做完（facts.machines），这里不再回落到活文件——
  // 否则夹具测试会偷偷依赖真实注册表，改一次真配置就让 P0 用例变红。
  var list = Array.isArray(facts.machines) ? facts.machines : null;
  if (list) {
    {
      var risky = [];
      list.forEach(function (m) {
        if (m.useSshConfig && !m.privateKeyPath) return;   // alias 由 ~/.ssh/config 解析，密钥位置不归本规则管
        var kp = m.privateKeyPath || m.keyPath || null;
        if (kp && (/(^|[\\/])(Downloads|Desktop)([\\/]|$)/i.test(kp) || !/^\.ssh|[\\/]\.ssh[\\/]/.test(kp))) risky.push({ name: m.name || m.host, host: m.host, keyPath: kp });
      });
      if (risky.length) out.push(F({ ruleId: 'R9', dimension: 'security', severity: 'P0',
        title: '外部密钥不在 ~/.ssh 下 ' + risky.length + ' 把', evidence: [facts.home + '/remote-workspaces/machines.json'], measured: { machines: risky },
        fixHint: '价值/外部系统操作，不自动做：迁移到 ~/.ssh 并 chmod 600，改注册表引用' }));
    }
  }

  if (facts.costTracker) {
    if (facts.costTracker.ageDays !== null && facts.costTracker.ageDays > 3) out.push(F({ ruleId: 'R11', dimension: 'modelCost', severity: facts.costTracker.ageDays > 14 ? 'P1' : 'P2',
      title: '成本记账停更 ' + facts.costTracker.ageDays + ' 天', evidence: [facts.costTracker.file], measured: { ageDays: facts.costTracker.ageDays },
      fixHint: '确认记账插件是否仍挂载；否则删除孤儿状态文件，避免假监控' }));
  } else out.push(F({ ruleId: 'R11', dimension: 'modelCost', severity: 'INFO', title: '未发现成本记账文件', confidence: 'UNKNOWN' }));

  if (facts.logs.servedPlugins) {
    var maxBundles = 0;
    facts.profiles.forEach(function (p) { maxBundles = Math.max(maxBundles, p.bundles.length); });
    if (facts.logs.servedPlugins > maxBundles) out.push(F({ ruleId: 'R15', dimension: 'plugins', severity: 'INFO', title: '客户端服务插件数 ' + facts.logs.servedPlugins + ' > 最大 bundles ' + maxBundles, measured: { served: facts.logs.servedPlugins, bundles: maxBundles } }));
  }

  if (facts.logs.standIn && facts.logs.standIn.length) out.push(F({ ruleId: 'R14', dimension: 'reliability', severity: 'P1',
    title: '装载日志出现 stand-in module ' + facts.logs.standIn.length + ' 次', evidence: [facts.home + '/unlag-reload.log'],
    measured: { last: facts.logs.standIn[facts.logs.standIn.length - 1].slice(0, 220) } }));
  if (facts.logs.notRunning && facts.logs.notRunning.length) out.push(F({ ruleId: 'R14b', dimension: 'reliability', severity: 'P1',
    title: '装载日志出现 newly not running ' + facts.logs.notRunning.length + ' 次', measured: { last: facts.logs.notRunning[facts.logs.notRunning.length - 1].slice(0, 220) } }));

  facts.disk.forEach(function (d) {
    if (d.bytes < 50 * 1024 * 1024) return;
    var asset = facts.engineAssets.filter(function (a) { return a.top === d.name; })[0];
    out.push(F({ ruleId: 'R17', dimension: 'disk', severity: 'INFO',
      title: '大目录 ' + d.name + ' 约 ' + Math.round(d.bytes / 1048576) + 'MB（' + d.files + ' 文件' + (d.truncated ? '，已截断' : '') + '）',
      // 产品审计 P3：以前这条只说「大」，不说「能不能动」，而面板的「可清理空间」只算安全档，
      // 两个面对同一批目录给出两套数字（R17 报 845MB，clean 报 48MB），用户会困惑。
      fixHint: '先跑 audit_clean preview 看它能回收多少：不在可清理分组里的（profiles / sessions / attachments / 运行时目录）是有意不提供清理的受保护面，需要人工判断而不是一键删。',
      evidence: [facts.home + '/' + d.name],
      measured: { mb: Math.round(d.bytes / 1048576), approx: !!d.truncated, oldestAgeDays: d.oldestAgeDays, dir: d.name,
                  verdict: asset ? 'ENGINE_ASSET_NO_RECLAIM' : (d.oldestAgeDays !== null && d.oldestAgeDays > 30 ? 'RECLAIM_CANDIDATE' : 'NO_DATA_OLD_ENOUGH') } }));
  });
  facts.engineAssets.forEach(function (a) {
    out.push(F({ ruleId: 'R18', dimension: 'disk', severity: 'INFO', title: '引擎资产（判为不可回收）：' + a.path.replace(facts.home, '~/.dsh'),
      evidence: [a.path], measured: { hashSubdirs: a.hashSubdirs, marker: a.marker } }));
  });

  // ---- R8 / R10 / R12 / R13 / R16 ----
  function entriesOf(name) {
    var e = facts.patchEntries[name];
    return Array.isArray(e) ? e : [];
  }
  function permPreset() {
    var res = { preset: null, approval: null };
    facts.profiles.forEach(function (p) {
      entriesOf(p.name).forEach(function (e) {
        if (e.id !== 'permission' || !e.config) return;
        res.preset = e.config.defaultPreset || null;
        var pr = (e.config.presets || {})[res.preset] || {};
        res.approval = pr.approval || null;
      });
    });
    return res;
  }

  var pp = permPreset();
  if (facts.credentialsFiles && facts.credentialsFiles.length && pp.preset === 'danger-full-access') {
    out.push(F({ ruleId: 'R8', dimension: 'security', severity: 'P1',
      title: '凭据文件对同进程 shell 可读（栅栏只在工具层）',
      evidence: facts.credentialsFiles.map(function (f) { return facts.home + '/' + f; }),
      measured: { credentialsFiles: facts.credentialsFiles, defaultPreset: pp.preset },
      fixHint: '用 OS ACL 收紧凭据文件，或把默认档位降到 workspace-write；不自动执行' }));
  } else if (!facts.credentialsFiles || !facts.credentialsFiles.length) {
    out.push(F({ ruleId: 'R8', dimension: 'security', severity: 'INFO', title: '未发现凭据文件，跳过栅栏可达性检查', confidence: 'UNKNOWN' }));
  }

  function scanEmpty(node, trail, acc) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) scanEmpty(node[i], trail + '[' + i + ']', acc);
      return;
    }
    Object.keys(node).forEach(function (k) {
      var v = node[k];
      var t = trail ? trail + '.' + k : k;
      if (Array.isArray(v) && v.length === 0 && /allowed(Url)?Hosts|blockedDomains|allowedHosts|denylist|blocklist/i.test(k)) acc.push(t);
      else scanEmpty(v, t, acc);
    });
  }
  var openSurfaces = [];
  facts.profiles.forEach(function (p) {
    entriesOf(p.name).forEach(function (e) {
      if (!e.config) return;
      var acc = []; scanEmpty(e.config, e.id, acc);
      if (acc.length) openSurfaces.push({ profile: p.name, entry: e.id, keys: acc });
    });
  });
  if (openSurfaces.length) {
    out.push(F({ ruleId: 'R10', dimension: 'security', severity: 'P2',
      title: '高危扩展面未设白名单/黑名单 ' + openSurfaces.length + ' 处',
      evidence: [facts.home + '/profiles'], measured: { surfaces: openSurfaces },
      fixHint: '逐项开通 allowlist/blocklist；无明确需求时保持空数组是显式接受风险' }));
  } else {
    out.push(F({ ruleId: 'R10', dimension: 'security', severity: 'INFO', title: '未发现空白的域名白名单字段', confidence: 'UNKNOWN' }));
  }

  var modelKeys = [];
  facts.profiles.forEach(function (p) {
    entriesOf(p.name).forEach(function (e) {
      if (!e.config) return;
      Object.keys(e.config).forEach(function (k) {
        var v = e.config[k];
        if (/Model$/.test(k) && typeof v === 'string' && v) modelKeys.push({ entry: e.id, key: k, value: v });
      });
    });
  });
  if (modelKeys.length) {
    out.push(F({ ruleId: 'R12', dimension: 'modelCost', severity: 'P2',
      title: '插件声明了模型值，但无法静态核对运行时实际值（' + modelKeys.length + ' 处）',
      evidence: [facts.home + '/profiles'], measured: { declared: modelKeys },
      confidence: 'UNKNOWN', fixHint: '需在宿主内对照运行时注入值；静态审计只能标 UNKNOWN，不猜' }));
  }

  facts.profiles.forEach(function (p) {
    var ents = entriesOf(p.name);
    if (!ents.length) return;
    var llm = ents.filter(function (e) { return e.id === 'llm-pi-ai' && e.config; })[0];
    var comp = ents.filter(function (e) { return e.id === 'compaction-basic' && e.config; })[0];
    var def = ents.filter(function (e) { return e.id === 'agent-default-model' && e.config; })[0];
    var models = [];
    if (llm) {
      var provs = llm.config.providers || {};
      Object.keys(provs).forEach(function (pn) {
        (provs[pn].models || []).forEach(function (m) { models.push(pn + '/' + m.id); });
      });
    }
    var pol = comp ? (comp.config.modelPolicies || []).map(function (x) { return x.provider + '/' + x.model; }) : [];
    if (models.length) {
      var covered = models.filter(function (m) { return pol.indexOf(m) !== -1; }).length;
      var ratio = Math.round((covered / models.length) * 1000) / 10;
      var defKey = def ? (def.config.provider + '/' + def.config.model) : null;
      if (ratio < 50 || (defKey && pol.indexOf(defKey) === -1)) {
        out.push(F({ ruleId: 'R13', dimension: 'context', severity: 'P1',
          title: '压缩策略覆盖率 ' + ratio + '%（' + covered + '/' + models.length + '），' + p.name + (defKey ? (' 默认模型 ' + defKey + (pol.indexOf(defKey) === -1 ? ' 无策略' : ' 已覆盖')) : ' 未声明默认模型'),
          evidence: [p.dir + '/cordis.patch.yml'],
          measured: { coveragePct: ratio, policies: pol.length, models: models.length, defaultModel: defKey, defaultCovered: defKey ? pol.indexOf(defKey) !== -1 : null, profile: p.name },
          fixHint: 'L2: 给默认模型补一条 modelPolicy（headroom 参考现有机型的 8192/16384 档）' }));
      }
    }
  });

  var memBundles = [];
  facts.profiles.forEach(function (p) {
    p.bundles.forEach(function (b) {
      if (/(memory|mnemon|context|recall|chronicle|project-memory)/i.test(b)) memBundles.push(b);
    });
  });
  var uniqMem = memBundles.filter(function (b, i) { return memBundles.indexOf(b) === i; });
  if (uniqMem.length >= 3) {
    out.push(F({ ruleId: 'R16', dimension: 'context', severity: 'P2',
      title: '同时挂载 ' + uniqMem.length + ' 套记忆/上下文插件，每轮固定注入开销未量化',
      evidence: [facts.home + '/profiles'], measured: { bundles: uniqMem }, confidence: 'MEDIUM',
      // 竞品分析 P3：本插件拿不到 Session 句柄（tokenMeter 的三个方法全要 Session），
      // 所以「每轮注入多少 token」它测不了——不许猜，但也不再把这个任务丢回给用户：
      // 给出生态里已经能取到这个数的具体去处。
      fixHint: 'token 侧不猜：宿主的 tokenMeter.contextPressure 或第三方 dsh-context-budget 能给出每轮注入实测值；本插件拿不到 Session 句柄，只给「几套插件同时在注入」这个可测事实。定主备后关掉其余自动注入。' }));
  } else if (!uniqMem.length) {
    out.push(F({ ruleId: 'R16', dimension: 'context', severity: 'INFO', title: '未发现记忆/上下文插件', confidence: 'UNKNOWN' }));
  }

  var providerBlocks = [];
  facts.profiles.forEach(function (p) {
    var ents = entriesOf(p.name);
    var llm = ents.filter(function (e) { return e.id === 'llm-pi-ai' && e.config; })[0];
    if (llm) providerBlocks.push({ profile: p.name, key: JSON.stringify(llm.config.providers || {}) });
  });
  if (providerBlocks.length > 1) {
    var same = providerBlocks.every(function (b) { return b.key === providerBlocks[0].key; });
    if (!same) {
      out.push(F({ ruleId: 'R6', dimension: 'consistency', severity: 'P2',
        title: '多 profile 的 providers 段已漂移',
        evidence: [facts.home + '/profiles'],
        measured: { profiles: providerBlocks.map(function (b) { return b.profile; }) },
        fixHint: 'L2: 用 sync-providers.mjs --write 同步，或抽到 home 层' }));
    } else {
      out.push(F({ ruleId: 'R6', dimension: 'consistency', severity: 'INFO',
        title: '多 profile 的 providers 段一致（' + providerBlocks.length + ' 份副本）',
        confidence: 'MEASURED', measured: { profiles: providerBlocks.map(function (b) { return b.profile; }) } }));
    }
  }

  // ---- R19 workspace hygiene / R20 capability redundancy ----
  if (facts.workspace) {
    var w = facts.workspace;
    var issues = [];
    if (w.mediaFiles.length) issues.push('媒体/压缩包 ' + w.mediaFiles.length + ' 个');
    if (w.underscoreFiles >= 5) issues.push('_ 前缀散件 ' + w.underscoreFiles + ' 个');
    if (w.strayHtml.length) issues.push('裸 HTML ' + w.strayHtml.length + ' 个');
    // 开发中的插件仓不算卫生问题（作者工作流），单列并说明真实风险来源
    if (w.pycache) issues.push('__pycache__ 未清理');
    if (issues.length) {
      out.push(F({ ruleId: 'R19', dimension: 'disk', severity: w.pluginRepos.length ? 'P1' : 'P2',
        title: '默认工作区不干净：' + issues.join('，'),
        evidence: [w.workspace.path],
        measured: { rootFiles: w.rootFileCount, media: w.mediaFiles.slice(0, 8), underscore: w.underscoreFiles,
                    strayHtml: w.strayHtml.slice(0, 8), pluginRepos: w.pluginRepos, pycache: w.pycache },
        fixHint: '把散件归档到 _archive/<month>/；插件源码仓迁到独立目录并改 file:/link: 指向（不自动做）' }));
    } else {
      out.push(F({ ruleId: 'R19', dimension: 'disk', severity: 'INFO', title: '默认工作区未见明显散件', confidence: 'MEASURED' }));
    }
    if (w.pluginRepos.length) {
      out.push(F({ ruleId: 'R19b', dimension: 'disk', severity: 'INFO',
        title: '默认工作区里有 ' + w.pluginRepos.length + ' 个开发中的插件仓（' + w.pluginRepos.join('、') + '）',
        evidence: [w.workspace.path], measured: { dirs: w.pluginRepos }, advisory: true,
        fixHint: '不是垃圾；风险只在 profile 用 file:/link: 指向它们（见 R22）。要解耦就迁到 plugins/ 并改依赖' }));
    }
  } else {
    out.push(F({ ruleId: 'R19', dimension: 'disk', severity: 'INFO', title: '无法确定默认工作区（workspace.json 缺失或格式未知）', confidence: 'UNKNOWN' }));
  }

  var red = (facts.capabilities && facts.capabilities.redundancy) || [];
  red.forEach(function (r) {
    out.push(F({ ruleId: 'R20', dimension: 'plugins', severity: 'P2', advisory: true,
      title: '能力冗余：' + r.tag + ' 有 ' + r.count + ' 个实现',
      evidence: [facts.home + '/profiles'], measured: { tag: r.tag, plugins: r.plugins },
      fixHint: '定主备，关掉其余实现或改按需检索；不自动卸载' }));
  });
  if (!red.length) out.push(F({ ruleId: 'R20', dimension: 'plugins', severity: 'INFO', title: '未发现某能力被 3 个以上实现同时占用' }));

  // ---- R22 file:/link: 依赖目标存在性（开发仓与 profile 的耦合断点）----
  facts.profiles.forEach(function (p) {
    var broken = [];
    // 存在性在采集阶段已判定（facts.profiles[].localDeps），
    // 规则层不再碰文件系统——否则夹具在本机与 CI 上结论会不同。
    var locals = p.localDeps;
    if (!Array.isArray(locals)) {
      // 旧格式兜底：没有 localDeps 就算不出存在性，不报（宁可漏报也不误报）。
      locals = [];
    }
    locals.forEach(function (x) {
      if (x.exists === false) broken.push({ dep: x.dep, spec: x.spec, target: x.target });
    });
    if (broken.length) {
      out.push(F({ ruleId: 'R22', dimension: 'reliability', severity: 'P0',
        title: 'file:/link: 依赖目标不存在 ' + broken.length + ' 个（' + p.name + '）',
        evidence: [p.dir + '/package.json'], measured: { broken: broken },
        fixHint: '宿主启动时该依赖解析失败 → 对应 bundle 会被静默跳过。修：恢复目录，或改依赖指向' }));
    }
  });
  // ---- R21 agent preset 层 ----
  var presets = facts.agentPresets || [];
  if (!presets.length) {
    out.push(F({ ruleId: 'R21', dimension: 'plugins', severity: 'INFO', title: '未发现本地 agent preset（全部为内置预设）', confidence: 'UNKNOWN' }));
  } else {
    presets.forEach(function (ps) {
      var dep = null;
      facts.profiles.forEach(function (p) {
        p.deps.forEach(function (d) { if (!dep && d.toLowerCase().indexOf(ps.dir.toLowerCase()) !== -1) dep = d; });
        p.bundles.forEach(function (b) { if (!dep && b.toLowerCase().indexOf(ps.dir.toLowerCase()) !== -1) dep = b; });
      });
      if (!dep) {
        out.push(F({ ruleId: 'R21a', dimension: 'plugins', severity: 'P2',
          title: '预设『' + ps.name + '』没有对应的已安装插件（疑似孤儿预设）',
          evidence: [ps.path], measured: { dir: ps.dir, entryCount: ps.entryCount, entries: ps.entryIds.slice(0, 8) },
          confidence: 'MEDIUM', advisory: true,
          fixHint: '确认插件是否已移除；若是，删该预设目录即可（预设实时扫描，免重启）' }));
      }
      var missing = (ps.names || []).filter(function (n) {
        if (!n || n.indexOf('@deepseek-ai/') === 0) return false;
        var found = false;
        facts.profiles.forEach(function (p) {
          p.deps.forEach(function (d) { if (d === n) found = true; });
          p.bundles.forEach(function (b) { if (b === n) found = true; });
        });
        return !found;
      });
      if (missing.length) {
        out.push(F({ ruleId: 'R21b', dimension: 'plugins', severity: 'P2',
          title: '预设『' + ps.name + '』引用了未安装的插件 ' + missing.length + ' 个',
          evidence: [ps.path + '/agent.cordis.yml'], measured: { dir: ps.dir, missing: missing },
          confidence: 'MEDIUM', advisory: true, fixHint: '装回插件，或删除该预设' }));
      }
      if (ps.personaComplete && ps.runtimeContextOff) {
        out.push(F({ ruleId: 'R21d', dimension: 'plugins', severity: 'INFO',
          title: '预设『' + ps.name + '』屏蔽了运行时上下文（complete + includeRuntimeContext:false）',
          measured: { dir: ps.dir }, advisory: true,
          fixHint: '这类预设不适合拿来跑审计/诊断，会缺上下文信息' }));
      }
    });
    if (presets.length < 5) out.push(F({ ruleId: 'R21e', dimension: 'plugins', severity: 'INFO', title: '本地预设 ' + presets.length + ' 个，其余为内置（不可静态审计）', confidence: 'UNKNOWN' }));
    out.push(F({ ruleId: 'R21', dimension: 'plugins', severity: 'INFO',
      title: '本地 agent preset ' + presets.length + ' 个：' + presets.map(function (p) { return p.name + '(' + p.entryCount + ' 条目)'; }).join('，'),
      measured: { presets: presets.map(function (p) { return { name: p.name, entries: p.entryCount, names: p.names }; }) } }));
  }

  // ---- R23 bundle 必须声明 dsh.bundle，否则宿主静默跳过该层 ----
  // 审计反哺 V07：判据在采集层（collect 的 noManifestBundles），规则层只读事实——
  // 原来规则层直接 readJson 文件系统，夹具永远盖不到这条 P0 规则（判别逻辑零测试）。
  facts.profiles.forEach(function (p) {
    if (!Array.isArray(p.noManifestBundles)) return;   // 旧形状兜底：取不到判据不报（宁可漏报不误报）
    if (p.noManifestBundles.length) {
      out.push(F({ ruleId: 'R23', dimension: 'reliability', severity: 'P0',
        title: 'bundle 未声明 dsh.bundle，宿主会静默跳过 ' + p.noManifestBundles.length + ' 个（' + p.name + '）',
        evidence: [p.dir + '/package.json'], measured: { bundles: p.noManifestBundles, profile: p.name },
        fixHint: '在包 package.json 补 dsh.bundle.patch；否则启动日志里只有一行 skipping profile bundle' }));
    }
  });

  // 架构审计 P0-A2：profile 读不出来时必须显式承认「我没看全」。
  // 严重度按 P0：host 启动时同样会跳过坏 profile，这已经不是审计噪声而是系统坏了；
  // 封顶规则随之生效（P0 未关闭 → 总分封 5.0），正是要它显眼。
  (facts.profileErrors || []).forEach(function (pe) {
    out.push(F({
      ruleId: 'R24',
      dimension: 'reliability',
      severity: 'P0',
      title: 'profile「' + pe.name + '」未被体检：' + (pe.reason === 'parse-error' ? 'package.json 解析失败' : '有 node_modules 但没有 package.json'),
      evidence: [pe.dir],
      measured: { profile: pe.name, reason: pe.reason },
      confidence: 'MEASURED',
      fixHint: '修好该 profile 的 package.json（或删掉残留目录）后重跑体检；在此之前报告是残缺的，别把它当成健康。',
      fp: 'R24#' + pe.name,
    }));
  });
  return out;
}
