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
import path from 'node:path';
import { audit } from './engine.mjs';
import { headlineOf } from './digest.mjs';
import { stats, load as loadHistory } from './history.mjs';
import { analyze as trimAnalyze } from './trim.mjs';
import { scan as cleanScan, PROTECTED_NAMES as CLEAN_PROTECTED } from './clean.mjs';
import { buildMatrix } from './capability-map.mjs';
import { productMetrics } from './metrics.mjs';
import { readLastVerify, timeline as verifyTimeline } from './verify.mjs';

const PREFIX = '/dsh-healthkit-panel';

// B6「主动敲门」的便宜入口（2026-11-17 产品修订）：
//
// 竞品赢在「坏的那一刻用户能看见入口」，我们原来只有侧栏 tab——装完不打开就等于没装。
// 但敲门不能用 collectSummary()，那会跑一次全量体检（几百毫秒 + 全盘扫），
// 而客户端每次页面加载都会问一次。所以这里**只读账本最后一行**：不跑体检、不写状态，
// 语义也诚实——它给的是「上次体检发现的 P0」，不是「现在有 P0」。
export const BADGE_SCHEMA = 'dsh-healthkit/badge/v1';

export function collectBadge() {
  let last = null;
  try {
    const rows = loadHistory();
    last = rows.length ? rows[rows.length - 1] : null;
  } catch (e) { last = null; }
  if (!last) return { schema: BADGE_SCHEMA, hasRun: false, p0: 0, p1: 0, score: null, at: null };
  return {
    schema: BADGE_SCHEMA,
    hasRun: true,
    p0: Number(last.p0 || 0),
    p1: Number(last.p1 || 0),
    score: typeof last.total === 'number' ? last.total : null,
    at: last.at || null,
  };
}

// B5：面板 payload 是唯一高频变更的面，却没有契约（report/check 都有 /v1）。
// 这里给它一个版本串 + 必需键集；字段改名会立刻被面板测试挡住，而不是面板静默变空白。
export const PANEL_SCHEMA = 'dsh-healthkit/panel/v1';
export const PANEL_REQUIRED_KEYS = [
  'schema', 'at', 'score', 'raw', 'band', 'bands', 'count', 'retired', 'product',
  'p0', 'p1', 'p2', 'info', 'headline', 'trend', 'items', 'plan', 'clean', 'trim', 'capabilities', 'dims',
];

// 略短于引擎的事实缓存 TTL（cache.mjs 的 60s）：页面的 60 秒自刷新每次都落在
// 引擎缓存还热的时候，不会变成「每分钟一次全盘扫描」。
const CACHE_MS = 55 * 1000;
const SEV_ORDER = { P0: 0, P1: 1, P2: 2, INFO: 3 };

// 数值兜底：评分链出问题时不要印 "NaN"。2026-11-16 实测：重复挂载的旧实例算出
// NaN，页面直接渲染成 <div class="v">NaN</div>，读者会当成插件坏了。
function num(v, digits) {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return digits == null ? String(n) : n.toFixed(digits);
}

// 本地时间：payload 的 at 是 toISOString 的 UTC，直接 slice(11,16) 会早 8 小时。
function fmtLocal(iso) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return String(iso || '');
  const p2 = (x) => String(x).padStart(2, '0');
  return p2(t.getMonth() + 1) + '-' + p2(t.getDate()) + ' ' + p2(t.getHours()) + ':' + p2(t.getMinutes());
}

function localHHMM(v) {
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return String(v || '').slice(5);
  return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
}

let cache = { at: 0, data: null };

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

function sendHtml(res, html) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    // 第二道防线：页面零脚本、零外链，禁掉嗅探与一切外部资源。
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
  });
  res.end(html);
}

// 只认本机回环：面板是本地运维面，不该从局域网可达。
const LOOPBACK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
function loopbackOnly(req) {
  const a = (req && req.socket && req.socket.remoteAddress) || '';
  // 空地址只出现在 Unix socket / 无 socket 的极端情况（如进程内调用）：
  // 这是有意放行的，因为它不经过网络；真要收紧就把下面这行删掉。
  if (a === '') return true;
  return LOOPBACK.indexOf(a) !== -1;
}

function clip(v, max) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (!s || s === '{}' || s === '[]') return '';
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch (e) { return ''; }
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
    // 2026-11-20：处置分层（不影响能不能加载的项不该催着改）
    faultRows: (at.rowsFault || []).slice(0, 8).map((x) => ({ ruleId: x.ruleId, title: x.title || '', target: x.target || '', saves: x.saves || '' })),
    hygieneRows: (at.rowsHygiene || []).slice(0, 8).map((x) => ({ ruleId: x.ruleId, title: x.title || '', target: x.target || '' })),
  };

  // 清理：可回收多少、按什么分组
  let clean = null;
  try {
    const s = cleanScan({});
    clean = {
      bytes: s.totalBytes || 0,
      // P3：把「大目录但没进可清理档」单独列出来，与 R17 的数字能对上。
      // 只读信息，不进可执行分组——受保护面不提供一键清理。
      notCleanable: (() => {
        try {
          const home = String(r.facts.home || '');
          const skip = ['profiles', 'dsh-runtimes', 'node_modules', 'sessions', 'attachments', 'skills', 'data', 'storages', '.git'];
          // 「是否已被某个可清理分组覆盖」按路径前缀判定：分组要操作的就是这个顶层目录
          // 或它下面的东西，才算覆盖（cache/attachments 可清理 ≠ ~/.dsh/attachments 可清理）。
          const coveredBy = (name) => {
            const base = home + path.sep + name;
            return (s.groups || []).some((g) => (g.entries || []).some((e) => {
              const p = String(e.path || '');
              return p === base || p.indexOf(base + path.sep) === 0;
            }));
          };
          return (r.facts.disk || [])
            .filter((d) => d.bytes >= 50 * 1048576 && !coveredBy(d.name))
            .map((d) => ({ name: d.name, bytes: d.bytes, protected: CLEAN_PROTECTED.indexOf(d.name) !== -1 || skip.indexOf(d.name) !== -1 }))
            .sort((a, b) => b.bytes - a.bytes)
            .slice(0, 6);
        } catch (e) { return []; }
      })(),
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
    schema: PANEL_SCHEMA,
    at: new Date().toISOString(),
    score: r.score.total,
    raw: r.score.raw,
    band: r.score.band,
    bands: r.score.bands || [],
    count: r.findings.length,
    findings: r.findings.length, // 兼容旧字段
    retired: r.retired.length,
    p0: by.P0, p1: by.P1, p2: by.P2, info: by.INFO,
    headline: headlineOf(by, r.score.total, r.findings.length),
    // 产品指标（第二次运行 / 采纳率 / 误报率）：面板只展示，不打分、不参与评分。
    product: (() => {
      try { return productMetrics(r.facts.home, { findingsCount: r.findings.length }); }
      catch (e) { return null; }
    })(),
    trend: {
      runs: h.runs,
      sources: h.sources || {},
      humanRuns: typeof h.humanRuns === 'number' ? h.humanRuns : null,
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
    // 维度分：引擎早就算好了（score.mjs 的 dims），只是从前没透传出去，
    // 于是面板只能给一个总分——「分数怎么来的」永远看不见。
    // 注意：不能让前端用 items 自行聚合，那是错的（disk 的 7 条全是 INFO、
    // 计分 0，按 items 计数会把最健康的维度画成最差）。
    dims: (r.score.dims || []).map((x) => ({
      key: x.key, label: x.label, weight: x.weight,
      score: x.score, count: x.count, cappedBy: x.cappedBy || null,
    })),
    // ① 跨重启验回 + ③ 跨次时间线（两者都只读，来自插件自己的数据目录）
    verify: (() => {
      try {
        const v = readLastVerify(r.facts.home);
        if (!v) return { hasPending: false, note: '还没有开机验回记录（下次重启宿主会自动核对）。' };
        return {
          hasPending: !!v.hasPending,
          at: v.at || '',
          pendingAt: v.pendingAt || '',
          score: typeof v.score === 'number' ? v.score : null,
          pendingScore: typeof v.pendingScore === 'number' ? v.pendingScore : null,
          fixed: (v.fixed || []).map((x) => ({ ruleId: x.ruleId, title: x.title, fp: x.fp })),
          stillThere: (v.stillThere || []).map((x) => ({ ruleId: x.ruleId, title: x.title, fp: x.fp })),
          muted: (v.muted || []).map((x) => ({ ruleId: x.ruleId, title: x.title, fp: x.fp })),
          regressions: (v.regressions || []).map((x) => ({ ruleId: x.ruleId, title: x.title, fp: x.fp })),
          note: v.note || '',
        };
      } catch (e) { return { hasPending: false, note: '验回记录读取失败：' + ((e && e.message) || e) }; }
    })(),
    timeline: (() => {
      try {
        return verifyTimeline(r.facts.home, 12).map((t) => ({
          at: t.at, score: t.score, delta: t.delta,
          added: t.added, fixed: t.fixed, muted: t.muted, kept: t.kept,
        }));
      } catch (e) { return []; }
    })(),
  };
  // 契约自检：改字段名的人在生产端就撞墙，而不是等用户看到面板变空白。
  const missing = PANEL_REQUIRED_KEYS.filter((k) => !(k in data));
  if (missing.length) throw new Error('panel payload 缺字段：' + missing.join(','));
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
  .replace(/"/g, '&quot;')
  // 单引号也转义：现在所有属性都是双引号，但「今天没有单引号属性」不是安全前提。
  .replace(/'/g, '&#39;');

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
  const stamp = (p) => localHHMM(p && (p.at || p.day));
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
    return sevBadge(k) + ' <b>' + num(n) + '</b>';
  }).join(' ');

  const delta = typeof d.trend.delta === 'number' ? d.trend.delta : null;
  const runs = typeof d.trend.runs === 'number' ? d.trend.runs : null;
  const trendTxt = num(d.trend.latest, 2) + (delta !== null
    ? (delta >= 0 ? ' (+' + delta + ')' : ' (' + delta + ')')
    : (runs && runs > 1 ? '（首日基线）' : '（首次）'));
  const cleanTxt = d.clean ? mbOf(d.clean.bytes) : '未知';
  const cleanSub = d.clean ? d.clean.groups.length + ' 组可清理' : '';
  const trimV = d.trim ? num(d.trim.served) + ' / ' + num(d.trim.maxBundles) : '—';
  const trimSub = d.trim ? d.trim.groups.length + ' 组能力冗余' : '';

  const cards = [
    '<div class="card"><div class="k">总分（10 分制）</div><div class="v">' + num(d.score, 2) + '</div><div class="row">' + sevRow + '</div></div>',
    '<div class="card"><div class="k">分档</div><div class="v">' + esc(d.band) + '</div><div class="dim">' + esc(d.headline) + '</div></div>',
    '<div class="card"><div class="k">未解决 / 已退役</div><div class="v">' + num(d.count) + ' <small>/ ' + num(d.retired) + '</small></div></div>',
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

  // 处置顺序：先回答「要不要动」，再谈分数
  const planLines = [];
  if (d.plan.stage1) {
    planLines.push('<li><b>必须处理｜P0 ' + d.plan.stage1.count + ' 条</b>：' +
      d.plan.stage1.from + ' → ' + d.plan.stage1.to + '（' + (d.plan.stage1.delta > 0 ? '+' : '') + d.plan.stage1.delta + (d.plan.capped ? '，解除封顶' : '') + '）' +
      (d.plan.stage1.items.length ? '<ul>' + d.plan.stage1.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '') + '</li>');
  } else {
    planLines.push('<li><b>必须处理</b>：没有 P0，不需要解封顶</li>');
  }
  if (d.plan.faultRows.length) {
    planLines.push('<li><b>故障处置｜影响加载/启动</b>（按影响排，不是按涨分）<ul>' +
      d.plan.faultRows.map(function (r) {
        return '<li><b>' + esc(r.ruleId) + '</b> ' + esc(r.title) + (r.target ? '（' + esc(r.target) + '）' : '') + (r.saves ? ' · ' + esc(r.saves) : '') + '</li>';
      }).join('') + '</ul></li>');
  } else {
    planLines.push('<li><b>故障处置</b>：没有会影响加载/启动的计分项</li>');
  }
  if (d.plan.hygieneRows.length) {
    planLines.push('<li><b>配置优化｜可保留现状</b>（不影响能不能加载，不建议为了分数动手）<ul>' +
      d.plan.hygieneRows.map(function (r) {
        return '<li><b>' + esc(r.ruleId) + '</b> ' + esc(r.title) + (r.target ? '（' + esc(r.target) + '）' : '') + '</li>';
      }).join('') + '</ul></li>');
  }
  planLines.push('<li class="dim">单条增量互不叠加；「全修完 → ' + d.plan.potentialAll + ' / 10」只是评分公式终点，不是建议动作。</li>');

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

  // ① 跨重启验回：上次体检说该修的，这次修好了没、有没有把别的东西搞坏。
  // 只报告不修——「被静音」与「真修好」分开列，否则分数上升会骗人。
  const v = d.verify || { hasPending: false };
  const verifyRows = [];
  if (v.hasPending) {
    (v.fixed || []).forEach(function (x) {
      verifyRows.push('<li><b style="color:var(--ok)">✓ 已修好</b> ' + esc(x.ruleId) + ' ' + esc(x.title) + '<div class="fp">' + esc(x.fp) + '</div></li>');
    });
    (v.stillThere || []).forEach(function (x) {
      verifyRows.push('<li><b>· 还在</b> ' + esc(x.ruleId) + ' ' + esc(x.title) + '<div class="fp">' + esc(x.fp) + '</div></li>');
    });
    (v.muted || []).forEach(function (x) {
      verifyRows.push('<li><b style="color:var(--warn)">~ 被静音（不算修好）</b> ' + esc(x.ruleId) + '<div class="fp">' + esc(x.fp) + '</div></li>');
    });
    (v.regressions || []).forEach(function (x) {
      verifyRows.push('<li><b style="color:var(--bad)">! 回归（本次新冒出）</b> ' + esc(x.ruleId) + ' ' + esc(x.title) + '<div class="fp">' + esc(x.fp) + '</div></li>');
    });
  }
  // 2026-11-20 反哺 P3：标题从「上次修的」改成「上次发现的变化」——
  // 自动纳入待验清单的只是「带修法的发现」，不等于用户承诺修了。
  // 另外补两态：无法复核（profile 读不出）与已不适用（对象不存在），
  // 否则「不出现」会被一律当成修好。
  if (v.hasPending) {
    (v.unverifiable || []).forEach(function (x) {
      verifyRows.push('<li><b style="color:var(--warn)">? 无法复核（对应 profile 本次读不出）</b> ' + esc(x.ruleId) + ' ' + esc(x.title) + '<div class="fp">' + esc(x.fp) + '</div></li>');
    });
    (v.notApplicable || []).forEach(function (x) {
      verifyRows.push('<li><b>– 已不适用（证据对象已不存在）</b> ' + esc(x.ruleId) + ' ' + esc(x.title) + '<div class="fp">' + esc(x.fp) + '</div></li>');
    });
  }
  const verifyBlock = '<h2>上次发现的变化，现在怎样了</h2><div class="card"><ul>' +
    (verifyRows.length ? verifyRows.join('') : '<li class="dim">' + esc(v.note || '没有待验清单（下次重启宿主会自动核对）。') + '</li>') +
    '</ul><div class="dim" style="margin-top:6px">开机自动核对：还命中没、有没有把别的东西搞坏。<b>只报告，不改配置</b>；「不出现」只有在对象仍被检查时才算修好。</div></div>';

  // ③ 跨次时间线：每次体检相对上次的「新增 / 真修好 / 被静音」。
  const tl = d.timeline || [];
  const timelineBlock = tl.length
    ? '<h2>最近几次的变化</h2><div class="card"><ul>' + tl.slice().reverse().map(function (t) {
        return '<li>' + esc(fmtLocal(t.at)) + ' · 分数 ' + num(t.score, 2) +
          '（' + (t.delta > 0 ? '+' : '') + num(t.delta, 2) + '）· 新增 ' + t.added +
          ' / 真修好 ' + t.fixed + ' / 被静音 ' + t.muted + ' · 持续 ' + t.kept + '</li>';
      }).join('') + '</ul></div>'
    : '<h2>最近几次的变化</h2><div class="card"><div class="dim">至少跑两次体检才有可比的变化（第一次是基线）。</div></div>';

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
    '<div class="dim" style="margin-bottom:14px">' + esc(d.headline) + ' · 更新 ' + esc(fmtLocal(d.at)) + '</div>',
    '<div class="grid">' + cards + '</div>',
    '<h2>问题清单（点开看根因与修法）</h2>' + issues,
    '<h2>修复顺序</h2><div class="card"><ol>' + planLines.join('') + '</ol></div>',
    '<h2>优化建议</h2><div class="card"><ul>' + advice.join('') + '</ul></div>',
    capsBlock,
    verifyBlock,
    timelineBlock,
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
  const badge = function handler(req, res) {
    if (!loopbackOnly(req)) return sendJson(res, 403, { error: 'loopback only' });
    try { sendJson(res, 200, collectBadge()); }
    catch (e) { sendJson(res, 500, { error: String((e && e.message) || e) }); }
  };
  const routes = [
    { kind: 'exact', path: PREFIX, handler: page },
    { kind: 'exact', path: PREFIX + '/', handler: page },
    { kind: 'exact', path: PREFIX + '/api/summary', handler: api },
    { kind: 'exact', path: PREFIX + '/api/badge', handler: badge },
  ];
  for (const r of routes) {
    try { webServer.register(r); report.routes += 1; report.attempts.push({ path: r.path, ok: true }); }
    catch (e) {
      const msg = String((e && e.message) || e);
      const duplicate = /duplicate/i.test(msg);
      if (duplicate) report.duplicate = true;
      report.attempts.push({ path: r.path, ok: false, duplicate, error: msg });
    }
  }
  // 路由已被本插件的另一实例注册（重复挂载）时，面板其实是活的：不该报「全失败」
  // 让运维去查一个不存在的问题，但也不能假装自己挂上了——如实记 duplicate。
  report.ok = report.routes > 0 || report.duplicate === true;
  if (report.routes === 0) report.reason = report.duplicate ? 'already-registered' : 'register-failed';
  return report;
}
