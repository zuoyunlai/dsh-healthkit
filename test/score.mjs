// 评分数学直测（架构审计 B7）。
//
// 修前 `grep -rn "unknownDiscount|attribution|penalty|dimensionCaps" test/` 零命中：
// 罚分、UNKNOWN 折扣、dimensionCaps、P0 封顶、归因这五块**没有任何直接测试**——
// 而分数是这个插件唯一的对外承诺。这条文件把它们逐条钉住。
import assert from 'node:assert/strict';
import { score, validateRubric, attribution } from '../src/score.mjs';

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

// 最小 rubric：一个维度、权重 100，便于手算
function mkRubric(over) {
  return Object.assign({
    version: 'test',
    base: 10,
    dimensions: [{ key: 'd1', label: 'D1', weight: 100 }],
    penalty: { P0: 4, P1: 1.8, P2: 0.5 },
    unknownDiscount: 0.5,
    dimensionCaps: [],
    caps: [],
    bands: [{ min: 8.5, label: '良好' }, { min: 7, label: '可用' }, { min: 5, label: '需治理' }, { min: 0, label: '高风险' }],
    scenarios: {},
  }, over || {});
}
const f = (severity, over) => Object.assign({ ruleId: 'X1', dimension: 'd1', severity, title: 't', fp: 'X1#a' }, over || {});

// ① 罚分数学
ok('P2 ×1 应扣 0.5 → 9.5', score(mkRubric(), [f('P2')], 'general').total === 9.5);
ok('P1 ×1 应扣 1.8 → 8.2', score(mkRubric(), [f('P1')], 'general').total === 8.2);
ok('P2 ×4 应扣 2.0 → 8.0', score(mkRubric(), [f('P2'), f('P2'), f('P2'), f('P2')], 'general').total === 8);

// ② UNKNOWN 按名义严重度打折（V04 的口径）
ok('P1 UNKNOWN 应扣 0.9（名义 1.8 × 0.5）→ 9.1',
  score(mkRubric(), [f('P1', { confidence: 'UNKNOWN' })], 'general').total === 9.1);
ok('UNKNOWN 折扣必须比已证轻、但比 P2 重',
  score(mkRubric(), [f('P1', { confidence: 'UNKNOWN' })], 'general').total
    < score(mkRubric(), [f('P2')], 'general').total + 0.4);

// ③ dimensionCaps：条数到阈值就把该维度压到上限
const capped = score(mkRubric({ dimensionCaps: [{ findings: 3, max: 5.5 }] }), [f('P2'), f('P2'), f('P2')], 'general');
ok('dimensionCaps 3 条应把维度压到 5.5', capped.dims[0].score === 5.5, 'got ' + capped.dims[0].score);
ok('cappedBy 要写明触发阈值', capped.dims[0].cappedBy === 3);

// ④ P0 封顶
const p0 = score(mkRubric({ caps: [{ when: 'p0Open >= 1', max: 5, reason: '存在未关闭 P0' }] }), [f('P0')], 'general');
ok('有 P0 时总分封 5.0', p0.total === 5, 'got ' + p0.total);
ok('封顶原因必须写明', p0.capReason === '存在未关闭 P0');
ok('raw 必须是封顶前的分', p0.raw === 6, 'got ' + p0.raw);

// ⑤ 分档边界
ok('8.5 → 良好', score(mkRubric(), [f('P1', {})], 'general').band === '可用');
ok('9.5 → 良好', score(mkRubric(), [f('P2')], 'general').band === '良好');

// ⑥ 未知维度/未知严重度必须被记录，不许静默
const droppedDim = score(mkRubric(), [f('P2', { dimension: 'nope' })], 'general');
ok('未知维度要进 dropped.dimension', droppedDim.dropped.dimension.length === 1 && droppedDim.dropped.dimension[0] === 'X1');
const droppedSev = score(mkRubric(), [f('P9')], 'general');
ok('未知严重度要进 dropped.severity', droppedSev.dropped.severity.length === 1);

// ⑦ rubric 自检：能抓住「写错一个字就静默改分」的四类
ok('正常 rubric 自检应为空', validateRubric(mkRubric()).length === 0, JSON.stringify(validateRubric(mkRubric())));
ok('caps.when 拼错必须被抓',
  validateRubric(mkRubric({ caps: [{ when: 'p0Open>=1', max: 5 }] })).some((m) => /白名单/.test(m)));
ok('维度 key 重复必须被抓',
  validateRubric(mkRubric({ dimensions: [{ key: 'a', weight: 50 }, { key: 'a', weight: 50 }] })).some((m) => /重复/.test(m)));
ok('bands 未降序必须被抓',
  validateRubric(mkRubric({ bands: [{ min: 5, label: 'x' }, { min: 8, label: 'y' }] })).some((m) => /降序/.test(m)));
ok('penalty 缺 P0 必须被抓',
  validateRubric(mkRubric({ penalty: { P1: 1, P2: 0.5 } })).some((m) => /P0/.test(m)));
ok('dimensionCaps 非单调必须被抓',
  validateRubric(mkRubric({ dimensionCaps: [{ findings: 3, max: 3.5 }, { findings: 5, max: 5.5 }] })).some((m) => /单调/.test(m)));

// ⑧ 归因：P0 先解封顶，再算单条边际
const many = [f('P0', { ruleId: 'P0a', fp: 'P0a#1' }), f('P2', { ruleId: 'P2a', fp: 'P2a#1' }), f('P2', { ruleId: 'P2b', fp: 'P2b#1' })];
const sc = score(mkRubric({ caps: [{ when: 'p0Open >= 1', max: 5, reason: 'P0' }] }), many, 'general');
const at = attribution(mkRubric({ caps: [{ when: 'p0Open >= 1', max: 5, reason: 'P0' }] }), many, sc);
// 解掉唯一那条 P0 后：维度 10−0.5−0.5=9，封顶不再生效 ⇒ 5.0 → 9.0
ok('归因必须给出解封顶那一步（5.0 → 9.0）',
  at.stage1 && at.stage1.count === 1 && at.stage1.from === 5 && at.stage1.to === 9,
  JSON.stringify(at.stage1));
ok('归因的行必须是单条边际', Array.isArray(at.rows) && at.rows.length === 2);
ok('归因潜力分必须 ≥ 当前分', typeof at.potentialAll === 'number' && at.potentialAll >= sc.total);

console.log('score: 通过（' + n + ' 项断言 · 罚分/折扣/维度封顶/P0封顶/丢弃项/rubric自检/归因）');
