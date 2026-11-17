// 文档漂移守卫（2026-11-17 反哺时发现 README 还写着「14 工具」「18 组测试」）。
//
// 这个仓库的教训是反复出现的：工具从 14 增到 16、测试从 18 增到 30，而 README 的
// 「现状」段与工具表不动——`tools-shape` 只钉住了 `--init` 的文案，没有钉 README。
// 本测试把 README / COMPLEMENTARY 里最容易被忘的几处对齐，改成机器检查。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const comp = fs.readFileSync(path.join(root, 'docs', 'COMPLEMENTARY.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const { buildTools } = await import('../index.js');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

const tools = buildTools({}).length;
const testGroups = (pkg.scripts.test.match(/node \.\/test\//g) || []).length;

// ① 工具表行数 == 实际工具数
const tableRows = (readme.match(/^\| `audit_[a-z]+`/gm) || []).length;
ok('README 工具表行数应等于实际工具数（' + tools + '）', tableRows === tools, 'table=' + tableRows + ' actual=' + tools);

// ② 标题里的中文数字也要对
const CN = { 10: '十', 11: '十一', 12: '十二', 13: '十三', 14: '十四', 15: '十五', 16: '十六', 17: '十七', 18: '十八', 19: '十九', 20: '二十' };
const want = CN[tools] || String(tools);
ok('README 标题的「' + want + '个工具」要与实际一致', readme.indexOf('## ' + want + '个工具') !== -1,
  (readme.match(/^## .*个工具.*$/m) || [''])[0]);

// ③ 不许残留旧数字（这是上次真的漂了的地方）
ok('README 不许残留「14 工具」', !/1[45]\s*工具/.test(readme));
ok('README 不许残留旧测试组数（18 组）', !/18 组测试/.test(readme));

// ④ 声明的测试组数 == package.json 里串起来的组数
const m = readme.match(/(\d+)\s*组测试全绿/);
ok('README 要声明测试组数', !!m);
ok('README 的测试组数应等于 npm test 实际组数（' + testGroups + '）', m && Number(m[1]) === testGroups, m ? m[1] : 'null');

// ⑤ 与 doctor 的关系必须写清「行为和而不同」：基线门 + --absolute + UNKNOWN 语义
for (const kw of ['基线门', '--absolute', 'UNKNOWN']) {
  ok('COMPLEMENTARY 必须写清与 doctor 的行为差异：' + kw, comp.indexOf(kw) !== -1);
}
ok('COMPLEMENTARY 不再声称两边行为一致', !/同一套 CI action 可以同时消费两者。$/.test(comp.split('\n').filter((l) => l.indexOf('同一套 CI') !== -1).join('')));

console.log('docs-drift: 通过（' + n + ' 项断言 · 工具数/测试组数/旧数字/与 doctor 的行为差异）');
