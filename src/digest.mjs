// 首屏结论化（产品审计 P0）。
//
// 问题：健康机器（9.81 / P0=P1=0）的首屏是「14 行 INFO + 3 条 P2」，读者看完不知道
// 该干什么——「跑完啥也没说」。实测 17 条发现里 14 条 INFO（82%），其中 7 条连 fixHint 都没有。
//
// 解法不是删 INFO（INFO 是观测证据库，audit_diff 与「什么时候开始变坏」全靠它），
// 而是换表达：**1 句结论 → ≤3 条最值得动的 → 其余一句话收走**。
//
// 这个模块是这条口径的单一真源：CLI 首屏、audit_run 的 summary、面板的 headline 都读它。
import { renderDegradations } from './degrade.mjs';

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
// 2026-11-20 反哺 P2：首屏先回答「现在需不需要动」。
// 判据只看「会不会影响加载/启动」：P0、fault 组计分项、profile 读不出。
// 清洁度/声明一致性/成本口径不进这句话——它们可以保留现状。
export function needsActionLine(result) {
  const findings = (result && result.findings) || [];
  const at = (result && result.attribution) || {};
  const capP0 = findings.filter((f) => f.severity === 'P0' && f.advisory !== true);
  const faults = (at.rowsFault || []).filter((r) => r.severity !== 'INFO');
  const broken = ((((result || {}).facts || {}).profileErrors) || []).length;
  const intent = findings.filter((f) => f.ruleId === 'R1b');
  const intentCount = intent.reduce((n, f) => n + ((f.measured && f.measured.count) || 0), 0);
  const unknown = findings.filter((f) => f.confidence === 'UNKNOWN').length;

  if (capP0.length || faults.length || broken) {
    const parts = [];
    if (capP0.length) parts.push('P0 ' + capP0.length + ' 条');
    if (faults.length) parts.push('影响加载 ' + faults.length + ' 条');
    if (broken) parts.push('profile 读不出 ' + broken + ' 个（报告残缺）');
    let s = '**需要处理**：' + parts.join(' · ') + '。';
    if (intentCount) s += '另有 ' + intentCount + ' 个插件按你的停用选择未挂载，不计为故障。';
    return { needAction: true, text: s };
  }
  let s = '**不需要处理**：没发现会影响插件加载/启动的计分项。';
  if (intentCount) s += '有 ' + intentCount + ' 个插件按你的停用选择未挂载，符合预期。';
  s += '没到满分不等于必须改——清洁度与声明一致性属于「可保留现状」。';
  if (unknown) s += '另有 ' + unknown + ' 条判不了的项，已在明细里标 UNKNOWN。';
  return { needAction: false, text: s };
}

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
  // P2-4：采集降级要出现在结论里——「判不了」不能长得像「没问题」。
  const degraded = (result && result.degradations) || [];
  if (degraded.length) {
    lines.push('');
    lines.push(renderDegradations(degraded));
  }
  return { headline: headline, topActions: top, infoCount: infoCount, restScoring: restScoring, degradations: degraded, lines: lines };
}
