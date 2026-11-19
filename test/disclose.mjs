// A4 能力披露：与插件目录同一套 10 token 词汇的静态披露。
//
// 三条硬要求：
//   ① token 必须是**闭集**里的（目录按 token 聚合，自创词等于没填）；
//   ② 不许把「同源相对 fetch」判成联网——否则本仓对自己的 SECURITY.md 承诺就自相矛盾；
//   ③ 判不了要写在 unchecked / capped 里，不能让人以为「没列出来就是没有」。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-disclose-'));
process.env.DSH_HOME = home;

const { CAPABILITY_TOKENS, SIGNALS, disclosePackage, disclose, DISCLOSURE_SCHEMA } = await import('../src/disclose.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}
function mkpkg(dir, files, pkgJson) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkgJson || { name: 'x', version: '1.0.0' }, null, 2));
  for (const [f, body] of Object.entries(files)) {
    const p = path.join(dir, f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body, 'utf8');
  }
}

// ① 闭集与目录一致（从 dsh-plugin-catalog 实测到的 10 个 token，一个字都不能改）
const CATALOG_TOKENS = ['fs-read', 'fs-write', 'env', 'network', 'shell', 'credentials', 'llm', 'dynamic-code', 'host-runtime', 'subagent'];
ok('token 闭集与插件目录完全一致', JSON.stringify(CAPABILITY_TOKENS) === JSON.stringify(CATALOG_TOKENS), CAPABILITY_TOKENS.join(','));
ok('每个 token 都有信号表（network 由函数判，允许空表）', CAPABILITY_TOKENS.every((t) => Array.isArray(SIGNALS[t])));

// ② 联网：绝对 URL + fetch → network
const a = path.join(home, 'a');
mkpkg(a, { 'index.js': "const r = await fetch('https://api.example.com/v1');\n" });
const da = disclosePackage(a);
ok('绝对 URL 的 fetch 判为 network', da.capabilities.includes('network'), da.capabilities.join(','));

// ③ 同源相对 fetch + 常量 → 不算 network（本仓 client.js 就是这个形状）
const b = path.join(home, 'b');
mkpkg(b, {
  'client.js': "const API = '/dsh-healthkit-panel/api/badge';\nfetch(API, { credentials: 'same-origin' });\n",
});
const db = disclosePackage(b);
ok('同源相对 fetch 不算 network', !db.capabilities.includes('network'), db.capabilities.join(','));

// ④ 解析不到参数的 fetch → 保守算 network
const c = path.join(home, 'c');
mkpkg(c, { 'index.js': "fetch(url + '/x');\n" });
ok('参数是表达式时保守判 network', disclosePackage(c).capabilities.includes('network'));

// ⑤ 子进程 / 安装期脚本 / 凭据
const d = path.join(home, 'd');
mkpkg(d, { 'index.js': "import { spawnSync } from 'node:child_process';\nspawnSync('ls');\nconst apiKey = process.env.KEY;\nfetch('https://x.example.org');\n" },
  { name: 'd', version: '1.0.0', scripts: { postinstall: 'node post.js' } });
const dd = disclosePackage(d);
ok('子进程判为 shell', dd.capabilities.includes('shell'));
ok('process.env 判为 env', dd.capabilities.includes('env'));
ok('apiKey 判为 credentials', dd.capabilities.includes('credentials'));
ok('读凭据 + 联网 → 目录那条最高频红线原文', dd.capabilityRedLines.includes('reads credentials/secrets AND has network access'), JSON.stringify(dd.capabilityRedLines));
ok('子进程 + 联网 → 进程红线', dd.capabilityRedLines.includes('spawns processes AND has network access'));
ok('postinstall → 安装期执行红线', dd.capabilityRedLines.includes('runs code at install time (postinstall)'));

// ⑥ 注释里的 URL / child_process 不许算能力
const e = path.join(home, 'e');
mkpkg(e, { 'index.js': "// 示例：fetch('https://api.example.com')\n/* spawnSync('ls') */\nconst x = 1;\n" });
const de = disclosePackage(e);
ok('注释里的联网示例不算 network', !de.capabilities.includes('network'), de.capabilities.join(','));
ok('注释里的子进程不算 shell', !de.capabilities.includes('shell'), de.capabilities.join(','));

// ⑦ 明文 http 红线只报真主机，回环不吓人
const f = path.join(home, 'f');
mkpkg(f, { 'index.js': "fetch('http://localhost:8080/x');\nfetch('http://plain.example.com/y');\n" });
const df = disclosePackage(f);
ok('回环明文不写成红线', !df.capabilityRedLines.some((x) => /localhost|127\.0\.0\.1/.test(x)), JSON.stringify(df.capabilityRedLines));
ok('真主机明文才写红线', df.capabilityRedLines.some((x) => /plain\.example\.com/.test(x)), JSON.stringify(df.capabilityRedLines));

// ⑧ 自披露：钉住 SECURITY.md 的「不联网」承诺
const self = disclosePackage(path.resolve('.'));ok('本仓自披露**不含 network**（= SECURITY.md 的不联网承诺可机检）', !self.capabilities.includes('network'), self.capabilities.join(','));
ok('本仓自披露含 fs-read / fs-write / host-runtime', ['fs-read', 'fs-write', 'host-runtime'].every((t) => self.capabilities.includes(t)), self.capabilities.join(','));
ok('本仓自披露不含网络红线', !self.capabilityRedLines.some((x) => /network access/.test(x)), JSON.stringify(self.capabilityRedLines));
ok('披露带 checked 时间戳', /^\d{4}-\d\d-\d\dT/.test(self.capabilityCheckedAt));

// ⑧b 确定性分级（0.13.1 审计 P2-3）：每条能力都要能被人复核
ok('每条能力都带 evidence', self.capabilities.every((t) => (self.capabilityEvidence || []).some((e) => e.token === t)), self.capabilities.join(','));
ok('evidence 的 certainty 只能是 confirmed/heuristic',
  (self.capabilityEvidence || []).every((e) => e.certainty === 'confirmed' || e.certainty === 'heuristic'),
  JSON.stringify((self.capabilityEvidence || []).map((e) => e.token + ':' + e.certainty)));
ok('evidence 带可读样本', (self.capabilityEvidence || []).every((e) => typeof e.sample === 'string'));
ok('本仓的 credentials 只能是 heuristic（它来自护栏正则，不是真的读凭据）',
  (() => { const e = (self.capabilityEvidence || []).find((x) => x.token === 'credentials'); return !e || e.certainty === 'heuristic'; })(),
  JSON.stringify((self.capabilityEvidence || []).find((x) => x.token === 'credentials')));

// ⑧c `credentials: 'same-origin'` 是 fetch 选项，不许当成「读凭据」
const credOpt = path.join(home, 'cred-opt');
mkpkg(credOpt, { 'client.js': "fetch('/api/x', { credentials: 'same-origin' });\n" });
const dc = disclosePackage(credOpt);
ok('fetch 的 credentials 选项不算 credentials 能力', !dc.capabilities.includes('credentials'), dc.capabilities.join(','));
ok('fetch 的 credentials 选项也不算网络（同源相对）', !dc.capabilities.includes('network'), dc.capabilities.join(','));

// ⑨ 全量披露：跳过宿主自带 @deepseek-ai/*、跨 profile 去重
const pkg = {
  name: 'p1',
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'pkg-a', 'pkg-b'] } },
};
mkpkg(path.join(home, 'profiles', 'web'), { 'package.json': JSON.stringify(pkg, null, 2) });
mkpkg(path.join(home, 'profiles', 'web', 'node_modules', 'pkg-a'), { 'index.js': 'readFileSync("x");' }, { name: 'pkg-a', version: '2.0.0' });
mkpkg(path.join(home, 'profiles', 'web', 'node_modules', 'pkg-b'), { 'index.js': '1;' }, { name: 'pkg-b', version: '3.0.0' });
mkpkg(path.join(home, 'profiles', 'desktop'), { 'package.json': JSON.stringify(pkg, null, 2) });
mkpkg(path.join(home, 'profiles', 'desktop', 'node_modules', 'pkg-a'), { 'index.js': 'readFileSync("x");' }, { name: 'pkg-a', version: '2.0.0' });

const all = disclose(home);
ok('全量披露 schema 正确', all.schema === DISCLOSURE_SCHEMA);
ok('只列第三方插件（跳过 @deepseek-ai/*）', all.plugins.every((p) => p.name.indexOf('@deepseek-ai/') !== 0), all.plugins.map((p) => p.name).join(','));
ok('跨 profile 同名插件只算一次', all.count === 2, 'count=' + all.count);
ok('披露按名字排序', all.plugins[0].name === 'pkg-a');
ok('两侧 profile 都记录', all.profiles.length === 2);

fs.rmSync(home, { recursive: true, force: true });
console.log('disclose: 通过（' + n + ' 项断言 · 闭集/联网判定/红线/注释免疫/自披露）');
