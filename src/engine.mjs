import path from 'node:path';
import fs from 'node:fs';
import { collect } from './collect.mjs';
import { runRules } from './rules.mjs';
import { score } from './score.mjs';
import { renderReport } from './report.mjs';
import { readJson } from './util.mjs';

export function retireStorePath(home) { return path.join(home, 'dsh-auditkit', 'retirements.json'); }
export function loadRetirements(home) { return readJson(retireStorePath(home), {}) || {}; }
export function saveRetirements(home, store) {
  var p = retireStorePath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2) + '\n', 'utf8');
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
  var report = renderReport(facts, kept, sc, { retired: retired });
  return { facts: facts, findings: kept, retired: retired, allFindings: findings, score: sc, report: report };
}
