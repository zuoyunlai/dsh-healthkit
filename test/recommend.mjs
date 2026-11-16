// 能力域推荐源：三条红线必须被测试钉住。
//   ① 装插件是最后手段（阶梯顺序固定）
//   ② 不联网、不给具体包名（只给搜索关键词）
//   ③ missing ≠ 该装（文案里必须写明）
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-rec-'));
process.env.DSH_HOME = home;

const { audit } = await import('../src/engine.mjs');
const { buildRecommend, renderRecommend } = await import('../src/recommend.mjs');

const r = audit({ scenario: 'general' });
const doc = buildRecommend(r.facts);

assert.equal(doc.schema, 'dsh-healthkit/recommend/v1');
assert.equal(doc.domains.length, 20, '应为 20 个能力域');
assert.deepEqual(doc.policy.order, ['配置', 'provider', '插件', '习惯']);

// ① 阶梯四级、顺序固定；插件级必须带「为什么配置补不上」
for (const d of doc.domains) {
  assert.equal(d.ladder.length, 4, d.key + ' 阶梯应四级');
  assert.ok(/配置层/.test(d.ladder[0]), d.key + ' 第一级应是配置层');
  assert.ok(/provider 层/.test(d.ladder[1]), d.key + ' 第二级应是 provider 层');
  assert.ok(/插件层/.test(d.ladder[2]), d.key + ' 第三级应是插件层');
  assert.ok(/习惯层/.test(d.ladder[3]), d.key + ' 第四级应是习惯层');
}

// ② 不给具体包名：只给搜索关键词；关键词不得看起来像包名（含 / 或 . 且像版本号）
for (const d of doc.domains) {
  const kw = d.sources.searchKeyword || '';
  if (kw) {
    assert.ok(!/^@?[a-z0-9-]+\/[a-z0-9-]+/.test(kw), d.key + ' 关键词不该像包名：' + kw);
    assert.ok(!/\d+\.\d+\.\d+/.test(kw), d.key + ' 关键词不该带版本号：' + kw);
  }
  // 宿主内置可以给具体名（那是宿主自己的行，不是第三方包）
}

// ③ missing ≠ 该装：policy 与渲染文案都要说明
assert.ok(/不代表你该装/.test(doc.policy.missingMeans), 'policy 应写明 missing ≠ 该装');
const text = renderRecommend(doc);
assert.ok(/不代表你该装/.test(text), '渲染文案应写明 missing ≠ 该装');
assert.ok(/不联网/.test(doc.policy.offline), 'policy 应写明不联网');
assert.ok(/不联网/.test(text), '渲染文案应写明不联网');

// 不得含绝对本机路径（推荐源要可分享）
const raw = JSON.stringify(doc);
assert.ok(!/C:\\Users\\/i.test(raw), '推荐源里不该有本机用户目录绝对路径');
assert.ok(!/[A-Z]:[\\/]/i.test(raw), '推荐源里不该有本机盘符路径');

fs.rmSync(home, { recursive: true, force: true });
console.log('recommend: 通过（20 域 · 四级阶梯 · 无包名 · missing≠该装 · 可分享）');
