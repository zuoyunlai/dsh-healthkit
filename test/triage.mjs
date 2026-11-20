import assert from 'node:assert/strict';
import { detectSymptom, triage, SYMPTOMS } from '../src/triage.mjs';

// 症状识别：中文口语 → 已知症状 id；认不出要如实说认不出，不能猜一个最像的。
assert.equal(detectSymptom('升级后工具不见了'), 'plugin-gone');
assert.equal(detectSymptom('DSH 起不来'), 'boot-fail');
assert.equal(detectSymptom('装了没生效'), 'not-loaded');
assert.equal(detectSymptom('每轮都好慢，token 吃太多'), 'context-heavy');
assert.equal(detectSymptom('磁盘越来越大'), 'disk');
assert.equal(detectSymptom(''), null);
assert.equal(detectSymptom('今天天气不错'), null);

const result = {
  findings: [
    { ruleId: 'R14', severity: 'P1', title: '装载日志出现 stand-in module', fp: 'R14', confidence: 'MEASURED' },
    { ruleId: 'R23', severity: 'P0', title: 'bundle 未声明 dsh.bundle', fp: 'R23#x', confidence: 'MEASURED' },
    { ruleId: 'R17', severity: 'INFO', title: '大目录', fp: 'R17#sessions', confidence: 'MEASURED' },
  ],
};

const t = triage(result, { symptom: '工具消失' });
assert.equal(t.known, true);
assert.deepEqual(t.matched.map((x) => x.ruleId), ['R14', 'R23'], '只列该症状相关的规则');
assert.ok(t.summary.includes('下一步'));
assert.ok(t.steps.length >= 2);

// 症状存在但本次没命中：必须区分「没命中」与「没问题」
const t2 = triage({ findings: [] }, { symptom: '起不来' });
assert.equal(t2.known, true);
assert.equal(t2.matched.length, 0);
assert.match(t2.summary, /不等于没问题/);

// 认不出：给可用清单，不虚构结论
const t3 = triage(result, { symptom: '玄学问题' });
assert.equal(t3.known, false);
assert.match(t3.summary, /plugin-gone/);

// 每个症状都要有可执行下一步，且检查项必须是非空规则号
for (const id of Object.keys(SYMPTOMS)) {
  const s = SYMPTOMS[id];
  assert.ok(s.label && s.keywords.length && s.steps.length >= 2, id + ' 缺 label/keywords/steps');
  assert.ok(s.checks.every((x) => /^R\d/.test(x)), id + ' 的 checks 必须是规则号');
}

console.log('triage: 通过（症状识别 / 命中过滤 / 未命中不等于没问题 / 未知症状不猜）');
