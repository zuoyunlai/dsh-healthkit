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

// 1) 待验清单只收带修法的 P0/P1
{
  const p = writePending(mk([F('R1#a', 'P1', '修法A'), F('R2#b', 'P0', '修法B'), F('R3#c', 'P2', '修法C'), F('R4#d', 'P1', null), F('R5#e', 'P1', '修法E')], [], 8), { home });
  assert.ok(p, '应写出待验清单');
  // 只收 P0/P1 且带修法的：R1#a、R2#b、R5#e（R3#c 是 P2；R4#d 没修法）
  assert.equal(p.targets.length, 3, '只应收 P0/P1 且带修法的，实得 ' + p.targets.length);
  assert.ok(p.targets.every((x) => x.fixHint), '每条目标都该带修法');
}

// 2) 验回三分：fixed / muted / stillThere
{
  // R1#a 修好了（不在 findings 里也没退役）；R2#b 被静音（在 retired 里）；R5#e 还在
  const v = checkPending(mk([F('R5#e', 'P1', '修法E')], [{ fp: 'R2#b', ruleId: 'R2', severity: 'P0', title: '被静音' }], 9), { home });
  assert.equal(v.hasPending, true);
  assert.equal(v.fixed.length, 1, '真修好应是 1 条');
  assert.equal(v.fixed[0].fp, 'R1#a');
  assert.equal(v.muted.length, 1, '被静音应是 1 条');
  assert.equal(v.muted[0].fp, 'R2#b');
  assert.equal(v.stillThere.length, 1, '还在应是 1 条');
  assert.equal(v.stillThere[0].fp, 'R5#e');
  // 被静音的不许混进 fixed
  assert.ok(!v.fixed.some((x) => x.fp === 'R2#b'), '被静音的不算修好');
  // 验回结果落盘
  const last = readLastVerify(home);
  assert.ok(last, '验回结果应落盘');
  assert.equal(last.fixed.length, 1);
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
console.log('verify: 通过（待验清单筛选 · fixed/muted/stillThere 三分 · 时间线）');
