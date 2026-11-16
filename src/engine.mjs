import path from 'node:path';
import fs from 'node:fs';
import { collect } from './collect.mjs';
import { runRules } from './rules.mjs';
import { score } from './score.mjs';
import { renderReport } from './report.mjs';
import { readJson } from './util.mjs';
import { dataDir } from './paths.mjs';

export function retireStorePath(home) { return path.join(dataDir(home), 'retirements.json'); }
export function loadRetirements(home) { return readJson(retireStorePath(home), {}) || {}; }
export function saveRetirements(home, store) {
  var p = retireStorePath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

import { attribution } from './score.mjs';

// 账本行数：self 段用。读不到就返回 null（不抛，体检器自己出问题不该影响体检结论）。
function require_history(home) {
  try {
    var p = path.join(dataDir(home), 'history.jsonl');
    if (!fs.existsSync(p)) return 0;
    var txt = fs.readFileSync(p, 'utf8');
    return txt.split(/\r?\n/).filter(function (l) { return l.trim(); }).length;
  } catch (e) {
    return null;
  }
}

export function audit(opts) {
  opts = opts || {};
  var here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  var cfgDir = path.join(here, '..', 'config');
  var rubric = readJson(path.join(cfgDir, 'rubric.json'), null);
  var allowlist = readJson(path.join(cfgDir, 'allowlist.json'), {});
  if (!rubric) throw new Error('rubric.json missing');
  var facts = collect(opts || {});
  var findings = runRules(facts, allowlist);
  var store = opts.skipRetire ? {} : loadRetirements(facts.home);
  var kept = [], retired = [];
  findings.forEach(function (f) {
    if (store[f.fp]) { f.retired = store[f.fp]; retired.push(f); } else kept.push(f);
  });
  var sc = score(rubric, kept, opts.scenario || 'general');
  var attr = attribution(rubric, kept, sc);
  var pkgVersion = (readJson(path.join(here, '..', 'package.json'), {}) || {}).version || '?';
  // §13.7 自审分离：self 段只描述体检器自身，不进评分。
  var self = {
    version: pkgVersion,
    // 工具面：宿主里由 apply() 注入；CLI 直跑时没有宿主注册，明说而不是显示「未注册」吓人。
    tools: opts.selfTools || [],
    toolFace: opts.selfTools && opts.selfTools.length ? 'host' : 'cli',
    dataDir: dataDir(facts.home),
    retiredCount: retired.length,
    notes: [],
  };
  try {
    var hist = require_history(facts.home);
    self.historyRuns = hist;
  } catch (e) {
    self.historyRuns = null;
    self.notes.push('账本读取失败：' + ((e && e.message) || e));
  }
  var report = renderReport(facts, kept, sc, { retired: retired, attr: attr, version: pkgVersion, self: self });
  return { facts: facts, findings: kept, retired: retired, allFindings: findings, score: sc, attribution: attr, report: report, self: self, rubricVersion: sc.rubricVersion };
}
