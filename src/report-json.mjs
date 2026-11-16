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
function statusOf(f) {
  if (f.advisory === true) return 'PASS';
  if (f.retired) return 'PASS';
  if (f.severity === 'P0' || f.severity === 'P1') return 'FAIL';
  if (f.severity === 'P2') return 'WARN';
  return 'PASS';
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
      const st = (r.status === 'conflicting' || r.status === 'redundant' || r.status === 'degraded') ? 'WARN' : 'PASS';
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
      });
    }
  } catch (e) { /* 能力域取不到就只报体检发现 */ }
  return checks;
}

// 三值契约信封：字段与 doctor 的 --format check 对齐。
export function buildCheckEnvelope(result, opts) {
  const o = opts || {};
  const checks = buildChecks(result, o);
  const fail = checks.filter((c) => c.status === 'FAIL');
  const warn = checks.filter((c) => c.status === 'WARN');
  const criticalFail = fail.some((c) => c.critical);
  // 退出码：0 全过 / 1 有 WARN / 2 有 FAIL。critical FAIL 也归 2。
  const exit = fail.length ? 2 : (warn.length ? 1 : 0);
  return {
    ok: exit === 0,
    contract: 'dsh-healthkit/check/v1',
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
