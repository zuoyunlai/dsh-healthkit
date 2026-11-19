// 能力声明对账（P1-1）。
//
// 事故：0.13.0 加了「写回 profile 配置」的回滚能力，但 README 还写着「不改你的配置」、
// SECURITY.md 还写着「唯一会动文件的操作是 --clean-apply」、package.json 的
// dsh.capabilities 还只有 `tools:register` + `fs:read`。**对外声明与代码实际动作面脱钩**。
//
// 这个测试把两者钉在一起：代码里出现了什么能力，声明里就必须有；声明了什么，
// 文档里就必须解释清楚。谁先谁后都行，但不许只剩一边。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const sec = fs.readFileSync(path.join(root, 'SECURITY.md'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const { SELF_RULE_BASENAMES } = await import('../src/disclose.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

// 收集「行为代码」：src/ + bin/ + 两个半边。排除静态扫描器的规则表（它写着模式字面量）。
const files = [];
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (/\.(mjs|js)$/.test(e.name) && SELF_RULE_BASENAMES.indexOf(e.name) === -1) files.push(p);
  }
}
walk(path.join(root, 'src'));
walk(path.join(root, 'bin'));
files.push(path.join(root, 'index.js'), path.join(root, 'client.js'));

const code = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const caps = new Set(pkg.dsh.capabilities || []);

// ① 代码里出现的动作面 → 声明里必须对应
const WRITE_API = /\b(writeFileSync|appendFileSync|renameSync|rmSync|cpSync|mkdirSync|unlinkSync|writeFile)\s*\(/;
const SPAWN_API = /\b(spawnSync|execSync|execFileSync|spawn)\s*\(|node:child_process/;
const WEB_API = /webServer\.register|\.register\(\{\s*kind:/;
const READ_API = /\b(readFileSync|readdirSync|statSync|existsSync|lstatSync)\s*\(/;

ok('代码会写文件 → 必须声明 fs:write', !WRITE_API.test(code) || caps.has('fs:write'), [...caps].join(','));
ok('代码会起子进程 → 必须声明 process:spawn', !SPAWN_API.test(code) || caps.has('process:spawn'), [...caps].join(','));
ok('代码会注册 web 路由 → 必须声明 web:serve', !WEB_API.test(code) || caps.has('web:serve'), [...caps].join(','));
ok('代码会读文件 → 必须声明 fs:read', !READ_API.test(code) || caps.has('fs:read'), [...caps].join(','));

// ② 反向：声明了的能力必须真有代码用它（防止声明注水）
ok('声明了 fs:write 就真有写操作', !caps.has('fs:write') || WRITE_API.test(code));
ok('声明了 process:spawn 就真有子进程', !caps.has('process:spawn') || SPAWN_API.test(code));
ok('声明了 web:serve 就真有路由注册', !caps.has('web:serve') || WEB_API.test(code));

// ③ 能力 token 形态：必须是 `域:动作`
const BAD = [...caps].filter((c) => !/^[a-z]+:[a-z]+$/.test(c));
ok('能力 token 形态合法（域:动作）', BAD.length === 0, BAD.join(','));

// ④ 官方字段：engines.dsh 与 dsh.compatibility 必须同源，不许各写一套
ok('声明了 engines.dsh（官方字段）', !!(pkg.engines && pkg.engines.dsh), JSON.stringify(pkg.engines));
ok('engines.dsh 与 dsh.compatibility.dsh 一致',
  pkg.engines && pkg.engines.dsh === (pkg.dsh.compatibility && pkg.dsh.compatibility.dsh),
  (pkg.engines && pkg.engines.dsh) + ' vs ' + (pkg.dsh.compatibility && pkg.dsh.compatibility.dsh));

// ⑤ 文档必须说清回滚这条写面（这是本次事故的直接缺口）
for (const kw of ['--rollback', '--recover', '写回前自动', '白名单', 'sha256']) {
  ok('SECURITY.md 必须写清回滚写面：' + kw, sec.indexOf(kw) !== -1);
}
ok('SECURITY.md 不再声称「唯一会动文件的操作是 --clean-apply」',
  sec.indexOf('唯一会动文件的操作是 `--clean-apply`') === -1);

// ⑥ README 的「不改配置」必须带显式例外，不许只说半句
const noTouchLine = (readme.split('\n').find((l) => l.indexOf('默认不改你的配置') !== -1)) || '';
ok('README 的「不改配置」已限定为默认行为', noTouchLine.length > 0, noTouchLine.slice(0, 60));
ok('README 紧接着给出回滚例外', /唯一的例外是\*\*恢复面\*\*/.test(readme));

// ⑦ 披露字段里的 retention 也要提到写面（避免「只读」印象）
const retention = (pkg.dsh.disclosure && pkg.dsh.disclosure.retention) || '';
ok('dsh.disclosure.retention 提到回滚写回', /rollback|recover|写回/.test(retention), retention.slice(0, 60));

console.log('capability-claims: 通过（' + n + ' 项断言 · 声明与代码动作面双向对账）');
