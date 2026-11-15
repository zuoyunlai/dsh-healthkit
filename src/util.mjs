import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}
export function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
export function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; }
}
export function readText(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
export function listDirs(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter(function (d) { return d.isDirectory(); }).map(function (d) { return d.name; }); }
  catch (e) { return []; }
}
export function listFiles(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter(function (d) { return d.isFile(); }).map(function (d) { return d.name; }); }
  catch (e) { return []; }
}
export function loadYaml(home) {
  var candidates = [];
  var profs = listDirs(path.join(home, 'profiles'));
  for (var i = 0; i < profs.length; i++) candidates.push(path.join(home, 'profiles', profs[i], 'package.json'));
  candidates.push(path.join(process.cwd(), 'package.json'));
  for (var j = 0; j < candidates.length; j++) {
    try { var req = createRequire(candidates[j]); return req('yaml'); } catch (e) { /* try next */ }
  }
  return null;
}
export function walk(root, opts) {
  opts = opts || {};
  var maxDepth = opts.maxDepth || 4;
  var skipNM = opts.skipNodeModules !== false;
  var bytes = 0, files = 0, oldest = null, truncated = false;
  var stack = [[root, 0]];
  while (stack.length) {
    var item = stack.pop(); var dir = item[0]; var depth = item[1];
    var ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (var i = 0; i < ents.length; i++) {
      var e = ents[i];
      if (skipNM && e.name === 'node_modules') continue;
      var fp = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < maxDepth) stack.push([fp, depth + 1]); else truncated = true; }
      else if (e.isFile()) {
        try { var st = fs.statSync(fp); bytes += st.size; files++; if (oldest === null || st.mtimeMs < oldest) oldest = st.mtimeMs; } catch (e2) { /* skip */ }
      }
    }
  }
  return { bytes: bytes, files: files, oldest: oldest, truncated: truncated };
}
export function daysAgo(ms) {
  if (!ms) return null;
  return Math.floor((Date.now() - ms) / 86400000);
}
export function pct(a, b) { return b === 0 ? 0 : Math.round((a / b) * 1000) / 10; }
