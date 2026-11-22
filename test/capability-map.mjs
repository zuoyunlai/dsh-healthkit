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
      // 2026-11-22（B1/B3a）：fixture 要能区分「委托接线」与「真冲突」，也要区分「有模型的 provider」与空壳。
      { id: 'web', name: '@deepseek-ai/dsh-web', config: { fetchProvider: 'fs-quality-fetch' } },
      { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { a: { models: [{ id: 'm1' }] }, b: { models: [{ id: 'm2' }] }, c: {} } } },
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

// B3a：宿主把 fetchProvider 指向插件注册的 provider + 插件 takeover = 单入口委托，不是冲突
assert.equal(byKey['web-search'].status, 'present');
assert.ok(/接管/.test(byKey['web-search'].detail));
// B1：缺口按 (profile, provider) 同集合算 —— b 有模型无策略 → degraded；c 是空壳不计缺口
assert.equal(byKey['model-routing'].status, 'degraded');
assert.ok(/b（1 个模型）/.test(byKey['model-routing'].detail), 'detail 要点名 b 及其模型数：' + byKey['model-routing'].detail);
assert.ok(/空壳/.test(byKey['model-routing'].detail), 'detail 要把 0 模型的空壳单列：' + byKey['model-routing'].detail);
assert.ok(!/desktop\/a（/.test(byKey['model-routing'].detail), 'a 有策略，不该进缺口');
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

// B3a 反例一：两个插件都想接管 → 真冲突
const twoTake = JSON.parse(JSON.stringify(facts));
twoTake.patchEntries.desktop.push({ id: 'web-fetch-alt', name: 'dsh-web-fetch-playwright', config: { fetchProviderTakeover: true } });
assert.equal(buildMatrix(twoTake).rows.find((r) => r.key === 'web-search').status, 'conflicting', '两个插件都想接管必须判冲突');
// B3a 反例二：两个实现把 fetchProvider 指向不同 provider → 真冲突
const twoPin = JSON.parse(JSON.stringify(facts));
twoPin.patchEntries.desktop.push({ id: 'web-fetch-alt', name: 'dsh-web-fetch-playwright', config: { fetchProvider: 'playwright' } });
assert.equal(buildMatrix(twoPin).rows.find((r) => r.key === 'web-search').status, 'conflicting', '两个不同的 fetchProvider 必须判冲突');
// B3c：配色 / 侧栏增强 / 右侧导航分工不同，不再被算成主题域重复
const themish = JSON.parse(JSON.stringify(facts));
themish.profiles[0].thirdPartyBundles.push('dsh-theme-palette', 'dsh-better-sidebar', 'dsh-rightbar-quicknav');
assert.notEqual(buildMatrix(themish).rows.find((r) => r.key === 'theme-a11y').status, 'redundant', '三件套分工不同，不该判重复');

// 六态在渲染里都要出现
const text = renderMatrix(m);
assert.ok(text.includes('能力域 20 个'));
assert.ok(renderMatrix(buildMatrix(twoTake)).includes('互相冲突'), '冲突态在渲染里要有专门一节');
assert.ok(text.includes('失效'));
assert.ok(text.includes('不代表你该装'));

// 阶梯必须四级，且「装插件」这条必须带「为什么配置补不上」
// present 态没有补救阶梯（1 条），所以这里只钉非 present 的域；冲突态单列一条
const conflictRow = buildMatrix(twoTake).rows.find((r) => r.key === 'web-search');
assert.equal(ladderOf(conflictRow).length, 4, '冲突态也要四级阶梯，实得 ' + ladderOf(conflictRow).length);
for (const key of ['av', 'model-routing', 'session-persist']) {
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
