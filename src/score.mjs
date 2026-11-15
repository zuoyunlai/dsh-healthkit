export function score(rubric, findings, scenario) {
  var overrides = (rubric.scenarios && rubric.scenarios[scenario] && rubric.scenarios[scenario].overrides) || {};
  var dims = rubric.dimensions.map(function (d) {
    var w = Object.prototype.hasOwnProperty.call(overrides, d.key) ? overrides[d.key] : d.weight;
    return { key: d.key, label: d.label, weight: w, penalties: 0, count: 0, items: [] };
  });
  var byKey = {};
  dims.forEach(function (d) { byKey[d.key] = d; });
  var p0 = 0;
  findings.forEach(function (f) {
    if (!byKey[f.dimension] || f.severity === 'INFO' || f.advisory === true) return;
    var d = byKey[f.dimension];
    var pen = f.confidence === 'UNKNOWN' ? rubric.penalty.UNKNOWN : (rubric.penalty[f.severity] || 0);
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
           capReason: capReason, band: band ? band.label : '-', p0Open: p0, dims: dims, rubricVersion: rubric.version };
}


// 「修哪条、涨多少」：用同一套 rubric 做反事实重算，不另立公式。
// 分两步：① 先解 P0 封顶（整组）；② 在解封后的基准上算每条 P1 的边际收益。
// 为什么不混着算：总分被封顶时，单条 P1 的真实分数增量恒为 0，混着算会得到一列假 +0。
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
    rows.push({ fp: f.fp, ruleId: f.ruleId, severity: f.severity, title: f.title, target: f.target || '', delta: d, deltaRaw: dr });
  });
  rows.sort(function (a, b) { return (b.delta - a.delta) || (b.deltaRaw - a.deltaRaw); });

  var leftover = findings.filter(function (f) { return !(f.advisory !== true && f.severity !== 'INFO' && f.dimension); });
  var all = score(rubric, leftover, sc.scenario);
  return { from: sc.total, capped: !!sc.capReason, stage1: stage1, stage2Base: base, rows: rows, potentialAll: all.total, potentialRaw: all.raw };
}
