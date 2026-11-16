// 分层守门（架构审计 B2 + ③-1）。
//
// 插件自述的契约是「采集层判定，规则层只读事实」——但修前 rules.mjs 自己读
// node_modules/<pkg>/package.json 和 remote-workspaces/machines.json，
// 于是那几条规则的行为依赖运行机器，夹具永远盖不到，`npm test` 全绿也不代表它们被验过。
//
// 本测试把这条契约变成可执行的：rules.mjs 一旦再出现文件系统调用就红。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');
const read = (f) => fs.readFileSync(path.join(src, f), 'utf8');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

// ① 规则层不许碰文件系统
const rules = read('rules.mjs');
ok('rules.mjs 不许调用 fs.*', !/\bfs\s*\./.test(rules), (rules.match(/\bfs\s*\.[a-zA-Z]+/g) || []).join(','));
ok('rules.mjs 不许调用 readJson(', !/\breadJson\s*\(/.test(rules));
ok('rules.mjs 不许 import node:fs', !/from ['"]node:fs['"]/.test(rules));

// ② 采集层是 FS 的单一入口（至少对「已安装版本 / machines」这两个事实）
const collect = read('collect.mjs');
ok('collect.mjs 必须采集 installedExclusions', /installedExclusions/.test(collect));
ok('collect.mjs 必须采集 machines', /facts\.machines\s*=/.test(collect));

// ③ 模块导入图不许有环（含自身依赖）
const files = fs.readdirSync(src).filter((f) => f.endsWith('.mjs'));
const graph = {};
for (const f of files) {
  const txt = read(f);
  const deps = [];
  for (const m of txt.matchAll(/from\s+['"]\.\/([A-Za-z0-9._-]+)['"]/g)) deps.push(m[1]);
  graph[f] = deps.filter((d) => d.endsWith('.mjs'));
}
const state = {};
const cycle = [];
function dfs(f, stack) {
  if (state[f] === 'done') return;
  if (state[f] === 'doing') { cycle.push(stack.concat(f).join(' → ')); return; }
  state[f] = 'doing';
  for (const d of graph[f] || []) if (graph[d]) dfs(d, stack.concat(f));
  state[f] = 'done';
}
for (const f of Object.keys(graph)) dfs(f, []);
ok('src/*.mjs 导入图不许有环', cycle.length === 0, cycle.join(' | '));

// ④ 依赖方向：engine 可以依赖 collect/rules/score/report；反向依赖是架构回归
const engine = read('engine.mjs');
ok('engine.mjs 必须走缓存版采集（cachedCollect）', /cachedCollect/.test(engine));
for (const mod of ['collect.mjs', 'rules.mjs', 'score.mjs', 'report.mjs']) {
  const txt = read(mod);
  ok(mod + ' 不许反向 import engine.mjs', !/from\s+['"]\.\/engine\.mjs['"]/.test(txt));
}

// ⑤ allowlist 的每个键都必须在代码里被引用：配置项存在却无人读，就是「空壳配置」
// （V06 的 allowRepair 是前车之鉴；engineAssetMarkers 这次也被抓出来过）。
const allowlist = JSON.parse(fs.readFileSync(path.join(here, '..', 'config', 'allowlist.json'), 'utf8'));
const allCode = files.map(read).join('\n') + fs.readFileSync(path.join(here, '..', 'index.js'), 'utf8');
for (const k of Object.keys(allowlist)) {
  if (/^_comment/.test(k)) continue;
  ok('allowlist 键 ' + k + ' 必须被代码引用', allCode.indexOf(k) !== -1);
}

console.log('layering: 通过（' + n + ' 项断言 · 规则层零 FS + 导入图无环 + 依赖方向 + allowlist 无空壳键）');
