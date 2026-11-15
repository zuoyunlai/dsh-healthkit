import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './util.mjs';

function fpOf(o) {
  var m = o.measured || {};
  var tail = m.tag || m.dir || (m.packages && m.packages[0]) || (m.stale && m.stale[0] && m.stale[0].entry) || (m.dead && m.dead[0]) || m.profile || '';
  return o.ruleId + (tail ? '#' + String(tail).slice(0, 60) : '');
}

function F(o) {
  return { id: o.id, ruleId: o.ruleId, dimension: o.dimension, severity: o.severity, title: o.title,
    evidence: o.evidence || [], measured: o.measured || {}, confidence: o.confidence || 'MEASURED', advisory: o.advisory === true,
    fixHint: o.fixHint || null, fp: o.fp || fpOf(o) };
}
function installedVersion(home, profileDir, name) {
  var p = path.join(profileDir, 'node_modules', name, 'package.json');
  var j = readJson(p, null);
  return j ? j.version : null;
}

export function runRules(facts, allowlist) {
  var out = [];
  var cfg = allowlist || {};
  var allow = cfg.depsNotBundled || {};

  for (var i = 0; i < facts.profiles.length; i++) {
    var p = facts.profiles[i];

    var realNotBundled = p.depsNotBundled.filter(function (d) { return !allow[d]; });
    if (realNotBundled.length) out.push(F({ ruleId: 'R1', dimension: 'consistency', severity: 'P1',
      title: '装了但未挂载的依赖 ' + realNotBundled.length + ' 个（' + p.name + '）',
      evidence: [p.dir + '/package.json'], measured: { count: realNotBundled.length, packages: realNotBundled },
      fixHint: 'L3-plan: dsh plugin --profile ' + p.name + ' remove ' + realNotBundled.join(' ') }));

    var entries = facts.patchEntries[p.name];
    if (Array.isArray(entries)) {
      var coreIds = entries.filter(function (e) { return e.name && e.name.indexOf('@deepseek-ai/') === 0; }).map(function (e) { return e.id; });
      var disabledIds = entries.filter(function (e) { return e.disabled; }).map(function (e) { return e.id; });
      var suspicious = disabledIds.filter(function (id) {
        if (coreIds.indexOf(id) !== -1) return false;
        if (facts.bundleIndex) return !((facts.bundleIndex.idToBundles || {})[id]);
        if ((cfg.corePatchIds || []).indexOf(id) !== -1) return false;
        var guesses = [id, '@michengai/' + id, '@deepseek-ai/' + id];
        return guesses.every(function (g) { return !p.deps.includes(g); });
      });
      if (suspicious.length) out.push(F({ ruleId: 'R2', dimension: 'consistency', severity: 'P2',
        title: 'disabled 指向的包不在依赖里（疑似空转） ' + suspicious.length + ' 条',
        evidence: [p.dir + '/cordis.patch.yml'], measured: { suspicious: suspicious }, confidence: facts.bundleIndex ? 'MEASURED' : 'MEDIUM',
        fixHint: '先用 --probe-all 确认该 id 是否存在于组合树，再删除条目（不要凭猜删）' }));
    } else if (entries && entries.error) {
      out.push(F({ ruleId: 'R2c', dimension: 'consistency', severity: 'P0', title: 'patch YAML 解析失败：' + entries.error, evidence: [p.dir + '/cordis.patch.yml'] }));
    }

    var excl = facts.exclusions[p.name];
    if (Array.isArray(excl)) {
      var dead = [], stale = [], unresolved = [];
      excl.forEach(function (entry) {
        var m = String(entry).match(/^(@?[^@]+)@(.+)$/);
        if (!m) return;
        var nm = m[1];
        var vers = m[2].split('||').map(function (s) { return s.trim(); });
        var inst = installedVersion(facts.home, p.dir, nm);
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

  var machinesFile = path.join(facts.home, 'remote-workspaces', 'machines.json');
  if (fs.existsSync(machinesFile)) {
    var machines = readJson(machinesFile, null);
    var list = machines && (Array.isArray(machines) ? machines : (machines.list || machines.machines || []));
    if (Array.isArray(list)) {
      var risky = [];
      list.forEach(function (m) {
        if (m.useSshConfig && !m.privateKeyPath) return;   // alias 由 ~/.ssh/config 解析，密钥位置不归本规则管
        var kp = m.privateKeyPath || m.keyPath || null;
        if (kp && (/(^|[\\/])(Downloads|Desktop)([\\/]|$)/i.test(kp) || !/^\.ssh|[\\/]\.ssh[\\/]/.test(kp))) risky.push({ name: m.name || m.host, host: m.host, keyPath: kp });
      });
      if (risky.length) out.push(F({ ruleId: 'R9', dimension: 'security', severity: 'P0',
        title: '外部密钥不在 ~/.ssh 下 ' + risky.length + ' 把', evidence: [machinesFile], measured: { machines: risky },
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
      evidence: [facts.home + '/' + d.name],
      measured: { mb: Math.round(d.bytes / 1048576), approx: !!d.truncated, oldestAgeDays: d.oldestAgeDays,
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
          measured: { coveragePct: ratio, policies: pol.length, models: models.length, defaultModel: defKey, defaultCovered: defKey ? pol.indexOf(defKey) !== -1 : null },
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
      fixHint: '需宿主内采样每轮注入 token；定主备后关掉其余自动注入' }));
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
    p.deps.forEach(function (d) {
      var v = (p.installed && p.installed[d]) || null;
      var spec = null;
      Object.keys(p.depSpecs || {}).forEach(function (k) { if (k === d) spec = p.depSpecs[k]; });
      if (!spec) return;
      var m = String(spec).match(/^(file|link):(.+)$/);
      if (!m) return;
      var target = m[2];
      var ok = false;
      try { ok = fs.existsSync(target); } catch (e) { ok = false; }
      if (!ok) broken.push({ dep: d, spec: spec });
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
  facts.profiles.forEach(function (p) {
    var nativeBundles = p.bundles.filter(function (b) { return b.indexOf('@deepseek-ai/') !== 0; });
    var noManifest = [];
    nativeBundles.forEach(function (b) {
      var pj = readJson(path.join(p.dir, 'node_modules', b, 'package.json'), null);
      if (!pj) return;
      if (!pj.dsh || !pj.dsh.bundle) noManifest.push(b);
    });
    if (noManifest.length) {
      out.push(F({ ruleId: 'R23', dimension: 'reliability', severity: 'P0',
        title: 'bundle 未声明 dsh.bundle，宿主会静默跳过 ' + noManifest.length + ' 个（' + p.name + '）',
        evidence: [p.dir + '/package.json'], measured: { bundles: noManifest },
        fixHint: '在包 package.json 补 dsh.bundle.patch；否则启动日志里只有一行 skipping profile bundle' }));
    }
  });

  return out;
}
