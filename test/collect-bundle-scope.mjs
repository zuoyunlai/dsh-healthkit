// @deepseek-ai/* 依赖列在 bundles 里时，绝不能再判「装了但未启用」（R1 官方作用域误报）。
//
// 现象（2026-11-21 在真机上实测）：src/collect.mjs 把 deps 拿去和「剔掉 @deepseek-ai/* 的
// thirdPartyBundles」比对，于是 @deepseek-ai/dsh-subagent-claude-code 明明列在
// dsh.profile.bundles 里，仍被报成 P1「装了但未启用 2 个（desktop）」。
//
// 本测试钉三件事（第 ② 条是防「改过头」：修成一律不报就变成安全假绿）：
//   ① 官方作用域依赖已挂载 → 不得进 depsNotBundled；
//   ② 官方作用域依赖未挂载 → 仍然要进 depsNotBundled 并被 R1 报出来；
//   ③ bundlesMissingFromDeps（R25）不受影响：核心 bundle 不在 dependencies 是正常的。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-bundle-scope-'));
process.env.DSH_HOME = home;
const dir = path.join(home, 'profiles', 'p1');

function pkg(name, extra) {
  fs.mkdirSync(path.join(dir, 'node_modules', name), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules', name, 'package.json'),
    JSON.stringify(Object.assign({ name, version: '1.0.0' }, extra || {})));
}

pkg('@deepseek-ai/dsh-mounted', { dsh: { bundle: { patch: './cordis.patch.yml' } } });
pkg('@deepseek-ai/dsh-unmounted', { dsh: { bundle: { patch: './cordis.patch.yml' } } });
pkg('dsh-extra-pkg');

fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-p1',
  private: true,
  dependencies: {
    '@deepseek-ai/dsh-mounted': '1.0.0',
    '@deepseek-ai/dsh-unmounted': '1.0.0',
    'dsh-extra-pkg': '1.0.0',
  },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-mounted'] } },
}, null, 2));

const { collect } = await import('../src/collect.mjs');
const { runRules } = await import('../src/rules.mjs');

const facts = collect({});
const p = (facts.profiles || []).find((x) => x.name === 'p1');
assert.ok(p, 'profile p1 应被采集到');

function ok(name, cond) {
  assert.ok(cond, name);
}

ok('已挂载的官方作用域依赖不得进 depsNotBundled：' + JSON.stringify(p.depsNotBundled),
  !p.depsNotBundled.includes('@deepseek-ai/dsh-mounted'));
ok('未挂载的官方作用域依赖仍要进 depsNotBundled',
  p.depsNotBundled.includes('@deepseek-ai/dsh-unmounted'));
ok('第三方未挂载包照旧要进 depsNotBundled',
  p.depsNotBundled.includes('dsh-extra-pkg'));
ok('R25 不应把核心 bundle 误当成缺失：' + JSON.stringify(p.bundlesMissingFromDeps),
  p.bundlesMissingFromDeps.length === 0);

const findings = runRules(facts, {});
const r1 = findings.filter((f) => f.ruleId === 'R1');
ok('应报 1 条 R1，实际 ' + r1.length, r1.length === 1);
const pkgs = r1[0].measured.packages;
ok('R1 里不得出现已挂载的官方作用域依赖：' + JSON.stringify(pkgs),
  !pkgs.includes('@deepseek-ai/dsh-mounted'));
ok('R1 里必须仍有真问题（不许修成一律不报）',
  pkgs.includes('@deepseek-ai/dsh-unmounted') && pkgs.includes('dsh-extra-pkg'));

fs.rmSync(home, { recursive: true, force: true });
console.log('collect-bundle-scope: 通过（@deepseek-ai 误报已修 / 真问题仍报 / R25 不受影响）');
