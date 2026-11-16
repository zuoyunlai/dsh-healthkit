// 产品指标（产品审计 §5 的指标 2 / 3 + 误报率）。
//
// 产品经理的原话：判断「值不值得装」的三个指标里，第 2（第二次运行率）和第 3（结论采纳率）
// 「能力在、数据没有」——`retirements.json` 能算误报率，采纳率靠 audit_verify，
// 但从来没有任何地方把它们摆出来。
//
// 三件事的口径，宁可说「算不出来」也不编：
//   ② 第二次运行：单机样本下它不是比率而是布尔 —— 有没有在 ≥7 天后回来跑过。
//      因此给 spanDays / returnedAfter7d（null = 观察期不足 7 天，别下结论）。
//   ③ 采纳率 = fixed / (fixed + stillThere)。被静音的（muted）**不算采纳**——
//      静音只说明你不看了，不说明你修了。
//   ④ 误报率 = retired / (findings + retired)。
//
// 全部只读：从账本、验回记录、退役档算，不写任何东西、不联网。
import fs from 'node:fs';
import path from 'node:path';
import { dshHome, readJson } from './util.mjs';
import { dataDir } from './paths.mjs';
import { retireStorePath } from './engine.mjs';

function dayMs(day) {
  const t = new Date(String(day) + 'T00:00:00').getTime();
  return Number.isFinite(t) ? t : null;
}

export function productMetrics(home, opts) {
  const h = home || dshHome();
  const o = opts || {};
  const out = {};

  // ② 第二次运行
  let hist = [];
  try {
    const p = path.join(dataDir(h), 'history.jsonl');
    const txt = fs.readFileSync(p, 'utf8');
    hist = txt.split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
  } catch (e) { hist = []; }
  const effective = hist.filter((r) => r.source === 'human' || r.source === 'automation');
  const legacy = hist.filter((r) => !r.source).length;
  const days = [...new Set(effective.map((r) => r.day).filter(Boolean))].sort();
  const firstDay = days.length ? days[0] : null;
  const lastDay = days.length ? days[days.length - 1] : null;
  const spanDays = firstDay && lastDay ? Math.round(((dayMs(lastDay) || 0) - (dayMs(firstDay) || 0)) / 86400000) : null;
  out.secondRun = {
    effectiveRuns: effective.length,
    legacyRuns: legacy,
    distinctDays: days.length,
    firstDay: firstDay,
    lastDay: lastDay,
    spanDays: spanDays,
    returnedAfter7d: spanDays === null ? null : spanDays >= 7,
    reason: !days.length
      ? '账本里还没有带来源的有效运行（老记录没有 source 字段）'
      : (spanDays !== null && spanDays < 7 ? '观察期不足 7 天（' + spanDays + ' 天），还判断不了会不会回来' : null),
  };

  // ③ 采纳率（来自上一次关机的验回记录）
  let verify = null;
  try {
    verify = readJson(path.join(dataDir(h), 'verify', 'last.json'), null);
  } catch (e) { verify = null; }
  if (verify && Array.isArray(verify.fixed) && Array.isArray(verify.stillThere)) {
    const denom = verify.fixed.length + verify.stillThere.length;
    out.adoption = {
      rate: denom ? Math.round((verify.fixed.length / denom) * 1000) / 10 : null,
      fixed: verify.fixed.length,
      stillThere: verify.stillThere.length,
      muted: Array.isArray(verify.muted) ? verify.muted.length : 0,
      at: verify.at || null,
      note: denom ? null : '上次验回没有可比的目标（没有 fixed/stillThere）',
    };
  } else {
    out.adoption = { rate: null, fixed: 0, stillThere: 0, muted: 0, at: null, note: '还没有验回记录（要重启宿主或跑 audit_verify）' };
  }

  // ④ 误报率
  let retired = {};
  try { retired = readJson(retireStorePath(h), {}) || {}; } catch (e) { retired = {}; }
  const retiredCount = Object.keys(retired).length;
  const findingsCount = typeof o.findingsCount === 'number' ? o.findingsCount : null;
  const fpDenom = findingsCount === null ? null : findingsCount + retiredCount;
  out.falsePositive = {
    retired: retiredCount,
    findings: findingsCount,
    rate: fpDenom ? Math.round((retiredCount / fpDenom) * 1000) / 10 : null,
    note: fpDenom ? null : '缺少当前发现数，只给退役条数',
  };

  return out;
}

export function renderMetrics(m, head) {
  if (!m) return '';
  const lines = [];
  const sr = m.secondRun || {};
  if (sr.returnedAfter7d === true) {
    lines.push('第二次运行：是（有效运行 ' + sr.effectiveRuns + ' 次 / ' + sr.distinctDays + ' 天，跨 ' + sr.spanDays + ' 天）');
  } else if (sr.returnedAfter7d === false) {
    lines.push('第二次运行：还没有（有效运行 ' + sr.effectiveRuns + ' 次，跨度不到 7 天）');
  } else {
    lines.push('第二次运行：算不出来 —— ' + (sr.reason || '样本不足'));
  }
  const ad = m.adoption || {};
  if (typeof ad.rate === 'number') {
    lines.push('结论采纳率：' + ad.rate + '%（真修好 ' + ad.fixed + ' / 还在 ' + ad.stillThere
      + (ad.muted ? '；另有 ' + ad.muted + ' 条被静音，不算采纳' : '') + '）');
  } else {
    lines.push('结论采纳率：算不出来 —— ' + (ad.note || '无数据'));
  }
  const fp = m.falsePositive || {};
  if (typeof fp.rate === 'number') {
    lines.push('误报率：' + fp.rate + '%（已退役 ' + fp.retired + ' / 发现 ' + fp.findings + '）');
  } else {
    lines.push('误报率：只知已退役 ' + (fp.retired || 0) + ' 条（缺当前发现数）');
  }
  return (head ? head + '\n' : '') + lines.join('\n');
}
