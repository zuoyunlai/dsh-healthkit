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
import { buildTools, msg, resolveWebServer } from './src/toolface.mjs';
export { buildTools, resolveWebServer };
export { TOOL_COUNT } from './src/toolface.mjs';

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
