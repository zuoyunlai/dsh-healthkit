import fs from 'node:fs';
import path from 'node:path';
import { dshHome, exists, readJson, readText, listDirs, listFiles, loadYaml, walk, daysAgo } from './util.mjs';
import { inspectWorkspace } from './workspace.mjs';
import { tagProfile, redundancy } from './capabilities.mjs';

export function collect(ctxOpts) {
  var home = dshHome();
  var yaml = loadYaml(home);
  var facts = { home: home, collectedAt: new Date().toISOString(), yamlAvailable: !!yaml, profiles: [], patchEntries: {}, exclusions: {}, costTracker: null, disk: [], engineAssets: [], logs: {}, vcs: false };

  var profNames = listDirs(path.join(home, 'profiles'));
  for (var i = 0; i < profNames.length; i++) {
    var name = profNames[i];
    var dir = path.join(home, 'profiles', name);
    var pkg = readJson(path.join(dir, 'package.json'), null);
    if (!pkg) continue;
    var bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [];
    var deps = Object.keys(pkg.dependencies || {});
    var depSpecs = pkg.dependencies || {};
    var third = bundles.filter(function (b) { return b.indexOf('@deepseek-ai/') !== 0; });
    var missing = third.filter(function (b) { return deps.indexOf(b) === -1; });
    var notBundledRaw = deps.filter(function (d) { return third.indexOf(d) === -1; });
    var patchPath = path.join(dir, 'cordis.patch.yml');
    var patchText = readText(patchPath);
    var entries = null, parseError = null;
    if (patchText && yaml) { try { entries = yaml.parse(patchText) || []; } catch (e) { parseError = String(e.message); } }
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
    facts.profiles.push({
      name: name, dir: dir, deps: deps, bundles: bundles, thirdPartyBundles: third,
      bundlesMissingFromDeps: missing,
      depsNotBundled: notBundledRaw.filter(function (d) {
        var j = readJson(path.join(dir, 'node_modules', d, 'package.json'), null);
        return !!(j && (j.dsh || /dsh-/i.test(j.name || d)));
      }),
      depsNotBundledRaw: notBundledRaw, installed: installed, depSpecs: depSpecs,
      bakFiles: listFiles(dir).filter(function (f) { return /[.]bak/.test(f); }),
      patchBytes: patchText ? patchText.length : 0
    });
  }

  facts.vcs = exists(path.join(home, 'profiles', '.git'));
  facts.credentialsFiles = listFiles(home).filter(function (f) { return /^[.]credentials/.test(f); });

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
      var sub = listDirs(dp);
      for (var s = 0; s < sub.length; s++) {
        var sp = path.join(dp, sub[s]);
        if (exists(path.join(sp, 'provenance.json'))) {
          var inner0 = listDirs(sp);
          facts.engineAssets.push({ top: topDirs[t], path: sp, hashSubdirs: inner0.length, marker: 'provenance.json' });
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
