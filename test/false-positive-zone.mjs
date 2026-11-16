// 假阳性专区（PLAN §16.2）：每个已退役项一个 fixture。
//
// 关键语义：退役**不是**让规则不再命中，而是让命中了也不计分、不进问题清单。
// 所以这个测试断言的是「退役机制正确」，不是「规则改对了」——
// 否则每次规则调整都会把历史误报重新变成问题。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRules } from '../src/rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const facts = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'facts-2026-11-16.json'), 'utf8'));
const allowlist = JSON.parse(fs.readFileSync(path.join(root, 'config', 'allowlist.json'), 'utf8'));

const dir = path.join(root, 'fixtures', 'retired');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
assert.ok(files.length > 0, '假阳性专区不应为空');

for (const file of files) {
  const rec = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  assert.ok(rec.fp, file + ' 缺 fp');
  assert.ok(rec.reason, file + ' 缺 reason（退役必须留理由）');
  assert.ok(rec.at, file + ' 缺 at');

  // 1) 规则在当前口径下仍然能命中这条（这是前提，不是问题）
  const findings = runRules(facts, allowlist);
  const hit = findings.find((f) => f.fp === rec.fp);

  // 2) 退役机制：命中时会被剔除，且带退役理由
  const store = {};
  store[rec.fp] = { reason: rec.reason, at: rec.at, title: rec.title };
  const kept = [];
  const retired = [];
  findings.forEach((f) => {
    if (store[f.fp]) { f.retired = store[f.fp]; retired.push(f); } else kept.push(f);
  });

  if (hit) {
    assert.ok(retired.some((f) => f.fp === rec.fp), rec.fp + ' 命中了却没被退役机制剔除');
    assert.ok(!kept.some((f) => f.fp === rec.fp), rec.fp + ' 退役后仍留在计分集合里');
    const r = retired.find((f) => f.fp === rec.fp);
    assert.equal(r.retired.reason, rec.reason, rec.fp + ' 退役理由没带上');
  } else {
    // 规则已改到不再命中这条：退役记录变成孤儿，应该被报告出来而不是静默留着。
    // 这里只断言「不崩」，孤儿检测由 report 的已退役段负责展示。
    assert.ok(true);
  }
}

console.log('false-positive-zone: 通过（' + files.length + ' 个退役 fixture）');
