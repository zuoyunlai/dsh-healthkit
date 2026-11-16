// 能力域矩阵：判定、阶梯、渲染三件事。
import assert from 'node:assert/strict';
import { buildMatrix, ladderOf, renderMatrix } from '../src/capability-map.mjs';

const facts = {
  profiles: [{
    name: 'desktop',
    bundles: ['@deepseek-ai/dsh-base', 'dsh-free-search', 'dsh-image-gen', '@liustack/modlens', '@goodandready/dsh-vision-bridge'],
    thirdPartyBundles: ['dsh-free-search', 'dsh-image-gen', '@liustack/modlens', '@goodandready/dsh-vision-bridge'],
  }],
};
const m = buildMatrix(facts);
assert.equal(m.rows.length, 20, '能力域应是 20 个');

const byKey = {};
for (const r of m.rows) byKey[r.key] = r;

// 单实现 → ok
assert.equal(byKey.search.status, 'ok');
assert.equal(byKey.search.count, 1);
// 多实现 → redundant
assert.equal(byKey.vision.status, 'redundant');
assert.equal(byKey.vision.count, 2);
// provider 不可静态判定 → unknown（不是 missing，不冤枉也不猜）
assert.equal(byKey.provider.status, 'unknown');
// 真的没有 → missing
assert.equal(byKey.voice.status, 'missing');

// 阶梯：missing 必须先配置、再内置、最后才是装插件
const lad = ladderOf(byKey.voice);
assert.equal(lad.length, 3);
assert.ok(lad[0].includes('配置层'));
assert.ok(lad[1].includes('宿主内置'));
assert.ok(lad[2].includes('装插件'));
// ok 的域不需要阶梯
assert.equal(ladderOf(byKey.search).length, 1);

const text = renderMatrix(m);
assert.ok(text.includes('能力域 20 个'));
assert.ok(text.includes('不代表你该装'), '必须说清 missing ≠ 该装');
assert.ok(text.includes('多实现'));

console.log('capability-map: 通过（20 域 · 单/多/无/未知四态 · 三级阶梯）');
