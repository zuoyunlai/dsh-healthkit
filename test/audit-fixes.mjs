// 2026-11-20 审计反哺回归：身份 / 遮蔽 / 形状 / 路径编码 / 写面边界。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = 'E:/Documents/deepseek-harness/plugins/dsh-healthkit';
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-fix-'));
process.env.DSH_HOME = home;

const { runRules } = await import('file:///' + root + '/src/rules.mjs');
const baseProfile = (name, extra) => Object.assign({
  name, dir: '/x/profiles/' + name, deps: [], bundles: [], thirdPartyBundles: [],
  noManifestBundles: [], depsNotBundled: [], depsNotBundledRaw: [], bakFiles: [],
  localDeps: [], installed: {}, depSpecs: {}, installedExclusions: {},
  marketDisabled: [], marketStateReadable: true,
}, extra || {});
const facts = (profiles, patchEntries) => ({
  home: '/x', profiles, logs: {}, profileErrors: [], disk: [], engineAssets: [],
  vcs: true, credentialsFiles: [], machines: [], costTracker: { ageDays: null, file: null },
  exclusions: { a: null, b: null }, patchEntries: patchEntries || { a: [], b: [] },
  agentPresets: [], capabilities: { tagged: [], redundancy: [] }, workspace: null,
});

// ① 多实例指纹必须不同（旧版两条 R4 都是裸 R4）
{
  const f = runRules(facts([baseProfile('a', { bakFiles: ['x.bak'] }), baseProfile('b', { bakFiles: ['y.bak'] })]), {});
  const fps = f.filter((x) => x.ruleId === 'R4').map((x) => x.fp);
  assert.equal(fps.length, 2);
  assert.notEqual(fps[0], fps[1], '两个 profile 的 R4 指纹必须不同，实得 ' + JSON.stringify(fps));
}

// ② allowlist 不被 permission 分支遮蔽
{
  const f = runRules(facts([baseProfile('a'), baseProfile('b')], {
    a: [{ id: 'permission', disabled: false, name: null, config: { defaultPreset: 'custom', presets: { custom: { approval: 'ask' } } } }],
    b: [{ id: 'zzz', disabled: true, name: null }],
  }), { corePatchIds: ['zzz'] });
  assert.equal(f.filter((x) => x.ruleId === 'R2').length, 0, 'corePatchIds 豁免必须在任何 profile 顺序下都生效');
}

// ③ 坏形状不崩（bundles 非数组）
{
  const pdir = path.join(home, 'profiles', 'p1');
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, 'package.json'), JSON.stringify({ name: 'p1', dependencies: {}, dsh: { profile: { bundles: { bad: 1 } } } }));
  const { collect } = await import('file:///' + root + '/src/collect.mjs');
  const f = collect({});
  assert.ok(Array.isArray(f.profiles), '坏形状时采集仍应返回结构');
  assert.ok(f.profileErrors.some((e) => e.reason === 'bundle-shape'), '坏形状要留 profileError');
}

// ④ 非 ASCII 安装路径：把 src/config/package.json 复制到中文目录再跑 audit
{
  const dir = path.join(home, '张三 的插件', 'dsh-healthkit');
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(path.join(root, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.cpSync(path.join(root, 'config'), path.join(dir, 'config'), { recursive: true });
  fs.copyFileSync(path.join(root, 'package.json'), path.join(dir, 'package.json'));
  const eng = await import('file:///' + dir.replace(/\\/g, '/') + '/src/engine.mjs');
  const r = eng.audit({ scenario: 'general', skipRetire: true });
  assert.ok(typeof r.score.total === 'number', '中文/带空格路径下 audit 必须能跑，实得 ' + JSON.stringify(r && r.score));
}

// ⑤ purge：非法批次名不列、负 olderThanDays 不能缩短保护窗
{
  const { trashDir } = await import('file:///' + root + '/src/clean.mjs');
  const bad = path.join(trashDir(), 'b-bad');
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(bad, 'manifest.json'), JSON.stringify({ batch: '../../victim', createdAt: new Date().toISOString(), items: [], totals: {} }));
  const clean = await import('file:///' + root + '/src/clean.mjs');
  const listed = clean.listBatches().map((x) => x.batch);
  assert.ok(!listed.includes('../../victim'), '非法批次名不得进入列表');
  const p = clean.purge({ olderThanDays: -1, dryRun: true });
  assert.equal(p.candidates.length, 0, '负门槛必须被夹到保护窗，实得 ' + JSON.stringify(p.candidates));
}

// ⑥ checkpoint keep 负值不得删空
{
  const rec = await import('file:///' + root + '/src/recovery.mjs');
  const h2 = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-keep-'));
  for (const n of ['a', 'b', 'c']) {
    fs.mkdirSync(path.join(h2, 'dsh-healthkit', 'checkpoints', n), { recursive: true });
    fs.writeFileSync(path.join(h2, 'dsh-healthkit', 'checkpoints', n, 'manifest.json'), JSON.stringify({ id: n }));
  }
  rec.prune(h2, -1);
  const left = fs.readdirSync(path.join(h2, 'dsh-healthkit', 'checkpoints')).length;
  assert.equal(left, 1, 'keep=-1 应被夹到 1，实得剩 ' + left);
  fs.rmSync(h2, { recursive: true, force: true });
}

// ⑦ audit_report 不得写进 DSH_HOME
{
  const { buildTools } = await import('file:///' + root + '/index.js');
  const byName = {};
  for (const x of buildTools({})) byName[x.name] = x;
  await assert.rejects(
    () => byName.audit_report.execute({ out: path.join(home, 'profiles', 'p1', 'package.json'), format: 'json' }),
    /拒绝写入 DSH_HOME/,
    'DSH_HOME 内的落点必须被拒',
  );
}

// ⑧ 验回：YAML 不可用时 patch 类目标记「无法复核」，不得记成修好
{
  const ver = await import('file:///' + root + '/src/verify.mjs');
  const h3 = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-verify-'));
  const pending = { score: { total: 8 }, findings: [{ fp: 'R2#a', ruleId: 'R2', severity: 'P2', dimension: 'consistency', title: '空转', fixHint: '删条目', advisory: false, measured: { profile: 'a' } }], retired: [] };
  // 直接写待验清单（writePending 只认带修法的项）
  fs.mkdirSync(path.dirname(ver.pendingPath(h3)), { recursive: true });
  fs.writeFileSync(ver.pendingPath(h3), JSON.stringify({ at: new Date().toISOString(), score: 8, targets: pending.findings.map((f) => ({ fp: f.fp, ruleId: f.ruleId, severity: f.severity, title: f.title, fixHint: f.fixHint, profile: 'a', evidence: null })) }));
  const v = ver.evaluatePending({ findings: [], retired: [], facts: { profiles: [{ name: 'a' }], profileErrors: [], yamlAvailable: false } }, { home: h3 });
  assert.equal(v.unverifiable.length, 1, 'YAML 缺口下 patch 类目标必须是 unverifiable，实得 ' + JSON.stringify({ f: v.fixed.length, u: v.unverifiable.length }));
  fs.rmSync(h3, { recursive: true, force: true });
}

fs.rmSync(home, { recursive: true, force: true });
console.log('audit-fixes: 通过（指纹/遮蔽/形状/中文路径/写面/验回 8 组）');
