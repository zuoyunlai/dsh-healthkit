// 能力披露（A4）：给「装了什么插件 = 它可能碰什么」一份机器可读的静态结论。
//
// 为什么做这个而不是再加一个面板：竞品检索显示目录数据里已经有一等字段
//   `capabilities`（**10 个 token 的闭集**）与 `capabilityRedLines`（自由文本），
// 11,519 条目录里 8,941 条填了它，而 `dsh-trust-check` 靠这件事拿到 33,742 下载/月。
// 我们的体检本来就在遍历每个 profile 的 bundle，顺手产出**同一套词汇**的披露，
// 就能被目录/市场直接消费——不需要用户会写 YAML。
//
// 判据全部是静态文本信号，**不做行为分析、不执行插件代码**。判不出来就不写这个 token，
// 并在 `unchecked` 里说明哪些文件没读（大小/数量上限），而不是假装覆盖完整。
//
// token 闭集（与目录一致，别自创）：
//   fs-read · fs-write · env · network · shell · credentials · llm · dynamic-code ·
//   host-runtime · subagent
import fs from 'node:fs';
import path from 'node:path';
import { dshHome } from './paths.mjs';

export const DISCLOSURE_SCHEMA = 'dsh-healthkit/disclosure/v1';

export const CAPABILITY_TOKENS = [
  'fs-read', 'fs-write', 'env', 'network', 'shell', 'credentials',
  'llm', 'dynamic-code', 'host-runtime', 'subagent',
];

// 每个 token 的正则。宁窄勿宽：静态误报会直接变成「这个插件能联网」的冤枉话。
//
// `network` 是唯一需要额外判断的：本仓自己的 client.js 就有 `fetch(BADGE_API)`，
// 而 BADGE_API 是 `/dsh-healthkit-panel/api/...` 这种**同源相对路径**——那是面板自己，
// 不是联网。一刀切「有 fetch 就算 network」会让我们对自己的 SECURITY.md 承诺撒谎，
// 所以这里解析一下标识符的字面量，解析不到才保守地算联网。
const NET_STRONG = [/node:https?/, /require\(['"]https?['"]\)/, /\bhttps?\.(get|request|createServer)\s*\(/, /\bWebSocket\b/, /\baxios\b/, /\bundici\b/, /['"`]https?:\/\/[a-z0-9[{]/i];

function resolvesToRelative(text, id) {
  const re = new RegExp('(?:const|let|var)\\s+' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*=\\s*[\'"`]([^\'"`]*)');
  const m = text.match(re);
  if (!m) return false;                       // 解析不到 → 当联网（保守）
  return m[1].charAt(0) === '/';
}

function networkHit(text) {
  if (NET_STRONG.some((re) => re.test(text))) return true;
  const calls = text.match(/fetch\s*\(\s*[^)\n]{0,120}/g) || [];
  for (const c of calls) {
    const lit = c.match(/fetch\s*\(\s*(['"`])([^'"`]*)\1/);
    if (lit) { if (lit[2].charAt(0) !== '/') return true; continue; }
    const id = c.match(/fetch\s*\(\s*([A-Za-z_$][\w$]*)/);
    if (!id) return true;                     // 表达式（拼接/三目）→ 当联网
    if (!resolvesToRelative(text, id[1])) return true;
  }
  return false;
}

export const SIGNALS = {
  'fs-read': [/\breadFileSync\s*\(/, /\breaddirSync\s*\(/, /\bstatSync\s*\(/, /\bexistsSync\s*\(/, /\bcreateReadStream\s*\(/, /\blstatSync\s*\(/],
  'fs-write': [/\bwriteFileSync\s*\(/, /\bappendFileSync\s*\(/, /\bmkdirSync\s*\(/, /\brmSync\s*\(/, /\brenameSync\s*\(/, /\bcpSync\s*\(/, /\bunlinkSync\s*\(/, /\bwriteFile\s*\(/],
  env: [/\bprocess\.env\b/, /\bDSH_[A-Z_]+\b/],
  network: [], // 由 networkHit() 单独判
  shell: [/node:child_process/, /require\(['"]child_process['"]\)/, /\bchild_process\b/, /\bspawnSync\s*\(/, /\bexecSync\s*\(/, /\bexecFileSync\s*\(/, /\bspawn\s*\(/],
  credentials: [/\bcredentials?\b/i, /\bapi[_ ]?key\b/i, /\bsecret\b/i, /\.ssh\b/, /\.npmrc\b/, /\bauthToken\b/, /\bBearer\s/],
  llm: [/\bctx\.llm\b/, /['"]llm['"]/, /\bmodel(Provider|s)?\b/, /\bcompletions?\b/],
  'dynamic-code': [/\bnew Function\s*\(/, /\beval\s*\(/, /from ['"]node:vm['"]/, /\brequire\(['"]node:vm['"]\)/],
  'host-runtime': [/\bctx\.inject\s*\(/, /\bctx\.tools\.register\b/, /\bctx\.slots\.register\b/, /\bctx\.effect\s*\(/],
  subagent: [/\bsubagent\b/i, /\bagentPreset\b/, /\bdelegate\b/i],
};

const MAX_FILES = 80;
const MAX_BYTES = 512 * 1024;
const CODE_RE = /\.(mjs|cjs|js|ts)$/;

// 扫描器不扫自己的规则表：SIGNALS 里的正则源码本身就会命中信号
// （`node:child_process`、`https?://` 这些字面量就写在表里）。
// 这不是「对自己网开一面」——规则表不是行为代码；不然任何静态扫描器都会把自己
// 判成「能起子进程 + 能联网」，这个字段立刻失去意义。
//
// 导出给测试用：`test/security-doc.mjs` 扫「代码里有没有网络客户端」时，
// 必须豁免同一批文件，否则它会把规则表里的正则字面量当成 import。
export const SELF_RULE_BASENAMES = ['disclose.mjs'];

// 注释里出现 URL/child_process 太常见（插件 README 式注释、示例代码）。
// 扫描行为代码前先剥离注释，避免把「文档」当成「能力」。
function stripNoise(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/[^\n]*/g, '$1 ');
}

function walk(dir, out, budget) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    if (budget.files >= MAX_FILES || budget.bytes >= MAX_BYTES) return;
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'test' || e.name === 'tests' || e.name === 'fixtures') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out, budget); continue; }
    if (!CODE_RE.test(e.name)) continue;
    if (SELF_RULE_BASENAMES.indexOf(e.name) !== -1) continue;
    let st = null;
    try { st = fs.statSync(p); } catch (err) { continue; }
    if (!st.isFile() || st.size > 400 * 1024) { budget.skipped.push(p); continue; }
    if (budget.bytes + st.size > MAX_BYTES) { budget.skipped.push(p); continue; }
    let txt = '';
    try { txt = fs.readFileSync(p, 'utf8'); } catch (err) { budget.skipped.push(p); continue; }
    out.push({ file: p, text: stripNoise(txt) });
    budget.files += 1;
    budget.bytes += st.size;
  }
}

function redLinesOf(pkg, caps, text) {
  const red = [];
  // 与目录里最高频的那条红线原文对齐（872 条用了它）
  if (caps.indexOf('credentials') !== -1 && caps.indexOf('network') !== -1) {
    red.push('reads credentials/secrets AND has network access');
  }
  if (caps.indexOf('shell') !== -1 && caps.indexOf('network') !== -1) {
    red.push('spawns processes AND has network access');
  }
  const post = (pkg.scripts && (pkg.scripts.postinstall || pkg.scripts.install || pkg.scripts.preinstall)) || '';
  if (post) red.push('runs code at install time (postinstall)');
  const hosts = Array.from(new Set((text.match(/http:\/\/([a-z0-9][a-z0-9.-]*\.[a-z]{2,})/gi) || [])
    .map((s) => s.replace(/^http:\/\//i, '').toLowerCase())
    // 回环上的明文不是「对外发包」，别把它写成红线去吓人
    .filter((h) => h !== 'localhost' && h !== '127.0.0.1' && h !== '0.0.0.0'))).slice(0, 5);
  for (const h of hosts) red.push('uses plaintext http:// to ' + h);
  return red;
}

// 单个包 → 披露
export function disclosePackage(dir, opts) {
  const o = opts || {};
  let pkg = {};
  try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch (e) { pkg = {}; }
  const budget = { files: 0, bytes: 0, skipped: [] };
  const found = [];
  walk(dir, found, budget);
  const text = found.map((f) => f.text).join('\n');
  const caps = [];
  for (const t of CAPABILITY_TOKENS) {
    if (t === 'network') { if (networkHit(text)) caps.push(t); continue; }
    if (SIGNALS[t].some((re) => re.test(text))) caps.push(t);
  }
  const entry = {
    name: String(pkg.name || path.basename(dir)),
    version: String(pkg.version || ''),
    capabilities: caps,
    capabilityRedLines: redLinesOf(pkg, caps, text),
    capabilityCheckedAt: new Date(o.now || Date.now()).toISOString(),
    scanned: { files: found.length, bytes: budget.bytes, capped: budget.files >= MAX_FILES || budget.bytes >= MAX_BYTES },
    // 读不到 / 没读的东西明写：静态披露最坏的用法是让人以为「没列出来就是没有」
    unchecked: budget.skipped.map((p) => String(p).replace(dir, '.')).slice(0, 20),
  };
  return entry;
}

// 全部 profile 里**第三方**已装插件（@deepseek-ai/* 是宿主自带，不在 profile 里）
export function disclose(home0, opts) {
  const home = home0 || dshHome();
  const out = [];
  const seen = new Set();
  const profiles = [];
  let names = [];
  try { names = fs.readdirSync(path.join(home, 'profiles'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
  catch (e) { names = []; }
  for (const name of names) {
    const dir = path.join(home, 'profiles', name);
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); } catch (e) { pkg = null; }
    if (!pkg) continue;
    const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
    profiles.push({ profile: name, bundles: bundles.length });
    for (const b of bundles) {
      const spec = String(b);
      const at = spec.lastIndexOf('@');
      const pkgName = at > 0 ? spec.slice(0, at) : spec;
      if (pkgName.indexOf('@deepseek-ai/') === 0) continue;
      if (seen.has(pkgName)) continue;
      const bdir = path.join(dir, 'node_modules', pkgName);
      if (!fs.existsSync(bdir)) continue;
      seen.add(pkgName);
      try { out.push(disclosePackage(bdir, opts)); } catch (e) { /* 单个包失败不影响整体 */ }
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return {
    schema: DISCLOSURE_SCHEMA,
    generatedAt: new Date().toISOString(),
    home: home,
    profiles,
    count: out.length,
    plugins: out,
  };
}

export function renderDisclosure(d) {
  const L = [];
  L.push('能力披露（' + d.count + ' 个第三方插件 · ' + CAPABILITY_TOKENS.length + ' 个 token 闭集）');
  L.push('依据：静态文本信号，不执行插件代码；没扫到的文件记在 unchecked，不代表「没有」。');
  L.push('');
  for (const p of d.plugins) {
    L.push('· ' + p.name + (p.version ? '@' + p.version : ''));
    L.push('  能力：' + (p.capabilities.length ? p.capabilities.join(' / ') : '（未命中任何信号）'));
    if (p.capabilityRedLines.length) L.push('  红线：' + p.capabilityRedLines.join('；'));
    if (p.scanned.capped) L.push('  ⚠ 扫描到上限（' + p.scanned.files + ' 文件 / ' + Math.round(p.scanned.bytes / 1024) + 'KB），结论可能不完整');
  }
  return L.join('\n');
}
