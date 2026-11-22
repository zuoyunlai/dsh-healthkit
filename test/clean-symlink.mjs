// 审计报告 §7 的「未核实项」补测：audit_clean 的 apply / restore 在**含符号链接的目录**上的行为。
//
// 三个要钉住的事实（任何一条不成立都是真缺陷，不是口味问题）：
//   ① 统计不跟随符号链接 —— 否则回收量虚高，而且会读到 DSH_HOME 之外的数据；
//   ② 腾挪不把链接指向的内容搬进来 —— 否则回收区里躺着用户家目录之外的「真实数据副本」，
//      而清单上写的是「可再生缓存」，语义就骗人了；
//   ③ 还原后链接仍是链接 —— 不能退化成目录副本。
//
// 2026-11-17 补：报告里这条原本标「未构造该用例」，现在有用例了。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-clean-sl-'));
process.env.DSH_HOME = home;

const { scan, apply, restore } = await import('../src/clean.mjs');

// 1) 一个可清理组：cache/dsh-image-gen，里面 2 个真文件（200 + 300 字节）
const cache = path.join(home, 'cache', 'dsh-image-gen');
fs.mkdirSync(path.join(cache, 'sub'), { recursive: true });
fs.writeFileSync(path.join(cache, 'a.bin'), Buffer.alloc(200, 1));
fs.writeFileSync(path.join(cache, 'sub', 'b.bin'), Buffer.alloc(300, 2));

// 2) 链接指向 DSH_HOME 之外一个 1MB 目录。若统计跟随它，字节数会从 500 跳到 1MB+
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-outside-'));
fs.writeFileSync(path.join(outside, 'huge.bin'), Buffer.alloc(1024 * 1024, 3));
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
const link = path.join(cache, 'link-to-outside');
// 2026-11-22（B2）：本用例的前提是「本机真能建出可识别的符号链接」。Windows 上若无
// SeCreateSymbolicLinkPrivilege，'dir' 类型直接 EPERM；Node 26 上 junction 的
// lstat().isSymbolicLink() 也可能为 false（实测过）。此时用例无意义 —— 打印原因并 SKIP，
// 而不是 FAIL：本机长期红灯会把真缺陷埋掉。CI（ubuntu）仍真跑。
let linkReady = false;
let linkWhy = '';
try {
  fs.symlinkSync(outside, link, linkType);
  linkReady = fs.lstatSync(link).isSymbolicLink();
  if (!linkReady) linkWhy = "junction 的 lstat().isSymbolicLink() 为 false（Node " + process.version + "）";
} catch (e) {
  linkWhy = 'symlink 创建失败：' + (e.code || e.message);
}
if (!linkReady) {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
  console.log('clean-symlink: SKIP（本机建不出可识别的符号链接：' + linkWhy + '）—— CI（ubuntu）真跑');
  process.exit(0);
}

// ① 统计不跟随
const s = scan();
const g = s.groups.find((x) => x.id === 'cache-image-gen');
assert.ok(g, '应扫到 cache-image-gen 组');
const e0 = g.entries[0];
assert.equal(e0.files, 2, '只该数到 2 个真文件（链接跳过），实得 ' + e0.files);
assert.ok(e0.bytes >= 500 && e0.bytes < 5000, '字节数不该跟随链接（应约 500，实得 ' + e0.bytes + '）');

// 预演不动文件
const dry = apply(['cache-image-gen'], { dryRun: true });
assert.equal(dry.ok, true, 'dryRun 应成功');
assert.ok(fs.existsSync(cache), 'dryRun 不该动任何文件');

// ② 腾挪不搬链接目标
const r = apply(['cache-image-gen']);
assert.equal(r.ok, true, 'apply 应成功：' + JSON.stringify(r.skipped));
assert.ok(!fs.existsSync(cache), '原位置应已腾空');
assert.equal(r.items.length, 1, '应腾挪 1 个条目');
const moved = r.items[0].to;
const movedLink = path.join(moved, 'link-to-outside');
assert.ok(fs.lstatSync(movedLink).isSymbolicLink(), '回收区里的链接必须仍是链接（被解引用就是缺陷）');
assert.equal(fs.realpathSync(movedLink), fs.realpathSync(outside), '链接目标字符串不该被改写');

// 只数「真文件」：符号链接在 Dirent 上 isDirectory/isFile 都为 false（Windows junction 也是），
// 所以必须显式跳过——否则它会被当成文件数进来，是遍历器自己的缺陷。
const walked = [];
(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (e.isFile()) walked.push(p);
  }
})(moved);
assert.equal(walked.length, 2, '回收区只该有 2 个真文件，实得 ' + walked.length + '：' + walked.map((p) => path.basename(p)).join(','));
assert.ok(!walked.some((p) => p.endsWith('huge.bin')), '不该把外部文件复制进回收区');
assert.ok(fs.existsSync(path.join(outside, 'huge.bin')), '外部目录必须原样还在（既没被搬走也没被清）');

// ③ 还原后仍是链接
const back = restore(r.batch);
assert.equal(back.ok, true, 'restore 应成功');
assert.deepEqual(back.conflicts, [], '不该有冲突');
assert.ok(fs.existsSync(path.join(cache, 'a.bin')), '还原后真文件应回到原位');
const backLink = path.join(cache, 'link-to-outside');
assert.ok(fs.lstatSync(backLink).isSymbolicLink(), '还原后仍必须是链接');
assert.equal(fs.realpathSync(backLink), fs.realpathSync(outside), '还原后链接目标应指回原处');

// 跨设备分支（rename 会 EXDEV）在测试环境里造不出第二个卷，只能静态钉住：
// 回落到 cpSync 时缺了 verbatimSymlinks，链接就会被**解引用**成目录副本——
// 那正是审计报告 §7 当初担心的事，也是「回收区里躺着 DSH_HOME 外的真实数据」的成因。
const src = fs.readFileSync(new URL('../src/clean.mjs', import.meta.url), 'utf8');
assert.ok(/fs\.renameSync\(from, to\)/.test(src), 'moveEntry 应优先 rename（同盘原子）');
assert.ok(/verbatimSymlinks:\s*true/.test(src), 'EXDEV 回落的 cpSync 必须带 verbatimSymlinks: true');

fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
console.log('clean-symlink: 通过（统计不跟随 · 不搬链接目标 · 还原保链接 · EXDEV 分支静态钉住）');
