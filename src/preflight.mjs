// 作者侧发布前自检（C1）：把体检的判据搬到**发布之前**。
//
// 竞品检索里 `dsh-plugin-toolkit`（21,896 下载/月，目录里写的是
// "Preflight for plugin authors: the checks the market runs"）说明了一件事：
// 「体检用户机器」的受众是**偶尔**，而「发布前自检」的受众是**每次发版都要**——
// 后者动机强得多。同一套规则换个身份，就是第二条增长曲线。
//
// 这里只做**静态**检查（不装依赖、不跑测试、不联网），目标是拦住「发出去就装不上/
// 装上了但宿主静默跳过」这两类事故——它们都是不可逆的（版本号一旦发出去就改不了）。
import fs from 'node:fs';
import path from 'node:path';

import { satisfies } from './verrange.mjs';

export const PREFLIGHT_SCHEMA = 'dsh-healthkit/preflight/v1';

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

// files / exports 里可能出现 `src/*.mjs` 这种通配：只校验「目录存在 + 至少命中一个文件」，
// 不假装自己实现了 npm 的 glob 语义。
function checkEntry(root, spec) {
  const s = String(spec);
  if (s.indexOf('*') === -1) {
    const p = path.join(root, s);
    return fs.existsSync(p) ? null : s;
  }
  const dir = path.dirname(path.join(root, s));
  const pat = path.basename(s);
  if (!fs.existsSync(dir)) return s;
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return s; }
  return names.some((x) => re.test(x)) ? null : s;
}

export function preflightRepo(dir0, opts) {
  const o = opts || {};
  const root = path.resolve(dir0 || '.');
  const blockers = [];
  const warnings = [];
  const infos = [];
  const add = (arr, code, detail) => arr.push({ code, detail });

  if (!fs.existsSync(root)) {
    return { schema: PREFLIGHT_SCHEMA, root, ok: false, verdict: 'FAIL', blockers: [{ code: 'no-dir', detail: '目录不存在：' + root }], warnings, infos };
  }

  const pkgPath = path.join(root, 'package.json');
  const pkg = readJson(pkgPath);
  if (!pkg) {
    add(blockers, 'package-json', 'package.json 缺失或解析失败——这种包发出去装不上');
    return { schema: PREFLIGHT_SCHEMA, root, ok: false, verdict: 'FAIL', blockers, warnings, infos };
  }

  // ① 宿主契约：dsh.bundle.patch 指向真实文件（bundle 的入口声明）
  const bundle = pkg.dsh && pkg.dsh.bundle;
  if (!bundle) {
    add(blockers, 'no-dsh-bundle', 'package.json 没有 dsh.bundle —— profile 把这个包当 bundle 用时，宿主会**静默跳过**');
  } else {
    const patchRel = typeof bundle === 'string' ? bundle : bundle.patch;
    if (!patchRel) add(blockers, 'no-bundle-patch', 'dsh.bundle 里没有 patch 路径');
    else if (!fs.existsSync(path.join(root, String(patchRel)))) {
      add(blockers, 'bundle-patch-missing', 'dsh.bundle.patch 指向的文件不存在：' + patchRel);
    }
  }

  // ② main 指向真实文件
  if (pkg.main) {
    if (!fs.existsSync(path.join(root, String(pkg.main)))) add(blockers, 'main-missing', 'main 指向的文件不存在：' + pkg.main);
  } else {
    add(warnings, 'no-main', '没有声明 main（宿主按默认 index.js 找入口，找不到就静默跳过）');
  }

  // ③ 发布清单：没写 files 会把 node_modules / .env 一起发出去；写了就要真有
  if (!Array.isArray(pkg.files) || !pkg.files.length) {
    add(blockers, 'no-files', '没声明 files —— npm 会把工作目录里不该发的东西一起发出去（含测试夹具、本地凭据）');
  } else {
    for (const f of pkg.files) {
      const miss = checkEntry(root, f);
      if (miss) add(warnings, 'files-missing', 'files 里声明的路径没有命中文件：' + miss);
    }
  }

  // ④ 列表页要用的元数据（缺了插件目录那条会很难看，甚至收不进）
  if (!pkg.description) add(warnings, 'no-description', '没有 description：插件市场/目录列表那一行会空着');
  if (!pkg.license) add(warnings, 'no-license', '没有 license 字段：收录清单通常要求明确许可');
  if (!pkg.repository && !pkg.homepage) add(warnings, 'no-repository', '没有 repository/homepage：目录无法给出「去仓库看看」的入口');
  if (!pkg.engines || !pkg.engines.node) add(warnings, 'no-engines', '没有 engines.node：装到老 Node 上会在运行时才炸');

  // ④b 宿主兼容声明（P1-4）
  //     `engines.dsh` 是官方字段；没有它，宿主与目录都无法判断这个包能不能装。
  //     声明了却不覆盖真机版本，比不声明更糟——那是**声称兼容但实际不兼容**（0.13.0 就是这样）。
  const declaredDsh = (pkg.engines && pkg.engines.dsh) || (pkg.dsh && pkg.dsh.compatibility && pkg.dsh.compatibility.dsh) || null;
  if (!declaredDsh) add(warnings, 'no-engines-dsh', '没有声明 engines.dsh：宿主升级时无法判断兼容性（0.13.0 的客户端 P0 正是这样漏出去的）');
  else if (o.hostVersion) {
    const r = satisfies(o.hostVersion, declaredDsh);
    if (r === null) add(warnings, 'engines-dsh-unjudged', '声明了 engines.dsh=' + declaredDsh + '，但与宿主 ' + o.hostVersion + ' 的比对超出支持范围，判不了');
    else if (r === false) add(blockers, 'engines-dsh-mismatch', '声明的 engines.dsh=' + declaredDsh + ' **不覆盖**当前宿主 ' + o.hostVersion);
    else add(infos, 'engines-dsh-ok', 'engines.dsh=' + declaredDsh + ' 覆盖当前宿主 ' + o.hostVersion);
  }
  if (/^0\.0\./.test(String(pkg.version || ''))) add(warnings, 'version-0.0.x', '版本还是 0.0.x：一旦发出去就改不了，确认这是你要的号');
  if (Array.isArray(pkg.keywords) && pkg.keywords.indexOf('dsh-plugin') === -1) {
    add(infos, 'no-topic-keyword', 'keywords 里没有 dsh-plugin：靠 topic/keyword 抓取的清单会漏掉你');
  }

  // ⑤ 本地化元数据（宿主插件列表在不激活插件时读 locale/*.json 的 meta）
  const localeDir = path.join(root, 'locale');
  if (fs.existsSync(localeDir)) {
    let names = [];
    try { names = fs.readdirSync(localeDir).filter((x) => /\.json$/.test(x)); } catch (e) { names = []; }
    for (const f of names) {
      const doc = readJson(path.join(localeDir, f));
      const meta = doc && doc.meta;
      if (!meta || !meta.title || !meta.description) {
        add(warnings, 'locale-meta', 'locale/' + f + ' 缺 meta.title / meta.description：英文宿主里会回落到中文标题');
      }
    }
    const exportsMap = pkg.exports || {};
    if (!exportsMap['./locale/*.json']) {
      add(warnings, 'locale-not-exported', '有 locale/ 但 exports 没导出 ./locale/*.json：宿主读不到这些元数据');
    }
    if (Array.isArray(pkg.files) && pkg.files.indexOf('locale/*.json') === -1 && pkg.files.indexOf('locale') === -1) {
      add(warnings, 'locale-not-in-files', '有 locale/ 但 files 没包进去：发布后文件就丢了');
    }
  }

  // ⑥ 补丁文件本身：id/name 是最低要求
  const patchFile = ['cordis.patch.yml', 'cordis.patch.yaml'].map((f) => path.join(root, f)).find((p) => fs.existsSync(p));
  if (patchFile) {
    let text = '';
    try { text = fs.readFileSync(patchFile, 'utf8'); } catch (e) { text = ''; }
    if (!/id\s*:/.test(text)) add(blockers, 'patch-no-id', patchFile.split(path.sep).pop() + ' 里没有 id：宿主装配时定位不到条目');
    if (/^\s+.*\t/m.test(text)) add(warnings, 'patch-tab', '补丁里出现 tab 缩进：YAML 会整体解析失败');
  }

  // ⑦ 凭据不该进发布清单
  if (Array.isArray(pkg.files) && pkg.files.some((f) => /(^|\/)(\.env|\.npmrc|credentials)/i.test(String(f)))) {
    add(blockers, 'secrets-in-files', 'files 里包含疑似凭据文件（.env/.npmrc/credentials）：发出去就是泄漏');
  }

  // ⑧ 文档与安全边界（收录清单与用户信任都看这两样）
  if (!fs.existsSync(path.join(root, 'README.md'))) add(infos, 'no-readme', '没有 README.md：目录页没有可读介绍');
  if (!fs.existsSync(path.join(root, 'SECURITY.md'))) add(infos, 'no-security', '没有 SECURITY.md：写清「我不做什么」比写功能更能建立信任');
  if (!(pkg.scripts && pkg.scripts.test)) add(warnings, 'no-test-script', '没有 test 脚本：发布前没有任何门');

  const verdict = blockers.length ? 'FAIL' : (warnings.length ? 'WARN' : 'PASS');
  return { schema: PREFLIGHT_SCHEMA, root, ok: blockers.length === 0, verdict, blockers, warnings, infos };
}

export function renderPreflight(r) {
  const L = [];
  L.push('发布前自检：' + r.verdict + (r.verdict === 'PASS' ? '（可以发）' : r.verdict === 'WARN' ? '（能发，但有值得先改的）' : '（先别发）'));
  L.push('目录：' + r.root);
  if (r.blockers.length) {
    L.push('');
    L.push('阻断（' + r.blockers.length + '）：');
    for (const b of r.blockers) L.push('  ✗ [' + b.code + '] ' + b.detail);
  }
  if (r.warnings.length) {
    L.push('');
    L.push('警告（' + r.warnings.length + '）：');
    for (const w of r.warnings) L.push('  ! [' + w.code + '] ' + w.detail);
  }
  if (r.infos.length) {
    L.push('');
    L.push('建议（' + r.infos.length + '）：');
    for (const i of r.infos) L.push('  · [' + i.code + '] ' + i.detail);
  }
  return L.join('\n');
}
