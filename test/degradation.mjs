// 降级测试（PLAN §16.3）：删除单个采集源（模拟宿主升级/文件缺失），
// 规则必须报 UNKNOWN 而不是崩溃、也不能把「读不到」当成「没问题」。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRules } from '../src/rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const base = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'facts-2026-11-16.json'), 'utf8'));
const allowlist = JSON.parse(fs.readFileSync(path.join(root, 'config', 'allowlist.json'), 'utf8'));

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// 每条降级场景：删掉某个采集源的证据，看规则怎么反应。
const cases = [
  {
    name: '成本记账文件缺失',
    mutate: (f) => { f.costTracker = null; },
    expectRule: 'R11',
    expectUnknown: true,
  },
  {
    name: 'YAML 解析不可用（patch 段读不到）',
    mutate: (f) => { f.yamlAvailable = false; f.patchEntries = {}; },
    expectRule: null,
    expectUnknown: true,
  },
  {
    name: '装载日志缺失',
    mutate: (f) => { f.logs = {}; },
    expectRule: null,
    expectUnknown: true,
  },
  {
    name: '远程机器注册表缺失',
    mutate: (f) => { f.machines = null; },
    expectRule: 'R9',
    expectUnknown: true,
  },
];

let checked = 0;
for (const c of cases) {
  const facts = clone(base);
  c.mutate(facts);

  // 不许崩
  let findings;
  try {
    findings = runRules(facts, allowlist);
  } catch (e) {
    assert.fail(c.name + '：规则抛异常了——降级应当出 UNKNOWN，而不是崩。' + e.message);
  }
  assert.ok(Array.isArray(findings), c.name + '：未返回数组');

  // 取不到证据时，必须有 UNKNOWN 或对应规则缺席（不能变成「一切正常」的假绿）
  const unknowns = findings.filter((f) => f.confidence === 'UNKNOWN');
  const hasUnknown = unknowns.length > 0;

  if (c.expectUnknown) {
    assert.ok(hasUnknown, c.name + '：取不到证据却没有报 UNKNOWN——这是假绿');
  }
  if (c.expectRule) {
    const hit = findings.filter((f) => f.ruleId === c.expectRule);
    const anyUnknown = hit.some((f) => f.confidence === 'UNKNOWN');
    assert.ok(hit.length === 0 || anyUnknown,
      c.name + '：' + c.expectRule + ' 在证据缺失时仍以确定口径报出（应当 UNKNOWN 或不报）');
  }
  checked++;
}

// 反向：证据齐全时不得全是 UNKNOWN（否则说明规则永远在猜）
{
  const findings = runRules(clone(base), allowlist);
  const unknownRatio = findings.filter((f) => f.confidence === 'UNKNOWN').length / Math.max(1, findings.length);
  assert.ok(unknownRatio < 0.6, '证据齐全时 UNKNOWN 占比 ' + Math.round(unknownRatio * 100) + '% 过高');
}

console.log('degradation: 通过（' + checked + ' 个降级场景 · 无崩溃 · 无假绿）');
