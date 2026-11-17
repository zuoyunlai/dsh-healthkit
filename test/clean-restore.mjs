// 回收区还原的安全守卫（2026-11-17 代码审查 P1-1）。
//
// 修前：`restore(batch)` 直接 `path.join(trashDir(), String(batch))`，且完全信任清单里的
// `from` / `to`。于是
//   ① `batch='../..'` 能让回收区之外的 manifest 被读到并按它搬文件；
//   ② 清单里 `from=/etc/passwd` 之类可以指向 DSH_HOME 之外 → 恢复即任意文件移动。
// apply() 侧一直有 insideHome + forbidden 两道校验，restore 侧此前是裸的。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-restore-'));
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-outside-'));
process.env.DSH_HOME = home;

const { restore, trashDir } = await import('../src/clean.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

function makeBatch(batch, items) {
  const dir = path.join(trashDir(), batch);
  fs.mkdirSync(path.join(dir, 'items'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    batch, createdAt: new Date().toISOString(), home,
    totals: { bytes: 1, files: 1, entries: items.length }, items,
  }, null, 2));
  return dir;
}

// ① 正常批次：从回收区搬回 DSH_HOME 内
{
  const batch = '20990101-000000';
  const dir = makeBatch(batch, []);
  const to = path.join(dir, 'items', '001-file.txt');
  fs.writeFileSync(to, 'hello');
  const from = path.join(home, 'cache', 'restored.txt');
  fs.mkdirSync(path.dirname(from), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    batch, home, totals: { entries: 1, bytes: 5, files: 1 },
    items: [{ from, to, bytes: 5, files: 1, group: 'cache', kind: 'file' }],
  }, null, 2));
  const r = restore(batch);
  ok('合法批次应还原成功', r.ok === true && r.restored.length === 1, JSON.stringify(r));
  ok('文件应回到原位置', fs.existsSync(from));
}

// ② batch 名穿越
for (const bad of ['../..', '..', '../../etc', 'a/b', '']) {
  const r = restore(bad);
  ok('非法批次名必须被拒：' + JSON.stringify(bad), r.ok === false, r.error || '');
}

// ③ 清单 from 指向 DSH_HOME 之外
{
  const batch = '20990102-000000';
  const dir = makeBatch(batch, []);
  const to = path.join(dir, 'items', '001-evil');
  fs.writeFileSync(to, 'payload');
  const victim = path.join(outside, 'victim.txt');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    batch, home, totals: { entries: 1 },
    items: [{ from: victim, to, bytes: 7, files: 1, group: 'x', kind: 'file' }],
  }, null, 2));
  const r = restore(batch);
  ok('清单 from 越界必须被拒', r.ok === true && r.restored.length === 0, JSON.stringify(r));
  ok('越界目标位置不许被写入', !fs.existsSync(victim));
  ok('被拒条目要留在回收区', fs.existsSync(to));
  ok('必须报出原因', (r.conflicts || []).some((c) => /越界|护栏/.test(c)), JSON.stringify(r.conflicts));
}

// ④ 清单 to 不在本批次目录内
{
  const batch = '20990103-000000';
  const dir = makeBatch(batch, []);
  const stray = path.join(trashDir(), 'stray.txt');
  fs.writeFileSync(stray, 'x');
  const from = path.join(home, 'cache', 'stray-target.txt');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    batch, home, totals: { entries: 1 },
    items: [{ from, to: stray, bytes: 1, files: 1, group: 'x', kind: 'file' }],
  }, null, 2));
  const r = restore(batch);
  ok('清单 to 越出批次目录必须被拒', r.restored.length === 0, JSON.stringify(r));
}

// ⑤ 清单 items 不是数组
{
  const batch = '20990104-000000';
  makeBatch(batch, []);
  fs.writeFileSync(path.join(trashDir(), batch, 'manifest.json'), JSON.stringify({ batch, home, items: 'nope' }), 'utf8');
  const r = restore(batch);
  ok('清单 items 非数组必须被拒', r.ok === false, r.error || '');
}

// ⑥ 命中护栏的路径同样拒绝（例如 node_modules）
{
  const batch = '20990105-000000';
  const dir = makeBatch(batch, []);
  const to = path.join(dir, 'items', '001-nm');
  fs.mkdirSync(to, { recursive: true });
  const from = path.join(home, '_backup', 'node_modules');
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    batch, home, totals: { entries: 1 },
    items: [{ from, to, bytes: 1, files: 1, group: 'x', kind: 'dir' }],
  }, null, 2));
  const r = restore(batch);
  ok('命中护栏的 from 必须被拒', r.restored.length === 0 && (r.conflicts || []).some((c) => /护栏/.test(c)), JSON.stringify(r));
}

fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(outside, { recursive: true, force: true });
console.log('clean-restore: 通过（' + n + ' 项断言 · 批次名穿越 / 清单两端越界 / 护栏 / items 形状）');
