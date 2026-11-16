// 机器可读报告 + 生态三值契约。
//
// 契约对齐 dsh-plugin-doctor 的 --format check（实测其信封）：
//   { ok, contract, checks[], doctor:{version,exit,skipped,criticalFail,degraded,approximated}, target:{...} }
// 差别只在于 checks 的来源：本插件来自体检发现，doctor 来自静态扫描。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { jsonReportPath } from '../src/reportpath.mjs';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-rj-'));
process.env.DSH_HOME = home;

const { audit } = await import('../src/engine.mjs');
const { buildCheckEnvelope, buildJsonReport } = await import('../src/report-json.mjs');

const r = audit({ scenario: 'general' });

// --- 三值契约信封 ---
{
  const env = buildCheckEnvelope(r, { version: '0.10.1' });
  assert.equal(env.contract, 'dsh-healthkit/check/v1');
  assert.equal(typeof env.ok, 'boolean');
  assert.ok(Array.isArray(env.checks) && env.checks.length > 0, '应有 checks');
  // 字段名与 doctor 一致
  for (const k of ['version', 'exit', 'skipped', 'criticalFail', 'degraded', 'approximated']) {
    assert.ok(k in env.doctor, 'doctor 信封缺字段 ' + k);
  }
  assert.ok('name' in env.target && 'version' in env.target, 'target 信封缺字段');
  // 每条 check 必须带 id / group / status 三值
  for (const c of env.checks) {
    assert.ok(['PASS', 'WARN', 'FAIL'].includes(c.status), '非法状态 ' + c.status);
    assert.ok(c.id && c.group, 'check 缺 id/group');
  }
  // 退出码：0/1/2，且与 FAIL/WARN 数量自洽
  const fail = env.checks.filter((c) => c.status === 'FAIL').length;
  const warn = env.checks.filter((c) => c.status === 'WARN').length;
  const expect = fail ? 2 : (warn ? 1 : 0);
  assert.equal(env.doctor.exit, expect, '退出码与 FAIL/WARN 不自洽');
  assert.equal(env.ok, env.doctor.exit === 0);
  // P0/P1 必须 FAIL
  for (const c of env.checks) {
    if (c.severity === 'P0' || c.severity === 'P1') assert.equal(c.status, 'FAIL', c.id + ' 是 ' + c.severity + ' 却不是 FAIL');
  }
}

// --- 全量 JSON 报告 ---
{
  const rep = buildJsonReport(r, { version: '0.10.1' });
  assert.equal(rep.schema, 'dsh-healthkit/report/v1');
  assert.ok(rep.generatedAt, '缺 generatedAt');
  assert.equal(typeof rep.score.total, 'number');
  assert.ok(Array.isArray(rep.score.dimensions), '缺维度分');
  assert.ok(Array.isArray(rep.findings), '缺 findings');
  for (const f of rep.findings) {
    for (const k of ['fp', 'ruleId', 'severity', 'title', 'evidence', 'measured', 'fixHint']) {
      assert.ok(k in f, 'finding 缺字段 ' + k);
    }
  }
  assert.ok(rep.plan && typeof rep.plan.potentialAll === 'number', '缺 plan');
  // 必须能被 JSON 序列化（不能有循环引用/不可序列化值）
  const round = JSON.parse(JSON.stringify(rep));
  assert.equal(round.schema, rep.schema);
}

// --- jsonReportPath：out 以 .json 结尾不该再追加 ---
assert.equal(jsonReportPath('/tmp/x.json'), '/tmp/x.json', '.json 结尾应照用');
assert.equal(jsonReportPath('/tmp/x.md'), '/tmp/x.json', '.md 应换成 .json');
assert.equal(jsonReportPath('/tmp/x'), '/tmp/x.json', '无扩展名应补 .json');

fs.rmSync(home, { recursive: true, force: true });
console.log('report-json: 通过（三值契约信封 · 全量 JSON 报告 · json 落点）');
