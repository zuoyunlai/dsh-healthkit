// 版本号防漂移：index.js 的 VERSION 必须运行时读 package.json，不能是手写字面量。
// 2026-11-16 踩过：常量写着 0.4.1，包已发到 0.4.3，plugin-status.json 因此报错版本。
// 运行时一致性（工具返回的版本 == 包版本）由真宿主重启后的 plugin-status 复核，本测试只管源码形状。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, '..', 'index.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));

assert.ok(!/const VERSION = '\d/.test(src), 'index.js 不得把 VERSION 写成字面量');
assert.ok(
  /const VERSION = JSON\.parse\(fs\.readFileSync\(new URL\('\.\/package\.json', import\.meta\.url\), 'utf8'\)\)\.version;/.test(src),
  'index.js 应从 package.json 读 VERSION',
);

console.log('version-guard: 通过（唯一真源 package.json = ' + pkg.version + '）');
