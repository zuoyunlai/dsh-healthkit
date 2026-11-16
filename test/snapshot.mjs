// 快照与跨次差异归因：写基线、比新增/修好/退役。
// 关键语义：「消失」不等于「修好了」——被退役记档的也要算消失，但必须单独列。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-snap-'));
process.env.DSH_HOME = home;

const { writeRun, listRuns, loadRun, loadRunByFile, diffRuns, renderDiff, latestRun } = await import('../src/snapshot.mjs');

function mkResult(fps, score, retired) {
  return {
    score: { total: score, raw: score, band: '可用', scenario: 'general' },
    findings: fps.map(function (fp) {
      const sev = fp.startsWith('R0') ? 'P0' : fp.startsWith('R1') ? 'P1' : 'P2';
      return { fp: fp, ruleId: fp.split('#')[0], severity: sev, dimension: 'consistency', title: '问题 ' + fp, advisory: false, fixHint: null };
    }),
    retired: (retired || []).map(function (fp) { return { fp: fp, ruleId: fp.split('#')[0], severity: 'P1', title: '问题 ' + fp }; }),
  };
}

// 第一次：写基线
// 显式给两次写入不同的 at：CI（快机器）上两次 fs 写入可能落在同一毫秒，
// 那样 listRuns 的顺序与 loadRun(stamp) 都会指向同一份，diff 变成空差（v0.12.0 的 ci 就是这么挂的）。
const T0 = 1763300000000;
const p1 = writeRun(mkResult(['R1#a', 'R11', 'R13'], 8.0), { home: home, scenario: 'general', version: 't', at: T0 });
assert.ok(p1 && fs.existsSync(p1), '快照应落盘');
assert.equal(listRuns(home).length, 1);

// 第二次：R1#a 修好了（消失），R14 新增，R11 被退役记档。
// 注意被退役的问题**不在 findings 里**——engine.audit() 已经把它挪进 retired 了。
writeRun(mkResult(['R13', 'R14'], 8.5, ['R11']), { home: home, scenario: 'general', version: 't', at: T0 + 1000 });
assert.equal(listRuns(home).length, 2);

const runs = listRuns(home);
const prev = loadRun(home, runs[0].stamp);
const cur = loadRun(home, runs[1].stamp);
const d = diffRuns(prev, cur);

assert.deepEqual(d.added.map(function (f) { return f.fp; }), ['R14'], '新增应是 R14');
assert.deepEqual(d.fixed.map(function (f) { return f.fp; }), ['R1#a'], '真修好应是 R1#a');
assert.deepEqual(d.newlyRetired.map(function (f) { return f.fp; }), ['R11'], 'R11 是被退役，不算修好');
assert.equal(d.kept, 1, '持续存在的应有 1 条（R13）');
assert.equal(d.delta, 0.5);

// 关键性质：退役 ≠ 修好，两者必须分开计数
assert.ok(!d.fixed.some(function (f) { return f.fp === 'R11'; }), '被退役的不能算进 fixed');
assert.ok(d.newlyRetired.some(function (f) { return f.fp === 'R11'; }), '被退役的必须单列');

// 无基线时不能说「全部新增」
{
  const nb = diffRuns(null, { at: 'x', score: 9, findings: [{ fp: 'R1', severity: 'P1', title: 't' }], retired: [] });
  assert.equal(nb.added.length, 0, '没有基线时不得报「新增」');
  assert.equal(nb.noBaseline, true);
  assert.ok(renderDiff(nb).includes('基线'), '渲染应说明这是第一次');
}

// 渲染里三类要分开出现
const text = renderDiff(d);
assert.ok(text.includes('新增'), '应有新增段');
assert.ok(text.includes('已修好'), '应有已修好段');
assert.ok(text.includes('新退役'), '应有新退役段');

// latestRun 能排除指定快照（否则写完本次就拿自己当上次）
{
  const last = latestRun(home);
  const withoutLast = latestRun(home, last.stamp);
  assert.ok(withoutLast && withoutLast.stamp !== last.stamp, '应能排除指定快照');
}

// 同一毫秒内写两次：文件名会加 '-1' 后缀，字典序会把它排到前面。
// 排序必须按记录里的 at，不能按文件名——否则「上一次/下一次」反了。
{
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-snap2-'));
  const fixedAt = 1763300000000;
  writeRun(mkResult(['R1#a', 'R13'], 8.0), { home: home2, scenario: 'general', version: 't', at: fixedAt });
  writeRun(mkResult(['R13', 'R14'], 8.5), { home: home2, scenario: 'general', version: 't', at: fixedAt });
  const runs2 = listRuns(home2);
  assert.equal(runs2.length, 2, '同毫秒两次写应存两份');
  const d2 = diffRuns(loadRunByFile(home2, runs2[0].file), loadRunByFile(home2, runs2[1].file));
  assert.deepEqual(d2.added.map(function (f) { return f.fp; }), ['R14'], '同毫秒写入后顺序不能反');
  fs.rmSync(home2, { recursive: true, force: true });
}

fs.rmSync(home, { recursive: true, force: true });
console.log('snapshot: 通过（写基线 · 新增/修好/退役三分 · 无基线不误报 · 同毫秒不乱序）');
