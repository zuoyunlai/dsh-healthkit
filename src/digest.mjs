// 首屏结论化（产品审计 P0）。
//
// 问题：健康机器（9.81 / P0=P1=0）的首屏是「14 行 INFO + 3 条 P2」，读者看完不知道
// 该干什么——「跑完啥也没说」。实测 17 条发现里 14 条 INFO（82%），其中 7 条连 fixHint 都没有。
//
// 解法不是删 INFO（INFO 是观测证据库，audit_diff 与「什么时候开始变坏」全靠它），
// 而是换表达：**1 句结论 → ≤3 条最值得动的 → 其余一句话收走**。
//
// 这个模块是这条口径的单一真源：CLI 首屏、audit_run 的 summary、面板的 headline 都读它。
const SEV_ORDER = { P0: 0, P1: 1, P2: 2, INFO: 3 };

// 一句话结论：面板与 CLI 共用，避免两处措辞漂移。
export function headlineOf(by, score, count) {
  const p0 = (by && by.P0) || 0;
  if (p0 > 0) return '有 ' + p0 + ' 条 P0 压着总分封顶，先处理它们';
  if (!count) return '没发现未解决的问题';
  if (score < 6) return '问题较多，按下表顺序修见效最快';
  if (score < 8) return '整体可用，还有几处该收的尾巴';
  return '整体健康，剩下的是打磨项';
}

// 「最值得动」的挑选：计分项（非 INFO、非 advisory）里，严重度优先、可执行的优先。
// 只看 ≤3 条：再多就不是「首屏」了。
export function pickTopActions(findings, limit) {
  const n = Number.isFinite(limit) ? limit : 3;
  const scoring = (findings || []).filter((f) => f && f.severity !== 'INFO' && f.advisory !== true);
  scoring.sort((a, b) => {
    const s = (SEV_ORDER[a.severity] === undefined ? 9 : SEV_ORDER[a.severity])
      - (SEV_ORDER[b.severity] === undefined ? 9 : SEV_ORDER[b.severity]);
    if (s) return s;
    // 有 fixHint 的排前面：首屏要给「能动手的」，不是「知道了也没用的」。
    const h = (b.fixHint ? 1 : 0) - (a.fixHint ? 1 : 0);
    if (h) return h;
    return String(a.ruleId).localeCompare(String(b.ruleId));
  });
  return scoring.slice(0, n);
}

export function countBySeverity(findings) {
  const by = { P0: 0, P1: 0, P2: 0, INFO: 0 };
  (findings || []).forEach((f) => { if (f && by[f.severity] !== undefined) by[f.severity] += 1; });
  return by;
}

// 首屏那几行（CLI / 工具 render 共用）。
// 参数：result = engine.audit() 的返回值；opts.limit 控制「最值得动」的条数。
export function renderFirstScreen(result, opts) {
  const o = opts || {};
  const findings = (result && result.findings) || [];
  const by = countBySeverity(findings);
  const score = result && result.score ? result.score : { total: 0, band: '-', raw: 0, p0Open: 0 };
  const headline = headlineOf(by, score.total, findings.length);
  const top = pickTopActions(findings, o.limit || 3);
  const infoCount = by.INFO;
  const restScoring = findings.filter((f) => f.severity !== 'INFO' && f.advisory !== true).length - top.length;

  const lines = [];
  lines.push('**' + headline + '**');
  lines.push('');
  if (top.length) {
    lines.push('最值得动的 ' + top.length + ' 条：');
    top.forEach((f, i) => {
      lines.push((i + 1) + '. [' + f.severity + '] `' + f.ruleId + '` ' + (f.title || ''));
      if (f.fixHint) lines.push('   → ' + String(f.fixHint).replace(/\s+/g, ' ').slice(0, 120));
    });
  } else {
    lines.push('没有计分项要修（P0/P1/P2 全为 0）。');
  }
  const tail = [];
  if (restScoring > 0) tail.push('另有 ' + restScoring + ' 条计分项');
  if (infoCount > 0) tail.push(infoCount + ' 条 INFO（不计分，观测用）');
  if (tail.length) {
    lines.push('');
    lines.push('其余 ' + tail.join(' / ') + '：`audit_findings` 或 `--findings` 看全量。');
  }
  return { headline: headline, topActions: top, infoCount: infoCount, restScoring: restScoring, lines: lines };
}
