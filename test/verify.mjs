// 跨重启验回与跨次时间线。
//
// 关键语义：
//   · 待验清单只收「带修法的 P0/P1」——没有修法的目标没法验。
//   · 三种结局必须分清：fixed=真修好、muted=被退役记档（**不算修好**）、stillThere=还在。
//   · 时间线按快照的 at 排序（不是文件名）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-verify-'));
process.env.DSH_HOME = home;

const { writePending, checkPending, readLastVerify, timeline } = await import('../src/verify.mjs');
const { writeRun } = await import('../src/snapshot.mjs');

function mk(findings, retired, score) {
  return {
    score: { total: score, raw: score, band: 'x', scenario: 'general' },
    findings,
    retired: retired || [],
  };
}
const F = (fp, sev, fix) => ({ fp, ruleId: fp.split('#')[0], severity: sev || 'P1', dimension: 'consistency', title: '问题 ' + fp, fixHint: fix || null, advisory: false });

// 1) 待验清单：带修法的 P0/P1 全收，另外最多补 3 条带修法的 P2
//
// 2026-11-17 产品审计 P2 改了判据：原来只收 P0/P1，于是健康机器（P0/P1 归零）的清单恒空，
// audit_verify 在健康机器上永远没有对象可验——而那才是绝大多数机器。
{
  const p = writePending(mk([F('R1#a', 'P1', '修法A'), F('R2#b', 'P0', '修法B'), F('R3#c', 'P2', '修法C'), F('R4#d', 'P1', null), F('R5#e', 'P1', '修法E')], [], 8), { home });
  assert.ok(p, '应写出待验清单');
  // P0/P1 带修法：R1#a、R2#b、R5#e（R4#d 没修法）；外加 P2 带修法：R3#c
  assert.equal(p.targets.length, 4, '应为 P0/P1 三条 + P2 一条，实得 ' + p.targets.length);
  assert.ok(p.targets.every((x) => x.fixHint), '每条目标都该带修法');
  assert.equal(p.targets.filter((x) => x.severity === 'P2').length, 1, 'P2 应只补 1 条（本例只有 1 条带修法）');
}

// 2) 验回三分：fixed / muted / stillThere
{
  // R1#a 修好了（不在 findings 里也没退役）；R2#b 被静音（在 retired 里）；R5#e 还在。
  // R3#c（P2）也进了待验清单并且不在本次 findings 里 ⇒ 同样算真修好，
  // 这是 2026-11-17 产品审计 P2 之后的新口径：P2 也能被验回。
  const v = checkPending(mk([F('R5#e', 'P1', '修法E')], [{ fp: 'R2#b', ruleId: 'R2', severity: 'P0', title: '被静音' }], 9), { home });
  assert.equal(v.hasPending, true);
  assert.equal(v.fixed.length, 2, '真修好应是 2 条（R1#a + R3#c P2），实得 ' + v.fixed.length);
  assert.ok(v.fixed.some((x) => x.fp === 'R1#a'), 'P1 修好要算进去');
  assert.ok(v.fixed.some((x) => x.fp === 'R3#c'), 'P2 修好也要算进去');
  assert.equal(v.muted.length, 1, '被静音应是 1 条');
  assert.equal(v.muted[0].fp, 'R2#b');
  assert.equal(v.stillThere.length, 1, '还在应是 1 条');
  assert.equal(v.stillThere[0].fp, 'R5#e');
  // 被静音的不许混进 fixed
  assert.ok(!v.fixed.some((x) => x.fp === 'R2#b'), '被静音的不算修好');
  // 验回结果落盘
  const last = readLastVerify(home);
  assert.ok(last, '验回结果应落盘');
  assert.equal(last.fixed.length, 2);
}

// 3) 没有待验清单时明说，不假装有
{
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-verify2-'));
  const v = checkPending(mk([], [], 10), { home: empty });
  assert.equal(v.hasPending, false);
  assert.ok(v.note, '应说明为什么没有待验清单');
}

// 4) 时间线：两次快照之间的新增/修好/被静音
{
  const h2 = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-tl-'));
  writeRun(mk([F('R1#a'), F('R2#b')], [], 8.0), { home: h2, scenario: 'general', version: 't', at: 1763300000000 });
  writeRun(mk([F('R2#b'), F('R3#c')], [], 8.5), { home: h2, scenario: 'general', version: 't', at: 1763300100000 });
  const tl = timeline(h2, 10);
  assert.equal(tl.length, 1, '两次快照应得 1 段时间线，实得 ' + tl.length);
  assert.equal(tl[0].added, 1, '新增 1 条');
  assert.equal(tl[0].fixed, 1, '真修好 1 条');
  assert.equal(tl[0].muted, 0);
  fs.rmSync(h2, { recursive: true, force: true });
}

fs.rmSync(home, { recursive: true, force: true });
// 1b) P2 最多补 3 条，不喧宾夺主
{
  const many = [];
  for (let i = 0; i < 6; i++) many.push(F('R9#' + i, 'P2', '修法' + i));
  const p2 = writePending(mk(many, [], 9), { home });
  assert.equal(p2.targets.length, 3, 'P2 最多补 3 条，实得 ' + p2.targets.length);
}

// 1c) 健康机器（只有 P2）也要有活干
{
  const only = writePending(mk([F('R10#x', 'P2', '开通 allowlist')], [], 9.8), { home });
  assert.equal(only.targets.length, 1, '只有 P2 时也应给出待验目标');
}


// 1d) 2026-11-20 反哺 P3：「不出现」不只一种原因。
// fixed 只该给「对象仍在被检查、判据不再命中」的那条；profile 读不出与对象不存在必须分开。
{
  const h3 = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-verify3-'));
  const withMeta = [
    { fp: 'R24#web', ruleId: 'R24', severity: 'P0', dimension: 'consistency', title: 'profile 读不出', fixHint: '修 package.json', advisory: false, measured: { profile: 'web' }, evidence: [path.join(h3, 'profiles', 'web', 'package.json')] },
    { fp: 'R1#old', ruleId: 'R1', severity: 'P1', dimension: 'consistency', title: '旧包的依赖未启用', fixHint: '确认是否还需要', advisory: false, measured: { profile: 'old' }, evidence: [path.join(h3, 'profiles', 'old', 'package.json')] },
    { fp: 'R4#gone', ruleId: 'R4', severity: 'P2', dimension: 'disk', title: '目录已删', fixHint: '清理', advisory: false, evidence: [path.join(h3, 'no-such-dir')] },
    { fp: 'R3#fine', ruleId: 'R3', severity: 'P1', dimension: 'consistency', title: '真修好的', fixHint: '重装', advisory: false },
  ];
  writePending({ score: { total: 8 }, findings: withMeta, retired: [] }, { home: h3 });
  const res = {
    score: { total: 9 },
    findings: [],
    retired: [],
    facts: { profileErrors: [{ name: 'web', reason: 'parse-error' }], profiles: [{ name: 'desktop' }] },
  };
  const v = checkPending(res, { home: h3 });
  assert.equal(v.unverifiable.length, 1, 'profile 读不出时该记「无法复核」，实得 ' + v.unverifiable.length);
  assert.equal(v.unverifiable[0].fp, 'R24#web');
  assert.equal(v.notApplicable.length, 2, 'profile 消失 / 证据不存在都该记「已不适用」，实得 ' + v.notApplicable.length);
  assert.ok(v.notApplicable.some((x) => x.fp === 'R1#old'), 'profile 已不在被检列表 → 已不适用');
  assert.ok(v.notApplicable.some((x) => x.fp === 'R4#gone'), '证据路径不存在 → 已不适用');
  assert.equal(v.fixed.length, 1, '只有对象仍被检查的那条才算真修好');
  assert.equal(v.fixed[0].fp, 'R3#fine');
  assert.match(v.note, /unverifiable/, 'note 要写清新状态的含义');
  fs.rmSync(h3, { recursive: true, force: true });
}

console.log('verify: 通过（待验清单筛选 · fixed/muted/stillThere/unverifiable/notApplicable 五分 · 时间线）');
