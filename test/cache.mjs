// 事实缓存（架构审计 B4）必须「快」，但不能「旧」。
//
// 修前实测：三次连续 audit() = 1016 / 854 / 933 ms —— 完全没有复用，
// 而 14 个工具里 13 个各自 audit() 一遍，面板还每分钟重算。
// 修后：1051 / 18 / 19 ms。
//
// 本测试钉三件事：
//   ① TTL 内复用同一份 facts（collectedAt 相同）；
//   ② 改配置（profile 的 package.json）后指纹变化 → 自动重采，不许拿到旧数据；
//   ③ opts.fresh 与 DSH_HEALTHKIT_NO_CACHE=1 两个旁路都能强制重采。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-cache-'));
const profile = path.join(home, 'profiles', 'p1');
fs.mkdirSync(path.join(profile, 'node_modules'), { recursive: true });
const writePkg = (bundles) => fs.writeFileSync(path.join(profile, 'package.json'),
  JSON.stringify({ name: 'p1', private: true, dependencies: {}, dsh: { profile: { bundles } } }, null, 2));
writePkg([]);
process.env.DSH_HOME = home;

const { audit } = await import('../src/engine.mjs');
const { clearFactsCache, factsCacheInfo, TTL_MS } = await import('../src/cache.mjs');

let n = 0;
function ok(name, cond) {
  n += 1;
  assert.ok(cond, name);
}

const a = audit({ scenario: 'general' });
const b = audit({ scenario: 'general' });
ok('TTL 内应复用同一份 facts（collectedAt 相同）', a.facts.collectedAt === b.facts.collectedAt);
ok('缓存应记录当前 home', factsCacheInfo().some((x) => x.home === home && x.fresh));
ok('TTL 应为正数', typeof TTL_MS === 'number' && TTL_MS > 0);

// 改配置：指纹（profiles/p1/package.json 的 mtime+size）必须变化
const before = b.facts.collectedAt;
writePkg(['@deepseek-ai/dsh-base']);
const c = audit({ scenario: 'general' });
ok('改了 profile 的 package.json 后必须重采（不许返回旧 facts）', c.facts.collectedAt !== before);
ok('重采后内容应反映新配置',
  (c.facts.profiles[0].bundles || []).indexOf('@deepseek-ai/dsh-base') !== -1);

// 旁路 1：opts.fresh
const d1 = c.facts.collectedAt;
const d = audit({ scenario: 'general', fresh: true });
ok('opts.fresh 必须绕过缓存', d.facts.collectedAt !== d1 && d1 !== undefined);

// 旁路 2：环境变量整体关闭
clearFactsCache();
process.env.DSH_HEALTHKIT_NO_CACHE = '1';
const e1 = audit({ scenario: 'general' });
const e2 = audit({ scenario: 'general' });
ok('DSH_HEALTHKIT_NO_CACHE=1 时两次必须各自采集', e1.facts.collectedAt !== e2.facts.collectedAt);
delete process.env.DSH_HEALTHKIT_NO_CACHE;

fs.rmSync(home, { recursive: true, force: true });
console.log('cache: 通过（' + n + ' 项断言 · TTL 复用 + 指纹失效 + 两条旁路）');
