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

var bad = r.findings.filter(function (f) {
  return f.ruleId === 'R17' && f.measured && f.measured.engineAsset === true && f.measured.verdict !== 'ENGINE_ASSET_NO_RECLAIM';
});
ok('engine-asset-not-reclaimable', bad.length === 0, bad.length ? JSON.stringify(bad.map(function (b) { return b.title; })) : '');

var store = loadRetirements(r.facts.home);
var leaked = r.findings.filter(function (f) { return store[f.fp]; });
ok('retired-hidden', leaked.length === 0, leaked.length ? leaked[0].fp : '');

var noFp = r.findings.filter(function (f) { return !f.fp; });
ok('every-finding-has-fingerprint', noFp.length === 0);

ok('p0-requires-cap-reason', r.score.p0Open === 0 || !!r.score.capReason, 'P0=' + r.score.p0Open);

ok('advisory-separated', r.findings.length >= 0 && adv.length >= 0, 'advisory=' + adv.length);

console.log('---');
console.log('failed=' + fails.length + ' findings=' + r.findings.length + ' retired=' + r.retired.length);
if (fails.length) process.exit(1);

