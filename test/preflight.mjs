// C1 作者侧发布前自检：拦住「发出去就装不上 / 装上了但宿主静默跳过」这两类不可逆事故。
//
// 版本号一旦发出去就改不了，所以这里的每一条 blocker 都必须对应一种**真实会坏**的形态，
// 而不是风格偏好。风格类一律进 warnings / infos。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { preflightRepo, renderPreflight, PREFLIGHT_SCHEMA } = await import('../src/preflight.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-preflight-'));
function repo(name, files) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) {
    const p = path.join(dir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body, null, 2), 'utf8');
  }
  return dir;
}
const GOOD_PKG = {
  name: 'good-plugin',
  version: '1.0.0',
  description: 'a good plugin',
  license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/x/y.git' },
  engines: { node: '>=20' },
  keywords: ['dsh-plugin'],
  main: './index.js',
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  files: ['index.js', 'cordis.patch.yml'],
  scripts: { test: 'node ./test/x.mjs' },
};

// ① 合格包：PASS
const good = repo('good', {
  'package.json': GOOD_PKG,
  'index.js': 'export const name = "good";\n',
  'cordis.patch.yml': '- insert:\n    - id: good\n      name: good-plugin\n',
  'README.md': '# good\n',
  'SECURITY.md': '# security\n',
});
const r1 = preflightRepo(good);
ok('合格包 PASS', r1.verdict === 'PASS', JSON.stringify(r1.blockers) + JSON.stringify(r1.warnings));
ok('schema 正确', r1.schema === PREFLIGHT_SCHEMA);
ok('PASS 时没有阻断', r1.blockers.length === 0);

// ② 没有 package.json → FAIL
const bad1 = repo('nodoc', { 'index.js': '1;\n' });
const r2 = preflightRepo(bad1);
ok('没有 package.json 直接 FAIL', r2.verdict === 'FAIL' && r2.blockers[0].code === 'package-json');

// ③ 没有 dsh.bundle → FAIL（这是宿主静默跳过的根因）
const bad2 = repo('nobundle', { 'package.json': Object.assign({}, GOOD_PKG, { dsh: undefined }), 'index.js': '1;\n', 'cordis.patch.yml': '- id: x\n' });
ok('没有 dsh.bundle 是阻断', preflightRepo(bad2).blockers.some((b) => b.code === 'no-dsh-bundle'));

// ④ dsh.bundle.patch 指向不存在的文件 → FAIL
const bad3 = repo('badpatch', { 'package.json': Object.assign({}, GOOD_PKG, { files: ['index.js'] }), 'index.js': '1;\n' });
ok('patch 文件不存在是阻断', preflightRepo(bad3).blockers.some((b) => b.code === 'bundle-patch-missing'));

// ⑤ main 指向不存在 → FAIL；没有 files → FAIL
const bad4 = repo('badmain', { 'package.json': Object.assign({}, GOOD_PKG, { main: './nope.js' }), 'cordis.patch.yml': '- id: x\n' });
ok('main 指向不存在是阻断', preflightRepo(bad4).blockers.some((b) => b.code === 'main-missing'));
const bad5 = repo('nofiles', { 'package.json': Object.assign({}, GOOD_PKG, { files: undefined }), 'index.js': '1;\n', 'cordis.patch.yml': '- id: x\n' });
ok('没有 files 是阻断（会把不该发的发出去）', preflightRepo(bad5).blockers.some((b) => b.code === 'no-files'));

// ⑥ 发布清单里含凭据文件 → FAIL
const bad6 = repo('secrets', { 'package.json': Object.assign({}, GOOD_PKG, { files: ['index.js', 'cordis.patch.yml', '.npmrc'] }), 'index.js': '1;\n', 'cordis.patch.yml': '- id: x\n', '.npmrc': 'token=x\n' });
ok('files 含 .npmrc 是阻断', preflightRepo(bad6).blockers.some((b) => b.code === 'secrets-in-files'));

// ⑦ 通配 files：命中就算过，没命中就警告
const good2 = repo('glob', {
  'package.json': Object.assign({}, GOOD_PKG, { files: ['index.js', 'cordis.patch.yml', 'src/*.mjs'], main: './index.js' }),
  'index.js': '1;\n', 'cordis.patch.yml': '- id: x\n', 'src/a.mjs': 'export const a = 1;\n',
});
ok('files 通配命中时不报警告', !preflightRepo(good2).warnings.some((w) => w.code === 'files-missing'));

// ⑧ locale 缺 meta → 警告；有 locale 但没导出 → 警告
const l10n = repo('l10n', {
  'package.json': Object.assign({}, GOOD_PKG, { files: ['index.js', 'cordis.patch.yml', 'locale/*.json'] }),
  'index.js': '1;\n', 'cordis.patch.yml': '- id: x\n',
  'locale/en.json': JSON.stringify({ meta: { title: 'x' } }, null, 2),
});
const r8 = preflightRepo(l10n);
ok('locale 缺 description → 警告', r8.warnings.some((w) => w.code === 'locale-meta'), JSON.stringify(r8.warnings.map((w) => w.code)));
ok('有 locale 但 exports 没导出 → 警告', r8.warnings.some((w) => w.code === 'locale-not-exported'));

// ⑨ 版本 0.0.x / 没有 keyword → 警告 / 建议
const weak = repo('weak', { 'package.json': Object.assign({}, GOOD_PKG, { version: '0.0.3', keywords: [], description: undefined }), 'index.js': '1;\n', 'cordis.patch.yml': '- id: x\n' });
const r9 = preflightRepo(weak);
ok('0.0.x 版本给警告', r9.warnings.some((w) => w.code === 'version-0.0.x'));
ok('缺 description 给警告', r9.warnings.some((w) => w.code === 'no-description'));
ok('缺 dsh-plugin 关键词只给建议', r9.infos.some((i) => i.code === 'no-topic-keyword'));
ok('有警告无阻断时 verdict=WARN', r9.verdict === 'WARN' && r9.blockers.length === 0, r9.verdict);

// ⑩ 补丁里没有 id → 阻断；tab 缩进 → 警告
const badPatch = repo('badp', { 'package.json': GOOD_PKG, 'index.js': '1;\n', 'cordis.patch.yml': '- insert:\n    - name: x\n' });
ok('补丁没有 id 是阻断', preflightRepo(badPatch).blockers.some((b) => b.code === 'patch-no-id'));

// ⑪ 文档类只给建议，不阻断（否则新仓永远发不出去）
const noDocs = repo('nodocs', { 'package.json': GOOD_PKG, 'index.js': '1;\n', 'cordis.patch.yml': '- id: x\n' });
const r11 = preflightRepo(noDocs);
ok('缺 SECURITY.md 只是建议', !r11.blockers.some((b) => b.code === 'no-security') && r11.infos.some((i) => i.code === 'no-security'));

// ⑫ 渲染：三个分区都出现
const txt = renderPreflight(preflightRepo(bad6));
ok('渲染含「阻断」', txt.indexOf('阻断') !== -1);
ok('渲染含阻断码', txt.indexOf('secrets-in-files') !== -1);
ok('渲染首行给判词', /发布前自检：(PASS|WARN|FAIL)/.test(txt.split('\n')[0]), txt.split('\n')[0]);

// ⑬ 本仓自检必须 PASS（这就是「作者用自己的工具」）
const self = preflightRepo(path.resolve('.'));
ok('本仓发布前自检 PASS', self.verdict === 'PASS', JSON.stringify(self.blockers) + JSON.stringify(self.warnings.map((w) => w.code)));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('preflight: 通过（' + n + ' 项断言 · 不可逆事故拦截 / 风格降级为警告 / 自检 PASS）');
