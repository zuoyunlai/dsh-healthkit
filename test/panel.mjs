// 面板：路由能挂上、只认回环、HTML 与 JSON 都能出。
// 不需要真宿主——用一个假 webServer 收集注册，用假 res 收集响应。
import assert from 'node:assert/strict';
import { makeTempHome } from './testenv.mjs';

// 面板测试跑在临时 HOME 上（CI 上没有 ~/.dsh）。
// **必须动态 import**：ESM 的静态 import 会在模块求值时先执行，
// 那时 DSH_HOME 还没设上，模块内已经按真机 HOME 初始化过了。
const tmpHome = makeTempHome('healthkit-panel-');
process.env.DSH_HOME = tmpHome;

const { registerPanel, collectSummary } = await import('../src/panel.mjs');
const { resolveWebServer } = await import('../index.js');
const { append } = await import('../src/history.mjs');

// 折线需要至少两个数据点：临时 HOME 里先记两笔账。
// （CI 上没有 ~/.dsh，账本是空的 → 折线画不出来，这是环境差异不是缺陷。）
{
  const fake = { score: { total: 8.1, raw: 8.1, band: '可用', scenario: 'general' }, findings: [], retired: [] };
  append(fake, { scenario: 'general' });
  fake.score.total = 8.4;
  append(fake, { scenario: 'general' });
}

const routes = {};
const fakeWs = { register(r) { routes[r.path] = r; return () => {}; } };
const rep = registerPanel(fakeWs);
assert.equal(rep.ok, true, '面板应注册成功');
assert.equal(rep.routes, 3);
assert.ok(routes['/dsh-healthkit-panel'], '页面路由缺');
assert.ok(routes['/dsh-healthkit-panel/api/summary'], 'API 路由缺');

function fakeRes() {
  const out = { status: 0, headers: null, body: '' };
  out.writeHead = (s, h) => { out.status = s; out.headers = h; };
  out.end = (b) => { out.body += b || ''; };
  return out;
}
const reqLocal = { url: '/dsh-healthkit-panel', socket: { remoteAddress: '127.0.0.1' } };
const reqRemote = { url: '/dsh-healthkit-panel', socket: { remoteAddress: '192.168.1.9' } };

// 本机：拿到 HTML
{
  const res = fakeRes();
  routes['/dsh-healthkit-panel'].handler(reqLocal, res);
  assert.equal(res.status, 200);
  assert.ok(res.body.includes('DSH 体检'), 'HTML 应含标题');
  // 服务端渲染：分数直接出现在 HTML 里，不依赖客户端 JS（侧边栏 iframe 禁脚本也能看）
  assert.ok(/<div class="v">\d+(\.\d+)?<\/div>/.test(res.body), 'HTML 应含服务端渲染的分数');
  assert.ok(res.body.includes('<meta http-equiv="refresh"'), '应有 meta 自刷新（不用 JS）');
  assert.ok(res.body.includes('<polyline'), '应有趋势折线（需至少两个数据点）');
  assert.ok(res.body.includes('能力域'), '应有能力域段');
  assert.ok(res.body.includes('上次修的，现在怎样了'), '应有跨重启验回段');
  assert.ok(res.body.includes('最近几次的变化'), '应有跨次时间线段');
  assert.ok(!/https?:\/\//.test(res.body.replace(/http:\/\/127\.0\.0\.1/g, '')), 'HTML 不应有外链（离线可用）');
}

// 非本机：403
{
  const res = fakeRes();
  routes['/dsh-healthkit-panel'].handler(reqRemote, res);
  assert.equal(res.status, 403);
}

// API：JSON 带分数
{
  const res = fakeRes();
  routes['/dsh-healthkit-panel/api/summary'].handler(reqLocal, res);
  assert.equal(res.status, 200);
  const d = JSON.parse(res.body);
  assert.equal(typeof d.score, 'number');
  assert.ok(d.band);
  assert.ok(Array.isArray(d.items), 'items 应为数组');
  assert.ok(d.items.length > 0, '应至少有一条问题');
  const first = d.items[0];
  assert.ok(first.ruleId && first.severity && first.title, '条目要有 ruleId/severity/title');
  assert.ok(typeof first.dimension === 'string', '条目要有维度（根因分类）');
  assert.ok(typeof first.fixHint === 'string', '条目要有修法');
  assert.ok(d.plan && Array.isArray(d.plan.rows), '要有修复顺序');
  assert.ok(d.headline, '要有一句话结论');
  assert.equal(typeof d.p0, 'number');
}

// 缓存：两次调用应命中同一份（1 分钟内）
{
  const a = collectSummary();
  const b = collectSummary();
  assert.equal(a.at, b.at, '1 分钟内应命中缓存');
}

// 注入约定的守门测试：0.5.1 就是把 inject 回调拿到的 ctx 直接当 webServer 传了，
// 结果 registerPanel 去取 ctx.register → 抛 'cannot get property "register" without inject'。
{
  const ws = { register() { return () => {}; } };
  assert.equal(resolveWebServer({ get: (n) => (n === 'webServer' ? ws : undefined) }), ws, '应能从 ctx 取到 webServer');
  assert.equal(resolveWebServer(ws), null, '把服务对象当 ctx 传必须被拒（这正是 0.5.1 的 bug）');
  assert.equal(resolveWebServer(null), null);
  // 非法输入不抛异常，只降级
  assert.equal(registerPanel({}).ok, false);
  assert.equal(registerPanel(null).ok, false);
}

console.log('panel: 通过（3 路由 · 回环守卫 · HTML 离线 · 缓存命中 · 注入约定）');
