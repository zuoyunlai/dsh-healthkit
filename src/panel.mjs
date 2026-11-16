// PC 管家式只读面板（Host 半边：网页面板 + JSON API）。
//
// 立场和工具一致：面板只展示、只读、不写配置。GET 不记账、不写状态。
// 宿主 API：ctx.inject(['webServer'], ws => ws.register({ kind, path, handler }))
//
// 2026-11-16 三次教训：
//   ① 字符串拼 HTML 手写转义 → 生成 JS 里 \" 被吃 → 整段脚本语法错、页面空白。
//   ② 侧边栏 iframe 不给脚本执行权 → 依赖 <script> 的面板在侧边栏里永远白屏。
//   ③ 只给分数不给原因 → 面板没用。现在每条问题带维度、证据、测得值、修法，
//      另给「修复顺序」与「优化建议」，折叠用原生 <details>（无脚本也能展开）。
import { audit } from './engine.mjs';
import { stats, load as loadHistory } from './history.mjs';
import { analyze as trimAnalyze } from './trim.mjs';
import { scan as cleanScan } from './clean.mjs';
import { buildMatrix } from './capability-map.mjs';

const PREFIX = '/dsh-healthkit-panel';
const CACHE_MS = 60 * 1000;
const SEV_ORDER = { P0: 0, P1: 1, P2: 2, INFO: 3 };

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

function clip(v, max) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (!s || s === '{}' || s === '[]') return '';
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch (e) { return ''; }
}

function headlineOf(by, score, count) {
  if (by.P0 > 0) return '有 ' + by.P0 + ' 条 P0 压着总分封顶，先处理它们';
  if (!count) return '没发现未解决的问题';
  if (score < 6) return '问题较多，按下表顺序修见效最快';
  if (score < 8) return '整体可用，还有几处该收的尾巴';
  return '整体健康，剩下的是打磨项';
}

export function collectSummary() {
  const now = Date.now();
  if (cache.data && now - cache.at < CACHE_MS) return cache.data;

  const r = audit({ scenario: 'general' });
  const by = { P0: 0, P1: 0, P2: 0, INFO: 0 };
  r.findings.forEach((f) => { if (by[f.severity] !== undefined) by[f.severity] += 1; });

  const sorted = r.findings.slice().sort((a, b) => {
    const da = SEV_ORDER[a.severity] === undefined ? 9 : SEV_ORDER[a.severity];
    const db = SEV_ORDER[b.severity] === undefined ? 9 : SEV_ORDER[b.severity];
    return da - db;
  });

  // 每条问题：是什么、在哪、为什么（根因）、怎么修
  const items = sorted.map((f) => ({
    fp: f.fp,
    ruleId: f.ruleId,
    severity: f.severity,
    dimension: f.dimension || '',
    title: f.title || '',
    target: f.target || '',
    confidence: f.confidence || 'uncertain',
    advisory: !!f.advisory,
    fixHint: f.fixHint || '',
    evidence: (f.evidence || []).slice(0, 4).map((x) => clip(x, 160)),
    measured: clip(f.measured, 320),
  }));

  // 修复顺序：先解 P0 封顶，再按单条增量排
  const at = r.attribution || {};
  const plan = {
    base: typeof at.stage2Base === 'number' ? at.stage2Base : r.score.total,
    potentialAll: typeof at.potentialAll === 'number' ? at.potentialAll : r.score.total,
    capped: !!at.capped,
    stage1: at.stage1
      ? {
          count: at.stage1.count || 0,
          from: at.stage1.from,
          to: at.stage1.to,
          delta: at.stage1.delta || 0,
          items: (at.stage1.items || []).slice(0, 8).map((x) => clip(x, 180)),
        }
      : null,
    rows: (at.rows || []).slice(0, 10).map((x) => ({
      ruleId: x.ruleId,
      severity: x.severity || '',
      title: x.title || '',
      target: x.target || '',
      delta: x.delta || 0,
    })),
  };

  // 清理：可回收多少、按什么分组
  let clean = null;
  try {
    const s = cleanScan({});
    clean = {
      bytes: s.totalBytes || 0,
      groups: (s.groups || []).map((g) => ({
        id: g.id,
        label: g.label || '',
        risk: g.risk || 'safe',
        reason: clip(g.reason || '', 120),
        bytes: g.bytes || 0,
        files: g.files || 0,
      })),
    };
  } catch (e) { clean = null; }

  // 优化建议：装载面瘦身
  let trim = null;
  try {
    const t = trimAnalyze(r.facts);
    trim = {
      served: t.served,
      maxBundles: t.maxBundles,
      groups: (t.groups || []).map((g) => ({ tag: g.tag, count: g.count, keep: g.keep, drop: g.drop })),
      memory: (t.memory || []).map((m) => m.name),
      suggestions: (t.suggestions || []).slice(0, 6),
    };
  } catch (e) { trim = null; }

  // 能力域：面板只放「多实现 / 无实现」的摘要，完整矩阵走 audit_capabilities
  let caps = null;
  try {
    const mx = buildMatrix(r.facts);
    caps = {
      present: mx.byStatus.present || 0,
      redundant: mx.byStatus.redundant || 0,
      conflicting: mx.byStatus.conflicting || 0,
      degraded: mx.byStatus.degraded || 0,
      missing: mx.byStatus.missing || 0,
      unknown: mx.byStatus.unknown || 0,
      // 只展示「有缺口」的域；全 20 条塞进面板太长
      rows: mx.rows
        .filter((x) => x.status !== 'present')
        .map((x) => ({ label: x.label, status: x.status, detail: x.detail })),
    };
  } catch (e) { caps = null; }

  const h = stats({ days: 30 });
  const data = {
    at: new Date().toISOString(),
    score: r.score.total,
    raw: r.score.raw,
    band: r.score.band,
    count: r.findings.length,
    findings: r.findings.length, // 兼容旧字段
    retired: r.retired.length,
    p0: by.P0, p1: by.P1, p2: by.P2, info: by.INFO,
    headline: headlineOf(by, r.score.total, r.findings.length),
    trend: {
      runs: h.runs,
      daysTracked: h.daysTracked,
      latest: h.latest,
      delta: h.delta,
      sparkline: h.sparkline || '',
      // 逐日点（按天折叠）：趋势语义，给 API / audit_trend 用。
      series: (h.series || []).slice(-30),
      // 按次的点：面板折线用这个。同一天里改完配置再跑一次，分数变化当天就能看见，
      // 而按天折叠会把当天所有记录压成一条，改动的效果要等到明天。
      recent: (() => {
        try {
          return loadHistory()
            .filter((r) => typeof r.total === 'number')
            .slice(-20)
            .map((r) => ({ at: r.at, day: r.day, total: r.total, p0: r.p0 }));
        } catch (e) { return []; }
      })(),
    },
    items,
    plan,
    clean,
    trim,
    capabilities: caps,
    retiredList: r.retired.map((f) => ({ fp: f.fp, ruleId: f.ruleId, title: f.title || '' })),
  };
  cache = { at: now, data };
  return data;
}

const CSS = [
  ':root{--bg:#0f1419;--card:#171d24;--line:#242d38;--ink:#e6edf3;--dim:#8b98a5;--ok:#3fb950;--warn:#d29922;--bad:#f85149;--accent:#58a6ff}',
  '*{box-sizing:border-box}',
  'body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,"Segoe UI",system-ui,sans-serif;padding:20px}',
  'header{display:flex;align-items:baseline;gap:12px;margin-bottom:10px}',
  'h1{font-size:18px;margin:0;font-weight:600}',
  'h2{font-size:13px;margin:20px 0 8px;color:var(--dim);font-weight:600;letter-spacing:.02em}',
  'button,a.btn{background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;text-decoration:none}',
  'button:hover,a.btn:hover{border-color:var(--accent)}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px;align-items:start}',
  '.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}',
  '.k{color:var(--dim);font-size:12px;margin-bottom:6px}',
  '.v{font-size:26px;font-weight:700;letter-spacing:-.5px}',
  '.v small{font-size:13px;font-weight:400;color:var(--dim)}',
  '.row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}',
  '.sev{display:inline-block;min-width:46px;font-size:11px;font-weight:700;padding:1px 6px;border-radius:5px;text-align:center}',
  '.s-P0{background:#3d1519;color:var(--bad)}',
  '.s-P1{background:#3a2d12;color:var(--warn)}',
  '.s-P2{background:#12243a;color:var(--accent)}',
  '.s-INFO{background:#1b2229;color:var(--dim)}',
  '.dim{color:var(--dim);font-size:12px}',
  '.fp{color:var(--dim);font-size:11px;font-family:ui-monospace,Consolas,monospace}',
  'details{border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin-bottom:8px;background:var(--card)}',
  'details[open]{border-color:#31405a}',
  'summary{cursor:pointer;list-style:none;display:flex;gap:8px;align-items:flex-start}',
  'summary::-webkit-details-marker{display:none}',
  'summary .t{font-size:13px;line-height:1.45}',
  '.body{margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:12px;color:var(--ink)}',
  '.kv{margin:6px 0}',
  '.kv b{color:var(--dim);font-weight:600;font-size:11px;display:block;margin-bottom:2px}',
  'pre{margin:2px 0 0;white-space:pre-wrap;word-break:break-all;font-family:ui-monospace,Consolas,monospace;font-size:11px;color:var(--dim)}',
  'ol,ul{margin:4px 0;padding-left:18px}',
  'li{margin:3px 0;font-size:12px}',
  'footer{margin-top:18px;color:var(--dim);font-size:12px}',
].join('\n');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const SEVS = ['P0', 'P1', 'P2', 'INFO'];

function sevBadge(x) {
  return '<span class="sev s-' + esc(x) + '">' + esc(x) + '</span>';
}

function mbOf(n) {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '0 B';
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
  return (n / 1048576).toFixed(1) + ' MB';
}

// SVG 折线：y 轴固定 0–10（不按 min/max 自适应，否则 8.3→8.4 会被画成陡坡）。
// preserveAspectRatio=none 让线随容器宽度拉伸；non-scaling-stroke 保证线宽不被拉变形。
function trendChart(series) {
  const pts = (series || []).filter((p) => typeof p.total === 'number');
  if (pts.length < 2) {
    return '<div class="dim">只有 1 个数据点，再跑几次才有折线</div>';
  }
  const W = 100, H = 30, PAD = 2;
  const x = (i) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
  const y = (v) => H - PAD - (Math.max(0, Math.min(10, v)) / 10) * (H - 2 * PAD);
  const points = pts.map((p, i) => x(i).toFixed(2) + ',' + y(p.total).toFixed(2)).join(' ');
  const ref = (v) => '<line x1="' + PAD + '" y1="' + y(v).toFixed(2) + '" x2="' + (W - PAD) + '" y2="' + y(v).toFixed(2) + '" stroke="currentColor" stroke-opacity=".18" stroke-width=".4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke" />';
  const first = pts[0], last = pts[pts.length - 1];
  const lo = Math.min.apply(null, pts.map((p) => p.total));
  const hi = Math.max.apply(null, pts.map((p) => p.total));
  const stamp = (p) => String(p.at || p.day || '').slice(11, 16) || String(p.day || '').slice(5);
  return [
    '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="分数趋势" style="width:100%;height:34px;display:block;color:var(--dim)">',
    ref(10), ref(8), ref(5),
    '<polyline points="' + points + '" fill="none" stroke="var(--accent)" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" />',
    '</svg>',
    '<div class="dim" style="display:flex;justify-content:space-between;font-size:11px">',
    '<span>' + esc(stamp(first)) + ' · ' + first.total + '</span>',
    '<span>低 ' + lo + ' / 高 ' + hi + ' · ' + pts.length + ' 次</span>',
    '<span>' + esc(stamp(last)) + ' · ' + last.total + '</span>',
    '</div>',
  ].join('');
}

function findingBlock(it) {
  const rows = [];
  rows.push('<div class="kv"><b>维度</b>' + esc(it.dimension || '未分类') +
    (it.advisory ? ' · <span class="dim">建议项（不计分）</span>' : '') +
    ' · 置信度 ' + esc(it.confidence) + '</div>');
  if (it.target) rows.push('<div class="kv"><b>位置</b>' + esc(it.target) + '</div>');
  if (it.evidence && it.evidence.length) {
    rows.push('<div class="kv"><b>证据</b><pre>' + it.evidence.map(esc).join('\n') + '</pre></div>');
  }
  if (it.measured) rows.push('<div class="kv"><b>测到的值</b><pre>' + esc(it.measured) + '</pre></div>');
  rows.push('<div class="kv"><b>怎么修</b>' + (it.fixHint ? esc(it.fixHint) : '<span class="dim">该规则没有固定修法，按证据自行判断</span>') + '</div>');
  rows.push('<div class="fp">' + esc(it.fp) + '</div>');
  return rows.join('');
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
  const cleanSub = d.clean ? d.clean.groups.length + ' 组可清理' : '';
  const trimV = d.trim ? d.trim.served + ' / ' + d.trim.maxBundles : '—';
  const trimSub = d.trim ? d.trim.groups.length + ' 组能力冗余' : '';

  const cards = [
    '<div class="card"><div class="k">总分（10 分制）</div><div class="v">' + d.score + '</div><div class="row">' + sevRow + '</div></div>',
    '<div class="card"><div class="k">分档</div><div class="v">' + esc(d.band) + '</div><div class="dim">' + esc(d.headline) + '</div></div>',
    '<div class="card"><div class="k">未解决 / 已退役</div><div class="v">' + d.count + ' <small>/ ' + d.retired + '</small></div></div>',
    '<div class="card"><div class="k">最新分 / 记账</div><div class="v">' + esc(trendTxt) + '</div><div class="dim">' + d.trend.runs + ' 次 / ' + d.trend.daysTracked + ' 天</div>' + trendChart(d.trend.recent) + '</div>',
    '<div class="card"><div class="k">可清理空间</div><div class="v">' + esc(cleanTxt) + '</div><div class="dim">' + esc(cleanSub) + '</div></div>',
    '<div class="card"><div class="k">服务插件 / 上限</div><div class="v">' + esc(trimV) + '</div><div class="dim">' + esc(trimSub) + '</div></div>',
  ].join('');

  // 问题清单：每条可展开看根因与修法
  const issues = d.items.length
    ? d.items.map(function (it) {
        return '<details><summary>' + sevBadge(it.severity) +
          '<div class="t"><b>' + esc(it.ruleId) + '</b> ' + esc(it.title) +
          '<div class="dim">' + esc(it.dimension || '') + (it.fixHint ? ' · ' + esc(it.fixHint.slice(0, 46)) : '') + '</div></div>' +
          '</summary><div class="body">' + findingBlock(it) + '</div></details>';
      }).join('')
    : '<div class="dim">没有未解决的问题</div>';

  // 修复顺序
  const planLines = [];
  if (d.plan.stage1) {
    planLines.push('<li><b>第一步｜清掉 ' + d.plan.stage1.count + ' 条 P0</b>：' +
      d.plan.stage1.from + ' → ' + d.plan.stage1.to + '（' + (d.plan.stage1.delta > 0 ? '+' : '') + d.plan.stage1.delta + (d.plan.capped ? '，解除封顶' : '') + '）' +
      (d.plan.stage1.items.length ? '<ul>' + d.plan.stage1.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</li>');
  } else {
    planLines.push('<li><b>第一步</b>：没有 P0，不需要解封顶</li>');
  }
  if (d.plan.rows.length) {
    planLines.push('<li><b>第二步｜以 ' + d.plan.base + ' 为基准，单条增量</b>（互不叠加）<ul>' +
      d.plan.rows.map(function (r) {
        return '<li>' + (r.delta > 0 ? '+' : '') + r.delta + ' · <b>' + esc(r.ruleId) + '</b> ' + esc(r.title) + (r.target ? '（' + esc(r.target) + '）' : '') + '</li>';
      }).join('') + '</ul></li>');
  }
  planLines.push('<li><b>全部修完</b> → ' + d.plan.potentialAll + ' / 10</li>');

  // 优化建议
  const advice = [];
  if (d.trim && d.trim.suggestions.length) {
    d.trim.suggestions.forEach(function (s) { advice.push('<li>' + esc(s) + '</li>'); });
  }
  if (d.clean && d.clean.groups.length) {
    advice.push('<li>可清理 ' + esc(mbOf(d.clean.bytes)) + '：' +
      d.clean.groups.map(function (g) { return esc(g.label) + ' ' + mbOf(g.bytes); }).join('、') +
      '（先 audit_clean 预览，执行会移入回收区，7 天内可还原）</li>');
  }
  if (!advice.length) advice.push('<li class="dim">暂时没有优化建议</li>');

  const capsBlock = d.capabilities
    ? '<h2>能力域（' + d.capabilities.present + ' 有 / ' + d.capabilities.redundant + ' 多 / ' + d.capabilities.conflicting + ' 冲突 / ' + d.capabilities.degraded + ' 失效 / ' + d.capabilities.missing + ' 无）</h2><div class="card"><ul>' +
      (d.capabilities.rows && d.capabilities.rows.length ? d.capabilities.rows.map(function (x) {
        return '<li><b>' + esc(x.label) + '</b> · ' + esc(x.status) + '：' + esc(x.detail) + '</li>';
      }).join('') : '<li class="dim">没有能力域数据</li>') +
      '</ul><div class="dim" style="margin-top:6px">每个缺口的四级补救阶梯（配置 → provider → 插件 → 习惯）用 <b>audit_capabilities</b> 看。</div></div>'
    : '';

  const retiredBlock = d.retiredList.length
    ? '<details><summary><b>已退役 ' + d.retiredList.length + ' 条</b><span class="dim">（误报记档，不再计分）</span></summary><div class="body">' +
      d.retiredList.map(function (x) { return '<div class="kv">' + esc(x.ruleId) + ' · ' + esc(x.title) + '<div class="fp">' + esc(x.fp) + '</div></div>'; }).join('') +
      '</div></details>'
    : '';

  return [
    '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    '<meta http-equiv="refresh" content="60">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>DSH 体检</title><style>' + CSS + '</style></head><body>',
    '<header><h1>DSH 体检</h1><span class="dim">只读 · 不写配置 · 不联网</span>',
    '<span style="flex:1"></span><a class="btn" href="?r=' + Date.now() + '">刷新</a></header>',
    '<div class="dim" style="margin-bottom:14px">' + esc(d.headline) + ' · 更新 ' + esc(String(d.at).replace('T', ' ').slice(0, 19)) + '</div>',
    '<div class="grid">' + cards + '</div>',
    '<h2>问题清单（点开看根因与修法）</h2>' + issues,
    '<h2>修复顺序</h2><div class="card"><ol>' + planLines.join('') + '</ol></div>',
    '<h2>优化建议</h2><div class="card"><ul>' + advice.join('') + '</ul></div>',
    capsBlock,
    retiredBlock,
    '<footer>数据来自本机 ~/.dsh；面板只读，清理与修复请走 audit_clean / CLI。每分钟自动刷新，数据缓存 60 秒。</footer>',
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
