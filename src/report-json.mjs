// 机器可读报告：JSON 全量报告 + 生态三值契约（check）。
//
// ④ 第 2 项（机器可读 JSON 报告）：让别的插件/脚本能消费体检结论，
// 而不是只能读 Markdown。
//
// ④ 第 1 项（与 dsh-plugin-doctor 互补）：生态正在收敛三值契约
// （见 dsh-plugin-doctor SPEC §1.1 与 RFC #1846）：check 工具输出
// PASS/WARN/FAIL 三值 + 退出码 0/1/2。本插件按同一契约提供 check 形态，
// 于是「整机健康体检」与「单插件合规体检」能被同一套 CI/action 消费。
//
// 契约形态照抄 doctor 的 check 信封（实测其 --format check 输出）：
//   { ok, contract, checks[], doctor:{...}, target:{...} }
// 差别只在本插件的 check 条目来自体检发现，而不是 doctor 的静态扫描。

import { buildMatrix } from './capability-map.mjs';
import fs from 'node:fs';
import path from 'node:path';

// 三值映射：体检发现的严重度 → 契约状态。
// P0/P1 = FAIL（必须处理），P2 = WARN（该看），INFO = PASS（提示，不阻塞）。
// 被退役的（误报记档）算 PASS —— 它已被显式豁免，不该继续阻塞 CI。
// 2026-11-17 竞品分析 P4：**skip ≠ pass**（RFC #1846 / dsh-plugin-doctor SPEC §1.1）。
// 修前 INFO 一律 PASS，于是「取不到证据」的 UNKNOWN（如 R11 未发现成本记账文件、
// R21e 未安装无法判断）被报成了通过——与它自己「不猜」的立场自相矛盾。
function statusOf(f) {
  if (f.advisory === true) return 'PASS';
  // 退役 = 显式豁免，但不能把「严重问题被误记档」也变成绿灯：
  // P0/P1 退役后降为 WARN（可见、不阻塞），P2/INFO 才是 PASS。
  if (f.retired) return (f.severity === 'P0' || f.severity === 'P1') ? 'WARN' : 'PASS';
  if (f.severity === 'P0' || f.severity === 'P1') return 'FAIL';
  if (f.severity === 'P2') return 'WARN';
  return f.confidence === 'UNKNOWN' ? 'WARN' : 'PASS';
}

export function buildChecks(result, opts) {
  const o = opts || {};
  const checks = [];
  for (const f of result.allFindings || []) {
    const st = statusOf(f);
    checks.push({
      name: f.title || (f.ruleId + ' ' + f.fp),
      status: st,
      detail: f.fixHint ? (f.ruleId + ' · ' + f.fixHint) : (f.ruleId + ' · ' + (f.confidence || 'MEASURED')),
      id: f.ruleId,
      group: f.dimension || 'general',
      severity: f.severity,
      fp: f.fp,
      critical: f.severity === 'P0',
      retired: !!f.retired,
    });
  }
  // 能力域矩阵：多实现/冲突/失效算 WARN，无实现算 PASS（缺能力不等于不健康）
  try {
    const mx = buildMatrix(result.facts);
    for (const r of mx.rows) {
      if (r.status === 'present') continue;
      // unknown 同样不许当 PASS（见上）：判不了就是判不了。
      const st = (r.status === 'conflicting' || r.status === 'redundant' || r.status === 'degraded' || r.status === 'unknown') ? 'WARN' : 'PASS';
      checks.push({
        name: '能力域 ' + r.label + '：' + (r.detail || r.status),
        status: st,
        detail: '能力域状态 ' + r.status,
        id: 'CAP-' + r.key.toUpperCase(),
        group: 'capabilities',
        severity: 'INFO',
        fp: 'CAP#' + r.key,
        critical: false,
        retired: false,
        // 能力域是「这台机器装了什么」的结构性事实，不是回归信号：
        // 装得丰富就会有冗余/未知，拿它当门禁条件等于让丰富的安装永远红。
        gating: false,
      });
    }
  } catch (e) { /* 能力域取不到就只报体检发现 */ }
  return checks;
}

// 有序修法清单（opt-in）：优先用 plan（attribution）的行序，其余按严重度补齐。
// 竞品 @moonquake2004/dsh-doctor 的做法：字段 opt-in、缺席时完全不存在，老消费者 byte-stable。
export function buildRemediation(result, opts) {
  const o = opts || {};
  const byFp = new Map();
  (result.allFindings || []).forEach(function (f) { byFp.set(f.fp, f); });
  const seen = new Set();
  const out = [];
  const attr = result.attribution;
  const rows = (attr && Array.isArray(attr.rows)) ? attr.rows : [];
  rows.forEach(function (r) {
    const f = byFp.get(r.fp);
    if (!f || !f.fixHint || seen.has(f.fp)) return;
    seen.add(f.fp);
    out.push('[' + f.ruleId + '] ' + String(f.fixHint));
  });
  const ORDER = { P0: 0, P1: 1, P2: 2, INFO: 3 };
  (result.findings || []).slice()
    .sort(function (a, b) { return (ORDER[a.severity] === undefined ? 9 : ORDER[a.severity]) - (ORDER[b.severity] === undefined ? 9 : ORDER[b.severity]); })
    .forEach(function (f) {
      if (!f.fixHint || seen.has(f.fp) || f.advisory === true) return;
      seen.add(f.fp);
      out.push('[' + f.ruleId + '] ' + String(f.fixHint));
    });
  return out.slice(0, Number.isFinite(o.limit) ? o.limit : 20);
}

// 三值契约信封：字段与 doctor 的 --format check 对齐。
export function buildCheckEnvelope(result, opts) {
  const o = opts || {};
  const checks = buildChecks(result, o);
  const fail = checks.filter((c) => c.status === 'FAIL');
  const warn = checks.filter((c) => c.status === 'WARN');
  const criticalFail = fail.some((c) => c.critical);
  const pass = checks.filter((c) => c.status === 'PASS');
  // 退出码：0 全过 / 1 有 WARN / 2 有 FAIL。critical FAIL 也归 2。
  const exit = fail.length ? 2 : (warn.length ? 1 : 0);
  const env = {
    ok: exit === 0,
    // 2026-11-17 P4：信封层补上 doctor 的顶层字段名。条目层本来就同形（name/status/detail），
    // 但信封层 doctor 用 exitCode/schema/generatedAt/profile，我们只有 contract/doctor.exit，
    // 于是一个只为 doctor 写的消费者读不到退出码——「同一套 CI 可消费」这句因此在信封层不成立。
    schema: 'dsh-healthkit/check/v1',
    contract: 'dsh-healthkit/check/v1',
    generatedAt: new Date().toISOString(),
    profile: (result.facts && result.facts.profiles && result.facts.profiles[0] && result.facts.profiles[0].name) || null,
    exitCode: exit,
    summary: { pass: pass.length, warn: warn.length, fail: fail.length, total: checks.length },
    checks,
    doctor: {
      version: o.version || null,
      exit: exit,
      skipped: 0,
      criticalFail: criticalFail,
      degraded: [],
      approximated: false,
    },
    target: {
      name: 'dsh-healthkit',
      version: o.version || null,
      score: result.score ? result.score.total : null,
      band: result.score ? result.score.band : null,
      p0: result.score ? result.score.p0Open : null,
    },
  };
  if (o.remediation === true) env.remediation = buildRemediation(result, o);
  return env;
}

// ---- 基线门（P1，借 SonarQube 的「只对新代码设门」+ fudge factor）----
//
// 修前：`audit_check` 是**绝对状态门**——本机 9.81 分、P0=P1=0 的健康机器上仍然是
// PASS 22 / WARN 10 / FAIL 0、退出码 1。一道永远红的门只有两种命运：被人 `|| true` 掉，
// 或者被人把发现一条条 retire 掉（后者更糟，会把真问题一起静音）。
//
// 修后：只判「相对基线新增 + 回归」；新增少于 3 条 WARN 时不下判（fudge）；新增 FAIL 永远不被放过。
export const GATE_FUDGE_MIN = 3;

export function buildGateEnvelope(result, opts) {
  const o = opts || {};
  const env = buildCheckEnvelope(result, o);
  const baseline = o.baseline;
  if (!baseline || !Array.isArray(baseline.fps)) {
    env.mode = 'absolute';
    env.note = '没有基线快照：本次按绝对状态判定（老行为）。跑一次 audit_run 记账后即启用基线门。';
    return env;
  }
  // 退役指纹并入基线：退役不等于修好，但也不该每轮都被算成「新增」去卡 CI。
  const base = new Set(baseline.fps.concat(Array.isArray(baseline.retired) ? baseline.retired : []));
  // 给每条 check 标 fresh：调用方（CLI/工具）要用它只列「新增」的那几条。
  env.checks.forEach(function (c) { c.fresh = !base.has(c.fp); });
  const fresh = env.checks.filter(function (c) { return c.fresh; });
  const gatingFresh = fresh.filter(function (c) { return c.gating !== false; });
  const newFail = gatingFresh.filter(function (c) { return c.status === 'FAIL'; });
  const newWarn = gatingFresh.filter(function (c) { return c.status === 'WARN'; });
  let exit = 0;
  let fudged = false;
  if (newFail.length) exit = 2;
  else if (newWarn.length >= GATE_FUDGE_MIN) exit = 1;
  else if (newWarn.length) { exit = 0; fudged = true; }

  env.mode = 'gate';
  env.baselineAt = baseline.at || null;
  env.baselineScore = typeof baseline.score === 'number' ? baseline.score : null;
  env.newFail = newFail.length;
  env.newWarn = newWarn.length;
  // 存量 = 参与门禁但已在基线里的；结构事实（能力域）单列，别混成「存量」。
  env.suppressed = env.checks.filter(function (c) { return c.gating !== false && !c.fresh; }).length;
  env.structural = env.checks.filter(function (c) { return c.gating === false; }).length;
  env.fudged = fudged;
  env.exitCode = exit;
  env.doctor.exit = exit;
  env.ok = exit === 0;
  env.summary = { pass: env.summary.pass, warn: newWarn.length, fail: newFail.length, total: gatingFresh.length };
  env.note = (newFail.length === 0 && newWarn.length === 0)
    ? '相对基线没有新增问题；' + env.suppressed + ' 条存量与 ' + env.structural + ' 条能力域结构事实不计入门。'
    : fudged
    ? '本次新增 ' + newWarn.length + ' 条 WARN（少于 ' + GATE_FUDGE_MIN + ' 条），按 fudge 口径不下判；新增 FAIL 永不放过。'
    : (exit === 0 ? '相对基线没有新增问题；' + env.suppressed + ' 条存量不计入门。' : '相对基线有新增问题。');
  return env;
}

// 全量 JSON 报告：给「要读全部细节」的消费方（不是 CI 门）。
export function buildJsonReport(result, opts) {
  const o = opts || {};
  const sc = result.score || {};
  const at = result.attribution || {};
  return {
    schema: 'dsh-healthkit/report/v1',
    generatedAt: new Date().toISOString(),
    version: o.version || null,
    scenario: sc.scenario || 'general',
    rubric: sc.rubricVersion || null,
    score: {
      total: sc.total, raw: sc.raw, band: sc.band,
      capReason: sc.capReason || null, p0Open: sc.p0Open || 0,
      dimensions: (sc.dims || []).map((d) => ({
        key: d.key, label: d.label, weight: d.weight, score: d.score,
        count: d.count, cappedBy: d.cappedBy || null,
      })),
    },
    findings: (result.allFindings || []).map((f) => ({
      fp: f.fp, ruleId: f.ruleId, severity: f.severity, dimension: f.dimension || '',
      title: f.title || '', target: f.target || '', confidence: f.confidence || 'MEASURED',
      advisory: f.advisory === true, retired: !!f.retired,
      evidence: f.evidence || [], measured: f.measured || {}, fixHint: f.fixHint || null,
    })),
    plan: {
      base: typeof at.stage2Base === 'number' ? at.stage2Base : sc.total,
      potentialAll: typeof at.potentialAll === 'number' ? at.potentialAll : sc.total,
      stage1: at.stage1 || null,
      rows: at.rows || [],
    },
    capabilities: (() => {
      try {
        const mx = buildMatrix(result.facts);
        return { byStatus: mx.byStatus, rows: mx.rows };
      } catch (e) { return null; }
    })(),
    self: result.self || null,
  };
}
