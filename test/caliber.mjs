// 口径回归（2026-11-22 反哺，对应 backlog B3b / B4；B1 在 test/capability-map.mjs 里钉）：
//   · B4：trim 的 maxBundles 必须与 R15 同源（现算各 profile 最大值），不许再是硬编码 43；
//         对外文案不许再出现「宿主上限」——它不是宿主给的常量。
//   · B3b：capabilities 的 image 标签不许吞掉视觉插件（否则 trim 报假「image ×3」）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { analyze, render } from '../src/trim.mjs';
import { tagProfile } from '../src/capabilities.mjs';

// B4：两个 profile 长度不同，必须取最大值（旧实现恒为 43）
const facts = {
  profiles: [
    { name: 'a', bundles: ['x', 'y', 'z'] },
    { name: 'b', bundles: ['1', '2', '3', '4', '5', '6', '7'] },
  ],
  logs: { servedPlugins: 9 },
  capabilities: {},
};
const r = analyze(facts);
assert.equal(r.maxBundles, 7, 'maxBundles 应现算为 7（最大 profile），实得 ' + r.maxBundles);
assert.ok(r.suggestions.some((s) => /配比失衡，不是官方上限/.test(s)),
  '超基线提示必须写明不是官方上限：' + r.suggestions.join(' | '));
const txt = render(r) + ' ' + r.suggestions.join(' ');
assert.ok(!/宿主上限|宿主 bundles 上限/.test(txt), '对外文案不许再出现「宿主上限」');

// 基线为 0（没有 profile bundles）时不能反过来判超限
const empty = analyze({ profiles: [{ name: 'a', bundles: [] }], logs: { servedPlugins: 9 }, capabilities: {} });
assert.equal(empty.maxBundles, 0);
assert.ok(!empty.suggestions.some((s) => /配比失衡/.test(s)), '基线为 0 时不能判超限');

// B3b：视觉插件不许被打成 image 实现
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-caliber-'));
const dir = path.join(home, 'p');
for (const [name, desc] of [
  ['dsh-image-gen', 'image generation for deepseek harness'],
  ['@liustack/modlens', 'Plug-in vision bridge for text-only LLMs, OCR ready'],
  ['@goodandready/dsh-vision-bridge', 'multimodal vision hub with ocr'],
]) {
  const p = path.join(dir, 'node_modules', name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'package.json'), JSON.stringify({ name, description: desc }));
}
const tagged = tagProfile({ dir, bundles: ['dsh-image-gen', '@liustack/modlens', '@goodandready/dsh-vision-bridge'] });
const byName = {};
for (const t of tagged) byName[t.name] = t.tags;
assert.deepEqual(byName['dsh-image-gen'], ['image'], 'image-gen 应打 image 标签');
assert.ok(!(byName['@liustack/modlens'] || []).includes('image'), 'modlens 不该打 image 标签：' + JSON.stringify(byName));
assert.ok(!(byName['@goodandready/dsh-vision-bridge'] || []).includes('image'), 'vision-bridge 不该打 image 标签：' + JSON.stringify(byName));
fs.rmSync(home, { recursive: true, force: true });

console.log('caliber: 通过（B4 maxBundles 现算 · 文案无「宿主上限」· B3b 视觉不打 image）');
