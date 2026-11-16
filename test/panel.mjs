// 面板：路由能挂上、只认回环、HTML 与 JSON 都能出。
// 不需要真宿主——用一个假 webServer 收集注册，用假 res 收集响应。
import assert from 'node:assert/strict';
import { registerPanel, collectSummary } from '../src/panel.mjs';

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
  assert.ok(res.body.includes('api/summary'), 'HTML 应引用自己的 API');
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
  assert.ok(Array.isArray(d.top));
  assert.equal(typeof d.p0, 'number');
}

// 缓存：两次调用应命中同一份（1 分钟内）
{
  const a = collectSummary();
  const b = collectSummary();
  assert.equal(a.at, b.at, '1 分钟内应命中缓存');
}

console.log('panel: 通过（3 路由 · 回环守卫 · HTML 离线 · 缓存命中）');
