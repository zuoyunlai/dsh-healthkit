// 安全文案守卫（B5）。
//
// 为什么要有这个测试：SECURITY.md 里写的每一句都是**对用户的承诺**，而承诺最怕两件事——
// ① 代码改了、文档没改（说「不联网」但其实加了 fetch）；② 路径写错了（说写到 pending.json，
// 实际是 verify/pending-verify.json），用户按文档去找就找不到。
// 所以把「文档说的」和「代码做的」做机器对账。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const secPath = path.join(root, 'SECURITY.md');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(mjs|js)$/.test(e.name) && !p.includes(path.join('test', ''))) out.push(p);
  }
  return out;
}

const codeFiles = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'bin')), path.join(root, 'index.js')];
const code = codeFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const sec = fs.readFileSync(secPath, 'utf8');

// ① 文件存在 + 会进包（不写进 files，发布后就丢，用户看到的是死链）
ok('SECURITY.md 存在', fs.existsSync(secPath));
ok('SECURITY.md 必须写进 package.json 的 files', (pkg.files || []).includes('SECURITY.md'), JSON.stringify(pkg.files));
ok('README 必须链到 SECURITY.md', /\]\(SECURITY\.md\)/.test(readme));

// ② 「产物路径」表必须与代码里的真名一致（这条踩过：写 pending.json，实际是 verify/pending-verify.json）
const artifacts = ['history.jsonl', 'pending-verify.json', 'retirements.json', 'feedback.jsonl', 'bundle-index.json', 'trash', 'runs', 'snapshots'];
for (const a of artifacts) {
  ok('SECURITY.md 描述的数据产物要存在于代码：' + a, sec.includes(a) && code.includes(a), 'doc=' + sec.includes(a) + ' code=' + code.includes(a));
}

// ③ 「不联网」是硬承诺：src/ 与 bin/ 不许出现 HTTP 客户端或 fetch
//
// 豁免 `src/disclose.mjs`：它本身就是静态扫描器的**规则表**，表里必然写着
// `node:http`、`fetch(` 这些模式字面量。规则表不是行为代码——不改豁免，
// 这条断言会变成「任何给别的东西做能力扫描的工具都不许存在」。
const { SELF_RULE_BASENAMES } = await import('../src/disclose.mjs');
const netScope = codeFiles
  .filter((f) => SELF_RULE_BASENAMES.indexOf(path.basename(f)) === -1)
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');
for (const bad of ['from \'node:http\'', 'from "node:http"', 'from \'node:https\'', 'from "node:https"', 'require(\'http\')', 'require("http")', 'fetch(']) {
  ok('代码里不许出现网络客户端：' + bad, !netScope.includes(bad));
}
ok('豁免清单不是空壳（disclose.mjs 确实在库里）', SELF_RULE_BASENAMES.every((b) => codeFiles.some((f) => path.basename(f) === b)));

// ④ 面板回环校验必须真的返回 403
const panel = fs.readFileSync(path.join(root, 'src', 'panel.mjs'), 'utf8');
ok('面板对非回环来源返回 403', /403/.test(panel) && /loopbackOnly/.test(panel));
ok('SECURITY.md 要写明 403', sec.includes('403'));

// ⑤ 清理护栏名单必须是「导出给测试遍历」的那一份，两份名字不许脱钩
const clean = fs.readFileSync(path.join(root, 'src', 'clean.mjs'), 'utf8');
const { PROTECTED_NAMES } = await import('../src/clean.mjs');
for (const name of PROTECTED_NAMES) {
  ok('护栏名单与代码一致：' + name, clean.includes('\'' + name + '\''));
  ok('SECURITY.md 要列出护栏：' + name, sec.includes(name));
}
ok('回收期 7 天写进文档且与代码一致', sec.includes('7 天') && /PURGE_AFTER_DAYS = 7/.test(clean));

// ⑥ 文档里不许出现「一键修复」式的越权承诺（我们明确不做）
ok('SECURITY.md 必须声明不提供一键修复', /一键修复/.test(sec));

console.log('security-doc: 通过（' + n + ' 项断言 · 文案与代码动作面对账）');
