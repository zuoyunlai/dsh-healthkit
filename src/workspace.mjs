import path from 'node:path';
import { readJson, listDirs, listFiles } from './util.mjs';

function toArray(v) {
  if (!v) return null;
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') return Object.keys(v).map(function (k) { var o = v[k]; if (o && typeof o === 'object') { if (!o.id) o.id = k; return o; } return null; }).filter(Boolean);
  return null;
}
function byId(j, id) {
  if (!id) return null;
  var keys = Object.keys(j);
  for (var i = 0; i < keys.length; i++) {
    var v = j[keys[i]];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      var rec = v[id];
      if (rec && typeof rec === 'object' && (rec.path || rec.dir || rec.root || rec.cwd || rec.workspacePath)) return rec;
    }
  }
  return null;
}

function pickWorkspace(home) {
  var j = readJson(path.join(home, 'storages', 'workspace.json'), null);
  if (!j) return null;
  var g = j.global || {};
  var defId = g.defaultWorkspaceId || j.activeId || j.current || null;
  var rec = byId(j, defId) || (j.tables && byId(j.tables, defId)) || ((g.workspaceIds || []).map(function (id) { return byId(j, id) || (j.tables && byId(j.tables, id)); }).filter(Boolean)[0]);
  if (rec) return { title: rec.title || rec.name || defId || null, path: rec.path || rec.dir || rec.root || rec.cwd || rec.workspacePath };
  var arr = toArray(j) || toArray(j.list) || toArray(j.workspaces) || toArray(j.items) || toArray(j.registry);
  if (!arr || !arr.length) return null;
  var withPath = arr.filter(function (w) { return w && (w.path || w.dir || w.root || w.cwd || w.workspacePath); });
  if (!withPath.length) return null;
  var activeId = j.activeId || j.current || j.defaultId || null;
  var def = withPath.filter(function (w) { return w.default === true || w.isDefault === true || (activeId && w.id === activeId); })[0];
  var w0 = def || withPath[0];
  return { title: w0.title || w0.name || w0.id || null, path: w0.path || w0.dir || w0.root || w0.cwd || w0.workspacePath };
}

export function inspectWorkspace(home) {
  var ws = pickWorkspace(home);
  if (!ws) return null;
  var rootFiles = listFiles(ws.path);
  var bigMedia = rootFiles.filter(function (f) { return /[.](mp3|mp4|wav|zip|tar|gz|7z|iso)$/i.test(f); });
  var underscore = rootFiles.filter(function (f) { return f.charAt(0) === '_'; });
  var strayHtml = rootFiles.filter(function (f) { return /[.]html?$/i.test(f); });
  var pluginRepos = [];
  var dirs = listDirs(ws.path);
  for (var i = 0; i < dirs.length; i++) {
    var pj = readJson(path.join(ws.path, dirs[i], 'package.json'), null);
    if (pj && pj.dsh) pluginRepos.push(dirs[i]);
  }
  return { workspace: ws, rootFileCount: rootFiles.length, mediaFiles: bigMedia,
           underscoreFiles: underscore.length, strayHtml: strayHtml,
           pluginRepos: pluginRepos, pycache: dirs.indexOf('__pycache__') !== -1 };
}
