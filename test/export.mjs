import assert from 'node:assert/strict';
import { redact, buildBundle } from '../src/export.mjs';

const home = 'C:\\Users\\bob\\.dsh';
const userHome = 'C:\\Users\\bob';
const raw = [
  'profile ' + home + '\\profiles\\desktop\\package.json',
  'key sk-abcdef1234567890 and ghp_abcdefghijklmnop',
  'mail bob@example.com',
  'Authorization: Bearer abcdefgh12345678',
].join('\n');

const r = redact(raw, { home, userHome });
assert.ok(!r.text.includes(home), '本机 DSH_HOME 必须脱敏');
assert.ok(!r.text.includes('bob@example.com'), '邮箱必须脱敏');
assert.ok(!r.text.includes('sk-abcdef1234567890'), '密钥必须脱敏');
assert.ok(!r.text.includes('ghp_abcdefghijklmnop'), 'GitHub token 必须脱敏');
assert.ok(!r.text.includes('abcdefgh12345678'), 'Bearer 必须脱敏');
assert.ok(r.counts.key >= 2 && r.counts.email >= 1, '脱敏计数要如实');

const result = {
  self: { version: '0.0.0-test' },
  score: { total: 9.1, band: '良好', p0Open: 0, rubricVersion: 'r' },
  facts: { home, collectedAt: '2026-11-20T01:00:00.000Z', cacheHit: false, profileErrors: [{ name: 'web', reason: 'parse-error' }] },
  firstScreen: { text: '**不需要处理**' },
  attribution: { rowsFault: [{ ruleId: 'R23', severity: 'P0' }] },
  findings: [
    { ruleId: 'R23', severity: 'P0', advisory: false, title: 'bundle 未声明 dsh.bundle', fixHint: '补 dsh.bundle', evidence: [home + '\\x\\package.json'] },
    { ruleId: 'R17', severity: 'INFO', advisory: false, title: '大目录' },
  ],
  degradations: [{ code: 'history-bad-line', detail: '账本坏行', count: 2 }],
};

const b = buildBundle(result, { userHome });
assert.ok(b.bytes > 200, '材料不能是空的');
assert.equal(b.schema, 'dsh-healthkit/export-bundle/v1');
assert.ok(b.markdown.includes('覆盖缺口'), '必须写清判不了的缺口');
assert.ok(b.markdown.includes('已脱敏'), '必须声明脱敏范围');
assert.ok(!b.markdown.includes(home), '成品里不得残留本机路径');
assert.ok(b.markdown.includes('R23'), '故障项要进材料');

console.log('export: 通过（路径/用户名/密钥/邮箱脱敏 + 材料结构）');
