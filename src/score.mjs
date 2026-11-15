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
