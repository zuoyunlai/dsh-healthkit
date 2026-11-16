// 生成两份 380px 窄栏预览：A = 现版 client.js 的忠实复刻；B = 建议改法。
// 只用于设计评审截图，不进插件运行路径。
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const d = JSON.parse(fs.readFileSync(path.join(here, 'summary.json'), 'utf8'));

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const mb = (n) => {
  if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '0 B';
  if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
  return (n / 1048576).toFixed(1) + ' MB';
};

// ── 宿主 token 兜底值：与 client.js 里 C 表的 fallback 一致；层 2 给个浅灰方便看卡片 ──
const HOST_VARS_LIGHT = `--dsw-alias-label-primary:#1f2328;--dsw-alias-label-secondary:#6b7280;--dsw-alias-border:rgba(128,128,128,.28);--dsw-alias-bg-layer-2:#f7f8fa;--dsw-alias-brand-primary:#2563eb;`;

const C = {
  fg: 'var(--dsw-alias-label-primary, #1f2328)',
  dim: 'var(--dsw-alias-label-secondary, #6b7280)',
  line: 'var(--dsw-alias-border, rgba(128,128,128,.28))',
  card: 'var(--dsw-alias-bg-layer-2, transparent)',
  accent: 'var(--dsw-alias-brand-primary, #2563eb)',
  ok: '#16a34a', warn: '#d97706', bad: '#dc2626', info: '#6b7280',
};
const SEV = { P0: C.bad, P1: C.warn, P2: C.accent, INFO: C.info };

/* ═══════════════════════════ A：现版复刻 ═══════════════════════════ */
const aBadge = (t, color) => `<span style="display:inline-block;min-width:40px;padding:1px 6px;border-radius:5px;font-size:11px;font-weight:700;text-align:center;color:${color};background:${color}22">${esc(t)}</span>`;
const aMetric = (label, value, sub) => `<div style="border:1px solid ${C.line};border-radius:10px;padding:8px 10px;background:${C.card};min-width:0">
  <div style="font-size:11px;color:${C.dim};margin-bottom:2px">${esc(label)}</div>
  <div style="font-size:17px;font-weight:700;color:${C.fg};line-height:1.25">${esc(value)}</div>
  ${sub ? `<div style="font-size:11px;color:${C.dim};margin-top:2px;overflow:hidden;text-overflow:ellipsis">${esc(sub)}</div>` : ''}
</div>`;
const aSection = (t) => `<div style="font-size:11px;font-weight:700;color:${C.dim};margin:14px 0 6px;letter-spacing:.02em">${esc(t)}</div>`;
const aKv = (label, node) => `<div style="margin:6px 0"><div style="font-size:10px;color:${C.dim};font-weight:600">${esc(label)}</div><div style="font-size:12px;color:${C.fg};white-space:pre-wrap;word-break:break-all">${esc(node)}</div></div>`;

function aFinding(it) {
  const body = [
    aKv('维度 / 置信度', (it.dimension || '—') + ' · ' + it.confidence + (it.advisory ? ' · 建议项（不计分）' : '')),
    it.target ? aKv('位置', it.target) : '',
    (it.evidence && it.evidence.length) ? aKv('证据', it.evidence.join('\n')) : '',
    it.measured ? aKv('测到的值', it.measured) : '',
    aKv('怎么修', it.fixHint || '该规则没有固定修法，按证据自行判断'),
    `<div style="font-size:10px;color:${C.dim};font-family:ui-monospace,Consolas,monospace;margin-top:4px">${esc(it.fp)}</div>`,
  ].join('');
  return `<details style="border:1px solid ${C.line};border-radius:9px;padding:7px 9px;margin-bottom:7px;background:${C.card}">
    <summary style="cursor:pointer;display:flex;gap:8px;align-items:flex-start;list-style:none">
      ${aBadge(it.severity, SEV[it.severity] || C.dim)}
      <div style="min-width:0;flex:1">
        <div style="font-size:12.5px;color:${C.fg};line-height:1.45"><b>${esc(it.ruleId)}</b> ${esc(it.title)}</div>
        <div style="font-size:11px;color:${C.dim};margin-top:2px">${esc(it.dimension || '')}${it.fixHint ? ' · ' + esc(String(it.fixHint).slice(0, 40)) : ''}</div>
      </div>
    </summary>
    <div style="margin-top:7px;padding-top:7px;border-top:1px solid ${C.line}">${body}</div>
  </details>`;
}

function aTrend(pts) {
  const W = 100, H = 30, PAD = 2;
  const x = (i) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
  const y = (v) => H - PAD - (Math.max(0, Math.min(10, v)) / 10) * (H - 2 * PAD);
  const points = pts.map((p, i) => x(i).toFixed(2) + ',' + y(p.total).toFixed(2)).join(' ');
  const ref = (v) => `<line x1="${PAD}" y1="${y(v)}" x2="${W - PAD}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".18" stroke-width=".4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>`;
  const stamp = (p) => String(p.at || p.day || '').slice(11, 16);
  const vals = pts.map((p) => p.total);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  return `<div style="margin-top:8px">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:34px;display:block;color:${C.dim}">
      ${ref(10)}${ref(8)}${ref(5)}
      <polyline points="${points}" fill="none" stroke="${C.accent}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    </svg>
    <div style="display:flex;justify-content:space-between;font-size:10px;color:${C.dim}">
      <span>${esc(stamp(pts[0]))} · ${pts[0].total}</span>
      <span>低 ${lo} / 高 ${hi} · ${pts.length} 次</span>
      <span>${esc(stamp(pts[pts.length - 1]))} · ${pts[pts.length - 1].total}</span>
    </div>
  </div>`;
}

const planA = [];
if (d.plan.stage1) {
  planA.push(`<li style="font-size:12px;margin:3px 0"><b>第一步｜${d.plan.stage1.count} 条 P0</b>：${d.plan.stage1.from} → ${d.plan.stage1.to}（${d.plan.stage1.delta > 0 ? '+' : ''}${d.plan.stage1.delta}${d.plan.capped ? '，解除封顶' : ''}）</li>`);
} else {
  planA.push(`<li style="font-size:12px;margin:3px 0"><b>第一步</b>：P0 = 0，无需解封顶</li>`);
}
if (d.plan.rows.length) {
  planA.push(`<li style="font-size:12px;margin:3px 0"><b>第二步｜${d.plan.base} 为基准</b><div>${d.plan.rows.map((r) => `<div style="font-size:11.5px;color:${C.fg};margin-top:2px">${r.delta > 0 ? '+' : ''}${r.delta} · ${esc(r.ruleId)} ${esc(String(r.title || '').slice(0, 46))}</div>`).join('')}</div></li>`);
}
planA.push(`<li style="font-size:12px;margin:3px 0"><b>全部修完 → ${d.plan.potentialAll} / 10</b></li>`);

const adviceA = [];
d.trim.suggestions.forEach((s) => adviceA.push(`<li style="font-size:12px;margin:3px 0">${esc(s)}</li>`));
if (d.clean && d.clean.groups.length) adviceA.push(`<li style="font-size:12px;margin:3px 0">可清理 ${mb(d.clean.bytes)}：${d.clean.groups.map((g) => esc(g.label) + ' ' + mb(g.bytes)).join('、')}（先预览，执行移入回收区 7 天可还原）</li>`);

const delta = typeof d.trend.delta === 'number' ? d.trend.delta : null;
const trendTxt = d.trend.latest + (delta === null ? '（首次）' : (delta >= 0 ? ' (+' + delta + ')' : ' (' + delta + ')'));

const htmlA = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>*{box-sizing:border-box}body{margin:0;padding:0;background:#fff;font:14px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif}:root{${HOST_VARS_LIGHT}}</style></head>
<body><div style="width:380px;padding:10px 12px;color:${C.fg};font-family:-apple-system,'Segoe UI',system-ui,sans-serif">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
    <span style="display:inline-block;width:18px;height:18px;border-radius:4px;background:#6EAB3B"></span>
    <div style="font-size:13px;font-weight:700;color:${C.fg}">体检</div>
    <div style="flex:1"></div>
    <a href="#" style="font-size:12px;color:${C.accent};text-decoration:none">刷新</a>
  </div>
  <div style="font-size:11px;color:${C.dim};margin-bottom:8px">${esc(d.headline)} · ${esc(String(d.at).replace('T', ' ').slice(0, 19))}</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
    ${aMetric('总分', String(d.score), d.band)}
    ${aMetric('未解决 / 已退役', d.count + ' / ' + d.retired, '')}
    ${aMetric('可清理', mb(d.clean.bytes), d.clean.groups.length + ' 组')}
    ${aMetric('插件 / 上限', d.trim.served + ' / ' + d.trim.maxBundles, d.trim.groups.length + ' 组冗余')}
    ${aMetric('最新分', trendTxt, d.trend.runs + ' 次 / ' + d.trend.daysTracked + ' 天 ' + (d.trend.sparkline || ''))}
  </div>
  <div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap">
    ${aBadge('P0 ' + d.p0, SEV.P0)}${aBadge('P1 ' + d.p1, SEV.P1)}${aBadge('P2 ' + d.p2, SEV.P2)}${aBadge('INFO ' + d.info, SEV.INFO)}
  </div>
  ${aTrend(d.trend.recent)}
  ${aSection('问题清单（点开看根因与修法）')}
  ${d.items.map(aFinding).join('')}
  ${aSection('修复顺序')}
  <ol style="margin:0;padding-left:18px">${planA.join('')}</ol>
  ${aSection('优化建议')}
  <ul style="margin:0;padding-left:18px">${adviceA.join('')}</ul>
  ${aSection('能力域（' + d.capabilities.present + ' 有 / ' + d.capabilities.redundant + ' 多 / ' + d.capabilities.conflicting + ' 冲突 / ' + d.capabilities.degraded + ' 失效 / ' + d.capabilities.missing + ' 无）')}
  <ul style="margin:0;padding-left:18px">${d.capabilities.rows.map((x) => `<li style="font-size:12px;margin:3px 0"><b>${esc(x.label)}</b> · ${esc(x.status)}：${esc(x.detail)}</li>`).join('')}</ul>
  <div style="font-size:10.5px;color:${C.dim};margin-top:4px">四级补救阶梯用 audit_capabilities：配置 → provider → 插件 → 习惯</div>
  <details style="border:1px solid ${C.line};border-radius:9px;padding:7px 9px;margin-top:8px">
    <summary style="cursor:pointer;font-size:12px;color:${C.dim}">已退役 ${d.retiredList.length}</summary>
    <div style="margin-top:6px">${d.retiredList.map((x) => `<div style="font-size:11px;color:${C.dim};margin-top:3px">${esc(x.ruleId)} · ${esc(x.title)}</div>`).join('')}</div>
  </details>
  <div style="font-size:10.5px;color:${C.dim};margin-top:12px">只读 · 数据缓存 60 秒</div>
</div></body></html>`;

/* ═══════════════════════════ B：建议改法 ═══════════════════════════ */
const bandColor = d.p0 > 0 ? '#dc2626' : d.score >= 9 ? '#15803d' : d.score >= 8 ? '#2563eb' : d.score >= 6 ? '#b45309' : '#dc2626';
const overLimit = d.trim.served > d.trim.maxBundles;
const pct = Math.min(100, Math.round((d.trim.served / d.trim.maxBundles) * 100));

const sevChip = (k, n) => {
  const hue = SEV[k], zero = n === 0;
  return `<span class="hk-chip" style="--h:${hue};${zero ? 'opacity:.45' : ''}"><i></i>${k}<b>${n}</b></span>`;
};

// 后端枚举 → 中文标签。纯呈现层映射，不动数据结构。
const DIM_ZH = {
  security: '安全', modelCost: '模型成本', consistency: '一致性', plugins: '插件', disk: '磁盘',
  context: '上下文', memory: '记忆', cost: '成本', trim: '装载面', hygiene: '整洁',
  maintainability: '可维护性', permissions: '权限', model: '模型',
};
const dimZh = (x) => DIM_ZH[x] || x || '未分类';
const STATUS = {
  redundant: ['冗余', '#2563eb'], degraded: ['失效', '#b45309'], missing: ['缺失', '#dc2626'],
  conflicting: ['冲突', '#dc2626'], unknown: ['未知', '#6b7280'], present: ['有', '#15803d'],
};
const statusZh = (s) => (STATUS[s] || [s, '#6b7280'])[0];
const statusHue = (s) => (STATUS[s] || [s, '#6b7280'])[1];

const bDetails = (it, compact) => `<details class="hk-row${compact ? ' hk-row--compact' : ''}">
  <summary><span class="hk-bar" style="--h:${SEV[it.severity]}"></span>
    <span class="hk-row__main"><b>${esc(it.ruleId)}</b> <span class="hk-row__title">${esc(it.title)}</span>${compact ? '' : `<span class="hk-row__meta">${esc(dimZh(it.dimension))}</span>`}</span>
    <svg class="hk-chev" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </summary>
  <div class="hk-row__body">
    <div class="hk-kv"><em>维度</em>${esc(dimZh(it.dimension))} · ${esc(it.confidence)}${it.advisory ? ' · 建议项' : ''}</div>
    ${it.target ? `<div class="hk-kv"><em>位置</em><code>${esc(it.target)}</code></div>` : ''}
    ${it.evidence && it.evidence.length ? `<div class="hk-kv"><em>证据</em><code>${esc(it.evidence.join('\n'))}</code></div>` : ''}
    ${it.measured ? `<div class="hk-kv"><em>测到的值</em><code>${esc(it.measured)}</code></div>` : ''}
    <div class="hk-kv"><em>怎么修</em>${esc(it.fixHint || '该规则没有固定修法，按证据自行判断')}</div>
    <div class="hk-fp">${esc(it.fp)}</div>
  </div>
</details>`;

const steps = [];
steps.push(d.plan.stage1
  ? `<li class="hk-step"><div class="hk-step__t"><span class="hk-num">1</span>清掉 ${d.plan.stage1.count} 条 P0</div><div class="hk-step__d">${d.plan.stage1.from} → ${d.plan.stage1.to}（${d.plan.stage1.delta > 0 ? '+' : ''}${d.plan.stage1.delta}${d.plan.capped ? '，解除封顶' : ''}）</div></li>`
  : `<li class="hk-step hk-step--done"><div class="hk-step__t"><span class="hk-num">1</span>P0 已清零，无封顶</div></li>`);
if (d.plan.rows.length) {
  steps.push(`<li class="hk-step"><div class="hk-step__t"><span class="hk-num">2</span>按单条增量修，基准 ${d.plan.base}</div>
    <div class="hk-plan">${d.plan.rows.map((r) => `<div class="hk-plan__row"><span class="hk-delta">+${r.delta}</span><span class="hk-plan__txt"><b>${esc(r.ruleId)}</b> ${esc(r.title)}</span></div>`).join('')}</div></li>`);
}
steps.push(`<li class="hk-step hk-step--done"><div class="hk-step__t"><span class="hk-num">3</span>全部修完 → <b>${d.plan.potentialAll} / 10</b></div></li>`);

const capsChips = [['有', d.capabilities.present, '#6b7280'], ['多', d.capabilities.redundant, '#2563eb'], ['冲突', d.capabilities.conflicting, '#dc2626'], ['失效', d.capabilities.degraded, '#b45309'], ['无', d.capabilities.missing, '#dc2626']]
  .map(([k, n, c]) => `<span class="hk-chip hk-chip--sm" style="--h:${c};${n === 0 ? 'opacity:.45' : ''}"><i></i>${k}<b>${n}</b></span>`).join('');

const last = d.trend.recent[d.trend.recent.length - 1];
const first = d.trend.recent[0];
const valsAll = d.trend.recent.map((p) => p.total);
const pts = d.trend.recent;
const W = 100, H = 31, PAD = 3.5;
const tx = (i) => PAD + (i / (pts.length - 1)) * (W - 2 * PAD);
const ty = (v) => H - PAD - (Math.max(0, Math.min(10, v)) / 10) * (H - 2 * PAD);
const line = pts.map((p, i) => tx(i).toFixed(2) + ',' + ty(p.total).toFixed(2)).join(' ');
const area = `${tx(0)},${H - PAD} ${line} ${tx(pts.length - 1)},${H - PAD}`;

const htmlB = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<style>
:root{${HOST_VARS_LIGHT}}
*{box-sizing:border-box}
body{margin:0;background:#fff;font:14px/1.5 -apple-system,"Segoe UI",system-ui,sans-serif}
.hk{width:380px;padding:12px 14px 16px;color:${C.fg};font-family:-apple-system,"Segoe UI",system-ui,sans-serif;font-size:12px;line-height:1.5}

/* 顶栏 */
.hk-head{display:flex;align-items:center;gap:8px;height:28px}
.hk-head__t{font-size:13px;font-weight:700;letter-spacing:.01em}
.hk-head__sp{flex:1}
.hk-btn{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;border-radius:7px;border:1px solid ${C.line};background:${C.card};color:${C.dim};font-size:11.5px;cursor:pointer;font-family:inherit}
.hk-btn:hover{color:${C.fg};border-color:color-mix(in srgb,${C.accent} 45%,${C.line})}
.hk-btn:focus-visible,summary:focus-visible{outline:2px solid ${C.accent};outline-offset:2px}

/* 序号/标题层 */
.hk-verdict{font-size:12.5px;line-height:1.45;color:${C.fg};margin:8px 0 10px}
.hk-verdict span{color:${C.dim};font-size:11px}

/* 英雄卡 */
.hk-hero{border:1px solid ${C.line};border-radius:12px;background:${C.card};padding:12px 13px 11px}
.hk-hero__top{display:flex;align-items:center;justify-content:space-between}
.hk-lab{font-size:10.5px;font-weight:600;color:${C.dim};letter-spacing:.06em}
.hk-band{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:999px;color:${bandColor};background:color-mix(in srgb,${bandColor} 13%,transparent)}
.hk-hero__num{display:flex;align-items:baseline;gap:7px;margin-top:1px}
.hk-score{font-size:31px;font-weight:700;line-height:1.05;letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:${bandColor}}
.hk-score small{font-size:12px;font-weight:600;color:${C.dim};letter-spacing:0}
.hk-sev{display:flex;gap:5px;margin-top:9px;flex-wrap:wrap}
.hk-chip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 7px 0 6px;border-radius:6px;font-size:10.5px;font-weight:600;color:${C.fg};background:color-mix(in srgb,var(--h) 11%,transparent);border:1px solid color-mix(in srgb,var(--h) 30%,transparent);font-variant-numeric:tabular-nums}
.hk-chip i{width:2px;height:9px;border-radius:1px;background:var(--h);display:block}
.hk-chip b{margin-left:2px;font-weight:700;color:var(--h)}
.hk-chip--sm{height:19px;font-size:10px;padding:0 6px 0 5px}
.hk-hero__sep{height:1px;background:${C.line};margin:11px 0 9px}
.hk-hero__note{font-size:11px;color:${C.dim};display:flex;justify-content:space-between;gap:8px}
.hk-hero__note em{font-style:normal;color:${C.fg};font-weight:600}

/* 指标 2×2 */
.hk-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.hk-card{border:1px solid ${C.line};border-radius:10px;background:${C.card};padding:9px 10px;min-width:0}
.hk-card__l{font-size:10.5px;color:${C.dim};font-weight:600;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hk-card__v{font-size:16px;font-weight:700;line-height:1.2;margin-top:3px;font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.hk-card__s{font-size:10.5px;color:${C.dim};margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hk-card--warn{border-color:color-mix(in srgb,#dc2626 34%,${C.line})}
.hk-card--warn .hk-card__v{color:#dc2626}
.hk-meter{height:3px;border-radius:2px;background:color-mix(in srgb,${C.dim} 22%,transparent);margin-top:6px;overflow:hidden}
.hk-meter i{display:block;height:100%;width:100%;border-radius:2px;background:#dc2626}

/* 趋势 */
.hk-trend{margin-top:8px;border:1px solid ${C.line};border-radius:10px;background:${C.card};padding:9px 10px 7px}
.hk-trend__top{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:2px}
.hk-chart{position:relative;margin:2px 0 0}
.hk-chart svg{display:block;width:100%;height:46px}
.hk-axis{position:absolute;inset:0;pointer-events:none;font-size:9px;color:${C.dim};font-variant-numeric:tabular-nums}
.hk-axis span{position:absolute;left:0;background:linear-gradient(90deg,#fff 60%,transparent);padding-right:4px}
.hk-trend__foot{display:flex;justify-content:space-between;font-size:10.5px;color:${C.dim};margin-top:5px;font-variant-numeric:tabular-nums}

/* 分段标题 */
.hk-sec{display:flex;align-items:center;gap:7px;margin:18px 0 8px;padding-top:12px;border-top:1px solid ${C.line}}
.hk-sec__t{font-size:11.5px;font-weight:700;letter-spacing:.03em}
.hk-sec__n{font-size:10.5px;font-weight:600;color:${C.dim};font-variant-numeric:tabular-nums}
.hk-sec__sp{flex:1}

/* 行 */
.hk-row{border:1px solid ${C.line};border-radius:10px;background:${C.card};margin-bottom:7px;padding:0}
.hk-row>summary{display:flex;align-items:flex-start;gap:8px;padding:8px 9px 8px 0;cursor:pointer;list-style:none}
.hk-row>summary::-webkit-details-marker{display:none}
.hk-bar{width:2px;border-radius:2px;background:var(--h);align-self:stretch;margin-left:-1px;flex:none;opacity:.85}
.hk-row__main{flex:1;min-width:0;font-size:12.5px;line-height:1.42}
.hk-row__main b{font-weight:700;color:${C.dim};font-size:11px;font-family:ui-monospace,Consolas,monospace;margin-right:2px}
.hk-row__title{color:${C.fg}}
.hk-row__meta{display:block;font-size:10.5px;color:${C.dim};margin-top:1px}
.hk-chev{flex:none;color:${C.dim};margin-top:3px;transition:transform .12s ease}
.hk-row[open] .hk-chev{transform:rotate(90deg)}
.hk-row[open]>summary{padding-bottom:0}
.hk-row__body{padding:0 10px 10px 11px}
.hk-row__body::before{content:"";display:block;height:1px;background:${C.line};margin:8px 0}
.hk-kv{font-size:11.5px;line-height:1.5;color:${C.fg};margin:5px 0;word-break:break-word}
.hk-kv em{display:block;font-style:normal;font-size:10px;font-weight:600;color:${C.dim};letter-spacing:.04em;margin-bottom:1px}
.hk-kv code{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:${C.dim};white-space:pre-wrap;word-break:break-all;display:block}
.hk-fp{font-family:ui-monospace,Consolas,monospace;font-size:9.5px;color:${C.dim};opacity:.75;margin-top:7px}

/* INFO 折叠组 */
.hk-group{border:1px dashed ${C.line};border-radius:10px;padding:0 9px;background:transparent}
.hk-group>summary{display:flex;align-items:center;gap:7px;padding:8px 0;cursor:pointer;list-style:none;font-size:11.5px;color:${C.dim}}
.hk-group>summary::-webkit-details-marker{display:none}
.hk-group>summary b{color:${C.fg};font-variant-numeric:tabular-nums}
.hk-group>summary svg{transition:transform .12s ease}
.hk-group[open]>summary svg{transform:rotate(90deg)}
.hk-row--compact{border:none;border-top:1px solid ${C.line};border-radius:0;background:transparent;margin:0;padding:0}
.hk-row--compact>summary{padding:6px 0 6px 0}
.hk-row--compact .hk-row__main{font-size:11.5px}
.hk-row--compact .hk-bar{opacity:.5}

/* 步骤 */
.hk-steps{list-style:none;margin:0;padding:0}
.hk-step{position:relative;padding:0 0 12px 26px;font-size:11.5px}
.hk-step:last-child{padding-bottom:0}
.hk-step::before{content:"";position:absolute;left:8px;top:16px;bottom:0;width:1px;background:${C.line}}
.hk-step:last-child::before{display:none}
.hk-num{position:absolute;left:0;top:1px;width:17px;height:17px;border-radius:50%;background:color-mix(in srgb,${C.accent} 12%,transparent);color:${C.accent};font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums}
.hk-step--done .hk-num{background:color-mix(in srgb,#16a34a 14%,transparent);color:#15803d}
.hk-step__t{font-size:12px;font-weight:600;color:${C.fg}}
.hk-step__d{font-size:11px;color:${C.dim};margin-top:1px}
.hk-plan{margin-top:6px}
.hk-plan__row{display:flex;gap:7px;align-items:baseline;padding:3px 0}
.hk-plan__txt{font-size:11.5px;color:${C.fg};line-height:1.45;min-width:0}
.hk-plan__txt b{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:${C.dim};margin-right:2px;font-weight:700}
.hk-delta{flex:none;font-size:10px;font-weight:700;color:#15803d;background:color-mix(in srgb,#16a34a 13%,transparent);border-radius:5px;padding:1px 5px;font-variant-numeric:tabular-nums;min-width:34px;text-align:center}

/* 建议 */
.hk-adv{list-style:none;margin:0;padding:0}
.hk-adv li{display:flex;gap:8px;padding:7px 0;font-size:11.5px;line-height:1.5;border-top:1px solid ${C.line}}
.hk-adv li:first-child{border-top:none;padding-top:0}
.hk-adv li em{font-style:normal;flex:none;width:14px;color:${C.dim};font-weight:700;font-size:10px;margin-top:2px}
.hk-adv li.warn em{color:#dc2626}

/* 能力域 */
.hk-caps{margin-top:2px}
.hk-caps__row{display:flex;gap:7px;align-items:baseline;padding:6px 0;border-top:1px solid ${C.line};font-size:11.5px;line-height:1.5}
.hk-caps__row:first-child{border-top:none}
.hk-caps__l{flex:none;width:74px;font-weight:600;color:${C.fg}}
.hk-caps__d{flex:1;min-width:0;color:${C.dim}}
.hk-pill{flex:none;font-size:9.5px;font-weight:700;padding:1px 5px;border-radius:4px;margin-top:1px}

.hk-foot{margin-top:14px;padding-top:10px;border-top:1px solid ${C.line};font-size:10px;color:${C.dim};display:flex;justify-content:space-between}
</style></head>
<body><div class="hk">
  <div class="hk-head">
    <span style="width:18px;height:18px;border-radius:4px;background:#6EAB3B;flex:none"></span>
    <span class="hk-head__t">体检</span>
    <span class="hk-head__sp"></span>
    <button class="hk-btn" type="button">
      <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      刷新</button>
  </div>

  <div class="hk-verdict">${esc(d.headline)}<span> · ${esc(String(d.at).replace('T', ' ').slice(11, 16))} 更新</span></div>

  <div class="hk-hero">
    <div class="hk-hero__top"><span class="hk-lab">总分</span><span class="hk-band">${esc(d.band)}</span></div>
    <div class="hk-hero__num">
      <span class="hk-score">${Number(d.score).toFixed(2)}<small>/10</small></span>
      <span style="font-size:11px;color:${C.dim}">${delta === null ? '首日基线' : (delta === 0 ? '较昨日持平' : (delta > 0 ? '较昨日 +' + delta : '较昨日 ' + delta))}</span>
    </div>
    <div class="hk-sev">${sevChip('P0', d.p0)}${sevChip('P1', d.p1)}${sevChip('P2', d.p2)}${sevChip('INFO', d.info)}</div>
    <div class="hk-hero__sep"></div>
    <div class="hk-hero__note"><span>未解决 <em>${d.count}</em> · 已退役 <em>${d.retired}</em></span><span>${d.trend.runs} 次记账</span></div>
  </div>

  <div class="hk-grid">
    <div class="hk-card"><div class="hk-card__l">可清理</div><div class="hk-card__v">${mb(d.clean.bytes)}</div><div class="hk-card__s">${d.clean.groups.length} 组 · 先预览</div></div>
    <div class="hk-card hk-card--warn"><div class="hk-card__l">插件 / 上限</div><div class="hk-card__v">${d.trim.served} / ${d.trim.maxBundles}</div><div class="hk-card__s">超 ${d.trim.served - d.trim.maxBundles} 个</div><div class="hk-meter"><i></i></div></div>
    <div class="hk-card"><div class="hk-card__l">最新分</div><div class="hk-card__v">${d.trend.latest}</div><div class="hk-card__s">${d.trend.daysTracked} 天 · ${d.trend.runs} 次</div></div>
    <div class="hk-card"><div class="hk-card__l">可涨</div><div class="hk-card__v">+${(d.plan.potentialAll - d.score).toFixed(2)}</div><div class="hk-card__s">全修完 ${d.plan.potentialAll} / 10</div></div>
  </div>

  <div class="hk-trend">
    <div class="hk-trend__top"><span class="hk-lab">分数趋势</span><span style="font-size:10px;color:${C.dim}">近 ${pts.length} 次 · 轴固定 0–10</span></div>
    <div class="hk-chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="分数趋势，最新 ${d.trend.latest} 分" style="color:${C.dim}">
        <line x1="${PAD}" y1="${ty(10)}" x2="${W - PAD}" y2="${ty(10)}" stroke="currentColor" stroke-opacity=".22" stroke-width=".4" vector-effect="non-scaling-stroke"/>
        <line x1="${PAD}" y1="${ty(5)}" x2="${W - PAD}" y2="${ty(5)}" stroke="currentColor" stroke-opacity=".22" stroke-width=".4" stroke-dasharray="2 2" vector-effect="non-scaling-stroke"/>
        <polygon points="${area}" fill="${C.accent}" fill-opacity=".09"/>
        <polyline points="${line}" fill="none" stroke="${C.accent}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
        <circle cx="${tx(pts.length - 1).toFixed(2)}" cy="${ty(last.total).toFixed(2)}" r="2.2" fill="${C.accent}" stroke="#fff" stroke-width="1" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="hk-axis"><span style="top:-1px">10</span><span style="top:50%;margin-top:-6px">5</span></div>
    </div>
    <div class="hk-trend__foot"><span>${esc(String(first.at).slice(11, 16))} · ${first.total}</span><span>低 ${Math.min(...valsAll)} / 高 ${Math.max(...valsAll)}</span><span>${esc(String(last.at).slice(11, 16))} · ${last.total}</span></div>
  </div>

  <div class="hk-sec"><span class="hk-sec__t">问题</span><span class="hk-sec__n">${d.count} 条 · 按严重度</span><span class="hk-sec__sp"></span><span class="hk-sec__n">点开看根因</span></div>
  ${d.items.filter((i) => i.severity !== 'INFO').map((i) => bDetails(i, false)).join('')}
  <details class="hk-group">
    <summary><svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>其余 <b>${d.info}</b> 条 INFO（不计分，仅提示）</span></summary>
    ${d.items.filter((i) => i.severity === 'INFO').map((i) => bDetails(i, true)).join('')}
  </details>

  <div class="hk-sec"><span class="hk-sec__t">修复顺序</span><span class="hk-sec__n">P0 封顶 → 单条增量</span></div>
  <ol class="hk-steps">${steps.join('')}</ol>

  <div class="hk-sec"><span class="hk-sec__t">优化建议</span></div>
  <ul class="hk-adv">
    ${overLimit ? `<li class="warn"><em>!</em><span>服务插件 ${d.trim.served} 个超过宿主上限 ${d.trim.maxBundles}：先砍「同能力多实现」，别砍基础设施。</span></li>` : ''}
    <li><em>1</em><span>image 有 3 个实现，主力是 dsh-image-gen；其余 ${d.trim.groups[0].drop.join('、')} 为可关候选。</span></li>
    <li><em>2</em><span>${d.trim.memory.length} 套记忆/上下文插件同时挂载：${d.trim.memory.join('、')}。</span></li>
    <li><em>3</em><span>可清理 ${mb(d.clean.bytes)}（${d.clean.groups.length} 组，含远程镜像）：先预览，执行移入回收区 7 天可还原。</span></li>
  </ul>

  <div class="hk-sec"><span class="hk-sec__t">能力域</span><span class="hk-sec__sp"></span></div>
  <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:2px">${capsChips}</div>
  <div class="hk-caps">
    ${d.capabilities.rows.map((x) => `<div class="hk-caps__row"><span class="hk-caps__l">${esc(x.label)}</span><span class="hk-pill" style="color:${statusHue(x.status)};background:color-mix(in srgb,${statusHue(x.status)} 13%,transparent)">${esc(statusZh(x.status))}</span><span class="hk-caps__d">${esc(x.detail)}</span></div>`).join('')}
  </div>
  <div style="font-size:10px;color:${C.dim};margin-top:7px">四级补救阶梯用 audit_capabilities：配置 → provider → 插件 → 习惯。</div>

  <details class="hk-group" style="margin-top:10px">
    <summary><svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <span>已退役 <b>${d.retiredList.length}</b> 条（误报记档，不再计分）</span></summary>
    <div style="padding-bottom:6px">${d.retiredList.map((x) => `<div style="font-size:11px;color:${C.dim};padding:4px 0;border-top:1px solid ${C.line}">${esc(x.ruleId)} · ${esc(x.title)}</div>`).join('')}</div>
  </details>

  <div class="hk-foot"><span>只读 · 不写配置</span><span>缓存 60 秒</span></div>
</div></body></html>`;

fs.writeFileSync(path.join(here, 'a-current.html'), htmlA);
fs.writeFileSync(path.join(here, 'b-proposed.html'), htmlB);
console.log('ok', htmlA.length, htmlB.length);
