// 清理护栏守卫矩阵（架构审计 P0-A1）。
//
// 背景：原护栏写法是 `[\\/]name([\\/]|\$)`，`\$` 是**转义的字面美元号**而不是结尾锚点，
// 于是「路径终段就是受保护名」——恰恰是它唯一要保护的情形——全部漏过。
// 实测 `C:/_backup/node_modules` 直接通过，只有 `.../node_modules/xxx` 才被挡；
// 而 grep 全仓 test/ 对 FORBIDDEN 零命中，说明这条护栏从来没被测过。
//
// 本测试钉三件事：
//   ① 8 个受保护名 × 3 种位置（终段/中段/子段）逐一必须挡；
//   ② 形近名（data-backup / mydata / sessions.db / node_modules.bak）不许误挡；
//   ③ purge（唯一不可逆的一步）对清单里含受保护项的批次必须拒绝，且不动目录。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-clean-guard-'));
process.env.DSH_HOME = home;

// 动态 import：DSH_HOME 必须在模块求值前设上（paths 会在导入期解析 home）。
const { forbidden, PROTECTED_NAMES, purge, trashDir } = await import('../src/clean.mjs');

let n = 0;
function ok(name, cond) {
  n += 1;
  assert.ok(cond, name);
}

// ① 受保护名 × 3 位置
for (const name of PROTECTED_NAMES) {
  const cases = [
    ['终段', path.join(home, '_backup', name)],
    ['中段', path.join(home, '_backup', name, 'pkg')],
    ['子段', path.join(home, '_backup', 'old', name, 'x.txt')],
  ];
  for (const [pos, p] of cases) ok('应挡下 [' + name + '·' + pos + '] ' + p, forbidden(p) !== null);
}

// ② 形近名不许误挡（护栏过宽会把正常清理全挡死，也是 bug）
for (const p of [
  path.join(home, '_backup', 'data-backup'),
  path.join(home, '_backup', 'mydata'),
  path.join(home, '_backup', 'sessions.db'),
  path.join(home, '_backup', 'node_modules.bak'),
  path.join(home, '_backup', 'attachments-old'),
]) ok('不该挡 ' + p, forbidden(p) === null);

// ③ purge 二次校验：护栏漏过的历史批次，不许被永久删除
const stamp = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString();

function makeBatch(batch, items, daysAgo) {
  const dir = path.join(trashDir(), batch);
  fs.mkdirSync(path.join(dir, 'items'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    batch,
    createdAt: stamp(daysAgo),
    restoreBefore: stamp(daysAgo),
    home,
    totals: { bytes: items.length * 10, files: items.length, entries: items.length },
    items,
  }, null, 2));
  return dir;
}

const badDir = makeBatch('20990101-000000', [{
  from: path.join(home, '_backup', 'node_modules'),
  to: path.join(trashDir(), '20990101-000000', 'items', '001-node_modules'),
  bytes: 10, files: 1, group: 'backup-aged', kind: 'dir',
}], 30);

const goodDir = makeBatch('20990102-000000', [{
  from: path.join(home, 'cache', 'dsh-image-gen'),
  to: path.join(trashDir(), '20990102-000000', 'items', '001-dsh-image-gen'),
  bytes: 10, files: 1, group: 'cache-image-gen', kind: 'dir',
}], 30);

const dry = purge({ olderThanDays: 7, dryRun: true });
ok('预演应把含受保护项的批次列为拒绝', dry.refused.length === 1 && dry.candidates.indexOf('20990102-000000') !== -1);

const r = purge({ olderThanDays: 7 });
ok('应拒绝删除含受保护项的批次', r.purged.indexOf('20990101-000000') === -1 && r.refused.length === 1);
ok('被拒绝的批次目录必须还在', fs.existsSync(badDir));
ok('正常批次应被删除', r.purged.indexOf('20990102-000000') !== -1 && !fs.existsSync(goodDir));

fs.rmSync(home, { recursive: true, force: true });
console.log('clean-guard: 通过（' + n + ' 项断言 · ' + PROTECTED_NAMES.length + ' 个受保护名 × 3 位置 + purge 二次校验）');
