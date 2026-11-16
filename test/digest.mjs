// 产品层三件事的守卫（产品审计 P0 / P2 / P3）。
//
// ① 首屏结论化：健康机器不再把 14 条 INFO 铺满首屏，而是「1 句结论 + ≤3 条最值得动 + 一句收走」；
// ② 差异驱动周报：没有变化时只说一句「无变化」，不许复述；有变化时必须带「上次说的现在怎样」；
// ③ R17 的大目录与 clean 的可清理空间要能对上（R17 要给出口，不能只说「大」）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-digest-'));
process.env.DSH_HEALTHKIT_NO_CACHE = '1';

const { renderFirstScreen, pickTopActions, headlineOf, countBySeverity } = await import('../src/digest.mjs');
const { buildDigest } = await import('../src/weekly.mjs');
const { writePending, pendingPath } = await import('../src/verify.mjs');
const { writeRun } = await import('../src/snapshot.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

const F = (ruleId, severity, extra) => Object.assign({ ruleId, severity, dimension: 'disk', title: ruleId + ' 标题', fp: ruleId + '#1', evidence: [], measured: {} }, extra || {});

function mockResult(findings, score) {
  return { findings, retired: [], score: { total: score, raw: score, band: '良好', p0Open: 0 }, facts: { home } };
}

// ① 首屏
const healthy = mockResult([
  F('R10', 'P2', { fixHint: '开通 allowlist' }),
  F('R12', 'P2'),
  F('R16', 'P2', { fixHint: '定主备' }),
  F('R3c', 'INFO'), F('R11', 'INFO'), F('R15', 'INFO'), F('R17', 'INFO'),
], 9.81);
ok('headline 应为「整体健康」', headlineOf(countBySeverity(healthy.findings), 9.81, healthy.findings.length).indexOf('健康') !== -1);
const top = pickTopActions(healthy.findings, 3);
ok('最值得动只取计分项', top.every((f) => f.severity !== 'INFO'));
ok('同级里优先给有 fixHint 的', top[0].ruleId === 'R10' || top[0].ruleId === 'R16', top.map((f) => f.ruleId).join(','));
const fs1 = renderFirstScreen(healthy, { limit: 3 });
ok('首屏不超过 3 条动作', fs1.topActions.length <= 3);
ok('首屏必须把 INFO 收成一句话', fs1.lines.join('\n').indexOf('4 条 INFO') !== -1, fs1.lines.join('\n'));
ok('首屏不许逐条列出 INFO', fs1.lines.filter((l) => l.indexOf('R3c') !== -1).length === 0);

// ② 周报：没有变化 → 一句「无变化」
const runShape = (findings, score) => ({
  at: new Date().toISOString(), score,
  findings: findings.map((f) => ({ fp: f.fp, ruleId: f.ruleId, severity: f.severity, title: f.title })),
  retired: [],
});
// 先写一份基线快照，且时间设为 1 小时前（writeRun 用自己的时间戳，避免同毫秒排序问题）
writeRun(mockResult(healthy.findings, 9.81), { home, scenario: 'general', version: 'test' });

const same = buildDigest(mockResult(healthy.findings, 9.81), { home });
ok('无变化时 changed 必须为 false', same.changed === false, String(same.changed));
ok('无变化时的文案应说明没有变化', same.lines.join('\n').indexOf('没有变化') !== -1, same.lines.join('\n'));
ok('无变化时仍要给出仍待处理的几条', same.lines.join('\n').indexOf('仍待处理') !== -1);

const worse = mockResult(healthy.findings.concat([F('R99', 'P1', { fixHint: '修它' })]), 8.2);
const changed = buildDigest(worse, { home });
ok('有变化时 changed 必须为 true', changed.changed === true);
ok('有变化时要报分数变动', /分数/.test(changed.lines.join('\n')), changed.lines.join('\n'));
ok('有变化时要列新增', changed.lines.join('\n').indexOf('R99') !== -1);

// ③ 待验清单：健康机器上也要有活干（P2 带修法要进清单）
const pending = writePending(mockResult(healthy.findings, 9.81), { home });
ok('P2 带修法应进待验清单（否则 audit_verify 永远空转）',
  pending.targets.length >= 2 && pending.targets.every((t) => t.severity !== 'INFO'),
  JSON.stringify(pending.targets.map((t) => t.ruleId)));
ok('待验清单落盘可读', fs.existsSync(pendingPath(home)));

// ④ R17 必须给出出口（不能只说「大」）
const rulesSrc = fs.readFileSync(new URL('../src/rules.mjs', import.meta.url), 'utf8');
const r17 = rulesSrc.slice(rulesSrc.indexOf("ruleId: 'R17'"), rulesSrc.indexOf("ruleId: 'R17'") + 1200);
ok('R17 必须带 fixHint', /fixHint:/.test(r17));
ok('R17 的修法要指向 audit_clean', /audit_clean/.test(r17));

// ⑤ 只跑 CLI 的人也必须能触发跨重启验回
const binSrc = fs.readFileSync(new URL('../bin/audit.mjs', import.meta.url), 'utf8');
ok('CLI 必须写待验清单（否则 audit_verify 只在工具面才有活干）', /writePending\(/.test(binSrc));
ok('CLI 必须支持 --source 与 --no-record', /--source/.test(binSrc) && /no-record/.test(binSrc));

fs.rmSync(home, { recursive: true, force: true });
delete process.env.DSH_HEALTHKIT_NO_CACHE;
console.log('digest: 通过（' + n + ' 项断言 · 首屏结论化 + 差异周报 + 待验清单 + R17 出口 + CLI 接线）');
