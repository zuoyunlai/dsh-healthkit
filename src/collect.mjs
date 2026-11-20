import fs from 'node:fs';
import path from 'node:path';
import { dshHome, exists, readJson, readText, listDirs, listFiles, loadYaml, walk, daysAgo } from './util.mjs';
import { inspectWorkspace } from './workspace.mjs';
import { tagProfile, redundancy } from './capabilities.mjs';

export function collect(ctxOpts) {
  var opts = ctxOpts || {};
  var home = dshHome();
  var yaml = loadYaml(home);
  var facts = { home: home, collectedAt: new Date().toISOString(), yamlAvailable: !!yaml, profiles: [], profileErrors: [], patchEntries: {}, exclusions: {}, costTracker: null, disk: [], engineAssets: [], logs: {}, vcs: false, machines: null };

  var profNames = listDirs(path.join(home, 'profiles'));
  for (var i = 0; i < profNames.length; i++) {
    var name = profNames[i];
    var dir = path.join(home, 'profiles', name);
    var pkgPath = path.join(dir, 'package.json');
    var pkg = readJson(pkgPath, null);
    if (!pkg) {
      // 2026-11-17 修（架构审计 P0-A2）：原来这里是一句 `continue`，于是「目录存在但
      // package.json 坏了」的 profile 会**整条从体检里消失**，报告照旧给高分——
      // 体检器把「坏了」报成「没有」是它最不能犯的错。
      // 但 profiles/ 下也可能只是残留空目录，不能一律当问题：
      //   · package.json 存在却解析失败 → parse-error（必须报）
      //   · 没有 package.json 但有 node_modules → missing-package-json（像个 profile，必须报）
      //   · 两者都没有 → 不是 profile，静默跳过
      var hasNodeModules = exists(path.join(dir, 'node_modules'));
      if (exists(pkgPath) || hasNodeModules) {
        facts.profileErrors.push({
          name: name, dir: dir,
          reason: exists(pkgPath) ? 'parse-error' : 'missing-package-json',
        });
      }
      continue;
    }
    // 2026-11-20 审计 P2：bundles 被写坏（对象数组、字符串、null）时，旧代码直接 .filter
    // 抛 TypeError，整次采集失败 → 21 个工具全挂。坏形状按「没有」处理并留一条 profileError。
    var rawBundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles);
    var bundles = Array.isArray(rawBundles) ? rawBundles.filter(function (x) { return typeof x === 'string' && x; }) : [];
    if (rawBundles !== undefined && !Array.isArray(rawBundles)) {
      facts.profileErrors.push({ name: name, dir: dir, reason: 'bundle-shape' });
    }
    var deps = Object.keys(pkg.dependencies || {});
    var depSpecs = pkg.dependencies || {};
    var third = bundles.filter(function (b) { return b.indexOf('@deepseek-ai/') !== 0; });
    var missing = third.filter(function (b) { return deps.indexOf(b) === -1; });
    var notBundledRaw = deps.filter(function (d) { return third.indexOf(d) === -1; });
    // 2026-11-20 反哺 P1：市场/官方插件页的「停用」不改 dependencies，只把包从
    // dsh.profile.bundles 里摘掉（dshmarket lib/profile.js removeProfileBundle 注释：
    // "The package itself stays installed; enabling re-adds it"）。
    // 因此「依赖在、bundle 不在」有两种含义：装坏了 / 用户主动停用。
    // 停用记录在市场自己的 state.json 里，体检必须读它，否则会把用户意图判成 P1 并建议 remove。
    var marketDisabled = [];
    var marketStateReadable = false;
    var marketState = readJson(path.join(dir, '.dsh-market', 'state.json'), null);
    if (marketState && Array.isArray(marketState.disabled)) {
      marketStateReadable = true;
      marketDisabled = marketState.disabled.filter(function (x) { return typeof x === 'string' && x; });
    }
    // 2026-11-20 审计 P1：恢复面认 .yml 与 .yaml，采集面只认 .yml——用 .yaml 的 profile
    // 在体检里等于「没有 patch」，R7a/R8/R10/R12/R13/R2 全部静默不跑（安全假绿），
    // 而 audit_boot 会说「patch 解析不了」。两边必须用同一份探测逻辑。
    var patchFile = ['cordis.patch.yml', 'cordis.patch.yaml']
      .map(function (f) { return { name: f, p: path.join(dir, f) }; })
      .filter(function (x) { return exists(x.p); })[0] || { name: 'cordis.patch.yml', p: path.join(dir, 'cordis.patch.yml') };
    var patchPath = patchFile.p;
    var patchText = readText(patchPath);
    var entries = null, parseError = null;
    if (patchText && yaml) {
      try {
        var parsedPatch = yaml.parse(patchText);
        // 补丁面必须是数组；解析出对象时旧代码 .map 崩溃，现在按「解析失败」如实报。
        if (Array.isArray(parsedPatch)) entries = parsedPatch;
        else if (parsedPatch === null || parsedPatch === undefined) entries = [];
        else parseError = 'PATCH_NOT_ARRAY';
      } catch (e) { parseError = String(e.message); }
    }
    else if (patchText && !yaml) parseError = 'YAML_UNAVAILABLE';
    facts.patchEntries[name] = entries ? entries.map(function (e) { return { id: e.id, disabled: e.disabled === true, name: e.name || null, hasConfig: !!e.config, config: e.config || null }; }) : [];
    if (parseError) facts.patchEntries[name] = { error: parseError };
    var installed = {};
    for (var k = 0; k < deps.length; k++) {
      var ver = readJson(path.join(dir, 'node_modules', deps[k], 'package.json'), null);
      installed[deps[k]] = ver ? ver.version : null;
    }
    var wsPath = path.join(dir, 'pnpm-workspace.yaml');
    var wsText = readText(wsPath);
    var excl = null;
    if (wsText && yaml) { try { var ws = yaml.parse(wsText); excl = ws.minimumReleaseAgeExclude || []; } catch (e) { excl = null; } }
    facts.exclusions[name] = excl;
    // 架构审计 B2：豁免项「对应哪个已安装版本」属于文件系统事实，必须在采集层定下来。
    // 原来规则层自己去读 node_modules/<pkg>/package.json，那条路径夹具永远盖不到。
    var installedExclusions = {};
    for (var xe = 0; xe < (Array.isArray(excl) ? excl.length : 0); xe++) {
      var xm = String(excl[xe]).match(/^(@?[^@]+)@(.+)$/);
      if (!xm) continue;
      var xv = readJson(path.join(dir, 'node_modules', xm[1], 'package.json'), null);
      installedExclusions[xm[1]] = xv ? xv.version : null;
    }
    // file:/link: 依赖的目标是否存在——**在采集阶段判定**（涉及真实文件系统，
    // 平台相关）。规则层只读事实，这样夹具在任何机器上结论一致。
    var localDeps = [];
    for (var k2 = 0; k2 < deps.length; k2++) {
      var d2 = deps[k2];
      var spec2 = depSpecs[d2];
      if (!spec2) continue;
      var m2 = String(spec2).match(/^(file|link):(.+)$/);
      if (!m2) continue;
      var t2 = path.isAbsolute(m2[2]) ? m2[2] : path.resolve(dir, m2[2]);
      var ex2 = false;
      try { ex2 = fs.existsSync(t2); } catch (e) { ex2 = false; }
      localDeps.push({ dep: d2, spec: String(spec2), target: t2, exists: ex2 });
    }
    // R23 判据（审计反哺 V07）：bundle 是否声明 dsh.bundle——文件系统的事在采集层做完，
    // 规则层只读事实。可读但缺 dsh.bundle 的才算；读不到的（未安装）不算，与原语义一致。
    var noManifest = third.filter(function (b) {
      var pj = readJson(path.join(dir, 'node_modules', b, 'package.json'), null);
      return !!(pj && !(pj.dsh && pj.dsh.bundle));
    });
    facts.profiles.push({
      name: name, dir: dir, deps: deps, bundles: bundles, thirdPartyBundles: third, noManifestBundles: noManifest,
      bundlesMissingFromDeps: missing,
      depsNotBundled: notBundledRaw.filter(function (d) {
        var j = readJson(path.join(dir, 'node_modules', d, 'package.json'), null);
        return !!(j && (j.dsh || /dsh-/i.test(j.name || d)));
      }),
      depsNotBundledRaw: notBundledRaw, installed: installed, depSpecs: depSpecs, localDeps: localDeps, installedExclusions: installedExclusions,
      marketDisabled: marketDisabled, marketStateReadable: marketStateReadable, patchFile: patchFile.name,
      bakFiles: listFiles(dir).filter(function (f) { return /[.]bak/.test(f); }),
      patchBytes: patchText ? patchText.length : 0
    });
  }

  facts.vcs = exists(path.join(home, 'profiles', '.git'));
  facts.credentialsFiles = listFiles(home).filter(function (f) { return /^[.]credentials/.test(f); });

  // 远端机器注册表：只取 R9 需要的字段，不采集任何凭据
  var machinesJson = readJson(path.join(home, 'remote-workspaces', 'machines.json'), null);
  if (machinesJson) {
    var ml = Array.isArray(machinesJson) ? machinesJson : (machinesJson.list || machinesJson.machines || []);
    if (Array.isArray(ml)) facts.machines = ml.map(function (m) {
      return { name: m.name || null, host: m.host || null, useSshConfig: m.useSshConfig === true,
               privateKeyPath: m.privateKeyPath || null, keyPath: m.keyPath || null };
    });
  }

  var candidates = ['', 'profiles', 'logs', 'storages'];
  for (var c = 0; c < candidates.length; c++) {
    var d = path.join(home, candidates[c]);
    var fs2 = listFiles(d);
    for (var f = 0; f < fs2.length; f++) {
      if (/usage/i.test(fs2[f]) && /[.]json$/.test(fs2[f])) {
        var st2 = null; try { st2 = fs.statSync(path.join(d, fs2[f])); } catch (e) { st2 = null; }
        if (st2 && (!facts.costTracker || st2.mtimeMs > facts.costTracker.mtimeMs)) facts.costTracker = { file: path.join(d, fs2[f]), mtimeMs: st2.mtimeMs, ageDays: daysAgo(st2.mtimeMs) };
      }
    }
  }

  var topDirs = listDirs(home);
  for (var t = 0; t < topDirs.length; t++) {
    var dp = path.join(home, topDirs[t]);
    var w = walk(dp, { maxDepth: 5 });
    facts.disk.push({ name: topDirs[t], bytes: w.bytes, files: w.files, oldestAgeDays: daysAgo(w.oldest), truncated: w.truncated });
    if (w.files > 0 && w.bytes > 0) {
      // C2：标记文件名取 allowlist.engineAssetMarkers（原来这里硬编码 provenance.json，
      // 配置项存在却从不被读——正是 V06 那种「配置是空壳」的同类复发）。
      var markers = (opts && Array.isArray(opts.engineAssetMarkers) && opts.engineAssetMarkers.length)
        ? opts.engineAssetMarkers : ['provenance.json'];
      var sub = listDirs(dp);
      for (var s = 0; s < sub.length; s++) {
        var sp = path.join(dp, sub[s]);
        var hitMarker = null;
        for (var mi = 0; mi < markers.length; mi++) {
          if (exists(path.join(sp, markers[mi]))) { hitMarker = markers[mi]; break; }
        }
        if (hitMarker) {
          var inner0 = listDirs(sp);
          facts.engineAssets.push({ top: topDirs[t], path: sp, hashSubdirs: inner0.length, marker: hitMarker });
          continue;
        }
        var inner1 = listDirs(sp);
        if (inner1.length === 1 && /^[0-9a-f]{64}$/.test(inner1[0])) {
          facts.engineAssets.push({ top: topDirs[t], path: sp, hashSubdirs: 1, marker: 'content-addressed' });
        }
      }
    }
  }

  var reloadLog = readText(path.join(home, 'unlag-reload.log'));
  if (reloadLog) {
    var lines = reloadLog.split(/\r?\n/);
    facts.logs.reloadLines = lines.length;
    facts.logs.standIn = lines.filter(function (l) { return /stand-in module/.test(l); });
    facts.logs.notRunning = lines.filter(function (l) { return /newly not running=[1-9]/.test(l); });
    var served = lines.filter(function (l) { return /served [0-9]+ plugins/.test(l); });
    var last = served.length ? served[served.length - 1].match(/served ([0-9]+) plugins/) : null;
    facts.logs.servedPlugins = last ? parseInt(last[1], 10) : null;
  }

  facts.workspace = inspectWorkspace(home);
  var tagged = [];
  for (var pi = 0; pi < facts.profiles.length; pi++) tagged = tagged.concat(tagProfile(facts.profiles[pi]));
  facts.capabilities = { tagged: tagged, redundancy: redundancy(tagged, 3) };
  facts.agentPresets = [];
  var pd = path.join(home, '.agent-presets');
  var pdirs = listDirs(pd);
  for (var pj = 0; pj < pdirs.length; pj++) {
    var pdir = path.join(pd, pdirs[pj]);
    var meta = readText(path.join(pdir, 'preset.yml')) || '';
    var body = readText(path.join(pdir, 'agent.cordis.yml')) || '';
    var nm = (meta.match(/^name:\s*(.+)$/m) || [])[1] || pdirs[pj];
    var desc = (meta.match(/^description:\s*(.+)$/m) || [])[1] || '';
    var ids = (body.match(/^- id:\s*(\S+)/gm) || []).map(function (s) { return s.replace(/^- id:\s*/, ''); });
    var names = (body.match(/^\s+name:\s*'?([^'\n]+)'?$/gm) || []).map(function (s) { return s.replace(/^\s+name:\s*'?/, '').replace(/'$/, '').trim(); });
    facts.agentPresets.push({ dir: pdirs[pj], path: pdir, name: nm.trim(), description: desc.trim().slice(0, 120),
      entryIds: ids, entryCount: ids.length, bytes: body.length, names: names,
      personaComplete: /complete:\s*true/.test(body), runtimeContextOff: /includeRuntimeContext:\s*false/.test(body) });
  }
  if (ctxOpts && ctxOpts.bundleIndex) facts.bundleIndex = ctxOpts.bundleIndex;

  return facts;
}
