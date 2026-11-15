#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { audit, loadRetirements, saveRetirements } from '../src/engine.mjs';
import { loadIndex, saveIndex, bundleIndexFrom } from '../src/probe.mjs';

function arg(name, fallback) { var i = process.argv.indexOf('--' + name); return i > -1 ? process.argv[i + 1] : fallback; }
function has(name) { return process.argv.indexOf('--' + name) > -1; }
function localDate() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function home() { return process.env.DSH_HOME || path.join(os.homedir(), '.dsh'); }

function uniqueBundles(h) {
  var set = {}; var dirs = [];
  try { dirs = fs.readdirSync(path.join(h, 'profiles'), { withFileTypes: true }).filter(function (d) { return d.isDirectory(); }); } catch (e) { return []; }
  dirs.forEach(function (d) {
    try {
      var pj = JSON.parse(fs.readFileSync(path.join(h, 'profiles', d.name, 'package.json'), 'utf8'));
      ((pj.dsh && pj.dsh.profile && pj.dsh.profile.bundles) || []).forEach(function (x) { if (x !== '@deepseek-ai/dsh-base') set[x] = 1; });
    } catch (e) { /* skip */ }
  });
  return Object.keys(set);
}
function dumpBundle(h, bundle) {
  var dir = path.join(h, 'profiles', 'probe');
  var bundles = bundle ? ['@deepseek-ai/dsh-base', bundle] : ['@deepseek-ai/dsh-base'];
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cordis.yml'), '[]\n');
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-profile-probe', private: true, dsh: { profile: { bundles: bundles } } }, null, 2) + '\n');
    var r = spawnSync('dsh', ['--profile', 'probe', '--dump-config'], { encoding: 'utf8', shell: true, timeout: 60000 });
    if (r.status !== 0 || !r.stdout) return null;
    return r.stdout.split(/\r?\n/).filter(function (l) { return /^- id: /.test(l); }).map(function (l) { return l.replace(/^- id:\s*/, '').trim(); });
  } catch (e) { return null; }
  finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e2) { /* ignore */ } }
}
function buildIndex(h) {
  var bundles = uniqueBundles(h); var dumps = {};
  var baseIds = dumpBundle(h, null);
  if (baseIds && baseIds.length) dumps['@deepseek-ai/dsh-base'] = baseIds;
  var ok = baseIds ? 1 : 0;
  bundles.forEach(function (b) { var ids = dumpBundle(h, b); if (ids && ids.length) { dumps[b] = ids; ok++; } });
  var idx = bundleIndexFrom(dumps); idx.requested = bundles.length + 1; idx.ok = ok; return idx;
}

if (has('links')) {
  var snap = audit({ scenario: 'general' });
  var rows = [];
  snap.facts.profiles.forEach(function (p) {
    p.deps.forEach(function (d) {
      var spec = (p.depSpecs || {})[d];
      if (!spec) return;
      var m = String(spec).match(/^(file|link):(.+)$/);
      if (!m) return;
      var target = m[2];
      var exists = false, mb = '-', mtime = '-';
      try {
        var stt = fs.statSync(target);
        exists = true; mb = (stt.isDirectory() ? 'dir' : (stt.size / 1048576).toFixed(1) + 'MB'); mtime = stt.mtime.toISOString().slice(0, 16);
      } catch (e) { exists = false; }
      rows.push({ profile: p.name, dep: d, kind: m[1], target: target, exists: exists, size: mb, mtime: mtime });
    });
  });
  console.log('file:/link: 依赖清单（' + rows.length + ' 条）');
  rows.forEach(function (r) {
    console.log([r.exists ? 'OK ' : 'MISS', r.profile, r.kind, r.dep, '->', r.target, r.size, r.mtime].join('  '));
  });
  var missing = rows.filter(function (r) { return !r.exists; });
  console.log('---');
  console.log('missing=' + missing.length + (missing.length ? '（宿主启动时对应 bundle 会被静默跳过）' : '（全部存在）'));
  process.exit(missing.length ? 1 : 0);
}

if (has('list-retired')) {
  var st = loadRetirements(home());
  var keys = Object.keys(st);
  if (!keys.length) console.log('no retirements');
  keys.forEach(function (k) { console.log(k + '  <-  ' + (st[k].reason || '') + '  (' + (st[k].at || '') + ')'); });
  process.exit(0);
}

var scenario = arg('scenario', 'general');
var out = arg('out', path.join(process.cwd(), 'AUDIT-' + localDate() + '.md'));
var wantProbe = has('probe-all');

try {
  var bundleIndex = null;
  if (wantProbe) {
    bundleIndex = loadIndex(home(), 24);
    if (!bundleIndex) { process.stderr.write('probing bundles (~60s)...\n'); bundleIndex = buildIndex(home()); saveIndex(home(), bundleIndex); }
  }
  var retireKey = arg('retire', null);
  var result = audit({ scenario: scenario, bundleIndex: bundleIndex, skipRetire: !!retireKey });
  if (retireKey) {
    var target = result.allFindings.filter(function (f) { return f.fp === retireKey || f.ruleId === retireKey; })[0];
    if (!target) { console.error('no finding matches: ' + retireKey); process.exit(2); }
    var store = loadRetirements(home());
    store[target.fp] = { reason: arg('reason', 'manual retire'), at: new Date().toISOString(), title: target.title };
    saveRetirements(home(), store);
    console.log('retired: ' + target.fp + '  (' + target.title + ')');
    process.exit(0);
  }
  var factsOut = arg('dump-facts', null);
  if (factsOut) { fs.mkdirSync(path.dirname(factsOut), { recursive: true }); fs.writeFileSync(factsOut, JSON.stringify(result.facts, null, 2), 'utf8'); }
  fs.writeFileSync(out, result.report, 'utf8');
  if (has('json')) process.stdout.write(JSON.stringify({ score: result.score, findings: result.findings, retired: result.retired.length }, null, 2) + '\n');
  else {
    if (bundleIndex) console.log('bundleIndex: ' + (bundleIndex.ok || 0) + '/' + (bundleIndex.requested || 0) + ' bundles, ' + Object.keys(bundleIndex.idToBundles || {}).length + ' ids');
    console.log('score=' + result.score.total + '/10 (raw ' + result.score.raw + ', band ' + result.score.band + ', P0=' + result.score.p0Open + ', retired=' + result.retired.length + ')');
    result.findings.forEach(function (f) { console.log('  [' + f.severity + ']' + (f.advisory ? '(建议)' : '') + ' ' + f.ruleId + ' ' + f.title); });
    console.log('report=' + out);
  }
} catch (e) { console.error('audit failed: ' + e.message); process.exit(1); }
