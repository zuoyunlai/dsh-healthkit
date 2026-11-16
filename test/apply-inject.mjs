// apply() 的注入路径集成测试：用假 ctx 模拟宿主，验证
//  ① 8 个工具经 ctx.tools.register 注册
//  ② webServer 经 inject 回调 + injected.get() 取到，面板真的挂上（0.5.1 在这里挂过）
// 用隔离的 DSH_HOME，避免写用户真实的 plugin-status.json。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-apply-'));
process.env.DSH_HOME = home;

const { apply, resolveWebServer } = await import('../index.js');

const registered = [];
const routes = [];
const fakeWs = { register(r) { routes.push(r); return () => {}; } };
const fakeTools = { register(r) { registered.push(r); return () => {}; } };

function makeCtx() {
  return {
    inject(deps, cb) {
      // 宿主语义：回调参数是 ctx，服务经 .get(name) 取
      // 宿主里 inject 回调拿到的 ctx，其已声明依赖可直接用（inject 已保证），
      // 所以除了 get() 还要暴露 tools 属性——真实 registerAll() 就是走 scope.tools.register。
      cb({
        get: (n) => (n === 'webServer' ? fakeWs : n === 'tools' ? fakeTools : undefined),
        tools: fakeTools,
        webServer: fakeWs,
        effect(fn) { return fn(); },
      });
      return () => {};
    },
    effect(fn) { return fn(); },
    get(n) {
      if (n === 'workingDirectory') return { get: () => path.join(home, 'ws') };
      return undefined;
    },
    tools: fakeTools,
  };
}

assert.equal(resolveWebServer({ get: (n) => (n === 'webServer' ? fakeWs : undefined) }), fakeWs);
assert.equal(resolveWebServer(fakeWs), null, '把服务对象当 ctx 传必须被拒');
assert.equal(resolveWebServer(null), null);

apply(makeCtx(), {});

// inject 回调里是 Promise 链（动态 import），给它一拍
await new Promise((r) => setTimeout(r, 800));

const statusPath = path.join(home, 'dsh-healthkit', 'plugin-status.json');
assert.ok(fs.existsSync(statusPath), 'apply 应写出 plugin-status.json');
const st = JSON.parse(fs.readFileSync(statusPath, 'utf8'));

assert.equal(st.registered.length, 9, '9 个工具都应注册，实得 ' + st.registered.length + ': ' + st.registered.join(','));
for (const n of ['audit_run', 'audit_report', 'audit_clean', 'audit_trend', 'audit_findings', 'audit_explain', 'audit_plan', 'audit_trim', 'audit_capabilities']) {
  assert.ok(st.registered.includes(n), '缺工具 ' + n);
}
assert.deepEqual(st.failures, [], '不应有注册失败：' + JSON.stringify(st.failures));
assert.equal(st.panel && st.panel.ok, true, '面板应挂上，实得 ' + JSON.stringify(st.panel));
assert.equal(routes.length, 3, '应注册 3 条路由，实得 ' + routes.length);

fs.rmSync(home, { recursive: true, force: true });
console.log('apply-inject: 通过（9 工具 · 面板 3 路由 · failures 空）');
