// dsh-healthkit 宿主半边
// 契约依据（实测自 dsh-chronicle / dsh-pet，两个同宿主在跑的真插件）：
//   bundle 用 `- insert: [{id, name}]` 插条目；入口 = package.json 的 main。
//   工具面 = `ctx.inject(['tools'], cb)` 等到服务 → `ctx.effect(() => ctx.tools.register({name, description, parameters, output:{schema,render}, execute}))`。
//
// 已踩实的三个坑（2026-11-16，本插件自己的 P0，逐条都是运行层实测而非推断）：
//   ① Cordis 的 ctx 是 Proxy：裸访问未 inject 的服务会抛 `cannot get property "x" without inject`。
//      旧版把 `ctx.tools` 探测放在 try 外 → apply() 抛穿 → 插件实例创建失败 →
//      工具静默消失、状态文件从未落盘。症状极具迷惑性：plugin list 有、--dump-config 有该条目、就是没工具。
//   ② `ctx.get('tools')` 在 apply() 挂载那一刻可能是 undefined（服务晚到）；要用 ctx.inject(['tools'], cb) 自愈。
//   ③ 工具**必须**声明 output:{schema,render}，否则注册直接报
//      `tool "x" must declare output { schema, render, presentationMeta? }`（旧版正是因为这个，toolsReady=true 但 registered=[]）。
//      schema 里 type 只能是单个字符串；additionalProperties 只能是布尔。
//   ④ apply() 第一行就落档：任何后续抛出都留得下证据。
import fs from 'node:fs';
import path from 'node:path';
import { resolveReportPath } from './src/reportpath.mjs';
import { dataDir, migrateLegacyDataDir, dshHome } from './src/paths.mjs';

export const name = 'dsh-healthkit';

// 版本号只有一处真源：package.json。
// 2026-11-16 踩过：手写常量忘了跟着改，plugin-status.json 报 0.4.1 而包里已是 0.4.3。
const VERSION = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

function statusPath() { return path.join(dataDir(), 'plugin-status.json'); }

function writeStatus(patch) {
  try {
    const p = statusPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { prev = {}; }
    fs.writeFileSync(p, JSON.stringify(Object.assign(prev, patch), null, 2) + '\n', 'utf8');
    return true;
  } catch (e) { return false; }
}

const msg = (e) => (e && e.message ? e.message : String(e));
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
    exit: { type: 'number' },
    pass: { type: 'number' },
    warn: { type: 'number' },
    fail: { type: 'number' },
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
      const { audit } = await import('./src/engine.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      // 记账 + 快照：写的是插件自己的数据目录，不碰被检对象；record=false 可关（审计反哺 V09）。
      if (!args || args.record !== false) {
        const hist = await import('./src/history.mjs');
        hist.append(r, { scenario: (args && args.scenario) || 'general', source: 'agent' });
        // 写运行快照：跨次差异归因的基线（audit_diff 用）。
        try {
          const snap = await import('./src/snapshot.mjs');
          snap.writeRun(r, { home: r.facts.home, scenario: (args && args.scenario) || 'general', version: r.self.version });
        } catch (e) { /* 快照写失败不该让体检失败 */ }
        // 写待验清单：下次宿主重启时，插件开机自动核对「上次说的该修的，修好了没、有没有搞坏别的」。
        try {
          const ver = await import('./src/verify.mjs');
          ver.writePending(r, { home: r.facts.home });
        } catch (e) { /* 待验清单写失败不该让体检失败 */ }
      }
      const { renderFirstScreen, countBySeverity } = await import('./src/digest.mjs');
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
      const { audit } = await import('./src/engine.mjs');
      const r = audit({ scenario: 'general' });
      const hist = await import('./src/history.mjs');
      hist.append(r, { scenario: 'general' });
      // 也写待验清单：重启后开机核对的是「最近一次体检」的结论，audit_report 也是一次体检。
      try {
        const ver = await import('./src/verify.mjs');
        ver.writePending(r, { home: r.facts.home });
      } catch (e) { /* 待验清单写失败不该让体检失败 */ }
      const workspace = resolveWorkspace(exec);
      const target = resolveReportPath({
        out: args && args.out,
        reportDir: pluginConfig.reportDir,
        workspace,
      });
      if (target.error) throw new Error('audit_report: ' + target.error);
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      // format=json → 机器可读全量报告（schema: dsh-healthkit/report/v1），供其他插件/脚本消费。
      if (args && args.format === 'json') {
        const { buildJsonReport } = await import('./src/report-json.mjs');
        const rep = buildJsonReport(r, { version: r.self && r.self.version });
        const { jsonReportPath } = await import('./src/reportpath.mjs');
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
      const { scan, apply, restore, listBatches, purge, renderScan, fmtBytes } = await import('./src/clean.mjs');
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
      const { stats, renderStats } = await import('./src/history.mjs');
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
      const { audit } = await import('./src/engine.mjs');
      const fb = await import('./src/feedback.mjs');
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
      const { audit } = await import('./src/engine.mjs');
      const { buildDigest } = await import('./src/weekly.mjs');
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
      const { audit } = await import('./src/engine.mjs');
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
      const { audit } = await import('./src/engine.mjs');
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
    description: '给出修复顺序：先解 P0 封顶，再按单条增量从大到小排。返回每步能涨多少分与全修完的终点（只读推演，不动配置）',
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
      const { audit } = await import('./src/engine.mjs');
      const a = args || {};
      const r = audit({ scenario: a.scenario || 'general' });
      const at = r.attribution || {};
      const limit = Math.max(1, Math.min(12, typeof a.limit === 'number' ? a.limit : 5));
      const sign = (n) => (n > 0 ? '+' + n : String(n));
      const steps = [];
      if (at.stage1) {
        steps.push('第一步｜清掉全部 ' + at.stage1.count + ' 条 P0：' + at.stage1.from + ' → ' + at.stage1.to + '（' + sign(at.stage1.delta) + (at.capped ? '，解除封顶' : '') + '）');
        (at.stage1.items || []).forEach((s) => steps.push('   · ' + s));
      } else {
        steps.push('第一步｜没有 P0，不需要解封顶');
      }
      if (at.rows && at.rows.length) {
        steps.push('第二步｜以 ' + at.stage2Base + ' 为基准，单条增量（互不叠加）：');
        at.rows.slice(0, limit).forEach((x) => {
          steps.push('   · ' + sign(x.delta) + '  ' + x.ruleId + ' ' + (x.title || '') + (x.target ? '（' + x.target + '）' : ''));
        });
        if (at.rows.length > limit) steps.push('   … 另有 ' + (at.rows.length - limit) + ' 条计分项');
      }
      if (typeof at.potentialAll === 'number') steps.push('全部修完 → ' + at.potentialAll + ' / 10');
      return {
        base: typeof at.stage2Base === 'number' ? at.stage2Base : r.score.total,
        potentialAll: typeof at.potentialAll === 'number' ? at.potentialAll : r.score.total,
        steps,
        summary: '当前 ' + r.score.total + '/10。' + steps.join('\n'),
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
      const { audit } = await import('./src/engine.mjs');
      const trim = await import('./src/trim.mjs');
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
      const { audit } = await import('./src/engine.mjs');
      const cm = await import('./src/capability-map.mjs');
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
      const { audit } = await import('./src/engine.mjs');
      const eng = await import('./src/engine.mjs');
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
    description: '跨重启验回：上次体检留下的「待修清单」，这次修好了没、有没有把别的东西搞坏（回归）。只报告不修——fixed=真修好，muted=被静音不算修好，stillThere=还在，regressions=新冒出来的 P0/P1',
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
      const { audit } = await import('./src/engine.mjs');
      const ver = await import('./src/verify.mjs');
      const r = audit({ scenario: 'general' });
      const home = r.facts.home;
      // **每次都当场重算**——开机时那份（verify/last.json）只是历史快照，
      // 拿它当答案会掩盖「刚退役了一条」这类变化（2026-11-16 实测踩到：
      // 退役后再查仍显示退役前的结果，因为读的是开机时的旧记录）。
      const v = ver.checkPending(r, { home });
      const boot = ver.readLastVerify(home);
      const tl = ver.timeline(home, (args && args.limit) || 12);
      const L = [];
      if (!v || !v.hasPending) {
        L.push('没有待验清单。');
        L.push(v && v.note ? v.note : '（上次体检没有带修法的 P0/P1，或还没跑过体检。）');
      } else {
        L.push('待验清单（来自 ' + String(v.pendingAt || '').replace('T', ' ').slice(0, 19) + '，分数 ' + v.pendingScore + ' → ' + v.score + '）');
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
        regressions: (v && v.regressions || []).length,
        timeline: tl.map((t) => String(t.at).replace('T', ' ').slice(5, 19) + ' 分数 ' + t.score + ' +' + t.added + '/修' + t.fixed + '/静' + t.muted),
        summary: L.join('\n'),
      };
    },
  },
  {
    name: 'audit_check',
    description: 'CI 门禁形态：按生态三值契约（PASS/WARN/FAIL + 退出码 0/1/2）给出体检结论，与 dsh-plugin-doctor 的 --format check 同形，可被同一套 CI/Action 消费。P0/P1=FAIL，P2=WARN，INFO 与已退役= PASS',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
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
      const { audit } = await import('./src/engine.mjs');
      const { buildCheckEnvelope } = await import('./src/report-json.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      const env = buildCheckEnvelope(r, { version: r.self && r.self.version });
      const by = { PASS: 0, WARN: 0, FAIL: 0 };
      env.checks.forEach((c) => { by[c.status] = (by[c.status] || 0) + 1; });
      const L = [];
      L.push('契约 ' + env.contract + ' · 退出码 ' + env.doctor.exit + '（0 全过 / 1 有 WARN / 2 有 FAIL）');
      L.push('PASS ' + by.PASS + ' · WARN ' + by.WARN + ' · FAIL ' + by.FAIL + '（共 ' + env.checks.length + ' 项）');
      const bad = env.checks.filter((c) => c.status !== 'PASS');
      if (bad.length) {
        L.push('');
        bad.forEach((c) => L.push('  [' + c.status + '] ' + c.id + ' ' + c.name));
      }
      return {
        ok: env.ok,
        contract: env.contract,
        exit: env.doctor.exit,
        pass: by.PASS || 0,
        warn: by.WARN || 0,
        fail: by.FAIL || 0,
        items: bad.map((c) => c.status + ' ' + c.id + ' ' + c.name),
        summary: L.join('\n'),
      };
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
      const { audit } = await import('./src/engine.mjs');
      const { buildRecommend, renderRecommend } = await import('./src/recommend.mjs');
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
      const { audit } = await import('./src/engine.mjs');
      const snap = await import('./src/snapshot.mjs');
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
  ];
}

export function apply(ctx, config) {
  const notes = [];
  const registered = [];
  const failures = [];
  const state = { toolsReady: false, surfaces: [] };

  // 数据目录改名 dsh-healthkit（2026-11-16）：首次启动把旧目录（见 src/paths.mjs 的 LEGACY_DIR_NAME）整目录 rename 过来；
  // 失败就回落旧目录继续用，绝不半搬。结果写进 status 供事后核对。
  let dataMigration = null;
  try { dataMigration = migrateLegacyDataDir(); } catch (e) { dataMigration = { status: 'failed', error: msg(e) }; }

  // 会话工作区解析（issue #1）：宿主进程的 process.cwd() 是 profile 目录，
  // 不能当「工作区」用。改成问 workingDirectory 服务要这个 agent 的会话目录。
  state.resolveWorkspace = function resolveWorkspace(exec) {
    try {
      if (!exec || !exec.agent || !exec.agent.session) return null;
      if (typeof ctx.get !== 'function') return null;
      const wd = ctx.get('workingDirectory');
      if (!wd || typeof wd.get !== 'function') return null;
      const dir = wd.get(exec.agent.session);
      return (typeof dir === 'string' && dir) ? dir : null;
    } catch (e) {
      return null;
    }
  };

  // ④ 进门就落档
  writeStatus({
    version: VERSION,
    phase: 'apply-entered',
    loadedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    processCwd: process.cwd(),
    dataDir: dataDir(),
    dataDirMigration: dataMigration,
    configKeys: config && typeof config === 'object' ? Object.keys(config) : [],
    notes: [],
  });

  // 宿主会在服务重发布时重复触发 inject 回调（同一 apply 里回调多次）。
  // 重复注册会让工具名撞车、面板路由撞 duplicate，所以这两处都做成幂等：
  // 第一次成功进来的就记账，后续直接返回。
  const registerAll = (toolCtx) => {
    if (registered.length) return; // 已经注册过一轮，别再注册第二遍
    state.toolsReady = true;
    let tools = null;
    try { tools = toolCtx.tools; } catch (e) { failures.push('read toolCtx.tools: ' + msg(e)); return; }
    if (!tools) { failures.push('tools service is null'); return; }
    for (const k of ['register', 'add', 'define', 'defineTool']) {
      try { if (typeof tools[k] === 'function') state.surfaces.push('tools.' + k); } catch (e) { failures.push('probe ' + k + ': ' + msg(e)); }
    }
    if (typeof tools.register !== 'function') { failures.push('tools.register missing; surfaces=' + state.surfaces.join(',')); return; }
    try {
      toolCtx.effect(() => {
        const disposers = [];
        for (const t of buildTools({ resolveWorkspace: state.resolveWorkspace, config })) {
          try { disposers.push(tools.register(t)); registered.push(t.name); }
          catch (e) { failures.push(t.name + ': ' + msg(e)); }
        }
        return () => {
          for (const d of disposers) { try { if (typeof d === 'function') d(); } catch (e) { /* 卸载期忽略 */ } }
        };
      });
    } catch (e) {
      failures.push('ctx.effect: ' + msg(e));
    }
    writeStatus({ phase: 'registered', toolsReady: true, detectedSurfaces: state.surfaces, registered, failures, notes });
  };

  let hooked = false;
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['tools'], (injected) => {
        try { registerAll(injected); } catch (e) { failures.push('inject callback: ' + msg(e)); }
      });
      hooked = true;
    } catch (e) {
      failures.push('ctx.inject(["tools"]): ' + msg(e));
    }
  } else {
    notes.push('ctx.inject is not a function');
  }

  if (!hooked) {
    try { registerAll(ctx); } catch (e) { failures.push('direct tools access: ' + msg(e)); }
  }

  // 面板（只读运维面）：webServer 在 apply 时刻常常还没起，用 inject 等它。
  // 挂不上不影响工具面——降级成「没有面板」，写进 status 的 panel 字段。
  //
  // 2026-11-16 踩坑：inject 的回调参数是 **ctx 本身**，不是服务对象。
  // 写成 registerPanel(injected) 会去取 injected.register → 触发
  // 'cannot get property "register" without inject'，面板静默挂不上
  // （工具面正常，只有 status.panel.ok=false）。必须 injected.get('webServer')。
  state.panel = { ok: false, reason: 'pending' };
  // 竞态：inject 回调可能在动态 import 完成前再次触发。只判 state.panel.ok 挡不住
  // ——那时 ok 还是 false，两次 import 会各挂一遍，第二次全撞 duplicate
  // （2026-11-16 真宿主实测：status.panel.attempts 三条全 duplicate、routes=0）。
  // 所以另立一个同步的 mounting 旗，第一行就置上。
  let panelMounting = false;
  const startPanel = (ws) => {
    if (panelMounting || (state.panel && state.panel.ok)) return;
    panelMounting = true;
    Promise.resolve()
      .then(() => import('./src/panel.mjs'))
      .then((m) => {
        const rep = m.registerPanel(ws);
        panelMounting = false;
        state.panel = rep;
        writeStatus({ panel: rep, notes });
      })
      .catch((e) => {
        panelMounting = false; // 失败允许下一次回调重试
        state.panel = { ok: false, reason: msg(e) };
        writeStatus({ panel: state.panel });
      });
  };
  if (typeof ctx.inject === 'function') {
    try {
      const bind = () => ctx.inject(['webServer'], (injected) => {
        const ws = resolveWebServer(injected);
        if (!ws) {
          state.panel = { ok: false, reason: 'webServer-unavailable' };
          writeStatus({ panel: state.panel });
          return;
        }
        startPanel(ws);
      });
      if (typeof ctx.effect === 'function') ctx.effect(bind); else bind();
    } catch (e) {
      state.panel = { ok: false, reason: 'ctx.inject(["webServer"]): ' + msg(e) };
      failures.push(state.panel.reason);
    }
  } else {
    state.panel = { ok: false, reason: 'ctx.inject is not a function' };
  }

  // ① 跨重启自证（只读版 A）：开机时核对上次体检的「待修清单」——
  // 修好了没、有没有把别的东西搞坏。只报告，不改任何配置。
  //
  // apply() 是同步的，所以这里走 Promise 链（与面板挂载同一写法）。
  // 验回失败不许影响插件加载——它是「体检器自己的额外能力」，不是插件能不能用的前提。
  let verifyState = { hasPending: false, reason: 'pending' };
  Promise.resolve()
    .then(() => import('./src/engine.mjs'))
    .then((eng) => import('./src/verify.mjs').then((ver) => ({ eng, ver })))
    .then(({ eng, ver }) => {
      // 架构审计 B3：先看看有没有待验目标。本机实测 pending-verify.json 的 targets 就是 []，
      // 却为此付了一次全盘扫描——顺手把「开机变慢」这笔噪声归零。
      const home = dshHome();
      if (!ver.hasPendingTargets(home)) {
        verifyState = { hasPending: false, reason: 'no-targets' };
        return;
      }
      const r0 = eng.audit({ scenario: 'general' });
      verifyState = ver.startupVerify(r0, { home: r0.facts.home });
    })
    .catch((e) => { verifyState = { hasPending: false, error: msg(e) }; })
    .then(() => {
      writeStatus({
        phase: 'apply-done',
        hookedViaInject: hooked,
        toolsReady: state.toolsReady,
        detectedSurfaces: state.surfaces,
        registered,
        failures,
        notes,
        panel: state.panel,
        verify: verifyState && verifyState.hasPending
          ? { fixed: (verifyState.fixed || []).length, stillThere: (verifyState.stillThere || []).length, muted: (verifyState.muted || []).length, regressions: (verifyState.regressions || []).length }
          : null,
      });
    });
}
