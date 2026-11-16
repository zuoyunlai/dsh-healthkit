import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readJson } from './util.mjs';
import { dataDir } from './paths.mjs';

function cachePath(home) { return path.join(dataDir(home), 'bundle-index.json'); }

export function loadIndex(home, ttlHours) {
  var f = cachePath(home);
  var j = readJson(f, null);
  if (!j || !j.builtAt) return null;
  var ageH = (Date.now() - Date.parse(j.builtAt)) / 3600000;
  if (ageH > (ttlHours || 24)) return null;
  return j;
}

export function saveIndex(home, idx) {
  var f = cachePath(home);
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(idx, null, 2), 'utf8'); return true; }
  catch (e) { return false; }
}

export function bundleIndexFrom(bundleDumps) {
  var idToBundles = {};
  Object.keys(bundleDumps).forEach(function (b) {
    var ids = bundleDumps[b] || [];
    ids.forEach(function (id) { (idToBundles[id] = idToBundles[id] || []).push(b); });
  });
  return { builtAt: new Date().toISOString(), bundles: Object.keys(bundleDumps).length, idToBundles: idToBundles };
}
