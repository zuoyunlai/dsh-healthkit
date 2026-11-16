// 三个「解释型」工具的形状与行为：能在真机上取到数，且空参/错参不崩。
import assert from 'node:assert/strict';
import { buildTools } from '../index.js';

const byName = {};
for (const t of buildTools({})) byName[t.name] = t;

assert.ok(byName.audit_findings, 'audit_findings 缺');
assert.ok(byName.audit_explain, 'audit_explain 缺');
assert.ok(byName.audit_plan, 'audit_plan 缺');
assert.ok(byName.audit_trim, 'audit_trim 缺');

// 每个工具都必须声明 output.schema 与 render（宿主硬要求）
for (const n of ['audit_findings', 'audit_explain', 'audit_plan', 'audit_trim']) {
  assert.ok(byName[n].output && byName[n].output.schema, n + ' 缺 output.schema');
  assert.equal(typeof byName[n].output.render, 'function', n + ' 缺 output.render');
}

const f = await byName.audit_findings.execute({ limit: 5 });
assert.ok(f.total > 0, '应能取到问题');
assert.ok(f.items.length <= 5);
assert.equal(typeof f.p0, 'number');
for (const it of f.items) assert.ok(it.fp && it.ruleId && it.severity, '条目缺字段');

const e = await byName.audit_explain.execute({ finding: f.items[0].fp });
assert.equal(e.found, true, '按 fp 应能解释');
assert.ok(e.summary.includes(e.ruleId));

const e2 = await byName.audit_explain.execute({});
assert.equal(e2.found, false, '空参不应假装找到');
assert.ok(Array.isArray(e2.candidates) && e2.candidates.length > 0, '空参应给候选');

const e3 = await byName.audit_explain.execute({ finding: 'NO_SUCH_FP' });
assert.equal(e3.found, false);

const p = await byName.audit_plan.execute({});
assert.ok(p.steps.length >= 2, '计划至少两步');
assert.equal(typeof p.base, 'number');
assert.equal(typeof p.potentialAll, 'number');
assert.ok(p.summary.includes('/10'));

const tm = await byName.audit_trim.execute({});
assert.ok(Array.isArray(tm.suggestions) && tm.suggestions.length > 0, 'trim 应给建议');
assert.equal(typeof tm.served, 'number');

console.log('tools-shape: 通过（findings ' + f.total + ' / plan base ' + p.base + ' → ' + p.potentialAll + ' / trim 建议 ' + tm.suggestions.length + ' 条）');
