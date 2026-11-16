// PC 管家式只读面板。
//
// 立场和工具一致：面板只展示、只读、不写配置。GET 请求不产生任何写盘副作用
// （不记账、不改状态），预取/刷新/重放都安全。
//
// 宿主 API：ctx.inject(['webServer'], ws => ws.register({ kind, path, handler }))
// handler 是 Node 的 (req, res)。prefix 路由自己剥路径尾段。
//
// 2026-11-16 教训：前端最初用字符串拼 HTML + 手写转义，生成出来的 JS 里
// \" 被吃成 "，整段脚本语法错误、页面空白。改成 DOM API 组装，不再拼标签。
import { audit } from './engine.mjs';
import { stats } from './history.mjs';
import { analyze as trimAnalyze } from './trim.mjs';
import { scan as cleanScan } from './clean.mjs';

const PREFIX = '/dsh-healthkit-panel';
const CACHE_MS = 60 * 1000;

let cache = { at: 0, data: null };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

// 只认本机回环：面板是本地运维面，不该从局域网可达。
function loopbackOnly(req) {
  const a = (req && req.socket && req.socket.remoteAddress) || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1' || a === '';
}

export function collectSummary() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_MS) return cache.data;

  const r = audit({ scenario: 'general' });
  const order = { P0: 0, P1: 1, P2: 2, INFO: 3 };
  const by = { P0: 0, P1: 0, P2: 0, INFO: 0 };
  r.findings.forEach((f) => { if (by[f.severity] !== undefined) by[f.severity] += 1; });
  const h = stats({ days: 30 });
  let clean = null;
  try {
    const s = cleanScan({});
    clean = { candidates: (s.groups || []).length, bytes: s.totalBytes || 0 };
  } catch (e) { clean = null; }
  let trim = null;
  try {
    const t = trimAnalyze(r.facts);
    trim = { served: t.served, maxBundles: t.maxBundles, groups: t.groups.length };
  } catch (e) { trim = null; }

  const top = r.findings
    .slice()
    .sort((a, b) => (order[a.severity] === undefined ? 9 : order[a.severity]) - (order[b.severity] === undefined ? 9 : order[b.severity]))
    .slice(0, 8)
    .map((f) => ({ severity: f.severity, ruleId: f.ruleId, title: f.title || '', fp: f.fp, fixHint: f.fixHint || '' }));

  const data = {
    at: new Date().toISOString(),
    score: r.score.total,
    raw: r.score.raw,
    band: r.score.band,
    findings: r.findings.length,
    retired: r.retired.length,
    p0: by.P0, p1: by.P1, p2: by.P2, info: by.INFO,
    trend: { runs: h.runs, daysTracked: h.daysTracked, latest: h.latest, delta: h.delta, sparkline: h.sparkline || '' },
    clean,
    trim,
    top,
  };
  cache = { at: now, data };
  return data;
}

const CSS = [
  ':root{--bg:#0f1419;--card:#171d24;--line:#242d38;--ink:#e6edf3;--dim:#8b98a5;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--accent:#58a6ff}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,"Segoe UI",system-ui,sans-serif;padding:20px}',
  'header{display:flex;align-items:baseline;gap:12px;margin-bottom:18px}',
  'h1{font-size:18px;margin:0;font-weight:600}',
  'button,a.btn{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;text-decoration:none}',
  'button:hover,a.btn:hover{border-color:var(--accent)}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;align-items:start}',
  '.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px}',
  '.k{color:var(--dim);font-size:12px;margin-bottom:6px}',
  '.v{font-size:28px;font-weight:700;letter-spacing:-.5px}',
  '.v small{font-size:13px;font-weight:400;color:var(--dim)}',
  '.row{display:flex;gap:10px;align-items:center;margin-top:8px;flex-wrap:wrap}',
  '.sev{display:inline-block;min-width:52px;font-size:11px;font-weight:700;padding:1px 6px;border-radius:5px;text-align:center}',
  '.s-P0{background:#3d1519;color:var(--bad)}',
  '.s-P1{background:#3a2d12;color:var(--warn)}',
  '.s-P2{background:#12243a;color:var(--accent)}',
  '.s-INFO{background:#1b2229;color:var(--dim)}',
  '.item{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);align-items:flex-start}',
  '.item:last-child{border-bottom:0}',
  '.fp{color:var(--dim);font-size:11px;font-family:ui-monospace,Consolas,monospace}',
  '.dim{color:var(--dim);font-size:12px}',
  'footer{margin-top:18px;color:var(--dim);font-size:12px}',
].join('\n');
// ---- 服务端渲染：面板不依赖任何客户端 JS ----
//
// 2026-11-16 真机反馈：系统浏览器能看，DSH 侧边栏 iframe 看不到内容。
// 响应头里没有任何 X-Frame-Options / CSP，所以不是被 header 拦，而是侧边栏 iframe
// 的沙箱不给脚本执行权——而这个面板原本全靠 <script> 渲染，于是整页空白。
// 改成把数据直接渲染进 HTML（数据本来就在服务端算好），并用 <meta refresh> 自刷新，
// 这样在禁脚本的沙箱里也能正常显示。

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SEVS = ['P0', 'P1', 'P2', 'INFO'];

function sevBadge(x) {
  return '<span class="sev s-' + x + '">' + x + '</span>';
}

function mbOf(n) {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '0 B';
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function pageHtml(data) {
  const d = data || collectSummary();
  const sevRow = SEVS.map(function (k) {
    const n = k === 'INFO' ? d.info : d[k.toLowerCase()];
    return sevBadge(k) + ' <b>' + n + '</b>';
  }).join(' ');

  const delta = typeof d.trend.delta === 'number' ? d.trend.delta : null;
  const trendTxt = d.trend.latest + (delta === null ? '（首次）' : (delta >= 0 ? ' (+' + delta + ')' : ' (' + delta + ')'));
  const cleanTxt = d.clean ? mbOf(d.clean.bytes) : '未知';
  const cleanSub = d.clean ? d.clean.candidates + ' 组可清理（先预览再生效）' : '';
  const trimV = d.trim ? d.trim.served + ' / ' + d.trim.maxBundles : '—';
  const trimSub = d.trim ? d.trim.groups + ' 组能力冗余' : '';

  const items = d.top.length
    ? d.top.map(function (x) {
        return '<div class="item">' + sevBadge(x.severity) +
          '<div><b>' + esc(x.ruleId) + '</b> ' + esc(x.title) +
          (x.fixHint ? '<div class="dim">' + esc(x.fixHint) + '</div>' : '') +
          '<div class="fp">' + esc(x.fp) + '</div></div></div>';
      }).join('')
    : '<div class="dim">没有未解决的问题</div>';

  const cards = [
    '<div class="card"><div class="k">总分（10 分制）</div><div class="v">' + d.score + '</div><div class="row">' + sevRow + '</div></div>',
    '<div class="card"><div class="k">分档</div><div class="v">' + esc(d.band) + '</div><div class="dim">更新 ' + esc(String(d.at).replace('T', ' ').slice(0, 19)) + '</div></div>',
    '<div class="card"><div class="k">未解决 / 已退役</div><div class="v">' + d.findings + ' <small>/ ' + d.retired + '</small></div></div>',
    '<div class="card"><div class="k">最新分 / 记账</div><div class="v">' + esc(trendTxt) + '</div><div class="dim">' + d.trend.runs + ' 次 / ' + d.trend.daysTracked + ' 天</div><div class="dim" style="font-family:ui-monospace,monospace;font-size:16px">' + esc(d.trend.sparkline || '—') + '</div></div>',
    '<div class="card"><div class="k">可清理空间</div><div class="v">' + esc(cleanTxt) + '</div><div class="dim">' + esc(cleanSub) + '</div></div>',
    '<div class="card"><div class="k">服务插件 / 上限</div><div class="v">' + esc(trimV) + '</div><div class="dim">' + esc(trimSub) + '</div></div>',
  ].join('');

  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta http-equiv="refresh" content="60">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>DSH 体检</title><style>' + CSS + '</style></head><body>',
    '<header><h1>DSH 体检</h1><span class="dim">只读 · 不写配置 · 不联网</span>',
    '<span style="flex:1"></span><a class="btn" href="?r=' + Date.now() + '">刷新</a></header>',
    '<div class="grid">' + cards + '</div>',
    '<div class="card" style="margin-top:14px"><div class="k">先看这些（按严重度）</div>' + items + '</div>',
    '<footer>数据来自本机 ~/.dsh；面板只读，清理与修复请走 audit_clean / CLI。每分钟自动刷新；数据缓存 60 秒。</footer>',
    '</body></html>',
  ].join('\n');
}

export function registerPanel(webServer) {
  const report = { ok: false, routes: 0, attempts: [] };
  if (!webServer || typeof webServer.register !== 'function') {
    report.reason = 'webServer-unavailable';
    return report;
  }
  const page = function handler(req, res) {
    if (!loopbackOnly(req)) return sendJson(res, 403, { error: 'loopback only' });
    try { sendHtml(res, pageHtml()); }
    catch (e) { sendJson(res, 500, { error: String((e && e.message) || e) }); }
  };
  const api = function handler(req, res) {
    if (!loopbackOnly(req)) return sendJson(res, 403, { error: 'loopback only' });
    try { sendJson(res, 200, collectSummary()); }
    catch (e) { sendJson(res, 500, { error: String((e && e.message) || e) }); }
  };
  const routes = [
    { kind: 'exact', path: PREFIX, handler: page },
    { kind: 'exact', path: PREFIX + '/', handler: page },
    { kind: 'exact', path: PREFIX + '/api/summary', handler: api },
  ];
  for (const r of routes) {
    try { webServer.register(r); report.routes += 1; report.attempts.push({ path: r.path, ok: true }); }
    catch (e) { report.attempts.push({ path: r.path, ok: false, error: String((e && e.message) || e) }); }
  }
  report.ok = report.routes > 0;
  return report;
}
