// 三个「解释型」工具的形状与行为：能在真机上取到数，且空参/错参不崩。
import assert from 'node:assert/strict';
import { makeTempHome } from './testenv.mjs';

// 跑在临时 HOME 上：CI（ubuntu runner）没有 ~/.dsh，用真机必然红。
// 动态 import：静态 import 会在 DSH_HOME 设上之前完成模块求值。
process.env.DSH_HOME = makeTempHome('healthkit-shape-', true);

const { buildTools } = await import('../index.js');

const byName = {};
for (const t of buildTools({})) byName[t.name] = t;

assert.ok(byName.audit_findings, 'audit_findings 缺');
assert.ok(byName.audit_explain, 'audit_explain 缺');
assert.ok(byName.audit_plan, 'audit_plan 缺');
assert.ok(byName.audit_trim, 'audit_trim 缺');
assert.ok(byName.audit_capabilities, 'audit_capabilities 缺');
assert.ok(byName.audit_retire, 'audit_retire 缺');
assert.ok(byName.audit_diff, 'audit_diff 缺');
assert.ok(byName.audit_verify, 'audit_verify 缺');
assert.ok(byName.audit_check, 'audit_check 缺');
assert.ok(byName.audit_recommend, 'audit_recommend 缺');
// C3：原来漏了这四个（架构审计），输出形状没被钉住
assert.ok(byName.audit_run, 'audit_run 缺');
assert.ok(byName.audit_report, 'audit_report 缺');
assert.ok(byName.audit_clean, 'audit_clean 缺');
assert.ok(byName.audit_trend, 'audit_trend 缺');
assert.ok(byName.audit_digest, 'audit_digest 缺');
assert.ok(byName.audit_feedback, 'audit_feedback 缺');
// A2：恢复面三条（升级/改配置后「还能不能起来」的链路）
assert.ok(byName.audit_boot, 'audit_boot 缺');
assert.ok(byName.audit_checkpoint, 'audit_checkpoint 缺');
assert.ok(byName.audit_rollback, 'audit_rollback 缺');

// 每个工具都必须声明 output.schema 与 render（宿主硬要求）
for (const n of ['audit_run', 'audit_report', 'audit_clean', 'audit_trend', 'audit_digest', 'audit_feedback', 'audit_findings', 'audit_explain', 'audit_plan', 'audit_trim', 'audit_capabilities', 'audit_retire', 'audit_diff', 'audit_verify', 'audit_check', 'audit_recommend', 'audit_boot', 'audit_checkpoint', 'audit_rollback']) {
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

// 审计反哺 V08：记档→撤销完整回环（跑在临时 HOME 上，不碰真实退役库）。
// 记档容易、纠错也得有门——没有撤销入口的退役等于只能手改 JSON。
{
  const f0 = await byName.audit_findings.execute({});
  assert.ok(f0.items.length > 0, '临时 HOME 上应至少有一条发现可供回环');
  const fp0 = f0.items[0].fp;
  const ret = await byName.audit_retire.execute({ finding: fp0, reason: 'V08 回环测试：记档' });
  assert.equal(ret.ok, true, '记档应成功：' + ret.summary);
  const f1 = await byName.audit_findings.execute({});
  assert.ok(!f1.items.some((x) => x.fp === fp0), '记档后它不该再出现在问题清单');
  const res = await byName.audit_retire.execute({ finding: fp0, action: 'restore' });
  assert.equal(res.ok, true, '撤销应成功：' + res.summary);
  const f2 = await byName.audit_findings.execute({});
  assert.ok(f2.items.some((x) => x.fp === fp0), '撤销后它应重新出现并计分');
}

// 回归（2026-11-16 真机踩到）：audit_verify 必须**当场重算**，
// 不能返回开机时写下的旧记录——否则「刚退役了一条」在验回里看不见，
// 被静音的那条会被误报成「还在」。
{
  const f0 = await byName.audit_findings.execute({});
  const fp0 = f0.items[0].fp;
  const { writePending } = await import('../src/verify.mjs');
  writePending({ score: { total: 9 }, findings: f0.items, retired: [] }, { home: process.env.DSH_HOME });
  await byName.audit_retire.execute({ finding: fp0, reason: '回归测试：验证 muted 判定' });
  const v = await byName.audit_verify.execute({});
  assert.equal(v.muted, 1, '被退役的那条应显示为「被静音」，实得 muted=' + v.muted + ' / stillThere=' + v.stillThere);
  assert.ok(v.stillThere >= 0, '其余目标仍在属正常');
  await byName.audit_retire.execute({ finding: fp0, action: 'restore' });
}

const p = await byName.audit_plan.execute({});
assert.ok(p.steps.length >= 2, '计划至少两步');
assert.equal(typeof p.base, 'number');
assert.equal(typeof p.potentialAll, 'number');
assert.ok(p.summary.includes('/10'));

const tm = await byName.audit_trim.execute({});
assert.ok(Array.isArray(tm.suggestions) && tm.suggestions.length > 0, 'trim 应给建议');
assert.equal(typeof tm.served, 'number');

const cp = await byName.audit_capabilities.execute({});
// 六态计数必须齐全（0.8.5 里 ok 恒为 0 —— matrix 早已没有 ok 状态，字段没跟着改）
assert.equal(typeof cp.present, 'number', '缺 present 计数');
assert.equal(typeof cp.redundant, 'number');
assert.equal(typeof cp.conflicting, 'number');
assert.equal(typeof cp.degraded, 'number');
assert.equal(typeof cp.missing, 'number');
assert.equal(typeof cp.unknown, 'number');
assert.ok(cp.present + cp.redundant + cp.conflicting + cp.degraded + cp.missing + cp.unknown === 20,
  '六态计数之和应等于 20，实得 ' + (cp.present + cp.redundant + cp.conflicting + cp.degraded + cp.missing + cp.unknown));
assert.ok(cp.rows.length === 20, '能力域应为 20 个，实得 ' + cp.rows.length);
assert.ok(/装插件|阶梯/.test(cp.summary), '摘要里应有补救阶梯');

// --init 的「工具面」文案必须与真实工具数一致：
// 0.6.0 时它漏写了 trim，7.0 又漏了 capabilities，文案落后于代码没人会发现。
{
  const { inspect } = await import('../src/init.mjs');

  // 只看「工具面会出现…」那一条；别的 step 也会提到 audit_report，混起来会多数。
  const step = inspect().steps.find(function (s) { return s.indexOf('工具面会出现') > -1; }) || '';
  const listed = [...new Set(step.match(/audit_[a-z]+/g) || [])];
  const names = Object.keys(byName);
  assert.equal(listed.length, names.length, 'init 文案里的工具数与实际不符：文案 ' + listed.length + ' / 实际 ' + names.length);
  for (const n of names) assert.ok(listed.includes(n), 'init 文案漏了工具 ' + n);
}

console.log('tools-shape: 通过（' + Object.keys(byName).length + ' 工具 / findings ' + f.total + ' / plan ' + p.base + '→' + p.potentialAll + ' / trim ' + tm.suggestions.length + ' 条 / 能力域 ' + cp.rows.length + ' 个）');
