// 通用性测试（PLAN §16.5 + §13 硬要求）：
// 把 DSH_HOME 指到临时目录、profile 改名、bundle 列表换掉，仍应跑通。
//
// §13 那几条「不写死 profile 名 / 不写死路径 / 宿主版本无关 / 插件名不硬编码 / 无 GUI 也能跑」
// 此前只有代码检视，没有测试覆盖。这里把它变成可回归的事实。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-portable-'));

// 造一个最小假 HOME：profile 名故意用 bizarre-name-9x（不是 desktop/web），
// bundle 列表故意用不常见的包名，路径里也不含任何真实用户目录名。
const profileName = 'bizarre-name-9x';
const profileDir = path.join(tmp, 'profiles', profileName);
fs.mkdirSync(path.join(profileDir, 'node_modules', 'some-third-party-pkg'), { recursive: true });
fs.writeFileSync(path.join(profileDir, 'package.json'), JSON.stringify({
  name: 'dsh-profile-' + profileName,
  private: true,
  dependencies: { 'some-third-party-pkg': '^1.2.3', 'dsh-healthkit': '^0.0.0' },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'some-third-party-pkg'] } },
}, null, 2));
fs.writeFileSync(path.join(profileDir, 'node_modules', 'some-third-party-pkg', 'package.json'), JSON.stringify({
  name: 'some-third-party-pkg', version: '1.2.3', description: 'A third party plugin with a browser tool',
}));
fs.writeFileSync(path.join(profileDir, 'cordis.patch.yml'), [
  '- id: some-third-party-pkg',
  '  name: some-third-party-pkg',
  '  config:',
  '    enabled: true',
].join('\n') + '\n');

// DSH_HOME 指到临时目录
process.env.DSH_HOME = tmp;

const { audit } = await import('../src/engine.mjs');
const { buildMatrix } = await import('../src/capability-map.mjs');

const r = audit({ scenario: 'general' });

// 1) 能跑通，不崩
assert.ok(r && r.facts, '体检应返回结果');
assert.equal(typeof r.score.total, 'number', '应有分数');

// 2) 不写死 profile 名：读到的是我造的那个奇怪名字
assert.deepEqual(r.facts.profiles.map((p) => p.name), [profileName], '应读到自定义 profile 名');

// 3) 不写死路径：home 指向临时目录；所有采到的证据路径都必须落在临时目录内，
//    不能出现别处的绝对路径（注意：临时目录本身就在用户目录下，所以不能断言路径里没有 "Users"）。
assert.equal(r.facts.home, tmp, 'home 应是临时目录');
{
  const paths = [];
  for (const f of r.findings) for (const e of (f.evidence || [])) paths.push(String(e));
  for (const p of r.facts.profiles) paths.push(p.dir);
  const outside = paths.filter((p) => !p.startsWith(tmp));
  assert.equal(outside.length, 0, '采到的路径越界到临时目录之外：' + outside.slice(0, 3).join(' | '));
}

// 4) 插件名不硬编码：陌生包名照样被采到
const prof = r.facts.profiles[0];
assert.ok(prof.thirdPartyBundles.includes('some-third-party-pkg'), '应采到陌生第三方 bundle');

// 5) 能力域不认得这个包也必须给出结论（不能因为不认识就崩或全空）
const mx = buildMatrix(r.facts);
assert.equal(mx.rows.length, 20, '能力域仍是 20 个');
const browser = mx.rows.find((x) => x.key === 'browser');
assert.ok(browser && browser.status, 'browser 域必须有状态');

// 6) 无 GUI / 无历史也能跑：runs 与账本目录不存在时不能抛
assert.ok(!fs.existsSync(path.join(tmp, 'dsh-healthkit', 'runs')), '此时不该有 runs 目录');
const { listRuns, latestRun } = await import('../src/snapshot.mjs');
assert.deepEqual(listRuns(tmp), [], '没有快照时应返回空数组');
assert.equal(latestRun(tmp), null, '没有快照时 latestRun 应为 null');

// 7) 通用性：改 profile 名与 bundle 列表后仍跑通（同一套代码，不同形状）
fs.renameSync(profileDir, path.join(tmp, 'profiles', 'yet-another-名-42'));
const r2 = audit({ scenario: 'general' });
assert.equal(r2.facts.profiles.length, 1);
assert.equal(r2.facts.profiles[0].name, 'yet-another-名-42', '改名后仍应读到');
assert.ok(typeof r2.score.total === 'number');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('portability: 通过（临时 HOME · 怪 profile 名 · 陌生 bundle · 改名后仍跑通）');
