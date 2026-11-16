// reportpath 回归（issue #1：缺省落点不许回到 process.cwd）
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveReportPath, reportFileName, localDate } from '../src/reportpath.mjs';

const now = new Date(2026, 10, 16, 12, 0, 0);
const home = 'C:/Users/u/.dsh';
const ws = 'E:/work';

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
});

t('取不到工作区时落插件数据目录，不落 cwd', () => {
  const r = resolveReportPath({ now, home });
  assert.equal(r.source, 'fallback');
  assert.equal(r.path, path.join(home, 'dsh-auditkit', 'reports', 'AUDIT-2026-11-16.md'));
  assert.ok(!r.path.includes('profiles'));
});

t('out 绝对路径照用', () => {
  const r = resolveReportPath({ now, workspace: ws, home, out: 'D:/reports/x.md' });
  assert.equal(r.source, 'out');
  assert.equal(r.path, 'D:/reports/x.md');
});

t('out 相对路径以工作区为基准', () => {
  const r = resolveReportPath({ now, workspace: ws, home, out: 'docs/x.md' });
  assert.equal(r.path, path.resolve(ws, 'docs/x.md'));
});

t('out 相对但无工作区 → 显式报错', () => {
  const r = resolveReportPath({ now, home, out: 'docs/x.md' });
  assert.ok(r.error && r.path === undefined);
});

t('reportDir 优先于工作区缺省，但仍落后于 out', () => {
  const a = resolveReportPath({ now, workspace: ws, home, reportDir: 'r' });
  assert.equal(a.source, 'config.reportDir');
  assert.equal(a.path, path.join(ws, 'r', 'AUDIT-2026-11-16.md'));
  const b = resolveReportPath({ now, workspace: ws, home, reportDir: 'r', out: 'D:/y.md' });
  assert.equal(b.source, 'out');
});

t('空串视为未给（config 默认 reportDir: ""）', () => {
  const r = resolveReportPath({ now, workspace: ws, home, reportDir: '', out: '   ' });
  assert.equal(r.source, 'workspace');
});

console.log('reportpath: ' + n + '/8 通过');
