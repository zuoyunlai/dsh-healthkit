import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRules } from '../src/rules.mjs';

var here = path.dirname(fileURLToPath(import.meta.url));
var facts = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'facts-2026-11-16.json'), 'utf8'));
var allowlist = JSON.parse(fs.readFileSync(path.join(here, '..', 'config', 'allowlist.json'), 'utf8'));
var findings = runRules(facts, allowlist);
var ids = findings.map(function (f) { return f.ruleId; });

var mustFire = ['R7a', 'R8', 'R9', 'R11', 'R13', 'R19', 'R19b', 'R21a'];
var mustNotFire = ['R22', 'R2c', 'R5'];
var fails = [];
mustFire.forEach(function (r) {
  var hit = ids.indexOf(r) !== -1;
  console.log((hit ? 'PASS ' : 'FAIL ') + 'must-fire ' + r);
  if (!hit) fails.push(r);
});
mustNotFire.forEach(function (r) {
  var hit = ids.indexOf(r) !== -1;
  console.log((hit ? 'FAIL ' : 'PASS ') + 'must-not-fire ' + r);
  if (hit) fails.push(r);
});
var reclaimMisjudge = findings.filter(function (f) {
  return f.ruleId === 'R17' && f.measured && f.measured.engineAsset === true && f.measured.verdict !== 'ENGINE_ASSET_NO_RECLAIM';
});
console.log((reclaimMisjudge.length ? 'FAIL ' : 'PASS ') + 'engine-asset-not-reclaimable');
if (reclaimMisjudge.length) fails.push('R17-engine-asset');

console.log('---');
console.log('findings=' + findings.length + ' failed=' + fails.length + ' (' + fails.join(',') + ')');
if (fails.length) process.exit(1);
