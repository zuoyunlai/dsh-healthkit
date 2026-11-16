// 跨重启自证（只读版 A）与跨次时间线。
//
// 定位（PLAN §11 的「跨重启闭环」在只读边界内的落地）：
//   用户改了配置 → 重启宿主 → 插件开机时自动比对「上次修的东西还在不在、有没有把别的东西搞坏」。
//   本模块**只报告**，绝不写配置——这与「只出命令不落盘」的既有立场一致（A 方案）。
//
// 两个概念要分清：
//   · pending-verify：上一次体检留下的「待验清单」（当时希望修好的那几条）。
//   · verify/last   ：本次开机跑出来的验回结果（修好了 / 没修好 / 回归了）。
//
// 为什么不能靠快照直接推：快照是「上一次体检的结果」，而用户可能没跑体检就改了配置；
// pending-verify 记录的是**待验目标**，验回时才有意义。

import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.mjs';
import { latestRun, listRuns, diffRuns, runsDir } from './snapshot.mjs';

export function verifyDir(home) {
  return path.join(dataDir(home), 'verify');
}

export function pendingPath(home) {
  return path.join(dataDir(home), 'pending-verify.json');
}

export function lastVerifyPath(home) {
  return path.join(verifyDir(home), 'last.json');
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}

function writeJson(p, obj) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    return true;
  } catch (e) { return false; }
}

// 记下「待验目标」：本次体检里那些看起来值得修、且修法明确的发现。
//
// 2026-11-17 产品审计 P2：原来只记 P0/P1，于是健康机器（P0/P1 归零）的待验清单恒为空，
// `audit_verify` 这张真正的护城河**在健康机器上永远没有对象可验**——而绝大多数机器是健康的。
// 现在补上「最多 3 条带修法的 P2」：低风险、可执行，正好是健康机器上唯一该动的东西。
export function writePending(result, opts) {
  const o = opts || {};
  try {
    const home = o.home;
    if (!home) return null;
    const findings = result.findings || [];
    const actionable = findings.filter((f) => f.fixHint && !f.advisory);
    const p0p1 = actionable.filter((f) => f.severity === 'P0' || f.severity === 'P1');
    const p2 = actionable.filter((f) => f.severity === 'P2').slice(0, 3);
    const targets = p0p1.concat(p2)
      .slice(0, 12)
      .map((f) => ({ fp: f.fp, ruleId: f.ruleId, severity: f.severity, title: f.title || '', fixHint: f.fixHint }));
    const rec = {
      at: new Date().toISOString(),
      score: result.score ? result.score.total : null,
      targets,
      note: targets.length
        ? '这些是上次体检认为该修的。重启后本插件会回来核对：修好了没、有没有把别的东西搞坏。'
        : '上次体检没有待验目标（没有带修法的 P0/P1/P2）。',
    };
    writeJson(pendingPath(home), rec);
    return rec;
  } catch (e) {
    return null;
  }
}

// 验回：拿待验清单与当前发现比对。
// 三种结局（对每条目标）：
//   fixed      —— 不再出现（且没被退役记档）→ 真修好了
//   stillThere —— 还在 → 没修或修法不对
//   muted      —— 不出现但被退役记档 → 被静音了，不算修好
// 外加「回归」：本次新出现的 P0/P1（相对上一次快照）。
// 架构审计 B3：启动验回的入参先问一句「有没有待验目标」。
// 没有的话整次全量体检（~1s / 1.2 万次系统调用）就是纯浪费——只换来一句「没有东西要验」。
export function hasPendingTargets(home) {
  const pending = readJson(pendingPath(home), null);
  return !!(pending && Array.isArray(pending.targets) && pending.targets.length > 0);
}

export function checkPending(result, opts) {
  const o = opts || {};
  const home = o.home;
  const pending = readJson(pendingPath(home), null);
  if (!pending || !Array.isArray(pending.targets) || !pending.targets.length) {
    return { hasPending: false, checked: [], fixed: [], stillThere: [], muted: [], regressions: [], note: '没有待验清单（上次体检没有带修法的 P0/P1，或还没跑过体检）。' };
  }
  const cur = {};
  (result.findings || []).forEach((f) => { cur[f.fp] = f; });
  const retired = {};
  (result.retired || []).forEach((f) => { retired[f.fp] = f; });

  const checked = [];
  const fixed = [];
  const stillThere = [];
  const muted = [];
  for (const t of pending.targets) {
    let status;
    if (cur[t.fp]) status = 'stillThere';
    else if (retired[t.fp]) status = 'muted';
    else status = 'fixed';
    const row = { fp: t.fp, ruleId: t.ruleId, severity: t.severity, title: t.title, status: status };
    checked.push(row);
    if (status === 'fixed') fixed.push(row);
    else if (status === 'muted') muted.push(row);
    else stillThere.push(row);
  }

  // 回归：相对**上一次快照**新出现的 P0/P1（本次体检结果 vs 上次快照）
  let regressions = [];
  try {
    const prev = latestRun(home);
    if (prev) {
      const d = diffRuns(prev, {
        at: new Date().toISOString(),
        score: result.score ? result.score.total : null,
        findings: (result.findings || []).map((f) => ({ fp: f.fp, ruleId: f.ruleId, severity: f.severity, title: f.title || '' })),
        retired: (result.retired || []).map((f) => f.fp),
      });
      regressions = d.added.filter((f) => f.severity === 'P0' || f.severity === 'P1');
    }
  } catch (e) { regressions = []; }

  const rec = {
    hasPending: true,
    at: new Date().toISOString(),
    pendingAt: pending.at,
    pendingScore: pending.score,
    score: result.score ? result.score.total : null,
    checked, fixed, stillThere, muted,
    regressions,
    note: '只报告，不改配置：fixed=真修好，muted=被退役记档（不算修好），stillThere=还在，regressions=本次新冒出来的 P0/P1。',
  };
  writeJson(lastVerifyPath(home), rec);
  return rec;
}

// 开机自检：宿主每次启动都会调 apply()，这里顺便做一次验回。
// 失败不许影响插件加载——它是「体检器自己的额外能力」，不是插件能不能用的前提。
export function startupVerify(result, opts) {
  try {
    return checkPending(result, opts);
  } catch (e) {
    return { hasPending: false, checked: [], fixed: [], stillThere: [], muted: [], regressions: [], error: String((e && e.message) || e) };
  }
}

export function readLastVerify(home) {
  return readJson(lastVerifyPath(home), null);
}

// 时间线：把最近 N 次快照串成一条线，每点标出「这次相对上次变了什么」。
export function timeline(home, limit) {
  const n = Math.max(2, Math.min(30, Number(limit) || 12));
  const runs = listRuns(home).slice(-n);
  const out = [];
  for (let i = 1; i < runs.length; i++) {
    // C4：目录布局只有一个真源（snapshot.runsDir），别再手写 '..' 穿越。
    const prev = readJson(path.join(runsDir(home), runs[i - 1].file), null);
    const cur = readJson(path.join(runsDir(home), runs[i].file), null);
    if (!prev || !cur) continue;
    const d = diffRuns(prev, cur);
    out.push({
      at: cur.at,
      score: cur.score,
      delta: typeof d.delta === 'number' ? d.delta : null,
      added: d.added.length,
      fixed: d.fixed.length,
      muted: d.newlyRetired.length,
      kept: d.kept,
      addedItems: d.added.slice(0, 3).map((f) => ({ ruleId: f.ruleId, severity: f.severity, title: f.title || '' })),
      fixedItems: d.fixed.slice(0, 3).map((f) => ({ ruleId: f.ruleId, severity: f.severity, title: f.title || '' })),
    });
  }
  return out;
}
