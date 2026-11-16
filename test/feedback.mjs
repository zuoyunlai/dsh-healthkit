// 首次价值信号（产品审计 §5 指标 1）的守卫。
//
// 「首次运行是否产出了用户事前不知道的结论」是判断值不值得装的唯一真指标，
// 而它只能由用户回答。本模块的硬约束：**只记本机、不联网、不外发**；
// 同一条发现只保留最后一次回答；没回答过时不许在周报里占版面。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-feedback-'));
process.env.DSH_HOME = home;

const fb = await import('../src/feedback.mjs');
const { buildDigest } = await import('../src/weekly.mjs');
const { writeRun } = await import('../src/snapshot.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

// 1) 空态：不许编数字
const s0 = fb.stats(home);
ok('无反馈时 answered 应为 0', s0.answered === 0);
ok('无反馈时 firstValueRate 应为 null', s0.firstValueRate === null);
ok('空态文案要说清怎么用且说明不外发', /本机|不外发/.test(fb.renderStats(s0)));

// 2) 记录与统计
fb.append(home, { at: '2026-11-17T01:00:00.000Z', fp: 'R10#a', ruleId: 'R10', severity: 'P2', title: 't', known: false });
fb.append(home, { at: '2026-11-17T01:01:00.000Z', fp: 'R12#b', ruleId: 'R12', severity: 'P2', title: 't', known: true });
let s = fb.stats(home);
ok('两条回答 answered=2', s.answered === 2, JSON.stringify(s));
ok('unknown=1 known=1', s.unknown === 1 && s.known === 1);
ok('首次价值率 = 50%', s.firstValueRate === 50, String(s.firstValueRate));

// 3) 同一条发现改主意：只保留最后一次
fb.append(home, { at: '2026-11-17T01:02:00.000Z', fp: 'R10#a', ruleId: 'R10', severity: 'P2', title: 't', known: true });
s = fb.stats(home);
ok('同 fp 只计一次', s.answered === 2, JSON.stringify(s));
ok('改主意后 unknown 应为 0', s.unknown === 0, JSON.stringify(s));
ok('首次价值率随之为 0', s.firstValueRate === 0);

// 4) 落盘位置在插件自己的数据目录，不碰被检对象
ok('feedback.jsonl 落在 dsh-healthkit 数据目录', fb.feedbackPath(home).indexOf('dsh-healthkit') !== -1, fb.feedbackPath(home));

// 5) 周报只在有数据时带出这一行；且低价值率要点出来
const F = (ruleId, severity) => ({ ruleId, severity, dimension: 'disk', title: ruleId + ' 标题', fp: ruleId + '#1', evidence: [], measured: {}, fixHint: 'x' });
const result = { findings: [F('R10', 'P2')], retired: [], score: { total: 9.8, raw: 9.8, band: '良好', p0Open: 0 }, facts: { home } };
writeRun(result, { home, scenario: 'general', version: 't' });
const dg = buildDigest(result, { home });
ok('有反馈时周报要带首次价值信号', /首次价值信号/.test(dg.lines.join('\n')), dg.lines.join('\n'));
ok('反馈统计要随周报返回', dg.feedback && dg.feedback.answered === 2, JSON.stringify(dg.feedback));

// 清空后周报不该再出现这一行
fs.rmSync(fb.feedbackPath(home), { force: true });
const dg2 = buildDigest(result, { home });
ok('无反馈时周报不许出现这一行', !/首次价值信号/.test(dg2.lines.join('\n')));

fs.rmSync(home, { recursive: true, force: true });
console.log('feedback: 通过（' + n + ' 项断言 · 空态/统计/改主意/落点/周报联动）');
