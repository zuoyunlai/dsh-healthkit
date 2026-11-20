// 工具面（Host 半边的一半）：21 个工具的定义、JSON Schema 与 execute。
//
// 为什么单独成文件（0.13.2，审计 P2-4b）：原来这些和插件外壳（apply / status 落盘）
// 挤在 index.js 里共 1,509 行，改一个工具要在一千多行里跳来跳去，工具数还被硬编码在
// init 文案、README 表、两处测试里各写一遍（历史上为此刻意同步过四次）。
// 现在：**工具面 = 本文件**，**宿主外壳 = index.js**，工具数由 `TOOL_COUNT` 单一真源导出。
//
// 依赖只有四样：fs / path / resolveReportPath / dshHome。执行体里的重活全部走动态 import，
// 所以本文件被 import 时不会读盘、不会扫盘。
import fs from 'node:fs';
import path from 'node:path';
import { resolveReportPath } from './reportpath.mjs';
import { dshHome } from './paths.mjs';

export const msg = (e) => (e && e.message ? e.message : String(e));
const text = (s) => [{ type: 'text', text: s }];

const RUN_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    raw: { type: 'number' },
    band: { type: 'string' },
    p0: { type: 'number' },
    p1: { type: 'number' },
    p2: { type: 'number' },
    findings: { type: 'number' },
    retired: { type: 'number' },
    summary: { type: 'string' },
    gains: { type: 'array', items: { type: 'string' } },
    // 2026-11-20 审计 P3：execute 一直在返回这两个字段却没声明（严格 schema 校验会丢）。
    headline: { type: 'string' },
    topActions: { type: 'array', items: { type: 'string' } },
  },
  required: ['score', 'band', 'p0', 'p1', 'p2', 'findings', 'summary'],
};

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    score: { type: 'number' },
    findings: { type: 'number' },
    bytes: { type: 'number' },
    via: { type: 'string' },
  },
  required: ['path', 'score', 'findings'],
};

const CLEAN_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    ok: { type: 'boolean' },
    freedBytes: { type: 'number' },
    moved: { type: 'number' },
    dryRun: { type: 'boolean' },
    batch: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['action', 'ok', 'summary'],
};

const FEEDBACK_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    answered: { type: 'number' },
    unknown: { type: 'number' },
    firstValueRate: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['ok', 'summary'],
};

const DIGEST_SCHEMA = {
  type: 'object',
  properties: {
    changed: { type: 'boolean' },
    headline: { type: 'string' },
    reason: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['changed', 'summary'],
};

const TREND_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    days: { type: 'number' },
    runs: { type: 'number' },
    daysTracked: { type: 'number' },
    latest: { type: 'number' },
    delta: { type: 'number' },
    avg7: { type: 'number' },
    p0: { type: 'number' },
    sparkline: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['action', 'summary'],
};



const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    hasPending: { type: 'boolean' },
    at: { type: 'string' },
    bootAt: { type: 'string' },
    fixed: { type: 'number' },
    stillThere: { type: 'number' },
    muted: { type: 'number' },
    unverifiable: { type: 'number' },
    notApplicable: { type: 'number' },
    regressions: { type: 'number' },
    timeline: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['ok', 'summary'],
};


const CHECK_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    contract: { type: 'string' },
    schema: { type: 'string' },
    exit: { type: 'number' },
    exitCode: { type: 'number' },
    mode: { type: 'string' },
    profile: { type: 'string' },
    generatedAt: { type: 'string' },
    pass: { type: 'number' },
    warn: { type: 'number' },
    fail: { type: 'number' },
    newFail: { type: 'number' },
    newWarn: { type: 'number' },
    suppressed: { type: 'number' },
    fudged: { type: 'boolean' },
    baselineAt: { type: 'string' },
    baselineScore: { type: 'number' },
    note: { type: 'string' },
    remediation: { type: 'array', items: { type: 'string' } },
    items: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['ok', 'contract', 'exit', 'summary'],
};


const RECOMMEND_SCHEMA = {
  type: 'object',
  properties: {
    schema: { type: 'string' },
    domains: { type: 'number' },
    items: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['schema', 'domains', 'summary'],
};

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    total: { type: 'number' },
    retired: { type: 'number' },
    p0: { type: 'number' },
    p1: { type: 'number' },
    p2: { type: 'number' },
    info: { type: 'number' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fp: { type: 'string' },
          ruleId: { type: 'string' },
          severity: { type: 'string' },
          dimension: { type: 'string' },
          title: { type: 'string' },
          target: { type: 'string' },
          fixHint: { type: 'string' },
        },
        required: ['fp', 'ruleId', 'severity', 'title'],
      },
    },
    summary: { type: 'string' },
  },
  required: ['total', 'p0', 'p1', 'p2', 'summary'],
};

const EXPLAIN_SCHEMA = {
  type: 'object',
  properties: {
    found: { type: 'boolean' },
    fp: { type: 'string' },
    ruleId: { type: 'string' },
    severity: { type: 'string' },
    dimension: { type: 'string' },
    title: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    measured: { type: 'string' },
    confidence: { type: 'string' },
    fixHint: { type: 'string' },
    retired: { type: 'boolean' },
    candidates: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['found', 'summary'],
};

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    base: { type: 'number' },
    potentialAll: { type: 'number' },
    steps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['steps', 'summary'],
};


const TRIM_SCHEMA = {
  type: 'object',
  properties: {
    served: { type: 'number' },
    maxBundles: { type: 'number' },
    thirdParty: { type: 'number' },
    memory: { type: 'number' },
    groups: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['served', 'suggestions', 'summary'],
};


const CAPS_SCHEMA = {
  type: 'object',
  properties: {
    present: { type: 'number' },
    redundant: { type: 'number' },
    conflicting: { type: 'number' },
    degraded: { type: 'number' },
    missing: { type: 'number' },
    unknown: { type: 'number' },
    ok: { type: 'number' },
    rows: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['present', 'redundant', 'missing', 'summary'],
};


const RETIRE_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string' },
    ok: { type: 'boolean' },
    fp: { type: 'string' },
    reason: { type: 'string' },
    title: { type: 'string' },
    total: { type: 'number' },
    items: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
  required: ['action', 'ok', 'summary'],
};


const DIFF_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    prevAt: { type: 'string' },
    curAt: { type: 'string' },
    prevScore: { type: 'number' },
    curScore: { type: 'number' },
    delta: { type: 'number' },
    added: { type: 'array', items: { type: 'string' } },
    fixed: { type: 'array', items: { type: 'string' } },
    newlyRetired: { type: 'array', items: { type: 'string' } },
    kept: { type: 'number' },
    summary: { type: 'string' },
  },
  required: ['ok', 'summary'],
};

// 工具表按「每次 apply 的依赖」构建：report 落点需要会话工作区解析器，
// 不能写成模块级闭包（那样每个宿主实例会共享同一份依赖）。
// inject 回调拿到的是 **ctx**，服务要经 .get(name) 取。
// 抽成纯函数是为了能被测试钉住：0.5.1 就是把这个 ctx 直接当 webServer 传了。
export function resolveWebServer(injected) {
  if (!injected || typeof injected.get !== 'function') return null;
  try {
    const ws = injected.get('webServer');
    return (ws && typeof ws.register === 'function') ? ws : null;
  } catch (e) {
    return null;
  }
}

export function buildTools(deps) {
  const d = deps || {};
  const resolveWorkspace = (typeof d.resolveWorkspace === 'function') ? d.resolveWorkspace : function () { return null; };
  const pluginConfig = (d.config && typeof d.config === 'object') ? d.config : {};
  return [
  {
    name: 'audit_run',
    description: '对当前 DSH 安装跑一次只读体检：返回总分、分档与 P0/P1/P2 计数。只读指「不碰被检对象」——会向插件自己的数据目录写一条账本与一份运行快照（record=false 可关）。不联网',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
        record: { type: 'boolean', description: '是否记账本与运行快照（写插件自己的数据目录，不碰被检对象），缺省 true' },
      },
      additionalProperties: false,
    },
    output: {
      schema: RUN_SCHEMA,
      render(_args, v) {
        const lines = [
          'dsh-healthkit · ' + v.score + '/10（' + v.band + '）',
          'P0 ' + v.p0 + ' · P1 ' + v.p1 + ' · P2 ' + v.p2 + ' · 共 ' + v.findings + ' 条 · 已退役 ' + v.retired,
          '',
          v.summary,
        ];
        if (v.gains && v.gains.length) {
          lines.push('');
          lines.push('— 先修哪几条 —');
          for (const g of v.gains) lines.push(g);
        }
        return text(lines.join('\n'));
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      // 记账 + 快照：写的是插件自己的数据目录，不碰被检对象；record=false 可关（审计反哺 V09）。
      if (!args || args.record !== false) {
        const hist = await import('./history.mjs');
        hist.append(r, { scenario: (args && args.scenario) || 'general', source: 'agent' });
        // 写运行快照：跨次差异归因的基线（audit_diff 用）。
        try {
          const snap = await import('./snapshot.mjs');
          snap.writeRun(r, { home: r.facts.home, scenario: (args && args.scenario) || 'general', version: r.self.version });
        } catch (e) { /* 快照写失败不该让体检失败 */ }
        // 写待验清单：下次宿主重启时，插件开机自动核对「上次说的该修的，修好了没、有没有搞坏别的」。
        try {
          const ver = await import('./verify.mjs');
          ver.writePending(r, { home: r.facts.home });
        } catch (e) { /* 待验清单写失败不该让体检失败 */ }
      }
      const { renderFirstScreen, countBySeverity } = await import('./digest.mjs');
      const by = countBySeverity(r.findings);
      // 产品审计 P0：健康机器的首屏不该是「14 行 INFO + 3 条 P2」。
      // 改成 1 句结论 + ≤3 条最值得动的 + 其余一句话收走（全量仍走 audit_findings）。
      const first = renderFirstScreen(r, { limit: 3 });
      return {
        score: r.score.total,
        raw: r.score.raw,
        band: r.score.band,
        p0: by.P0 || 0,
        p1: by.P1 || 0,
        p2: by.P2 || 0,
        findings: r.findings.length,
        retired: r.retired.length,
        headline: first.headline,
        topActions: first.topActions.length,
        summary: first.lines.join('\n'),
        gains: (() => {
          const a = r.attribution;
          const out = [];
          if (a && a.stage1) out.push('第一步｜关掉 ' + a.stage1.count + ' 条 P0：' + a.stage1.from + ' → ' + a.stage1.to + '（' + (a.stage1.delta > 0 ? '+' : '') + a.stage1.delta + '）');
          if (a && a.rows && a.rows.length) {
            out.push('第二步｜基准 ' + a.stage2Base + '：' + a.rows.slice(0, 3).map((x) => x.ruleId + ' +' + x.delta).join(' · '));
          }
          if (a) out.push('全修完 → ' + a.potentialAll + '/10');
          return out;
        })(),
      };
    },
  },
  {
    name: 'audit_report',
    description: '跑一次体检，把完整 Markdown 报告写成文件：缺省写本会话工作区的 AUDIT-<日期>.md；给了 out 则按 out（相对路径以会话工作区为基准）；取不到工作区时退到 $DSH_HOME/dsh-healthkit/reports/。返回路径、落点来源与摘要',
    parameters: {
      type: 'object',
      properties: {
        out: { type: 'string', description: '报告输出路径：绝对路径照用，相对路径以本会话工作区为基准；缺省 = 会话工作区下的 AUDIT-<日期>.md。注意：不接受「相对 process.cwd」的旧语义' },
        format: { type: 'string', description: 'md（默认，人读 Markdown）| json（机器可读全量报告，写同名 .json）' },
      },
      additionalProperties: false,
    },
    output: {
      schema: REPORT_SCHEMA,
      render(_args, v) {
        return text('报告已写入 ' + v.path
          + '\n落点 ' + (v.via || '?') + ' · 总分 ' + v.score + ' · 问题 ' + v.findings + ' 条 · ' + v.bytes + ' 字节');
      },
    },
    execute: async (args, exec) => {
      const { audit } = await import('./engine.mjs');
      const r = audit({ scenario: 'general' });
      const hist = await import('./history.mjs');
      hist.append(r, { scenario: 'general' });
      // 也写待验清单：重启后开机核对的是「最近一次体检」的结论，audit_report 也是一次体检。
      try {
        const ver = await import('./verify.mjs');
        ver.writePending(r, { home: r.facts.home });
      } catch (e) { /* 待验清单写失败不该让体检失败 */ }
      const workspace = resolveWorkspace(exec);
      const target = resolveReportPath({
        out: args && args.out,
        reportDir: pluginConfig.reportDir,
        workspace,
      });
      if (target.error) throw new Error('audit_report: ' + target.error);
      // 2026-11-20 审计 P1：模型面可传绝对 out。缺边界时一条 audit_report
      // 就能把 profile 的 package.json 写成体检 JSON（与「只读」承诺冲突）。
      // 只允许 DSH_HOME 之外的路径、插件自己的 reports 目录、或会话工作区。
      {
        const { dataDir } = await import('./paths.mjs');
        const home0 = r.facts.home;
        const reportsDir = path.join(dataDir(home0), 'reports');
        const inside = (p, root) => {
          if (!root) return false;
          const rel = path.relative(root, p);
          return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
        };
        if (inside(target.path, home0) && !inside(target.path, reportsDir) && !inside(target.path, workspace)) {
          throw new Error('audit_report: 拒绝写入 DSH_HOME 内的路径（会覆盖被检配置）：' + target.path + '；请改到工作区或插件 reports 目录');
        }
      }
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      // format=json → 机器可读全量报告（schema: dsh-healthkit/report/v1），供其他插件/脚本消费。
      if (args && args.format === 'json') {
        const { buildJsonReport } = await import('./report-json.mjs');
        const rep = buildJsonReport(r, { version: r.self && r.self.version });
        const { jsonReportPath } = await import('./reportpath.mjs');
        const jsonPath = jsonReportPath(target.path);
        fs.writeFileSync(jsonPath, JSON.stringify(rep, null, 2) + '\n', 'utf8');
        return {
          path: jsonPath,
          via: target.source,
          score: r.score.total,
          findings: r.findings.length,
          bytes: Buffer.byteLength(JSON.stringify(rep, 'utf8'), 'utf8'),
        };
      }
      fs.writeFileSync(target.path, r.report, 'utf8');
      return {
        path: target.path,
        via: target.source,
        score: r.score.total,
        findings: r.findings.length,
        bytes: Buffer.byteLength(r.report, 'utf8'),
      };
    },
  },
  {
    name: 'audit_clean',
    description: '清理会话外的可再生垃圾（缓存/过期备份/过期索引/远程镜像）：默认只预览，执行也是先移入回收区、7 天内可还原，绝不直删',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'preview|apply|restore|list|purge，缺省 preview' },
        ids: { type: 'array', items: { type: 'string' }, description: 'apply 时要清理的分组 id（从 preview 拿）' },
        confirm: { type: 'boolean', description: '允许动「需确认」档（远程工作区镜像）' },
        dryRun: { type: 'boolean', description: '只演不练' },
        batch: { type: 'string', description: 'restore 时的批次号' },
        olderThanDays: { type: 'number', description: 'purge 的天数门槛，缺省 7' },
      },
      additionalProperties: false,
    },
    output: {
      schema: CLEAN_SCHEMA,
      render(_args, v) {
        return text('dsh-healthkit · clean/' + v.action + (v.dryRun ? '（预演）' : '') + '\n' + v.summary);
      },
    },
    execute: async (args) => {
      const { scan, apply, restore, listBatches, purge, renderScan, fmtBytes } = await import('./clean.mjs');
      const a = (args && args.action) || 'preview';
      if (a === 'preview') {
        const s = scan({});
        return { action: 'preview', ok: true, freedBytes: s.safeBytes, moved: 0, dryRun: true, batch: '', summary: renderScan(s) };
      }
      if (a === 'list') {
        const bs = listBatches();
        const summary = bs.length
          ? bs.map((b) => b.batch + ' · ' + fmtBytes(b.bytes) + ' · ' + b.entries + ' 项 · ' + (b.ageDays === null ? '' : b.ageDays + ' 天前') + ' · 还原截止 ' + (b.restoreBefore || '-')).join('\n')
          : '回收区为空';
        return { action: 'list', ok: true, freedBytes: 0, moved: 0, dryRun: true, batch: '', summary };
      }
      if (a === 'apply') {
        const r = apply((args && args.ids) || [], { confirm: !!(args && args.confirm), dryRun: !!(args && args.dryRun) });
        if (!r.ok) return { action: 'apply', ok: false, freedBytes: 0, moved: 0, dryRun: !!(args && args.dryRun), batch: '', summary: '未执行：' + r.error + ((r.skipped && r.skipped.length) ? '\n' + r.skipped.join('\n') : '') };
        const head = (r.dryRun ? '预演：将释放 ' : '已释放 ') + fmtBytes(r.freedBytes) + '，' + r.items.length + ' 项';
        const tail = r.batch ? '\n批次 ' + r.batch + '，还原截止 ' + r.restoreBefore + '（audit_clean action=restore batch=' + r.batch + '）' : '';
        const skips = (r.skipped && r.skipped.length) ? '\n跳过 ' + r.skipped.length + ' 项：\n' + r.skipped.join('\n') : '';
        return { action: 'apply', ok: true, freedBytes: r.freedBytes, moved: r.items.length, dryRun: !!r.dryRun, batch: r.batch || '', summary: head + tail + skips };
      }
      if (a === 'restore') {
        const r = restore(args && args.batch);
        if (!r.ok) return { action: 'restore', ok: false, freedBytes: 0, moved: 0, dryRun: false, batch: String((args && args.batch) || ''), summary: '还原失败：' + r.error };
        const s = '已还原 ' + r.restored.length + ' 项' + (r.conflicts.length ? '，冲突 ' + r.conflicts.length + ' 项\n' + r.conflicts.join('\n') : '');
        return { action: 'restore', ok: true, freedBytes: 0, moved: r.restored.length, dryRun: false, batch: String(r.batch || ''), summary: s };
      }
      if (a === 'purge') {
        // 2026-11-20 审计 P1：purge 是唯一不可逆动作，模型面必须显式确认（CLI 有独立旗标）。
        if (!(args && args.confirm)) {
          const p0 = purge({ olderThanDays: (args && args.olderThanDays) || 7, dryRun: true });
          return { action: 'purge', ok: false, freedBytes: 0, moved: 0, dryRun: true, batch: '',
            summary: '未执行：purge 会永久删除回收区批次，需 confirm=true。\n预演：将删除 ' + p0.candidates.length + ' 个批次，' + fmtBytes(p0.bytes) + (p0.refused && p0.refused.length ? '\n拒绝 ' + p0.refused.length + ' 个（清单含受保护路径）' : '') };
        }
        const r = purge({ olderThanDays: (args && args.olderThanDays) || 7, dryRun: !!(args && args.dryRun) });
        const n = r.dryRun ? r.candidates.length : r.purged.length;
        let s = (r.dryRun ? '预演：将永久删除 ' : '已永久删除 ') + n + ' 个批次，' + fmtBytes(r.bytes);
        // 护栏二次校验拦下的批次必须报出来，否则「少删了」会被当成删干净了。
        if (r.refused && r.refused.length) {
          s += '\n拒绝 ' + r.refused.length + ' 个批次（清单含受保护路径，不解封）：\n' +
            r.refused.map((x) => x.batch + ' · ' + x.path).join('\n');
        }
        return { action: 'purge', ok: true, freedBytes: r.bytes, moved: n, dryRun: !!r.dryRun, batch: '', summary: s };
      }
      return { action: String(a), ok: false, freedBytes: 0, moved: 0, dryRun: true, batch: '', summary: '未知 action：' + a + '（preview|apply|restore|list|purge）' };
    },
  },
  {
    name: 'audit_trend',
    description: '看分数历史：近 N 天的体检次数、最新分与变化、均值、最好/最差、P0 未关，附 sparkline（账本只读，每日折叠）',
    parameters: {
      type: 'object',
      properties: { days: { type: 'number', description: '回看天数，缺省 30' } },
      additionalProperties: false,
    },
    output: {
      schema: TREND_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { stats, renderStats } = await import('./history.mjs');
      const s = stats({ days: (args && args.days) || 30 });
      const num = (x) => (typeof x === 'number' ? x : 0);
      return {
        action: 'trend',
        days: num(s.days),
        runs: num(s.runs),
        daysTracked: num(s.daysTracked),
        latest: num(s.latest),
        delta: num(s.delta),
        avg7: num(s.avg7),
        p0: num(s.p0),
        sparkline: s.sparkline || '',
        summary: renderStats(s),
      };
    },
  },
  {
    name: 'audit_feedback',
    description: '首次价值信号：对某条发现回答「这条我原先知道 / 不知道」，只记在本机（不联网、不外发），用来算这个插件的首次价值率。传 finding=fp 或规则号',
    parameters: {
      type: 'object',
      properties: {
        finding: { type: 'string', description: '发现的指纹 fp，或规则号（如 R17）' },
        known: { type: 'boolean', description: 'true = 我原先就知道；false = 我原先不知道' },
        note: { type: 'string', description: '可选备注（为什么不知道/为什么没用）' },
      },
      required: ['finding', 'known'],
      additionalProperties: false,
    },
    output: {
      schema: FEEDBACK_SCHEMA,
      render(_args, v) { return text(v.summary); },
    },
    execute: async (args) => {
      const a = args || {};
      const key = String(a.finding || '').trim();
      if (!key) return { ok: false, answered: 0, unknown: 0, firstValueRate: 0, summary: '要给 finding（fp 或规则号）。' };
      const { audit } = await import('./engine.mjs');
      const fb = await import('./feedback.mjs');
      const r = audit({ scenario: 'general' });
      const pool = (r.allFindings || []).concat(r.retired || []);
      const hit = pool.find((f) => f.fp === key || f.ruleId === key);
      if (!hit) {
        return { ok: false, answered: 0, unknown: 0, firstValueRate: 0, summary: '没有匹配的发现：' + key + '（用 audit_findings 看 fp）' };
      }
      fb.append(r.facts.home, {
        at: new Date().toISOString(),
        fp: hit.fp,
        ruleId: hit.ruleId,
        severity: hit.severity,
        title: hit.title || '',
        known: a.known === true,
        note: a.note ? String(a.note).slice(0, 200) : null,
      });
      const s = fb.stats(r.facts.home);
      return {
        ok: true,
        answered: s.answered,
        unknown: s.unknown,
        firstValueRate: typeof s.firstValueRate === 'number' ? s.firstValueRate : 0,
        summary: '已记下：`' + hit.ruleId + '` ' + (a.known === true ? '原先就知道' : '原先不知道') + '。\n' + fb.renderStats(s),
      };
    },
  },
  {
    name: 'audit_digest',
    description: '差异驱动的周报摘要：与上次相比变了什么（分数/新增/真修好/新退役）、上次说该修的现在怎样；没有变化时只说一句「无变化」而不是复述。只读，不记账',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
        limit: { type: 'number', description: '「最值得动」的条数，缺省 3，最大 5' },
      },
      additionalProperties: false,
    },
    output: {
      schema: DIGEST_SCHEMA,
      render(_args, v) { return text(v.summary); },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const { buildDigest } = await import('./weekly.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      const lim = Math.max(1, Math.min(5, Number((args && args.limit) || 3)));
      const d = buildDigest(r, { limit: lim });
      return {
        changed: d.changed === true,
        headline: d.headline || '',
        reason: d.reason || '',
        summary: d.lines.join('\n'),
      };
    },
  },
  {
    name: 'audit_findings',
    description: '列出体检发现的问题（按严重度排序），带指纹 fp、规则号、维度与修法提示。只读，不改配置；要「为什么扣分」用 audit_explain，要「先修哪条」用 audit_plan',
    parameters: {
      type: 'object',
      properties: {
        severity: { type: 'string', description: 'P0|P1|P2|INFO|all，缺省 all' },
        limit: { type: 'number', description: '返回条数上限，缺省 20，最大 50' },
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
      },
      additionalProperties: false,
    },
    output: {
      schema: FINDINGS_SCHEMA,
      render(_args, v) {
        const head = '发现 ' + v.total + ' 条（P0 ' + v.p0 + ' · P1 ' + v.p1 + ' · P2 ' + v.p2 + ' · INFO ' + v.info + '）· 已退役 ' + v.retired;
        return text(head + '\n\n' + v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const a = args || {};
      const r = audit({ scenario: a.scenario || 'general' });
      const order = { P0: 0, P1: 1, P2: 2, INFO: 3 };
      const all = r.findings.slice().sort((x, y) => {
        const dx = order[x.severity] === undefined ? 9 : order[x.severity];
        const dy = order[y.severity] === undefined ? 9 : order[y.severity];
        return dx - dy;
      });
      const by = { P0: 0, P1: 0, P2: 0, INFO: 0 };
      all.forEach((f) => { if (by[f.severity] !== undefined) by[f.severity] += 1; });
      const sev = a.severity && a.severity !== 'all' ? a.severity : null;
      const picked = sev ? all.filter((f) => f.severity === sev) : all;
      const limit = Math.max(1, Math.min(50, typeof a.limit === 'number' ? a.limit : 20));
      const items = picked.slice(0, limit).map((f) => ({
        fp: f.fp,
        ruleId: f.ruleId,
        severity: f.severity,
        dimension: f.dimension || '',
        title: f.title || '',
        target: f.target || '',
        fixHint: f.fixHint || '',
      }));
      const lines = items.map((x, i) => (i + 1) + '. [' + x.severity + '] ' + x.ruleId + ' ' + x.title + (x.target ? ' @ ' + x.target : '') + '\n   fp: ' + x.fp);
      if (picked.length > items.length) lines.push('… 还有 ' + (picked.length - items.length) + ' 条未列出（加大 limit 或按 severity 过滤）');
      if (!items.length) lines.push(sev ? '（没有 ' + sev + ' 级问题）' : '（没有未退役的问题）');
      return {
        total: all.length,
        retired: r.retired.length,
        p0: by.P0,
        p1: by.P1,
        p2: by.P2,
        info: by.INFO,
        items,
        summary: lines.join('\n'),
      };
    },
  },
  {
    name: 'audit_explain',
    description: '解释一条体检发现：它落在哪个维度、证据是什么、测到的数值、置信度与修法。传指纹 fp 或规则号（如 R14）；空参则列出当前全部候选',
    parameters: {
      type: 'object',
      properties: {
        finding: { type: 'string', description: '指纹 fp（如 R14#2f1a）或规则号（如 R14）' },
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
      },
      additionalProperties: false,
    },
    output: {
      schema: EXPLAIN_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const a = args || {};
      const r = audit({ scenario: a.scenario || 'general' });
      const all = r.allFindings || r.findings;
      const key = String(a.finding || '').trim();
      let hit = null;
      if (key) {
        hit = all.find((f) => f.fp === key) || null;
        if (!hit) hit = all.find((f) => f.ruleId === key) || null;
        if (!hit) {
          const near = all.filter((f) => f.ruleId.indexOf(key) > -1 || f.fp.indexOf(key) > -1).slice(0, 10);
          const cands = near.map((f) => f.severity + ' ' + f.ruleId + ' ' + f.fp + '  ' + f.title);
          return {
            found: false,
            candidates: cands,
            summary: '没找到「' + key + '」。' + (cands.length ? '相近的候选：\n' + cands.map((c) => '- ' + c).join('\n') : '当前没有问题可匹配；先跑 audit_findings 看全部。'),
          };
        }
      } else {
        const cands = all.slice(0, 12).map((f) => f.severity + ' ' + f.ruleId + ' ' + f.fp + '  ' + f.title);
        return {
          found: false,
          candidates: cands,
          summary: '需要指定要解释哪一条（fp 或规则号）。当前候选：\n' + cands.map((c) => '- ' + c).join('\n'),
        };
      }
      const isRetired = !!hit.retired;
      const measured = JSON.stringify(hit.measured || {}, null, 2);
      const lines = [
        '[' + hit.severity + '] ' + hit.ruleId + ' · ' + (hit.dimension || '?') + ' 维度',
        hit.title || '',
        'fp: ' + hit.fp,
        '',
        '证据：',
        (hit.evidence && hit.evidence.length ? hit.evidence.map((x) => '- ' + x).join('\n') : '- （无路径证据，见下列数值）'),
        '',
        '测到的值：',
        measured,
        '',
        '置信度：' + (hit.confidence || 'uncertain') + '（uncertain 表示规则只能报告现象，判读要你来做）',
        '修法：' + (hit.fixHint || '（该规则没有固定修法，按证据自行判断）'),
      ];
      if (isRetired) lines.push('', '状态：已退役记档（' + JSON.stringify(hit.retired) + '），不再计入评分。');
      return {
        found: true,
        fp: hit.fp,
        ruleId: hit.ruleId,
        severity: hit.severity,
        dimension: hit.dimension || '',
        title: hit.title || '',
        evidence: (hit.evidence || []).slice(0, 20),
        measured,
        confidence: hit.confidence || 'uncertain',
        fixHint: hit.fixHint || '',
        retired: isRetired,
        candidates: [],
        summary: lines.join('\n'),
      };
    },
  },
  {
    name: 'audit_plan',
    description: '给出处置顺序：先分「故障处置」（影响加载/启动，必须处理）与「配置优化」（可保留现状），再按影响而非涨分排。只读推演，不动配置',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '第二步列几条，缺省 5，最大 12' },
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
      },
      additionalProperties: false,
    },
    output: {
      schema: PLAN_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const a = args || {};
      const r = audit({ scenario: a.scenario || 'general' });
      const at = r.attribution || {};
      const limit = Math.max(1, Math.min(12, typeof a.limit === 'number' ? a.limit : 5));
      const sign = (n) => (n > 0 ? '+' + n : String(n));
      const steps = [];
      const fault = at.rowsFault || [];
      const hygiene = at.rowsHygiene || [];
      if (at.stage1) {
        steps.push('必须处理｜P0 ' + at.stage1.count + ' 条：' + at.stage1.from + ' → ' + at.stage1.to + '（' + sign(at.stage1.delta) + (at.capped ? '，解除封顶' : '') + '）');
        (at.stage1.items || []).forEach((s) => steps.push('   · ' + s));
      } else {
        steps.push('必须处理｜没有 P0，不需要解封顶');
      }
      if (fault.length) {
        steps.push('故障处置｜影响加载/启动（按影响排，不是按涨分）：');
        fault.slice(0, limit).forEach((x) => {
          steps.push('   · ' + x.ruleId + ' ' + (x.title || '') + (x.target ? '（' + x.target + '）' : '') + (x.saves ? ' · ' + x.saves : ''));
        });
        if (fault.length > limit) steps.push('   … 另有 ' + (fault.length - limit) + ' 条故障项');
      } else {
        steps.push('故障处置｜没有会影响加载/启动的计分项');
      }
      if (hygiene.length) {
        steps.push('配置优化｜可保留现状，不建议为了分数动手：');
        hygiene.slice(0, limit).forEach((x) => {
          steps.push('   · ' + x.ruleId + ' ' + (x.title || '') + (x.target ? '（' + x.target + '）' : ''));
        });
        if (hygiene.length > limit) steps.push('   … 另有 ' + (hygiene.length - limit) + ' 条优化项');
      }
      steps.push('说明：单条增量互不叠加；「全修完 → ' + at.potentialAll + ' / 10」只是评分公式终点，不是建议动作。');
      return {
        base: typeof at.stage2Base === 'number' ? at.stage2Base : r.score.total,
        potentialAll: typeof at.potentialAll === 'number' ? at.potentialAll : r.score.total,
        steps,
        summary: '当前 ' + r.score.total + '/10。' + steps.join('\n'),
      };
    },
  },
  {
    name: 'audit_triage',
    description: '按症状进入诊断：把「升级后工具不见了 / 起不来 / 装了没生效 / 很吃 token / 磁盘越来越大」路由到对应规则与下一步命令。只做编排，不新增判定引擎；只读',
    parameters: {
      type: 'object',
      properties: {
        symptom: { type: 'string', description: '症状（自然语言）或 id：plugin-gone / boot-fail / not-loaded / context-heavy / disk' },
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
      },
      required: ['symptom'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          known: { type: 'boolean' },
          symptom: { type: 'string' },
          label: { type: 'string' },
          matched: { type: 'array', items: { type: 'string' } },
          steps: { type: 'array', items: { type: 'string' } },
          summary: { type: 'string' },
        },
        required: ['known', 'summary'],
      },
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const tr = await import('./triage.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      const t = tr.triage(r, { symptom: args && args.symptom });
      return {
        known: t.known,
        symptom: t.symptom || '',
        label: t.label || '',
        matched: (t.matched || []).map((m) => '[' + m.severity + '] ' + m.ruleId + ' ' + m.title + '  ' + m.fp),
        steps: t.steps || [],
        summary: t.summary,
      };
    },
  },
  {
    name: 'audit_export',
    description: '生成一份可直接贴出去的脱敏求助材料：版本/采集时间/结论/故障处置/覆盖缺口/复现命令。路径、用户名、密钥、邮箱已脱敏；不写盘、不上传，也不打包整份配置',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          bytes: { type: 'number' },
          redactions: { type: 'string' },
          markdown: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['bytes', 'markdown', 'summary'],
      },
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const ex = await import('./export.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      const b = ex.buildBundle(r, { version: r.self && r.self.version });
      const c = b.redactions || {};
      const red = '路径 ' + (c.home || 0) + ' / 用户名 ' + (c.user || 0) + ' / 密钥 ' + (c.key || 0) + ' / 邮箱 ' + (c.email || 0);
      return {
        bytes: b.bytes,
        redactions: red,
        markdown: b.markdown,
        summary: '已生成脱敏求助材料（' + b.bytes + ' 字节）。脱敏计数：' + red + '。\n不含完整配置内容，也未上传；粘贴前请自己再过一眼。\n\n' + b.markdown,
      };
    },
  },
  {
    name: 'audit_trim',
    description: '装载面瘦身分析：报服务插件数 vs bundles 上限、同能力多实现、记忆插件叠放，给出「谁是主力、谁是可关候选」。只读，不写 cordis.patch.yml',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
      },
      additionalProperties: false,
    },
    output: {
      schema: TRIM_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const trim = await import('./trim.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      const a = trim.analyze(r.facts);
      return {
        served: typeof a.served === 'number' ? a.served : 0,
        maxBundles: a.maxBundles,
        thirdParty: a.thirdParty.length,
        memory: a.memory.length,
        groups: a.groups.map((g) => g.tag + ' ×' + g.count + ' · 主力 ' + g.keep + ' · 候选 ' + (g.drop.join('、') || '无')),
        suggestions: a.suggestions,
        summary: trim.render(a),
      };
    },
  },
  {
    name: 'audit_capabilities',
    description: '能力域矩阵：20 个能力域各自有没有实现（有/多/无/无法判定），每个缺口给三级补救阶梯——① 先看配置 ② 再看宿主内置 ③ 最后才考虑装插件。只读',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
      },
      additionalProperties: false,
    },
    output: {
      schema: CAPS_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const cm = await import('./capability-map.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      const mx = cm.buildMatrix(r.facts);
      const b = mx.byStatus;
      return {
        // 字段名与六态口径一致（present/redundant/conflicting/degraded/missing/unknown）。
        // 0.8.5 之前这里叫 ok，但 matrix 里已无 ok 状态 ⇒ 恒为 0（实测发现）。
        present: b.present || 0,
        redundant: b.redundant || 0,
        conflicting: b.conflicting || 0,
        degraded: b.degraded || 0,
        missing: b.missing || 0,
        unknown: b.unknown || 0,
        // 兼容旧字段名（不删，避免已有调用方断掉）
        ok: b.present || 0,
        rows: mx.rows.map((x) => x.status.padEnd(9) + ' ' + x.label + (x.count ? ' ×' + x.count : '')),
        summary: cm.renderMatrix(mx),
      };
    },
  },
  {
    name: 'audit_retire',
    description: '误报记档：把一条体检发现标记为「已退役」（误报），之后不再计入评分。原因必填——没有理由的记档等于永久静音一条真问题。action=restore 可撤销记档（撤后重新计分）。传 fp 或规则号；不带参数则列出候选',
    parameters: {
      type: 'object',
      properties: {
        finding: { type: 'string', description: '要记档/撤销的指纹 fp（如 R14#2f1a）或规则号；省略则只列候选' },
        reason: { type: 'string', description: '为什么这是误报（记档时必填；撤销不需要）' },
        action: { type: 'string', description: 'retire|restore|list；缺省：给了 finding 即记档。restore=撤销记档' },
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
      },
      additionalProperties: false,
    },
    output: {
      schema: RETIRE_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const eng = await import('./engine.mjs');
      const a = args || {};
      const key = String(a.finding || '').trim();
      const reason = String(a.reason || '').trim();

      if (!key) {
        const r = audit({ scenario: a.scenario || 'general' });
        const cands = (r.allFindings || []).slice(0, 20).map((f) => f.severity + ' ' + f.ruleId + ' ' + f.fp + '  ' + f.title);
        return {
          action: 'list', ok: true, total: (r.allFindings || []).length, items: cands,
          summary: '要记档哪一条？传 finding=<fp 或规则号> 与 reason="原因"。当前候选：\n' + (cands.length ? cands.map((c) => '- ' + c).join('\n') : '（没有可记档的问题）'),
        };
      }
      // 撤销记档（审计反哺 V08）：记档容易、纠错也得有门，否则误记一条真问题只能手改 JSON。
      if (a.action === 'restore') {
        const r0 = audit({ scenario: a.scenario || 'general', skipRetire: true });
        const store0 = eng.loadRetirements(r0.facts.home);
        // 精确 fp 优先；给规则号则撤该规则下全部记档（摘要里说明撤了几条）
        const exact = store0[key] ? [key] : Object.keys(store0).filter((fp) => fp.split('#')[0] === key);
        if (!exact.length) {
          return { action: 'restore', ok: false, fp: key, summary: '没有「' + key + '」的记档可撤销。不带参数可查看当前候选与已记档条目。' };
        }
        for (const fp of exact) delete store0[fp];
        eng.saveRetirements(r0.facts.home, store0);
        return {
          action: 'restore', ok: true, fp: exact.join('、'),
          summary: '已撤销记档：' + exact.join('、') + '。这些发现会重新计入评分与问题清单。',
        };
      }
      if (a.action !== 'restore' && !reason) {
        return {
          action: 'retire', ok: false, fp: key, reason: '',
          summary: '记档必须给理由（reason 必填）。没有理由的记档等于永久静音一条可能为真的问题，所以这里不替你补默认理由。',
        };
      }
      const r = audit({ scenario: a.scenario || 'general', skipRetire: true });
      const hit = (r.allFindings || []).find((f) => f.fp === key) || (r.allFindings || []).find((f) => f.ruleId === key);
      if (!hit) {
        return { action: 'retire', ok: false, fp: key, reason: reason, summary: '没找到「' + key + '」这条发现，无法记档。先用 audit_findings 看当前有哪些。' };
      }
      const store = eng.loadRetirements(r.facts.home);
      store[hit.fp] = { reason: reason, at: new Date().toISOString(), title: hit.title };
      eng.saveRetirements(r.facts.home, store);
      return {
        action: 'retire', ok: true, fp: hit.fp, reason: reason, title: hit.title,
        summary: '已记档：' + hit.fp + '（' + hit.title + '）\n理由：' + reason + '\n它不再计入评分，也不再出现在问题清单里。撤销：audit_retire action=restore，或 dsh-healthkit --unretire ' + hit.fp + '。',
      };
    },
  },
  {
    name: 'audit_verify',
    description: '跨重启验回：上次体检发现的变化，这次还命中没、有没有把别的东西搞坏（回归）。只报告不修——fixed=对象仍在被检查且不再命中，muted=被静音不算修好，stillThere=还在，unverifiable=对应 profile 本次读不出，notApplicable=证据对象已不存在，regressions=新冒出来的 P0/P1',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '时间线条数，缺省 12，最大 30' },
      },
      additionalProperties: false,
    },
    output: {
      schema: VERIFY_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const ver = await import('./verify.mjs');
      const r = audit({ scenario: 'general' });
      const home = r.facts.home;
      // **每次都当场重算**——开机时那份（verify/last.json）只是历史快照，
      // 拿它当答案会掩盖「刚退役了一条」这类变化（2026-11-16 实测踩到：
      // 退役后再查仍显示退役前的结果，因为读的是开机时的旧记录）。
      // 2026-11-20 审计 P2：checkPending 会落盘，把开机那份「跨重启证据」覆盖成按需结果。
      // 工具路径只算不写，落盘留给 startupVerify。
      const v = ver.checkPending(r, { home, persist: false });
      const boot = ver.readLastVerify(home);
      const tl = ver.timeline(home, (args && args.limit) || 12);
      const L = [];
      if (!v || !v.hasPending) {
        L.push('没有待验清单。');
        L.push(v && v.note ? v.note : '（上次体检没有带修法的 P0/P1，或还没跑过体检。）');
      } else {
        L.push('上次发现的变化（来自 ' + String(v.pendingAt || '').replace('T', ' ').slice(0, 19) + '，分数 ' + v.pendingScore + ' → ' + v.score + '）');
        L.push('');
        L.push('真修好 ' + v.fixed.length + ' 条：');
        v.fixed.forEach((x) => L.push('  ✓ ' + x.ruleId + ' ' + x.title + '  ' + x.fp));
        if (!v.fixed.length) L.push('  （无）');
        L.push('还在 ' + v.stillThere.length + ' 条：');
        v.stillThere.forEach((x) => L.push('  · ' + x.ruleId + ' ' + x.title + '  ' + x.fp));
        if (!v.stillThere.length) L.push('  （无）');
        L.push('被静音（**不算修好**）' + v.muted.length + ' 条：');
        v.muted.forEach((x) => L.push('  ~ ' + x.ruleId + '  ' + x.fp));
        if (!v.muted.length) L.push('  （无）');
        L.push('无法复核（对应 profile 本次读不出）' + (v.unverifiable || []).length + ' 条：');
        (v.unverifiable || []).forEach((x) => L.push('  ? ' + x.ruleId + ' ' + x.title + '  ' + x.fp));
        if (!(v.unverifiable || []).length) L.push('  （无）');
        L.push('已不适用（证据对象已不存在）' + (v.notApplicable || []).length + ' 条：');
        (v.notApplicable || []).forEach((x) => L.push('  – ' + x.ruleId + ' ' + x.title + '  ' + x.fp));
        if (!(v.notApplicable || []).length) L.push('  （无）');
        if (v.regressions && v.regressions.length) {
          L.push('');
          L.push('**回归**（本次新冒出来的 P0/P1）' + v.regressions.length + ' 条：');
          v.regressions.forEach((x) => L.push('  ! ' + x.ruleId + ' ' + x.title));
        }
      }
      if (tl.length) {
        L.push('');
        L.push('最近几次体检的变化（新增 / 真修好 / 被静音）：');
        tl.forEach((t) => L.push('  ' + String(t.at).replace('T', ' ').slice(5, 19) + '  分数 ' + t.score + '  +' + t.added + ' / 修 ' + t.fixed + ' / 静 ' + t.muted));
      }
      return {
        ok: true,
        hasPending: !!(v && v.hasPending),
        at: (v && v.at) || '',
        bootAt: (boot && boot.at) || '',
        fixed: (v && v.fixed || []).length,
        stillThere: (v && v.stillThere || []).length,
        muted: (v && v.muted || []).length,
        unverifiable: (v && v.unverifiable || []).length,
        notApplicable: (v && v.notApplicable || []).length,
        regressions: (v && v.regressions || []).length,
        timeline: tl.map((t) => String(t.at).replace('T', ' ').slice(5, 19) + ' 分数 ' + t.score + ' +' + t.added + '/修' + t.fixed + '/静' + t.muted),
        summary: L.join('\n'),
      };
    },
  },
  {
    name: 'audit_check',
    description: 'CI 门禁形态：按生态三值契约（PASS/WARN/FAIL + 退出码 0/1/2）给出体检结论。默认是**基线门**——只判相对上一次快照的新增与回归（同 SonarQube 的 new-code gate），存量问题不计入门；新增少于 3 条 WARN 时不下判（fudge），新增 FAIL 永不放过。P0/P1=FAIL，P2=WARN，UNKNOWN=WARN（判不了不当通过），MEASURED 的 INFO 与已退役=PASS',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
        baseline: { type: 'string', description: 'auto（缺省，相对上一次快照只看新增）| none（绝对状态门，老行为）' },
        remediation: { type: 'boolean', description: '是否附有序修法清单 remediation（缺省 false；为 false 时该字段完全不出现）' },
        fresh: { type: 'boolean', description: 'true = 绕过事实缓存，立刻重新采集' },
      },
      additionalProperties: false,
    },
    output: {
      schema: CHECK_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const a = args || {};
      const { audit } = await import('./engine.mjs');
      const { buildGateEnvelope } = await import('./report-json.mjs');
      const r = audit({ scenario: a.scenario || 'general', fresh: a.fresh === true });
      let baseline = null;
      if (a.baseline !== 'none') {
        try {
          const snap = await import('./snapshot.mjs');
          const prev = snap.latestRun(r.facts.home);
          if (prev) {
            baseline = {
              at: prev.at || null,
              score: typeof prev.score === 'number' ? prev.score : null,
              fps: (prev.findings || []).map((f) => f.fp).filter(Boolean),
              // 2026-11-20 审计 P2：已退役的指纹也要算进基线，否则退役的 P0/P1
              // 每轮都会被判成「新增 WARN」，攒够 3 条就永久 exit 1。
              retired: (prev.retired || []).slice(),
            };
          }
        } catch (e) { baseline = null; }
      }
      const env = buildGateEnvelope(r, {
        version: r.self && r.self.version,
        baseline,
        remediation: a.remediation === true,
      });
      const by = { PASS: 0, WARN: 0, FAIL: 0 };
      env.checks.forEach((c) => { by[c.status] = (by[c.status] || 0) + 1; });
      const L = [];
      L.push('契约 ' + env.schema + ' · 模式 ' + env.mode + ' · 退出码 ' + env.exitCode + '（0 全过 / 1 有 WARN / 2 有 FAIL）');
      if (env.mode === 'gate') {
        L.push('相对基线' + (env.baselineAt ? '（' + String(env.baselineAt).replace('T', ' ').slice(0, 19) + ' · ' + env.baselineScore + ' 分）' : '')
          + '：新增 FAIL ' + env.newFail + ' · 新增 WARN ' + env.newWarn + ' · 存量不计 ' + env.suppressed);
        L.push(env.note);
      } else {
        L.push('绝对状态：PASS ' + by.PASS + ' · WARN ' + by.WARN + ' · FAIL ' + by.FAIL + '（共 ' + env.checks.length + ' 项）');
      }
      const bad = env.checks.filter((c) => c.status !== 'PASS' && (env.mode !== 'gate' || !c.suppressed));
      if (bad.length) {
        L.push('');
        bad.slice(0, 12).forEach((c) => L.push('  [' + c.status + '] ' + c.id + ' ' + c.name));
      }
      if (env.remediation && env.remediation.length) {
        L.push('');
        L.push('修法（有序）：');
        env.remediation.slice(0, 8).forEach((s, i) => L.push('  ' + (i + 1) + '. ' + s));
      }
      const out = {
        ok: env.ok,
        contract: env.contract,
        schema: env.schema,
        generatedAt: env.generatedAt,
        profile: env.profile || '',
        exit: env.exitCode,
        exitCode: env.exitCode,
        mode: env.mode,
        pass: by.PASS || 0,
        warn: env.mode === 'gate' ? env.newWarn : (by.WARN || 0),
        fail: env.mode === 'gate' ? env.newFail : (by.FAIL || 0),
        newFail: env.newFail || 0,
        newWarn: env.newWarn || 0,
        suppressed: env.suppressed || 0,
        fudged: env.fudged === true,
        baselineAt: env.baselineAt || '',
        baselineScore: typeof env.baselineScore === 'number' ? env.baselineScore : 0,
        note: env.note || '',
        items: env.checks.filter((c) => c.status !== 'PASS').map((c) => c.status + ' ' + c.id + ' ' + c.name),
        summary: L.join('\n'),
      };
      if (env.remediation) out.remediation = env.remediation;
      return out;
    },
  },
  {
    name: 'audit_recommend',
    description: '能力域推荐源：20 个能力域各自的补救阶梯（配置→provider→插件→习惯）与「去哪找」。装插件是最后手段，只给搜索关键词不给包名；missing 只表示当前没有实现，不代表你该装',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
      },
      additionalProperties: false,
    },
    output: {
      schema: RECOMMEND_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const { buildRecommend, renderRecommend } = await import('./recommend.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      const doc = buildRecommend(r.facts);
      return {
        schema: doc.schema,
        domains: doc.domains.length,
        items: doc.domains.map((d) => d.localState + ' ' + d.label + ' → ' + (d.sources.builtin)),
        summary: renderRecommend(doc),
      };
    },
  },
  {
    name: 'audit_diff',
    description: '跨次差异归因：把这次体检与上一次快照对比——新增了哪些问题、真正修好了哪些、哪些只是被退役记档（不算修好）、严重度有没有变化。用于回答「我这次改动到底改善了什么」',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
        record: { type: 'boolean', description: '是否顺便把这次体检存成新快照（缺省 true）；传 false 则只看不写' },
      },
      additionalProperties: false,
    },
    output: {
      schema: DIFF_SCHEMA,
      render(_args, v) {
        return text(v.summary);
      },
    },
    execute: async (args) => {
      const { audit } = await import('./engine.mjs');
      const snap = await import('./snapshot.mjs');
      const a = args || {};
      const r = audit({ scenario: a.scenario || 'general' });
      const home = r.facts.home;

      // 先取上一次快照（排除本次刚写的），再决定要不要写本次快照
      const prev = snap.latestRun(home);
      const cur = {
        at: new Date().toISOString(),
        score: r.score.total,
        findings: r.findings.map((f) => ({
          fp: f.fp, ruleId: f.ruleId, severity: f.severity, dimension: f.dimension || '',
          title: f.title || '', advisory: f.advisory === true, fixHint: f.fixHint || null,
        })),
        retired: r.retired.map((f) => f.fp),
      };

      if (a.record !== false) {
        snap.writeRun(r, { home: home, scenario: a.scenario || 'general', version: r.self.version });
      }

      const d = snap.diffRuns(prev, cur);
      return {
        ok: true,
        prevAt: d.prevAt || '',
        curAt: d.curAt,
        prevScore: typeof d.prevScore === 'number' ? d.prevScore : 0,
        curScore: typeof d.curScore === 'number' ? d.curScore : 0,
        delta: typeof d.delta === 'number' ? d.delta : 0,
        added: d.added.map((f) => '[' + f.severity + '] ' + f.ruleId + ' ' + f.fp),
        fixed: d.fixed.map((f) => '[' + f.severity + '] ' + f.ruleId + ' ' + f.fp),
        newlyRetired: d.newlyRetired.map((f) => f.fp),
        kept: d.kept,
        summary: snap.renderDiff(d),
      };
    },
  },
  // ---- 恢复面（A2）：这三条是「我坏了，现在就要救」那条链路的工具面 ----
  {
    name: 'audit_boot',
    description: '预启动静态探针：判「这份配置还能不能被加载」——bundle 没装 / 没声明 dsh.bundle（宿主会静默跳过）/ cordis.patch.yml 解析不了 / 补丁 id 重复。不 spawn 宿主、不执行插件代码、不联网；判不了的（宿主版本兼容、插件运行时抛错、端口占用）会明确列出来。改完配置先跑它',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          canBoot: { type: 'boolean' },
          blockers: { type: 'number' },
          warnings: { type: 'number' },
          profiles: { type: 'number' },
          summary: { type: 'string' },
        },
        required: ['canBoot', 'summary'],
      },
      render(_args, v) { return text(v.summary); },
    },
    execute: async () => {
      const { bootPreflight, renderBoot } = await import('./recovery.mjs');
      const b = bootPreflight(dshHome());
      return {
        action: 'boot',
        canBoot: b.canBoot === true,
        blockers: b.blockers.length,
        warnings: b.warnings.length,
        profiles: b.profiles.length,
        summary: renderBoot(b),
      };
    },
  },
  {
    name: 'audit_checkpoint',
    description: '把 profile 的配置文件存成一份快照——在配置还能用的时候建，出事时才有得回。只收白名单：package.json / cordis.patch.yml / cordis.patch.yaml / cordis.yml / pnpm-workspace.yaml / agent.cordis.yml；不含 node_modules，也不收 .npmrc 这类可能带凭据的文件。回滚前会自动再打一份',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: '为什么建（写进清单，比如 before-upgrade）' },
        keep: { type: 'number', description: '保留最近几份，缺省 10' },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          id: { type: 'string' },
          files: { type: 'number' },
          profiles: { type: 'number' },
          summary: { type: 'string' },
        },
        required: ['id', 'summary'],
      },
      render(_args, v) { return text(v.summary); },
    },
    execute: async (args) => {
      const { checkpoint } = await import('./recovery.mjs');
      const a = args || {};
      const keepN = Math.max(1, Math.min(100, Math.trunc(Number(a.keep) || 10)));
      const m = checkpoint(dshHome(), { reason: a.reason || 'tool', keep: keepN });
      return {
        action: 'checkpoint',
        id: m.id,
        files: m.files.length,
        profiles: m.profiles,
        summary: '已建快照 ' + m.id + '：' + m.files.length + ' 个配置文件 / ' + m.profiles +
          ' 个 profile（只有配置面，不含 node_modules）',
      };
    },
  },
  {
    name: 'audit_rollback',
    description: '把配置写回某份快照。危险动作，必须 confirm:true。写回前会自动给当前状态再打一份快照（回滚错了还能回来），只写清单里白名单内的文件，sha256 不符就跳过；回滚后请用 audit_boot 确认是否真的救回来了',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '快照 id（audit_checkpoint 的返回，或 CLI --checkpoints 列出）' },
        confirm: { type: 'boolean', description: '必须为 true 才真的写回' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          ok: { type: 'boolean' },
          id: { type: 'string' },
          written: { type: 'number' },
          skipped: { type: 'number' },
          backup: { type: 'string' },
          summary: { type: 'string' },
        },
        required: ['ok', 'summary'],
      },
      render(_args, v) { return text(v.summary); },
    },
    execute: async (args) => {
      const a = args || {};
      if (a.confirm !== true) {
        return {
          action: 'rollback', ok: false, id: String(a.id || ''), written: 0, skipped: 0, backup: '',
          summary: '没有写任何文件：这是会改配置的动作，需要显式 confirm:true。先看看要回滚到哪份：audit_checkpoint 的返回里有 id。',
        };
      }
      const { rollback } = await import('./recovery.mjs');
      const r = rollback(dshHome(), String(a.id || ''), {});
      if (!r.ok) {
        return {
          action: 'rollback', ok: false, id: String(a.id || ''), written: 0, skipped: (r.skipped || []).length,
          backup: '', summary: '回滚失败：' + (r.detail || r.reason) + ((r.skipped || []).length ? '\n跳过：\n  ' + r.skipped.join('\n  ') : ''),
        };
      }
      return {
        action: 'rollback', ok: true, id: r.id, written: r.written.length, skipped: r.skipped.length,
        backup: r.backup,
        summary: '已回滚到 ' + r.id + '（快照时间 ' + r.at + '）：写回 ' + r.written.length + ' 个文件' +
          (r.written.length ? '\n  ' + r.written.join('\n  ') : '') +
          '\n当前状态已存为 ' + r.backup + '（回滚错了还能回来）\n下一步：audit_boot 静态探针确认是否真救回来了',
      };
    },
  },
  ];
}


// 工具数单一真源：README/docs-drift/init 文案都从这里取
export const TOOL_COUNT = buildTools({}).length;
