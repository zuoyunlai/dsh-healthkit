// C2 规则矩阵：表不许比代码旧。
//
// 这个仓库最反复出现的缺陷就是「代码改了、文档没改」（README 的 14 工具/18 组测试都漂过）。
// 所以 docs/MATRIX.md 不由人写，而是生成物——本测试重生成一遍并逐字比对。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const { buildMatrix, renderMatrix, extractRules, BOOT_COVERED, CLEAN_COVERED, MATRIX_SCHEMA } = await import('../src/matrix.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

const m = buildMatrix(root);
ok('矩阵 schema 正确', m.schema === MATRIX_SCHEMA);
ok('抽到了规则（≥20 条）', m.count >= 20, String(m.count));

// ① 抽取的规则必须覆盖源码里出现的所有 ruleId（漏一条就说明正则漂了）
const src = fs.readFileSync(path.join(root, 'src', 'rules.mjs'), 'utf8');
const ids = Array.from(new Set((src.match(/ruleId:\s*'([^']+)'/g) || []).map((s) => s.replace(/^ruleId:\s*'/, '').replace(/'$/, ''))));
const got = new Set(m.rows.map((r) => r.ruleId));
const missing = ids.filter((x) => !got.has(x));
ok('源码里的 ruleId 全部进了矩阵', missing.length === 0, '缺：' + missing.join(','));

// ② 每条规则都有严重度与维度（解析失败的会是空串）
ok('每条规则都解析出严重度', m.rows.every((r) => /^(P0|P1|P2|INFO)$/.test(r.severity)), m.rows.filter((r) => !r.severity).map((r) => r.ruleId).join(','));

// ②b 条件型严重度必须按最坏值记（0.13.1 审计 P2-1：R2c 曾被记成 P2，实为 P0）
const r2c = m.rows.find((r) => r.ruleId === 'R2c');
ok('R2c 在矩阵里存在', !!r2c);
ok('R2c 的严重度按最坏值记 P0（不是 P2）', r2c && r2c.severity === 'P0', r2c && r2c.severity);
ok('R2c 标注为条件型', r2c && r2c.conditional === true);
ok('R2c 的两个取值都被记下', r2c && r2c.severityAll.indexOf('P0') !== -1 && r2c.severityAll.indexOf('P2') !== -1, r2c && r2c.severityAll.join('/'));
ok('矩阵正文里写了「条件：」说明', fs.readFileSync(path.join(root, 'docs', 'MATRIX.md'), 'utf8').indexOf('（条件：') !== -1);
ok('每条规则都解析出维度', m.rows.every((r) => r.dimension && r.dimension !== '—'), m.rows.filter((r) => r.dimension === '—').map((r) => r.ruleId).join(','));
ok('每条规则都有标题', m.rows.every((r) => r.title.length > 2));

// ③ 探针/清理覆盖表必须指向真实存在的规则（防止删了规则还在勾选）
for (const k of Object.keys(BOOT_COVERED)) ok('探针覆盖表指向真实规则：' + k, got.has(k));
for (const k of Object.keys(CLEAN_COVERED)) ok('清理覆盖表指向真实规则：' + k, got.has(k));

// ④ 生成物与仓库里的 docs/MATRIX.md 逐字一致
const docPath = path.join(root, 'docs', 'MATRIX.md');
ok('docs/MATRIX.md 存在', fs.existsSync(docPath));
const onDisk = fs.readFileSync(docPath, 'utf8').replace(/\r\n/g, '\n');
const fresh = renderMatrix(buildMatrix(root)) + '\n';
ok('docs/MATRIX.md 与代码生成结果一致（改了规则记得 --matrix --out 重生成）', onDisk === fresh,
  onDisk.length + ' vs ' + fresh.length);

// ⑤ 表里不许出现「全目录 × 宿主版本」这种做不到的承诺
ok('矩阵明说自己不做什么', onDisk.indexOf('这张表不做什么') !== -1);
ok('矩阵不承诺全目录兼容', onDisk.indexOf('不是「全目录 × 宿主版本」') !== -1);

// ⑥ extractRules 是纯函数：空仓库不炸
const empty = extractRules(path.join(root, 'test'));
ok('空/无规则目录返回空数组', Array.isArray(empty) && empty.length === 0);

console.log('matrix: 通过（' + n + ' 项断言 · 抽取完整性 / 覆盖表 / 生成物不漂）');
