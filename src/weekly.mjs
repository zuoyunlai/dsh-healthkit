// 差异驱动的周报（产品审计 P2）。
//
// 为什么需要它：一条「每周 09:00 自动体检」在 9.81 分的机器上，每周得到的是
// 「同一句话 + 同样 14 条 INFO」——把 78% 的零新信息从手动噪声升级成定时噪声，
// 人的反应是屏蔽。而它同时是唯一能给「不打开也能收到价值」的触点。
//
// 所以周报的规则是：
//   ① 有变化才发（分数 / 新增 / 真修好 / 新退役 任一发生）；
//   ② 一定要带「上次说该修的现在怎样」——这张牌（audit_verify）此前从未被打出去过；
//   ③ 没有变化时只说一句「无变化」，不做无信息量的复述。
//
// 只读：不写账本、不写快照、不改配置。记账由 audit_run / CLI 负责。
import { latestRun, diffRuns } from './snapshot.mjs';
import { checkPending } from './verify.mjs';
import { headlineOf, countBySeverity, pickTopActions } from './digest.mjs';
import { stats as feedbackStats, renderStats as renderFeedback } from './feedback.mjs';
import { productMetrics } from './metrics.mjs';

function currentRunShape(result) {
  return {
    at: new Date().toISOString(),
    score: result && result.score ? result.score.total : null,
    findings: ((result && result.findings) || []).map((f) => ({ fp: f.fp, ruleId: f.ruleId, severity: f.severity, title: f.title || '' })),
    retired: ((result && result.retired) || []).map((f) => f.fp),
  };
}

export function buildDigest(result, opts) {
  const o = opts || {};
  const home = o.home || (result && result.facts && result.facts.home);
  const findings = (result && result.findings) || [];
  const by = countBySeverity(findings);
  const score = result && result.score ? result.score.total : null;
  const headline = headlineOf(by, score, findings.length);

  // ① 与上一次快照比
  let diff = null;
  let changed = true;
  let reason = '首次体检（没有基线）';
  try {
    const prev = latestRun(home);
    diff = diffRuns(prev, currentRunShape(result));
    if (diff.noBaseline) {
      changed = true;
      reason = '首次体检（没有基线）';
    } else {
      const delta = typeof diff.delta === 'number' ? diff.delta : 0;
      const moved = Math.abs(delta) >= 0.05;
      changed = moved || diff.added.length > 0 || diff.fixed.length > 0 || diff.newlyRetired.length > 0;
      const bits = [];
      if (moved) bits.push('分数 ' + (delta > 0 ? '+' : '') + delta + '（' + diff.prevScore + ' → ' + diff.curScore + '）');
      if (diff.added.length) bits.push('新增 ' + diff.added.length + ' 条');
      if (diff.fixed.length) bits.push('真修好 ' + diff.fixed.length + ' 条');
      if (diff.newlyRetired.length) bits.push('新退役 ' + diff.newlyRetired.length + ' 条');
      reason = bits.length ? bits.join(' · ') : '没有变化';
    }
  } catch (e) {
    diff = null;
    changed = true;
    reason = '拿不到上次快照（' + ((e && e.message) || e) + '）';
  }

  // ② 上次说该修的，现在怎样
  let verify = null;
  try {
    const v = checkPending(result, { home: home });
    if (v && v.hasPending) {
      verify = {
        checked: (v.checked || []).length,
        fixed: (v.fixed || []).map((x) => x.ruleId),
        stillThere: (v.stillThere || []).map((x) => x.ruleId),
        muted: (v.muted || []).map((x) => x.ruleId),
        regressions: (v.regressions || []).map((x) => x.ruleId),
      };
      // 有状态变化也算「有变化」：这正是周报该说话的时候。
      if (verify.stillThere.length === 0 && verify.fixed.length === 0 && verify.muted.length === 0 && verify.regressions.length === 0) {
        // 全部还在 —— 没变化
      } else if (verify.fixed.length || verify.muted.length || verify.regressions.length) {
        changed = true;
      }
    }
  } catch (e) { verify = null; }

  // 首次价值信号（产品审计 §5）：只有用户真的回答过才出现，否则不占版面。
  let feedback = null;
  try {
    const fs1 = feedbackStats(home);
    if (fs1.answered > 0) feedback = { stats: fs1, text: renderFeedback(fs1) };
  } catch (e) { feedback = null; }

  // 产品指标（§5 的 2/3 + 误报率）：能算才出现，算不出来不当噪声。
  let metrics = null;
  try {
    const m = productMetrics(home, { findingsCount: findings.length });
    const sr = m.secondRun || {};
    const ad = m.adoption || {};
    const fpv = m.falsePositive || {};
    if (sr.returnedAfter7d !== null || typeof ad.rate === 'number' || typeof fpv.rate === 'number') metrics = m;
  } catch (e) { metrics = null; }

  const top = pickTopActions(findings, o.limit || 3);
  const lines = [];
  lines.push('**' + headline + '**');
  if (feedback) {
    lines.push('');
    lines.push(feedback.text);
  }
  // P5（借 Snyk Fix Rate）：采纳率现在恒为 0/null —— 把「怎么让它变成证据」写在旁边，
  // 而不是让仪表上那个 0 一直挂着没人管。
  let ritual = null;
  try {
    const m2 = productMetrics(home, { findingsCount: findings.length });
    const ad = (m2 && m2.adoption) || {};
    if (typeof ad.rate !== 'number' || ad.rate === 0) {
      ritual = '验回仪式：采纳率现在是 ' + (typeof ad.rate === 'number' ? ad.rate + '%' : '算不出来')
        + '。把上次说该修的那几条里**真修掉一条**，重启宿主让验回跑一次，这个数才会从 0 变成证据。';
    }
  } catch (e) { ritual = null; }

  if (metrics) {
    lines.push('');
    lines.push('运行数据：' + [
      (metrics.secondRun && metrics.secondRun.returnedAfter7d !== null
        ? '第二次运行 ' + (metrics.secondRun.returnedAfter7d ? '是' : '还没有')
        : null),
      (metrics.adoption && typeof metrics.adoption.rate === 'number' ? '采纳率 ' + metrics.adoption.rate + '%' : null),
      (metrics.falsePositive && typeof metrics.falsePositive.rate === 'number' ? '误报率 ' + metrics.falsePositive.rate + '%' : null),
    ].filter(Boolean).join(' · '));
  }
  lines.push('');
  if (!changed) {
    lines.push('与上次相比：' + reason + '。本次不展开，避免把定时复述变成噪声。');
    if (top.length) {
      lines.push('');
      lines.push('仍待处理（' + top.length + ' 条最值得动的）：');
      top.forEach((f, i) => lines.push((i + 1) + '. [' + f.severity + '] `' + f.ruleId + '` ' + (f.title || '')));
    }
    return { changed: false, headline: headline, reason: reason, verify: verify, lines: lines, topActions: top.length, feedback: feedback ? feedback.stats : null };
  }

  lines.push('与上次相比：' + reason + '。');
  if (diff && !diff.noBaseline) {
    if (diff.added.length) lines.push('- 新增：' + diff.added.slice(0, 5).map((f) => '[' + f.severity + '] ' + f.ruleId).join('、'));
    if (diff.fixed.length) lines.push('- 真修好：' + diff.fixed.slice(0, 5).map((f) => f.ruleId).join('、'));
    if (diff.newlyRetired.length) lines.push('- 新退役（被静音，不算修好）：' + diff.newlyRetired.slice(0, 5).map((f) => f.ruleId).join('、'));
  }
  if (verify) {
    lines.push('');
    lines.push('上次说该修的，现在：');
    if (verify.fixed.length) lines.push('- 已修好：' + verify.fixed.join('、'));
    if (verify.stillThere.length) lines.push('- 还在：' + verify.stillThere.join('、'));
    if (verify.muted.length) lines.push('- 被静音：' + verify.muted.join('、'));
    if (verify.regressions.length) lines.push('- 回归：' + verify.regressions.join('、'));
  }
  if (ritual) {
    lines.push('');
    lines.push(ritual);
  }
  if (top.length) {
    lines.push('');
    lines.push('本次最值得动的 ' + top.length + ' 条：');
    top.forEach((f, i) => {
      lines.push((i + 1) + '. [' + f.severity + '] `' + f.ruleId + '` ' + (f.title || ''));
      if (f.fixHint) lines.push('   → ' + String(f.fixHint).replace(/\s+/g, ' ').slice(0, 110));
    });
  }
  return { changed: true, headline: headline, reason: reason, verify: verify, diff: diff, lines: lines, topActions: top.length, feedback: feedback ? feedback.stats : null };
}
