// dsh-auditkit 宿主半边
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

export const name = 'dsh-auditkit';

const VERSION = '0.1.3';

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
  },
  required: ['path', 'score', 'findings'],
};

const TOOLS = [
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
          'dsh-auditkit · ' + v.score + '/10（' + v.band + '）',
          'P0 ' + v.p0 + ' · P1 ' + v.p1 + ' · P2 ' + v.p2 + ' · 共 ' + v.findings + ' 条 · 已退役 ' + v.retired,
          '',
          v.summary,
        ];
        return text(lines.join('\n'));
      },
    },
    execute: async (args) => {
      const { audit } = await import('./src/engine.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
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
      };
    },
  },
  {
    name: 'audit_report',
    description: '跑一次体检并把完整 Markdown 报告写到工作区（默认 AUDIT-<日期>.md），返回路径与摘要',
    parameters: {
      type: 'object',
      properties: { out: { type: 'string', description: '报告输出路径，缺省写当前工作区' } },
      additionalProperties: false,
    },
    output: {
      schema: REPORT_SCHEMA,
      render(_args, v) {
        return text('报告已写入 ' + v.path + '\n总分 ' + v.score + ' · 问题 ' + v.findings + ' 条 · ' + v.bytes + ' 字节');
      },
    },
    execute: async (args) => {
      const { audit } = await import('./src/engine.mjs');
      const r = audit({ scenario: 'general' });
      const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const out = (args && args.out) || path.join(process.cwd(), 'AUDIT-' + d + '.md');
      fs.writeFileSync(out, r.report, 'utf8');
      return { path: out, score: r.score.total, findings: r.findings.length, bytes: Buffer.byteLength(r.report, 'utf8') };
    },
  },
];

export function apply(ctx, config) {
  const notes = [];
  const registered = [];
  const failures = [];
  const state = { toolsReady: false, surfaces: [] };

  // ④ 进门就落档
  writeStatus({
    version: VERSION,
    phase: 'apply-entered',
    loadedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
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
        for (const t of TOOLS) {
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
