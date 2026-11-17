// 插件列表的本地化元数据（locale/*.json 的 meta 段）。
//
// 依据宿主文档 references/host-plugin.md：Plugin Manager 与设置页在**不激活插件**的前提下，
// 从导出的 locale JSON 读 `meta.title` / `meta.description`。缺了它，插件列表那一行只能回落到
// package.json 的 name/description——在英文宿主下就会出现中文标题。
//
// 本测试钉四件事：两份基准语言字典齐全、字段非空、exports 与 files 都已声明（否则发布后会丢文件）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

for (const id of ['en', 'zh']) {
  const p = path.join(root, 'locale', id + '.json');
  ok('locale/' + id + '.json 必须存在', fs.existsSync(p));
  const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
  ok(id + ' 的 meta 段存在', !!doc.meta);
  ok(id + ' 的 meta.title 非空', typeof doc.meta.title === 'string' && doc.meta.title.trim().length > 0, String(doc.meta.title));
  ok(id + ' 的 meta.description 非空', typeof doc.meta.description === 'string' && doc.meta.description.trim().length > 0);
  ok(id + ' 的 description 不得含营销词', !/best|powerful|ultimate|comprehensive|world-class/i.test(doc.meta.description));
}

// 英文标题按文档要求用 sentence case（只首词与专有名词大写）
const en = JSON.parse(fs.readFileSync(path.join(root, 'locale', 'en.json'), 'utf8'));
const words = String(en.meta.title).split(/\s+/).slice(1);
ok('英文标题应是 sentence case（DSH 例外）', words.every((w) => w === 'DSH' || w[0] !== w[0].toUpperCase() || w.length <= 3), en.meta.title);

// 声明面：不声明 exports 就读不到；不写进 files 发布后就丢
const exportsMap = pkg.exports || {};
ok('exports 必须导出 ./locale/*.json', !!exportsMap['./locale/*.json'], JSON.stringify(Object.keys(exportsMap)));
ok('files 必须包含 locale/*.json', (pkg.files || []).indexOf('locale/*.json') !== -1, JSON.stringify(pkg.files));
ok('files 仍包含 icon 相关导出（不要为加 locale 而丢图标）', (pkg.files || []).some((f) => /logo\.svg|icon/.test(f)));

console.log('locale-meta: 通过（' + n + ' 项断言 · 双基准字典 + 字段 + exports/files 声明面）');
