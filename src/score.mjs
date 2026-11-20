// rubric 自检（架构审计 B1）。
//
// 修前实测：把 caps 的 when 多写一个空格（'p0Open >= 1' → 'p0Open>=1'），封顶**静默失效**，
// 5.0 直接变成 8.0；把 dimensions 的 key 拼错一个字母，P0 整条消失、总分 10.0。
// 都是「配置写错一个字，对外承诺悄悄变」，所以必须在启动/体检时显式喊出来。
export const CAP_WHENS = ['p0Open >= 1', 'p0Open >= 3'];

export function validateRubric(rubric) {
  const errs = [];
  const r = rubric || {};
  const dims = Array.isArray(r.dimensions) ? r.dimensions : [];
  if (!dims.length) errs.push('dimensions 缺失或为空');
  const seen = {};
  dims.forEach(function (d) {
    if (!d || !d.key) errs.push('存在没有 key 的维度');
    else if (seen[d.key]) errs.push('维度 key 重复：' + d.key);
    else seen[d.key] = true;
    if (!(typeof d.weight === 'number' && d.weight >= 0)) errs.push('维度 ' + (d && d.key) + ' 的 weight 不是非负数');
  });
  if (dims.length && !dims.some(function (d) { return (Number(d.weight) || 0) > 0; })) errs.push('所有维度权重都是 0');
  (Array.isArray(r.caps) ? r.caps : []).forEach(function (c) {
    if (CAP_WHENS.indexOf(c && c.when) === -1) errs.push('caps[].when 不在白名单「' + String(c && c.when) + '」——该封顶会被静默忽略');
    if (typeof (c && c.max) !== 'number') errs.push('caps[].max 必须是数字（when=' + String(c && c.when) + '）');
  });
  const bands = Array.isArray(r.bands) ? r.bands : [];
  if (bands.length < 2) errs.push('bands 少于 2 档');
  for (let i = 1; i < bands.length; i++) {
    if (!(bands[i].min < bands[i - 1].min)) errs.push('bands 未按 min 严格降序（第 ' + (i + 1) + ' 项）');
  }
  const dcs = (Array.isArray(r.dimensionCaps) ? r.dimensionCaps : []).slice().sort(function (a, b) { return a.findings - b.findings; });
  dcs.forEach(function (dc, i) {
    if (typeof dc.findings !== 'number' || typeof dc.max !== 'number') errs.push('dimensionCaps 条目缺 findings/max');
    else if (i > 0 && dc.max > dcs[i - 1].max) errs.push('dimensionCaps 未单调：findings 越多 max 反而更大');
  });
  if (!r.penalty || typeof r.penalty !== 'object') errs.push('penalty 缺失');
  else ['P0', 'P1', 'P2'].forEach(function (s) {
    if (typeof r.penalty[s] !== 'number') errs.push('penalty 缺 ' + s + '（该严重度将按 0 罚分）');
  });
  return errs;
}

export function score(rubric, findings, scenario) {
  var overrides = (rubric.scenarios && rubric.scenarios[scenario] && rubric.scenarios[scenario].overrides) || {};
  var dims = rubric.dimensions.map(function (d) {
    var w = Object.prototype.hasOwnProperty.call(overrides, d.key) ? overrides[d.key] : d.weight;
    return { key: d.key, label: d.label, weight: w, penalties: 0, count: 0, items: [] };
  });
  var byKey = {};
  dims.forEach(function (d) { byKey[d.key] = d; });
  var p0 = 0;
  // 丢弃项不再静默（架构审计 B1）：未知维度/未知严重度都记下来，由 engine 写进 self.notes。
  var dropped = { dimension: [], severity: [] };
  findings.forEach(function (f) {
    if (f.severity === 'INFO' || f.advisory === true) return;
    if (!byKey[f.dimension]) { dropped.dimension.push(f.ruleId); return; }
    if (typeof rubric.penalty[f.severity] !== 'number') dropped.severity.push(f.ruleId + '/' + f.severity);
    var d = byKey[f.dimension];
    // 审计反哺 V04：UNKNOWN 从「固定轻罚」改为「按名义严重度打折」——
    // 旧表里 P1 已证扣 1.8 而 P1 UNKNOWN 只扣 0.5，取证不足反而比已证问题罚得轻，
    // 会系统性高估健康度。unknownDiscount 是折扣系数（0.5 = 罚名义值的一半）。
    var nominal = rubric.penalty[f.severity] || 0;
    var disc = typeof rubric.unknownDiscount === 'number' ? rubric.unknownDiscount : 0.5;
    var pen = f.confidence === 'UNKNOWN' ? nominal * disc : nominal;
    d.penalties += pen; d.count += 1; d.items.push(f.ruleId);
    if (f.severity === 'P0') p0++;
  });
  var weighted = 0, totalWeight = 0;
  dims.forEach(function (d) {
    d.score = Math.max(0, rubric.base - d.penalties);
    var caps = rubric.dimensionCaps || [];
    for (var i = 0; i < caps.length; i++) {
      if (d.count >= caps[i].findings && d.score > caps[i].max) { d.score = caps[i].max; d.cappedBy = caps[i].findings; }
    }
    weighted += d.score * d.weight; totalWeight += d.weight;
  });
  var raw = totalWeight ? weighted / totalWeight : 0;
  var capped = raw, capReason = null;
  for (var j = 0; j < rubric.caps.length; j++) {
    var cap = rubric.caps[j];
    var hit = (cap.when === 'p0Open >= 1' && p0 >= 1) || (cap.when === 'p0Open >= 3' && p0 >= 3);
    if (hit && raw > cap.max) { capped = cap.max; capReason = cap.reason; break; }
  }
  var band = rubric.bands.filter(function (b) { return capped >= b.min; })[0];
  return { scenario: scenario, raw: Math.round(raw * 100) / 100, total: Math.round(capped * 100) / 100,
           capReason: capReason, band: band ? band.label : '-', p0Open: p0, dims: dims, rubricVersion: rubric.version,
           // B6：分档阈值随结果一起下发，前端不再各自硬编码一份 8.5/7/5。
           bands: (rubric.bands || []).map(function (b) { return { min: b.min, label: b.label }; }),
           dropped: dropped, unknownScenario: !!(rubric.scenarios && !rubric.scenarios[scenario]) };
}


// 一条修法能省下多少「物理量」。只认已经测得出来的；测不出的返回 null（显示为「待测」）。
function savesOf(f) {
  const m = (f && f.measured) || {};
  if (f.ruleId === 'R17' && typeof m.mb === 'number' && m.mb > 0) return '省 ' + m.mb + ' MB';
  if (f.ruleId === 'R15' && typeof m.served === 'number' && typeof m.bundles === 'number' && m.served > m.bundles) {
    return '少 ' + (m.served - m.bundles) + ' 个服务插件';
  }
  if (f.ruleId === 'R16' && Array.isArray(m.bundles) && m.bundles.length) {
    return '每轮省 token（待测 · 涉及 ' + m.bundles.length + ' 套）';
  }
  return null;
}

// 「修哪条、涨多少」：用同一套 rubric 做反事实重算，不另立公式。
// 分两步：① 先解 P0 封顶（整组）；② 在解封后的基准上算每条 P1 的边际收益。
// 为什么不混着算：总分被封顶时，单条 P1 的真实分数增量恒为 0，混着算会得到一列假 +0。
import { isFaultRule } from './matrix.mjs';

export function attribution(rubric, findings, sc) {
  var round = function (x) { return Math.round(x * 100) / 100; };
  var scoring = findings.filter(function (f) { return f.advisory !== true && f.severity !== 'INFO' && f.dimension; });
  var p0s = scoring.filter(function (f) { return f.severity === 'P0'; });
  var rest0 = scoring.filter(function (f) { return f.severity !== 'P0'; });

  var stage1 = null;
  var base = sc.total;
  var baseRaw = sc.raw;
  if (p0s.length) {
    var s0 = score(rubric, rest0, sc.scenario);
    stage1 = {
      count: p0s.length,
      items: p0s.map(function (f) { return f.ruleId + ' · ' + (f.title || '') + (f.target ? '（' + f.target + '）' : ''); }),
      from: sc.total, to: s0.total, delta: round(s0.total - sc.total), rawAfter: s0.raw,
    };
    base = s0.total;
    baseRaw = s0.raw;
  }

  var rows = [];
  rest0.forEach(function (f) {
    var rest = rest0.filter(function (x) { return x !== f; });
    var s2 = score(rubric, rest, sc.scenario);
    var d = round(s2.total - base);
    var dr = round(s2.raw - baseRaw);
    if (d === 0 && dr === 0) return;
    // 竞品分析 P2（借 Lighthouse 的 Opportunities）：光说「+0.13 分」驱动不了人，
    // 能说「省 200MB / 少 13 个服务插件」才有用。拿不到物理量就写「待测」，不许编数字。
    rows.push({
      fp: f.fp, ruleId: f.ruleId, severity: f.severity, title: f.title, target: f.target || '',
      delta: d, deltaRaw: dr, saves: savesOf(f),
    });
  });
  rows.sort(function (a, b) { return (b.delta - a.delta) || (b.deltaRaw - a.deltaRaw); });

  var leftover = findings.filter(function (f) { return !(f.advisory !== true && f.severity !== 'INFO' && f.dimension); });
  var all = score(rubric, leftover, sc.scenario);
  // 2026-11-20 反哺 P2：不只按「涨多少分」排，还要分清「不修会怎样」。
  // fault = 影响加载/启动（必须处理）；hygiene = 清洁度与声明一致性（可以保留现状）。
  var fault = [], hygiene = [];
  rows.forEach(function (r) { (isFaultRule(r.ruleId) ? fault : hygiene).push(r); });
  return { from: sc.total, capped: !!sc.capReason, stage1: stage1, stage2Base: base, rows: rows,
           rowsFault: fault, rowsHygiene: hygiene,
           potentialAll: all.total, potentialRaw: all.raw };
}
