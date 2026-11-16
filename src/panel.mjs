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
  'button{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px}',
  'button:hover{border-color:var(--accent)}',
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

const JS = [
  'function el(tag, cls, txt){var e=document.createElement(tag);if(cls)e.className=cls;if(txt!=null)e.textContent=String(txt);return e}',
  'function sev(s){return el("span","sev s-"+s,s)}',
  'function mb(n){return n>=1073741824?(n/1073741824).toFixed(1)+" GB":(n/1048576).toFixed(1)+" MB"}',
  'function setText(id,t){document.getElementById(id).textContent=t}',
  'function renderSev(d){var box=document.getElementById("sev");box.textContent="";',
  '  [["P0",d.p0],["P1",d.p1],["P2",d.p2],["INFO",d.info]].forEach(function(p){box.appendChild(sev(p[0]));box.appendChild(el("b",null," "+p[1]));})}',
  'function renderTop(items){var box=document.getElementById("top");box.textContent="";',
  '  if(!items.length){box.appendChild(el("div","dim","没有未解决的问题"));return}',
  '  items.forEach(function(x){var row=el("div","item");row.appendChild(sev(x.severity));',
  '    var w=el("div");w.appendChild(el("b",null,x.ruleId));w.appendChild(el("span",null," "+x.title));',
  '    if(x.fixHint)w.appendChild(el("div","dim",x.fixHint));',
  '    w.appendChild(el("div","fp",x.fp));row.appendChild(w);box.appendChild(row)})}',
  'async function load(){',
  '  var d=window.__SUMMARY__;',
  '  if(!d){var r=await fetch("' + PREFIX + '/api/summary",{cache:"no-store"});d=await r.json()}',
  '  setText("score",d.score);setText("band",d.band);renderSev(d);',
  '  setText("findings",d.findings);setText("retired",d.retired);',
  '  var dl=(typeof d.trend.delta==="number")?d.trend.delta:null;',
  '  setText("trend",d.trend.latest+(dl===null?"（首次）":(dl>=0?" (+"+dl+")":" ("+dl+")")));',
  '  setText("runs",d.trend.runs+" 次 / "+d.trend.daysTracked+" 天");',
  '  setText("spark",d.trend.sparkline||"—");',
  '  setText("clean",d.clean?mb(d.clean.bytes):"未知");',
  '  setText("cleanSub",d.clean?d.clean.candidates+" 组可清理（先预览再生效）":"");',
  '  if(d.trim){setText("trim",d.trim.served+" / "+d.trim.maxBundles);setText("trimSub",d.trim.groups+" 组能力冗余")}',
  '  renderTop(d.top);',
  '  setText("at","更新 "+String(d.at).replace("T"," ").slice(0,19));',
  '}',
  'document.getElementById("refresh").onclick=function(){load().catch(function(e){setText("at","刷新失败："+e.message)})};',
  'load().catch(function(e){setText("at","加载失败："+e.message)});',
].join('\n');

export function pageHtml() {
  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>DSH 体检</title><style>' + CSS + '</style></head><body>',
    '<header><h1>DSH 体检</h1><span class="dim">只读 · 不写配置 · 不联网</span>',
    '<span style="flex:1"></span><button id="refresh">刷新</button></header>',
    '<div class="grid">',
    '<div class="card"><div class="k">总分（10 分制）</div><div class="v" id="score">—</div><div class="row" id="sev"></div></div>',
    '<div class="card"><div class="k">分档</div><div class="v" id="band">—</div><div class="dim" id="at">加载中…</div></div>',
    '<div class="card"><div class="k">未解决 / 已退役</div><div class="v"><span id="findings">—</span> <small>/ <span id="retired">—</span></small></div></div>',
    '<div class="card"><div class="k">最新分 / 记账</div><div class="v" id="trend">—</div><div class="dim" id="runs"></div><div class="dim" id="spark" style="font-family:ui-monospace,monospace;font-size:16px"></div></div>',
    '<div class="card"><div class="k">可清理空间</div><div class="v" id="clean">—</div><div class="dim" id="cleanSub"></div></div>',
    '<div class="card"><div class="k">服务插件 / 上限</div><div class="v" id="trim">—</div><div class="dim" id="trimSub"></div></div>',
    '</div>',
    '<div class="card" style="margin-top:14px"><div class="k">先看这些（按严重度）</div><div id="top"></div></div>',
    '<footer>数据来自本机 ~/.dsh；面板只读，清理与修复请走 audit_clean / CLI。每分钟缓存一次。</footer>',
    '<script>' + JS + '</script>',
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
    try { sendHtml(res, pageHtml()); } catch (e) { sendJson(res, 500, { error: String((e && e.message) || e) }); }
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
