// 产品指标守卫（产品审计 §5 的指标 2/3 + 误报率）。
//
// 产品审计的原话：「第二次运行率 / 结论采纳率——能力在、数据没有」。
// 这个模块把它们算出来，但硬约束是**算不出来就说算不出来**，
// 不许用老记录（没有 source 字段的账本行）冒充「用户回来跑过」。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-metrics-'));
const dataDir = path.join(home, 'dsh-healthkit');
fs.mkdirSync(path.join(dataDir, 'verify'), { recursive: true });

const { productMetrics, renderMetrics } = await import('../src/metrics.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}
const writeHistory = (rows) => fs.writeFileSync(path.join(dataDir, 'history.jsonl'),
  rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

// ① 空账本：两项都必须说「算不出来」，不许编
let m = productMetrics(home, { findingsCount: 17 });
ok('空账本时第二次运行应为 null', m.secondRun.returnedAfter7d === null);
ok('空账本要给出原因', /source/.test(m.secondRun.reason || ''), m.secondRun.reason);
ok('无验回时采纳率应为 null', m.adoption.rate === null);
ok('无验回要说明怎么才会有', /重启|audit_verify/.test(m.adoption.note || ''), m.adoption.note);
ok('误报率可算（3/20=15%）', true); // 下面用真实数据断言

// ② 只有 agent 来源：不算「有效运行」
writeHistory([
  { at: '2026-11-17T01:00:00.000Z', day: '2026-11-17', total: 9.8, source: 'agent' },
  { at: '2026-11-18T01:00:00.000Z', day: '2026-11-18', total: 9.8, source: 'agent' },
]);
m = productMetrics(home, { findingsCount: 17 });
ok('agent 跑的不算有效运行', m.secondRun.effectiveRuns === 0, String(m.secondRun.effectiveRuns));
ok('agent 跑的不许让第二次运行变成「是」', m.secondRun.returnedAfter7d === null);

// ③ 跨 10 天的有效运行（human + automation）→ 第二次运行为真
writeHistory([
  { at: '2026-11-10T01:00:00.000Z', day: '2026-11-10', total: 9.0, source: 'human' },
  { at: '2026-11-15T01:00:00.000Z', day: '2026-11-15', total: 9.4, source: 'automation' },
  { at: '2026-11-20T01:00:00.000Z', day: '2026-11-20', total: 9.8, source: 'human' },
  { at: '2026-11-20T02:00:00.000Z', day: '2026-11-20', total: 9.8, source: 'agent' },
  { at: '2026-11-09T01:00:00.000Z', day: '2026-11-09', total: 8.6 }, // 老记录：没有 source
]);
m = productMetrics(home, { findingsCount: 17 });
ok('有效运行只数 human+automation（3 次）', m.secondRun.effectiveRuns === 3, String(m.secondRun.effectiveRuns));
ok('老记录单独统计', m.secondRun.legacyRuns === 1, String(m.secondRun.legacyRuns));
ok('跨 10 天 ⇒ 第二次运行 = 是', m.secondRun.returnedAfter7d === true, JSON.stringify(m.secondRun));
ok('跨度应为 10 天', m.secondRun.spanDays === 10, String(m.secondRun.spanDays));

// ④ 采纳率：静音的绝不算采纳
fs.writeFileSync(path.join(dataDir, 'verify', 'last.json'), JSON.stringify({
  at: '2026-11-17T02:00:00.000Z',
  checked: [{ fp: 'a' }, { fp: 'b' }, { fp: 'c' }],
  fixed: [{ fp: 'a' }, { fp: 'b' }],
  stillThere: [{ fp: 'c' }],
  muted: [{ fp: 'd' }, { fp: 'e' }, { fp: 'f' }],
  regressions: [],
}), 'utf8');
fs.writeFileSync(path.join(dataDir, 'retirements.json'), JSON.stringify({ 'x#1': {}, 'y#2': {}, 'z#3': {} }), 'utf8');
m = productMetrics(home, { findingsCount: 17 });
ok('采纳率 = 2/(2+1) = 66.7', m.adoption.rate === 66.7, String(m.adoption.rate));
ok('静音条数单独报', m.adoption.muted === 3, String(m.adoption.muted));
ok('误报率 = 3/(17+3) = 15', m.falsePositive.rate === 15, String(m.falsePositive.rate));

// ⑤ 文案：算不出来时不许出现百分比
fs.rmSync(path.join(dataDir, 'verify', 'last.json'));
fs.rmSync(path.join(dataDir, 'history.jsonl'));
const empty = renderMetrics(productMetrics(home, { findingsCount: 17 }));
ok('空数据文案里不许编采纳率', !/采纳率：[\d.]+%/.test(empty), empty);
ok('空数据文案要出现「算不出来」', (empty.match(/算不出来/g) || []).length >= 2, empty);

fs.rmSync(home, { recursive: true, force: true });
console.log('metrics: 通过（' + n + ' 项断言 · 有效运行口径 / 静音不算采纳 / 误报率 / 不编数）');
