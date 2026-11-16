// R22（file:/link: 目标不存在）必须**平台无关**：
// 存在性在 collect 阶段判定，规则层只读事实。
//
// 2026-11-16 踩过：夹具里写的是本机绝对路径，在 CI（Linux runner）上必然不存在，
// R22 必然命中 —— 那是环境差异，不是真问题，害得 CI 第一次发版直接红。
// 现在夹具用相对路径 + 显式 exists 字段，结论在任何机器上一致。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRules } from '../src/rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const facts = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'facts-2026-11-16.json'), 'utf8'));
const allowlist = JSON.parse(fs.readFileSync(path.join(root, 'config', 'allowlist.json'), 'utf8'));

// 夹具里的本地依赖必须自带 exists 字段（不能靠本机文件系统）
for (const p of facts.profiles || []) {
  for (const d of p.localDeps || []) {
    assert.equal(typeof d.exists, 'boolean', p.name + '/' + d.dep + ' 缺 exists 字段（夹具不能依赖真实文件系统）');
  }
}

// exists=true → 不报
{
  const f = runRules(JSON.parse(JSON.stringify(facts)), allowlist);
  const hits = f.filter((x) => x.ruleId === 'R22');
  assert.equal(hits.length, 0, '夹具里目标都存在，R22 不该命中：' + hits.map((h) => h.title).join(' | '));
}

// exists=false → 必须报（真问题不能被「平台无关」这个理由吞掉）
{
  const clone = JSON.parse(JSON.stringify(facts));
  let touched = 0;
  for (const p of clone.profiles || []) {
    for (const d of p.localDeps || []) { if (touched === 0) { d.exists = false; touched++; } }
  }
  const f = runRules(clone, allowlist);
  const hits = f.filter((x) => x.ruleId === 'R22');
  assert.equal(hits.length, 1, '有一个目标不存在时 R22 应命中一次，实得 ' + hits.length);
  assert.equal(hits[0].severity, 'P0', 'R22 应是 P0');
  assert.ok(/不存在/.test(hits[0].title), '标题应说明目标不存在');
}

console.log('r22-local-deps: 通过（平台无关 · 坏目标仍报 P0）');
