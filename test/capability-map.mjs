// 能力域矩阵：六态判定 + 四级阶梯 + 「装插件建议必须说明为什么配置补不上」。
import assert from 'node:assert/strict';
import { buildMatrix, ladderOf, renderMatrix, assertPluginAdvice, STATES } from '../src/capability-map.mjs';

// 六态齐全
assert.equal(STATES.length, 6);
assert.deepEqual(STATES.slice().sort(), ['conflicting', 'degraded', 'missing', 'present', 'redundant', 'unknown'].sort());

const facts = {
  profiles: [{
    name: 'desktop',
    bundles: ['@deepseek-ai/dsh-base', 'dsh-free-search', 'dsh-image-gen', '@liustack/modlens', '@goodandready/dsh-vision-bridge', 'dsh-chronicle', 'dsh-mnemon'],
    thirdPartyBundles: ['dsh-free-search', 'dsh-image-gen', '@liustack/modlens', '@goodandready/dsh-vision-bridge', 'dsh-chronicle', 'dsh-mnemon'],
  }],
  patchEntries: {
    desktop: [
      { id: 'web-search-free', name: 'dsh-free-search', config: { fetchProviderTakeover: true } },
      { id: 'web', name: '@deepseek-ai/dsh-web', config: { fetchProvider: 'deepseek-fetch-api' } },
      { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { a: {}, b: {} } } },
      { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: { auto: true, modelPolicies: [{ provider: 'a', model: 'm1' }] } },
      { id: 'permission', name: '@deepseek-ai/dsh-permission-presets', config: { defaultPreset: 'danger-full-access', presets: {} } },
    ],
  },
  machines: null,
  costTracker: null,
};

const m = buildMatrix(facts);
assert.equal(m.rows.length, 20, '能力域应是 20 个');
const byKey = {};
for (const r of m.rows) byKey[r.key] = r;

// conflicting：接管型与宿主 provider 并存
assert.equal(byKey['web-search'].status, 'conflicting');
assert.ok(/接管/.test(byKey['web-search'].detail));
// degraded：声明 2 个 provider，只有 1 个有策略
assert.equal(byKey['model-routing'].status, 'degraded');
// degraded：默认档位 danger-full-access
assert.equal(byKey['security-boundary'].status, 'degraded');
// degraded：无成本记账
assert.equal(byKey['cost-visibility'].status, 'degraded');
// redundant：两个视觉实现
assert.equal(byKey['vision-ocr'].status, 'redundant');
// missing：没有音视频
assert.equal(byKey.av.status, 'missing');
// unknown：会话持久化由宿主承担
assert.equal(byKey['session-persist'].status, 'unknown');

// 六态在渲染里都要出现
const text = renderMatrix(m);
assert.ok(text.includes('能力域 20 个'));
assert.ok(text.includes('互相冲突'));
assert.ok(text.includes('失效'));
assert.ok(text.includes('不代表你该装'));

// 阶梯必须四级，且「装插件」这条必须带「为什么配置补不上」
for (const key of ['av', 'web-search', 'model-routing', 'session-persist']) {
  const lad = ladderOf(byKey[key]);
  assert.equal(lad.length, 4, key + ' 阶梯应四级，实得 ' + lad.length);
  assert.ok(/配置层/.test(lad[0]), key + ' 第一级应是配置层');
  assert.ok(/provider 层/.test(lad[1]), key + ' 第二级应是 provider 层');
  assert.ok(/插件层/.test(lad[2]), key + ' 第三级应是插件层');
  assert.ok(/习惯层/.test(lad[3]), key + ' 第四级应是习惯层');
}

// 硬规则：没有「为什么配置补不上」的装插件建议不许出
assert.equal(assertPluginAdvice({ status: 'missing' }, '③ 插件层：按关键词搜 xxx'), false);
assert.equal(assertPluginAdvice({ status: 'missing' }, '③ 插件层：配置层补不上时才考虑，按关键词搜 xxx'), true);
assert.equal(assertPluginAdvice({ status: 'missing' }, '① 配置层：先看配置'), true);

// 渲染里的每条阶梯都必须过这个断言
for (const line of text.split('\n')) {
  if (/^\s{4}[①②③④]/.test(line)) {
    assert.ok(assertPluginAdvice({}, line), '渲染出的阶梯违反硬规则：' + line.trim());
  }
}

console.log('capability-map: 通过（20 域 · 六态 · 四级阶梯 · 装插件建议硬规则）');
