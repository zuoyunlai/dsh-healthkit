// reportpath 回归（issue #1：缺省落点不许回到 process.cwd）
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveReportPath, reportFileName, localDate } from '../src/reportpath.mjs';

const now = new Date(2026, 10, 16, 12, 0, 0);
// 所有路径都用**平台自己的方式**构造绝对路径。
//
// 2026-11-16 踩了两次：先写死 'D:/reports/x.md'，再写死 home='C:/...' ws='E:/work'——
// 这些在 POSIX 上都不是绝对路径（path.isAbsolute 为 false），于是「绝对路径照用」
// 与「相对路径以工作区为基准」两条在 Linux CI 上必然失败。
// 路径语义不同，不是代码有错——所以要改的是夹具，不是实现。
const absHome = path.resolve(path.sep + 'home' + path.sep + 'u' + path.sep + '.dsh');
const absWs = path.resolve(path.sep + 'work');
const absOut = path.resolve(path.sep + 'reports' + path.sep + 'x.md');
const home = absHome;
const ws = absWs;

let n = 0;
const t = (name, fn) => { fn(); n += 1; console.log('  ok ' + n + ' - ' + name); };

t('文件名用本地日期', () => {
  assert.equal(reportFileName(now), 'AUDIT-2026-11-16.md');
  assert.equal(localDate(now), '2026-11-16');
});

t('缺省落会话工作区', () => {
  const r = resolveReportPath({ now, workspace: ws, home });
  assert.equal(r.source, 'workspace');
  assert.equal(r.path, path.join(ws, 'AUDIT-2026-11-16.md'));
  assert.ok(path.isAbsolute(r.path), '落点必须是绝对路径');
});

t('取不到工作区时落插件数据目录，不落 cwd', () => {
  const r = resolveReportPath({ now, home });
  assert.equal(r.source, 'fallback');
  assert.equal(r.path, path.join(home, 'dsh-healthkit', 'reports', 'AUDIT-2026-11-16.md'));
  assert.ok(!r.path.includes('profiles'));
  assert.ok(path.isAbsolute(r.path), '落点必须是绝对路径');
});

t('out 绝对路径照用', () => {
  const r = resolveReportPath({ now, workspace: ws, home, out: absOut });
  assert.equal(r.source, 'out');
  assert.equal(r.path, absOut);
  assert.ok(path.isAbsolute(absOut), '测试自身要保证 out 真的是绝对路径');
});

t('out 相对路径以工作区为基准', () => {
  const r = resolveReportPath({ now, workspace: ws, home, out: 'docs/x.md' });
  assert.equal(r.path, path.resolve(ws, 'docs/x.md'));
  assert.ok(path.isAbsolute(r.path), '落点必须是绝对路径');
});

t('out 相对但无工作区 → 显式报错', () => {
  const r = resolveReportPath({ now, home, out: 'docs/x.md' });
  assert.ok(r.error && r.path === undefined);
});

t('reportDir 优先于工作区缺省，但仍落后于 out', () => {
  const a = resolveReportPath({ now, workspace: ws, home, reportDir: 'r' });
  assert.equal(a.source, 'config.reportDir');
  assert.equal(a.path, path.join(path.resolve(ws, 'r'), 'AUDIT-2026-11-16.md'));
  const b = resolveReportPath({ now, workspace: ws, home, reportDir: 'r', out: absOut });
  assert.equal(b.source, 'out');
});

t('空串视为未给（config 默认 reportDir: ""）', () => {
  const r = resolveReportPath({ now, workspace: ws, home, reportDir: '', out: '   ' });
  assert.equal(r.source, 'workspace');
});

console.log('reportpath: ' + n + '/8 通过');
