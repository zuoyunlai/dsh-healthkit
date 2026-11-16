// 不变量测试：跑在一个**临时 HOME** 上（造一个最小假 DSH 安装）。
//
// 为什么不用真机：CI（ubuntu runner）上没有 ~/.dsh，用真机必然红；
// 而不变量本身要验的是「规则行为」，与具体机器无关。
import { makeTempHome } from './testenv.mjs';

const tmpHome = makeTempHome('healthkit-inv-');
process.env.DSH_HOME = tmpHome;

// 动态 import：静态 import 会在 DSH_HOME 设上之前就完成模块求值。
var { audit, loadRetirements } = await import('../src/engine.mjs');

var fails = [];
function ok(name, cond, detail) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : ''));
  if (!cond) fails.push(name);
}

var r = audit({ scenario: 'general' });
var adv = r.findings.filter(function (f) { return f.advisory === true; });

// 修前这条恒真：R17 的 measured 里从来没有 engineAsset 字段（只有 verdict/dir），
// 所以 bad 恒为空、断言恒 PASS。改成拿 verdict 与 facts.engineAssets 对账。
var engineDirs = (r.facts.engineAssets || []).map(function (a) { return a && (a.top || a.name || a.dir); }).filter(Boolean);
function isEngineAsset(dir) { return !!dir && engineDirs.indexOf(dir) !== -1; }
var bad = r.findings.filter(function (f) {
  if (f.ruleId !== 'R17' || !f.measured) return false;
  var v = f.measured.verdict;
  if (v === 'ENGINE_ASSET_NO_RECLAIM') return !isEngineAsset(f.measured.dir);   // 声称是引擎资产却查无此物
  if (v === 'RECLAIM_CANDIDATE') return isEngineAsset(f.measured.dir);           // 声称可回收却其实是引擎资产
  return false;
});
ok('engine-asset-not-reclaimable', bad.length === 0, bad.length ? JSON.stringify(bad.map(function (b) { return b.title; })) : '');

var store = loadRetirements(r.facts.home);
var leaked = r.findings.filter(function (f) { return store[f.fp]; });
ok('retired-hidden', leaked.length === 0, leaked.length ? leaked[0].fp : '');

var noFp = r.findings.filter(function (f) { return !f.fp; });
ok('every-finding-has-fingerprint', noFp.length === 0);

ok('p0-requires-cap-reason', r.score.p0Open === 0 || !!r.score.capReason, 'P0=' + r.score.p0Open);

// 修前 `adv.length >= 0` 恒真。真断言：advisory 项一条都不许进评分维度。
var dimItems = [];
r.score.dims.forEach(function (d) { dimItems = dimItems.concat(d.items || []); });
var leakedAdv = adv.filter(function (f) { return dimItems.indexOf(f.ruleId) !== -1; });
ok('advisory-separated', leakedAdv.length === 0, 'advisory=' + adv.length + (leakedAdv.length ? ' leaked=' + leakedAdv.map(function (f) { return f.ruleId; }).join(',') : ''));

// 审计反哺 V10：报告必须有跨次对比段（无基线时也要注明「本次为基线」）。
ok('report-has-crossrun', /跨次对比/.test(r.report), '');

console.log('---');
console.log('failed=' + fails.length + ' findings=' + r.findings.length + ' retired=' + r.retired.length);
if (fails.length) process.exit(1);

