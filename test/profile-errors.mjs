// 坏 profile 不许静默消失（架构审计 P0-A2）。
//
// 现象（修前实测）：profiles/corrupt 的 package.json 写成坏 JSON，
// collect 里一句 `if (!pkg) continue;` 让整个 profile 从体检里消失，
// findings 里零条提到它，报告照旧给高分 —— 体检器把「坏了」报成「没有」。
//
// 本测试钉四件事：
//   ① package.json 解析失败 → 必报 R24（P0, MEASURED）；
//   ② 有 node_modules 但没有 package.json → 必报 R24（像个 profile）；
//   ③ 纯残留空目录 → 不许报（别把噪声当问题）；
//   ④ P0 存在时封顶照常生效（总分 ≤ 5.0），这样「报告残缺」不会被高分掩盖。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-profile-errors-'));
process.env.DSH_HOME = home;

const profiles = path.join(home, 'profiles');
function mkProfile(name, pkgBody) {
  const dir = path.join(profiles, name);
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
  if (pkgBody !== null) fs.writeFileSync(path.join(dir, 'package.json'), pkgBody);
  return dir;
}

mkProfile('good', JSON.stringify({ name: 'good', private: true, dsh: { profile: { bundles: [] } } }));
mkProfile('corrupt', '{ this is not json');
const residualDir = mkProfile('residual', null);
fs.mkdirSync(path.join(profiles, 'empty-residue'), { recursive: true });

const { collect } = await import('../src/collect.mjs');
const { runRules } = await import('../src/rules.mjs');
const { score } = await import('../src/score.mjs');

const allowlist = JSON.parse(fs.readFileSync(new URL('../config/allowlist.json', import.meta.url), 'utf8'));
const rubric = JSON.parse(fs.readFileSync(new URL('../config/rubric.json', import.meta.url), 'utf8'));

const facts = collect({});
let n = 0;
function ok(name, cond) {
  n += 1;
  assert.ok(cond, name);
}

const errNames = (facts.profileErrors || []).map((x) => x.name).sort();
ok('collect 应记下 corrupt 与 residual：实际 ' + JSON.stringify(errNames),
  errNames.length === 2 && errNames[0] === 'corrupt' && errNames[1] === 'residual');
ok('corrupt 的原因应为 parse-error',
  (facts.profileErrors.find((x) => x.name === 'corrupt') || {}).reason === 'parse-error');
ok('residual 的原因应为 missing-package-json',
  (facts.profileErrors.find((x) => x.name === 'residual') || {}).reason === 'missing-package-json');
ok('空残留目录不许被当成 profile 问题', !errNames.includes('empty-residue'));
ok('正常 profile 仍在体检范围内', (facts.profiles || []).some((p) => p.name === 'good'));
ok('坏 profile 不许混进 profiles 数组', !(facts.profiles || []).some((p) => p.name === 'corrupt'));

const findings = runRules(facts, allowlist);
const r24 = findings.filter((f) => f.ruleId === 'R24');
ok('应产出 2 条 R24，实际 ' + r24.length, r24.length === 2);
ok('R24 必须是 P0 且 MEASURED', r24.every((f) => f.severity === 'P0' && f.confidence === 'MEASURED'));
ok('R24 指纹必须彼此不同（不同 profile 各一条）', r24[0].fp !== r24[1].fp);
ok('R24 必须被计分（不许标 advisory）', r24.every((f) => f.advisory !== true));
ok('R24 证据里要带 profile 路径', r24.some((f) => (f.evidence || []).some((e) => e.indexOf('corrupt') !== -1)));

const sc = score(rubric, findings, 'general');
ok('存在未关闭 P0 时总分必须被封顶（实际 ' + sc.total + '）', sc.total <= 5.0);
ok('封顶原因必须写明', typeof sc.capReason === 'string' && sc.capReason.length > 0);

fs.rmSync(home, { recursive: true, force: true });
console.log('profile-errors: 通过（' + n + ' 项断言 · 坏 profile 必报 R24 且触发封顶）');
