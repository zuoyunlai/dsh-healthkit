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
import os from 'node:os';
import { resolveReportPath } from './src/reportpath.mjs';

export const name = 'dsh-healthkit';

const VERSION = '0.4.1';

function homeDir() { return process.env.DSH_HOME || path.join(os.homedir(), '.dsh'); }
function statusPath() { return path.join(homeDir(), 'dsh-auditkit', 'plugin-status.json'); }

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

// 工具表按「每次 apply 的依赖」构建：report 落点需要会话工作区解析器，
// 不能写成模块级闭包（那样每个宿主实例会共享同一份依赖）。
function buildTools(deps) {
  const d = deps || {};
  const resolveWorkspace = (typeof d.resolveWorkspace === 'function') ? d.resolveWorkspace : function () { return null; };
  const pluginConfig = (d.config && typeof d.config === 'object') ? d.config : {};
  return [
  {
    name: 'audit_run',
    description: '对当前 DSH 安装跑一次只读体检：返回总分、分档与 P0/P1/P2 计数（不修改任何配置、不联网）',
    parameters: {
      type: 'object',
      properties: {
        scenario: { type: 'string', description: 'general|code|design|writing，缺省 general' },
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
      const hist = await import('./src/history.mjs');
      hist.append(r, { scenario: (args && args.scenario) || 'general' });
      const by = {};
      r.findings.forEach((f) => { by[f.severity] = (by[f.severity] || 0) + 1; });
      const top = r.findings
        .filter((f) => f.severity === 'P0' || f.severity === 'P1')
        .slice(0, 8)
        .map((f) => '- [' + f.severity + '] ' + f.ruleId + ' ' + (f.title || '') + (f.target ? ' @ ' + f.target : ''))
        .join('\n');
      return {
        score: r.score.total,
        raw: r.score.raw,
        band: r.score.band,
        p0: by.P0 || 0,
        p1: by.P1 || 0,
        p2: by.P2 || 0,
        findings: r.findings.length,
        retired: r.retired.length,
        summary: top || '（无 P0/P1）',
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
    description: '跑一次体检，把完整 Markdown 报告写成文件：缺省写本会话工作区的 AUDIT-<日期>.md；给了 out 则按 out（相对路径以会话工作区为基准）；取不到工作区时退到 $DSH_HOME/dsh-auditkit/reports/。返回路径、落点来源与摘要',
    parameters: {
      type: 'object',
      properties: {
        out: { type: 'string', description: '报告输出路径：绝对路径照用，相对路径以本会话工作区为基准；缺省 = 会话工作区下的 AUDIT-<日期>.md。注意：不接受「相对 process.cwd」的旧语义' },
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
      const workspace = resolveWorkspace(exec);
      const target = resolveReportPath({
        out: args && args.out,
        reportDir: pluginConfig.reportDir,
        workspace,
      });
      if (target.error) throw new Error('audit_report: ' + target.error);
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
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
        const s = (r.dryRun ? '预演：将永久删除 ' : '已永久删除 ') + n + ' 个批次，' + fmtBytes(r.bytes);
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
  ];
}

export function apply(ctx, config) {
  const notes = [];
  const registered = [];
  const failures = [];
  const state = { toolsReady: false, surfaces: [] };

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
    configKeys: config && typeof config === 'object' ? Object.keys(config) : [],
    notes: [],
  });

  const registerAll = (toolCtx) => {
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

  writeStatus({
    phase: 'apply-done',
    hookedViaInject: hooked,
    toolsReady: state.toolsReady,
    detectedSurfaces: state.surfaces,
    registered,
    failures,
    notes,
  });
}
