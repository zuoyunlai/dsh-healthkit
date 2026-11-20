// 恢复面：profile 配置快照 / 回滚 / 预启动探针。
//
// 2026-11-17 竞品检索后的 A2 修订。动机是数据：同域头部 `dsh-plugin-health`（5,623 下载/周）
// 与 `astra3294/dsh-doctor`（boot 探针 + checkpoint/rollback）卖的都是**「我坏了，现在就要救」**；
// 而我们原来只有「体检 + 报告」。`--clean-restore` 还原的是**我们自己删掉的东西**，
// 不是「回到上次能用的配置」——这两件事经常被混为一谈，实际上差得很远。
//
// 本模块只做三件确定的事：
//   ① checkpoint：把 profile 的**配置文件**（不是 node_modules）拷进自己的数据目录，带 sha256 清单；
//   ② boot：预启动静态探针——不 spawn 宿主、不执行插件代码，只判「这份配置还能不能被加载」；
//   ③ rollback：把配置写回快照，**先自动给当前状态再打一份快照**，并只写清单里出现过的文件。
//
// 刻意不做：不执行插件代码、不联网、不碰 node_modules、不写 .npmrc 之类可能含凭据的文件。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dataDir, dshHome } from './paths.mjs';
import { loadYaml } from './util.mjs';
import { satisfies } from './verrange.mjs';

export const CHECKPOINT_SCHEMA = 'dsh-healthkit/checkpoint/v1';
export const BOOT_SCHEMA = 'dsh-healthkit/boot/v1';

// 只快照「配置面」。名单是白名单不是黑名单：新出现的文件名默认不进来，
// 免得哪天把 .npmrc / .env 这种带 token 的文件扫进快照。
export const CONFIG_FILES = [
  'package.json',
  'cordis.patch.yml',
  'cordis.patch.yaml',
  'cordis.yml',
  'pnpm-workspace.yaml',
  'agent.cordis.yml',
];

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 配置文件超过 2MB 一定不是配置，跳过
const KEEP = 10;

export function checkpointsDir(home) { return path.join(dataDir(home || dshHome()), 'checkpoints'); }

function profileDirs(home) {
  const base = path.join(home, 'profiles');
  let names = [];
  try {
    names = fs.readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.charAt(0) !== '.')
      .map((d) => d.name);
  } catch (e) { return []; }
  return names.sort();
}

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function stampId(now) {
  const d = new Date(now || Date.now());
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return 'cp-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function writeAtomic(p, buf) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, p);
}

// ---------------------------------------------------------------- checkpoint

export function checkpoint(home0, opts) {
  const o = opts || {};
  const home = home0 || dshHome();
  const base = o.id || stampId(o.now);
  // id 精确到秒。回滚会「先给当前状态打一份」，同一秒内就可能与目标快照撞名，
  // 撞名的后果不是报错而是**把原快照覆盖成坏配置**（真踩过）。所以同名自动加后缀。
  let id = base;
  let dir = path.join(checkpointsDir(home), id);
  for (let i = 2; fs.existsSync(path.join(dir, 'manifest.json')); i += 1) {
    id = base + '-' + i;
    dir = path.join(checkpointsDir(home), id);
  }
  const files = [];
  for (const name of profileDirs(home)) {
    for (const f of CONFIG_FILES) {
      const src = path.join(home, 'profiles', name, f);
      let st;
      try { st = fs.statSync(src); } catch (e) { continue; }
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      let buf;
      try { buf = fs.readFileSync(src); } catch (e) { continue; }
      const rel = path.join(name, f);
      writeAtomic(path.join(dir, 'files', rel), buf);
      files.push({ profile: name, name: f, sha256: sha256(buf), bytes: buf.length });
    }
  }
  const manifest = {
    schema: CHECKPOINT_SCHEMA,
    id,
    at: new Date(o.now || Date.now()).toISOString(),
    reason: String(o.reason || 'manual').slice(0, 80),
    profiles: profileDirs(home).length,
    files,
  };
  writeAtomic(path.join(dir, 'manifest.json'), Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'));
  prune(home, o.keep);
  return manifest;
}

export function listCheckpoints(home0) {
  const home = home0 || dshHome();
  const base = checkpointsDir(home);
  let names = [];
  try { names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch (e) { return []; }
  const out = [];
  for (const id of names.sort()) {
    let m = null;
    try { m = JSON.parse(fs.readFileSync(path.join(base, id, 'manifest.json'), 'utf8')); } catch (e) { m = null; }
    if (!m) continue;
    out.push({ id: m.id || id, at: m.at, reason: m.reason, files: (m.files || []).length, profiles: m.profiles || 0 });
  }
  return out;
}

export function prune(home0, keep) {
  const home = home0 || dshHome();
  const base = checkpointsDir(home);
  let names = [];
  try { names = fs.readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); }
  catch (e) { return 0; }
  // 自动快照（rollback 前的保险）参与排序但**不主动删最旧的手动快照**：
  // 简单做法是统一按名字（含时间戳）排序保留最后 N 个，够用且可预测。
  // 2026-11-20 审计 P2：keep=-1 会让 slice 越界并删掉**全部**快照（含刚建的那份）。
  // 夹到 [1, 100]，负值/NaN 一律回落默认。
  const keepN = Number.isFinite(Number(keep)) ? Math.max(1, Math.min(100, Math.trunc(Number(keep)))) : KEEP;
  const sorted = names.sort();
  const excess = sorted.slice(0, Math.max(0, sorted.length - keepN));
  let removed = 0;
  for (const id of excess) {
    try { fs.rmSync(path.join(base, id), { recursive: true, force: true }); removed += 1; } catch (e) { /* ignore */ }
  }
  return removed;
}

// ---------------------------------------------------------------- boot 预启动探针
//
// 「能不能启动」在静态层面能判的只有四件事（判不了的一律 unknown，不猜）：
//   ① profile 的 package.json 能解析，且 dsh.profile.bundles 是数组；
//   ② 每个 bundle 在 node_modules 里存在（缺 = 宿主启动时找不到入口）；
//   ③ 每个 bundle 的 package.json 声明了 dsh.bundle（缺 = 宿主**静默跳过**，R23）；
//   ④ cordis.patch.yml 能解析且 id 不重复（解析失败 = 补丁整段失效）。
export function bootPreflight(home0, opts) {
  const o = opts || {};
  const home = home0 || dshHome();
  // 真 YAML 解析器（可从 profile 解析到）。解析不了就判 unknown，**不得**升级成 blocker：
  // 没有解析器只说明「我们判不了」，不说明用户的配置坏了。见下方 patch 段。
  const yaml = o.yaml !== undefined ? o.yaml : loadYaml(home);
  const blockers = [];
  const warnings = [];
  const profiles = [];
  const names = profileDirs(home);

  if (!names.length) {
    return { schema: BOOT_SCHEMA, at: new Date().toISOString(), ok: false, canBoot: false, profiles,
      blockers: [{ code: 'no-profile', detail: '在 ' + home + '/profiles 下没找到任何 profile' }], warnings };
  }

  for (const name of names) {
    const dir = path.join(home, 'profiles', name);
    const info = { profile: name, bundles: 0, missing: [], noManifest: [], hostProvided: 0, patch: 'ok' };
    let pkg = null;
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); }
    catch (e) {
      info.patch = 'unreadable';
      blockers.push({ code: 'package-json', profile: name, detail: 'package.json 读不出或解析失败：' + ((e && e.message) || e) });
      profiles.push(info);
      continue;
    }
    const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || null;
    if (!Array.isArray(bundles)) {
      warnings.push({ code: 'no-bundles', profile: name, detail: 'dsh.profile.bundles 缺失或不是数组（宿主可能什么都加载不了）' });
      profiles.push(info);
      continue;
    }
    info.bundles = bundles.length;
    for (const b of bundles) {
      const spec = String(b);
      // 允许 "name@version" 写法：取 @ 之前（scoped 包要保留前导 @）
      const at = spec.lastIndexOf('@');
      const pkgName = at > 0 ? spec.slice(0, at) : spec;
      const bdir = path.join(dir, 'node_modules', pkgName);
      if (!fs.existsSync(bdir)) {
        // `@deepseek-ai/*` 是**宿主自带**的 bundle（装在 DSH 应用里，不在 profile 的
        // node_modules 里）。第一版没区分，把桌面的 43 个 bundle 全报成「依赖没装」，
        // 直接把自己变成最吵的那个工具——静态探针的假红比不探还坏。
        if (pkgName.indexOf('@deepseek-ai/') === 0) { info.hostProvided += 1; continue; }
        info.missing.push(pkgName);
        continue;
      }
      let bj = null;
      try { bj = JSON.parse(fs.readFileSync(path.join(bdir, 'package.json'), 'utf8')); } catch (e) { bj = null; }
      if (!bj) { info.noManifest.push(pkgName); continue; }
      if (!(bj.dsh && bj.dsh.bundle)) info.noManifest.push(pkgName);
    }
    if (info.missing.length) {
      blockers.push({ code: 'bundle-missing', profile: name, detail: '依赖没装：' + info.missing.join('、') });
    }
    if (info.noManifest.length) {
      // 静默跳过不阻塞启动，但这正是「升完级插件不见了」的元凶，必须报
      warnings.push({ code: 'bundle-no-manifest', profile: name, detail: '没声明 dsh.bundle，宿主会静默跳过：' + info.noManifest.join('、') });
    }
    // patch 解析：用**真解析器**，不用启发式。
    //
    // 0.13.0 第一版是「统计整个文件里引号奇偶 + 找 tab 缩进」。那是错的：
    // 一条含英文撇号的注释（`# don't`）就会让引号计数落单 → 判成「引号未闭合」→
    // blocker → `--recover --yes` 把用户配置回滚。**假红接上自动写回**，比假红本身危险得多。
    //
    // 现在三条规矩：
    //   ① 有解析器：能 parse 就 parse，抛错才是真 blocker（tab 缩进会真的让 YAML 抛）；
    //   ② 没有解析器：`unknown` + warning，**绝不由它触发回滚**；
    //   ③ id 重复从解析结构里取，不再用正则扫文本。
    const patchPath = ['cordis.patch.yml', 'cordis.patch.yaml'].map((f) => path.join(dir, f)).find((p) => fs.existsSync(p));
    if (patchPath) {
      let text = '';
      try { text = fs.readFileSync(patchPath, 'utf8'); } catch (e) { text = ''; }
      if (!text.trim()) {
        info.patch = 'empty';
      } else if (!yaml || typeof yaml.parse !== 'function') {
        info.patch = 'unknown';
        warnings.push({
          code: 'patch-unparsed',
          profile: name,
          detail: patchPath.replace(home, '~/.dsh') + ' 判不了（本机找不到 YAML 解析器）；这只说明我们判不了，不代表配置有问题',
        });
      } else {
        let parsed = null;
        let parseErr = null;
        try { parsed = yaml.parse(text); } catch (e) { parseErr = String((e && e.message) || e); }
        if (parseErr) {
          info.patch = 'parse-error';
          blockers.push({
            code: 'patch-parse',
            profile: name,
            detail: patchPath.replace(home, '~/.dsh') + ' 解析失败：' + parseErr.split('\n')[0],
          });
        } else {
          const entries = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.insert) ? parsed.insert : []);
          const ids = entries
            .map((e) => (e && typeof e === 'object' ? e.id : null))
            .filter((x) => typeof x === 'string' && x);
          const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
          if (dup.length) {
            warnings.push({ code: 'patch-duplicate-id', profile: name, detail: '补丁 id 重复：' + Array.from(new Set(dup)).join('、') });
            info.patch = 'duplicate-id';
          }
        }
      }
    }
    profiles.push(info);
  }

  const canBoot = blockers.length === 0;
  // 宿主版本对账（P1-4）：声明了引擎范围就核一下——前提是有人告诉我们宿主版本。
  // 桌面端没有把版本暴露给插件（profile 里也没有 @deepseek-ai/dsh），所以这里只能「给就核、
  // 不给就说判不了」，绝不假装通过。CLI 用 `--host 0.2.2-rc.5` 传进来。
  const compat = hostCompat(home, o.hostVersion);
  if (compat.verdict === 'mismatch') {
    blockers.push({ code: 'host-version', detail: '本插件声明 engines.dsh = ' + compat.declared + '，不覆盖当前宿主 ' + compat.hostVersion });
  }
  return {
    schema: BOOT_SCHEMA,
    at: new Date().toISOString(),
    ok: canBoot && compat.verdict !== 'mismatch',
    canBoot: canBoot && compat.verdict !== 'mismatch',
    profiles,
    blockers,
    warnings,
    compat,
    // 判不了的事写明：真正的启动还取决于宿主版本与插件运行时行为，静态探针到不了那一步。
    unknown: ['宿主版本兼容性', '插件运行时抛错', '端口占用'],
  };
}

// 读本插件自己的 engines.dsh / dsh.compatibility.dsh，和给定宿主版本比对。
export function hostCompat(home0, hostVersion) {
  let declared = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    declared = (pkg.engines && pkg.engines.dsh) || (pkg.dsh && pkg.dsh.compatibility && pkg.dsh.compatibility.dsh) || null;
  } catch (e) { declared = null; }
  if (!declared) return { declared: null, hostVersion: hostVersion || null, verdict: 'undeclared', note: '本插件没有声明 engines.dsh' };
  if (!hostVersion) return { declared, hostVersion: null, verdict: 'unknown', note: '宿主没把版本告诉插件；要核对就传 --host <版本>' };
  const r = satisfies(hostVersion, declared);
  if (r === null) return { declared, hostVersion, verdict: 'unknown', note: '版本或范围语法超出支持范围，判不了' };
  return { declared, hostVersion, verdict: r ? 'ok' : 'mismatch', note: r ? '声明覆盖当前宿主' : '声明**不覆盖**当前宿主' };
}

export function renderBoot(b) {
  const L = [];
  L.push('预启动探针：' + (b.canBoot ? '静态看能启动（判不了的部分见末尾）' : '静态看**起不来**'));
  for (const p of b.profiles) {
    L.push('  · ' + p.profile + '：bundle ' + p.bundles + ' 个' +
      (p.missing.length ? '，缺 ' + p.missing.length : '') +
      (p.noManifest.length ? '，无 manifest ' + p.noManifest.length : '') +
      '，patch ' + p.patch);
  }
  if (b.compat) {
    L.push('  · 宿主版本对账：' + b.compat.verdict + ' — ' + (b.compat.note || '') +
      (b.compat.declared ? '（声明 ' + b.compat.declared + (b.compat.hostVersion ? '，宿主 ' + b.compat.hostVersion : '') + '）' : ''));
  }
  for (const x of b.blockers) L.push('  ✗ [' + x.code + '] ' + (x.profile ? x.profile + '：' : '') + x.detail);
  for (const x of b.warnings) L.push('  ! [' + x.code + '] ' + (x.profile ? x.profile + '：' : '') + x.detail);
  L.push('  静态探针判不了：' + b.unknown.join('、'));
  return L.join('\n');
}

// ---------------------------------------------------------------- rollback

export function rollback(home0, id, opts) {
  const o = opts || {};
  const home = home0 || dshHome();
  if (!id || !/^[A-Za-z0-9._-]{1,80}$/.test(id)) return { ok: false, reason: 'bad-id', detail: '快照 id 不合法：' + id };
  const dir = path.join(checkpointsDir(home), id);
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')); }
  catch (e) { return { ok: false, reason: 'not-found', detail: '找不到快照 ' + id }; }

  // 写回之前先给**当前状态**再打一份快照：回滚本身也是一次破坏性操作，
  // 没有这条路就变成「为了修好而丢掉现在能用的配置」。
  const before = checkpoint(home, { reason: 'auto-before-rollback:' + id });

  const written = [];
  const skipped = [];
  for (const f of manifest.files || []) {
    // 只允许写回 profile 目录下的白名单文件名——manifest 是可以被人手改的，不能信
    if (CONFIG_FILES.indexOf(f.name) === -1) { skipped.push(f.name + '（不在白名单）'); continue; }
    if (!/^[^\\/]+$/.test(f.profile) || f.profile === '.' || f.profile === '..') { skipped.push(f.profile + '（profile 名非法）'); continue; }
    const src = path.join(dir, 'files', f.profile, f.name);
    let buf;
    try { buf = fs.readFileSync(src); } catch (e) { skipped.push(f.profile + '/' + f.name + '（快照里没有内容）'); continue; }
    if (sha256(buf) !== f.sha256) { skipped.push(f.profile + '/' + f.name + '（快照内容被改过，sha256 不符）'); continue; }
    const dst = path.join(home, 'profiles', f.profile, f.name);
    writeAtomic(dst, buf);
    written.push(f.profile + '/' + f.name);
  }
  return {
    ok: written.length > 0,
    id,
    at: manifest.at,
    written,
    skipped,
    backup: before.id,
    // 回滚后必须再跑一次探针才知道「是否真的救回来了」——这里不替用户下结论
    next: 'dsh-healthkit --boot',
  };
}

export function recover(home0, opts) {
  const o = opts || {};
  const home = home0 || dshHome();
  const before = o.preflight || bootPreflight(home);
  if (before.canBoot && !o.force) {
    return { ok: true, acted: false, reason: 'already-bootable', preflight: before };
  }
  const list = listCheckpoints(home);
  if (!list.length) return { ok: false, acted: false, reason: 'no-checkpoint', preflight: before };
  // 2026-11-20 审计 P2：auto-before-rollback:* 是「回滚前的坏状态」保险，
  // 把它当「最新可用快照」就是救砖时把用户送回去。救回只认手动/预升级快照。
  const usable = list.filter((x) => !/^auto-before-rollback:/.test(String(x.id || '')));
  const target = (usable.length ? usable : list)[usable.length ? usable.length - 1 : list.length - 1];
  const r = rollback(home, target.id, { reason: 'recover' });
  const after = bootPreflight(home);
  return { ok: r.ok, acted: true, rolledBackTo: target.id, backup: r.backup, written: r.written, skipped: r.skipped, before, after };
}
