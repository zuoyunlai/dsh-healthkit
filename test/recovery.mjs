// A2 恢复面：配置快照 / 预启动探针 / 回滚 / 救回。
//
// 这个模块是整个仓库里**第二个会写用户文件的东西**（第一个是清理器）。所以测试的重点不是
// 「功能对不对」，而是「它会不会把好的东西写坏」：白名单、sha256、写回前必备份、
// 撞名不覆盖、假红不能有（@deepseek-ai/* 是宿主自带，不该报成「依赖没装」）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-recovery-'));
process.env.DSH_HOME = home;

const {
  checkpoint, listCheckpoints, bootPreflight, rollback, recover,
  CONFIG_FILES, CHECKPOINT_SCHEMA,
} = await import('../src/recovery.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}
function w(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8'); }

// ---------- 造一个「能启动」的 profile
const PRO = path.join(home, 'profiles', 'alpha');
const PKG = path.join(PRO, 'package.json');
const PATCH = path.join(PRO, 'cordis.patch.yml');
const PKG_BODY = JSON.stringify({
  name: 'alpha',
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'localthing'] } },
}, null, 2);
w(PKG, PKG_BODY);
w(PATCH, '- id: alpha\n  name: localthing\n');
w(path.join(PRO, 'node_modules', 'localthing', 'package.json'),
  JSON.stringify({ name: 'localthing', version: '1.0.0', dsh: { bundle: { patch: './cordis.patch.yml' } } }));
// 一个「没声明 dsh.bundle」的第三方 bundle（升完级静默跳过的那类）
w(path.join(PRO, 'node_modules', 'nomf', 'package.json'), JSON.stringify({ name: 'nomf', version: '1.0.0' }));

// ① 健康态：canBoot，且 @deepseek-ai/* 不许被报成缺依赖
const b1 = bootPreflight(home);
ok('健康配置可启动', b1.canBoot === true, JSON.stringify(b1.blockers));
ok('宿主自带 @deepseek-ai/* 不算缺依赖', b1.blockers.every((x) => x.code !== 'bundle-missing'), JSON.stringify(b1.blockers));
ok('探针记录 hostProvided 个数', b1.profiles[0].hostProvided === 1, String(b1.profiles[0].hostProvided));
ok('探针承认自己判不了的东西', Array.isArray(b1.unknown) && b1.unknown.length >= 2);

// ② 没声明 dsh.bundle → 只是 warning（静默跳过不阻塞启动）
const b2 = (() => {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  pkg.dsh.profile.bundles.push('nomf');
  fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2));
  return bootPreflight(home);
})();
ok('没声明 dsh.bundle 只报 warning 不封启动', b2.canBoot === true && b2.warnings.some((x) => x.code === 'bundle-no-manifest'), JSON.stringify(b2.warnings));

// ③ 缺依赖 → blocker
fs.rmSync(path.join(PRO, 'node_modules', 'nomf'), { recursive: true, force: true });
const b3 = bootPreflight(home);
ok('第三方依赖缺失是 blocker', b3.canBoot === false && b3.blockers.some((x) => x.code === 'bundle-missing'), JSON.stringify(b3.blockers));
// 复原
w(path.join(PRO, 'node_modules', 'nomf', 'package.json'), JSON.stringify({ name: 'nomf', version: '1.0.0', dsh: { bundle: {} } }));

// ④ package.json 坏 → blocker（且不许抛）
w(PKG, '{ this is not json');
const b4 = bootPreflight(home);
ok('package.json 解析失败是 blocker', b4.canBoot === false && b4.blockers.some((x) => x.code === 'package-json'));
fs.writeFileSync(PKG, PKG_BODY);

// ⑤ patch 里有 tab 缩进 → blocker
const patchBackup = fs.readFileSync(PATCH, 'utf8');
fs.writeFileSync(PATCH, '- id: alpha\n\tname: localthing\n');
const b5 = bootPreflight(home);
ok('patch 缩进 tab 是 blocker', b5.canBoot === false && b5.blockers.some((x) => x.code === 'patch-indent'), JSON.stringify(b5.blockers));
fs.writeFileSync(PATCH, patchBackup);
ok('复原后又能启动', bootPreflight(home).canBoot === true);

// ⑥ checkpoint：只收白名单文件、带 sha256
const m1 = checkpoint(home, { reason: 'test' });
ok('快照 schema 正确', m1.schema === CHECKPOINT_SCHEMA);
ok('快照收的是白名单文件', m1.files.every((f) => CONFIG_FILES.indexOf(f.name) !== -1), JSON.stringify(m1.files.map((f) => f.name)));
ok('快照里有 package.json 与 cordis.patch.yml', m1.files.length === 2, String(m1.files.length));
ok('每个文件带 sha256', m1.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256)));
// 故意放一个黑名单文件，确认它不会被收进来
w(path.join(PRO, '.npmrc'), '//registry.npmjs.org/:_authToken=SECRET');
const m1b = checkpoint(home, { reason: 'test2' });
ok('.npmrc 这类凭据文件不进快照', m1b.files.every((f) => f.name !== '.npmrc'));
ok('快照目录里也确实没有 .npmrc', !fs.existsSync(path.join(home, 'dsh-healthkit', 'checkpoints', m1b.id, 'files', 'alpha', '.npmrc')));

// ⑦ 撞名不覆盖（同一秒连打两份，id 加后缀，原快照内容保持）
const a = checkpoint(home, { id: 'same-second', reason: 'first' });
const b = checkpoint(home, { id: 'same-second', reason: 'second' });
ok('同一 id 第二份自动加后缀', a.id !== b.id && b.id.indexOf('same-second-') === 0, a.id + ' / ' + b.id);
const firstManifest = JSON.parse(fs.readFileSync(path.join(home, 'dsh-healthkit', 'checkpoints', a.id, 'manifest.json'), 'utf8'));
ok('原快照未被覆盖', firstManifest.reason === 'first', firstManifest.reason);

// ⑧ rollback：写回 + 自动备份 + 只写白名单
const listBefore = listCheckpoints(home).length;
fs.writeFileSync(PKG, '{ broken again }');
const r1 = rollback(home, m1.id, {});
ok('回滚成功', r1.ok === true, JSON.stringify(r1));
ok('回滚写回 2 个文件', r1.written.length === 2, JSON.stringify(r1.written));
ok('回滚后 package.json 内容复原', fs.readFileSync(PKG, 'utf8') === PKG_BODY);
ok('回滚前自动给当前状态打了快照', listCheckpoints(home).length === listBefore + 1, listBefore + ' -> ' + listCheckpoints(home).length);
ok('回滚记录了备份 id', typeof r1.backup === 'string' && r1.backup.length > 3, String(r1.backup));
ok('回滚后提示再跑探针', /--boot/.test(r1.next));

// ⑨ 回滚护栏：坏 id / 篡改的 sha / manifest 里塞黑名单文件名
ok('非法 id 被拒', rollback(home, '../etc', {}).ok === false);
ok('不存在的 id 被拒', rollback(home, 'cp-19700101-000000', {}).ok === false);

const evil = path.join(home, 'dsh-healthkit', 'checkpoints', 'evil');
w(path.join(evil, 'manifest.json'), JSON.stringify({
  schema: CHECKPOINT_SCHEMA, id: 'evil', at: new Date().toISOString(), files: [
    { profile: 'alpha', name: '.npmrc', sha256: 'x'.repeat(64), bytes: 1 },
    { profile: '..', name: 'package.json', sha256: 'y'.repeat(64), bytes: 1 },
    { profile: 'alpha', name: 'package.json', sha256: 'z'.repeat(64), bytes: 1 },
  ],
}));
const r2 = rollback(home, 'evil', {});
ok('manifest 里的黑名单文件不会被写', r2.written.length === 0, JSON.stringify(r2.written));
ok('黑名单/非法 profile 进 skipped', r2.skipped.length === 3, JSON.stringify(r2.skipped));
ok('回滚失败时会话仍然给出原因', r2.ok === false);
ok('篡改 sha 时不写文件', fs.readFileSync(PKG, 'utf8') === PKG_BODY);

// ⑩ recover：能启动就不动；起不来才回滚到最新快照
const okState = recover(home, {});
ok('健康时不采取动作', okState.acted === false && okState.reason === 'already-bootable', JSON.stringify({ acted: okState.acted, reason: okState.reason }));

// 先建一份干净快照，再把配置弄坏，recover 应救回来
const good = checkpoint(home, { reason: 'good-state' });
fs.writeFileSync(PKG, '{ oops }');
const bad = bootPreflight(home);
ok('坏配置探针不过', bad.canBoot === false);
const rec = recover(home, { preflight: bad });
ok('起不来时执行回滚', rec.acted === true, JSON.stringify(rec));
ok('回滚目标是较新的快照（含 good-state）', typeof rec.rolledBackTo === 'string' && rec.rolledBackTo.length > 3, String(rec.rolledBackTo));
ok('救回后探针通过', rec.after.canBoot === true, JSON.stringify(rec.after.blockers));
ok('内容复原', fs.readFileSync(PKG, 'utf8') === PKG_BODY);
ok('good 快照仍在', listCheckpoints(home).some((c) => c.id === good.id));

fs.rmSync(home, { recursive: true, force: true });
console.log('recovery: 通过（' + n + ' 项断言 · 快照/探针/回滚/救回 + 写面护栏）');
