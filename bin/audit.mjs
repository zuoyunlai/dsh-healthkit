#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { audit, loadRetirements, saveRetirements } from '../src/engine.mjs';
import { loadIndex, saveIndex, bundleIndexFrom } from '../src/probe.mjs';
import { scan as cleanScan, apply as cleanApply, restore as cleanRestore, listBatches as cleanList, purge as cleanPurge, renderScan, fmtBytes } from '../src/clean.mjs';
import { append as historyAppend, stats as historyStats, renderStats as renderHistory } from '../src/history.mjs';
import { attributionLines } from '../src/report.mjs';
import { checkpoint, listCheckpoints, bootPreflight, renderBoot, rollback, recover } from '../src/recovery.mjs';

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
    // 不走 shell：参数是字面量，多一层 cmd.exe/sh 只增加拼接面与噪音；windowsHide 免黑框。
    var r = spawnSync('dsh', ['--profile', 'probe', '--dump-config'], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 60000 });
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

var USAGE = [
  'dsh-healthkit —— DSH 体检（只读评分 / 可还原清理 / 分数趋势）',
  '',
  '用法：',
  '  dsh-healthkit                   跑一次体检，写 AUDIT-<日期>.md 并记账',
  '  dsh-healthkit --scenario <名>    general | code | design | writing',
  '  dsh-healthkit --out <路径>       指定报告落点',
  '  dsh-healthkit --json            只输出 JSON 摘要',
  '  dsh-healthkit --verbose         首屏结论 + 全量发现清单',
  '  dsh-healthkit --no-record       不记入账本（排查/试跑用）',
  '  dsh-healthkit --feedback <fp>=known|unknown   首次价值信号：这条我原先知不知道',
  '  dsh-healthkit --source <s>      账本标记来源：human（缺省）/ agent / automation / ci',
  '  dsh-healthkit --why             只看「先修哪几条」',
  '  dsh-healthkit --links           看 link:/file: 依赖指向何处',
  '  dsh-healthkit --trend [--days N]  分数趋势',
  '  dsh-healthkit --probe-all       重新探针 bundle 索引（约 60s）',
  '  dsh-healthkit --dump-facts <路径> 导出采集到的原始事实',
  '',
  '误报记档：',
  '  dsh-healthkit --retire <指纹或规则号> --reason "原因"   （原因必填）',
  '  dsh-healthkit --unretire <指纹或规则号>              撤销记档（重新计分）',
  '  dsh-healthkit --list-retired',
  '',
  '清理（默认只预览，永不直删）：',
  '  dsh-healthkit --clean-preview',
  '  dsh-healthkit --clean-apply --ids a,b [--confirm] [--dry-run]',
  '  dsh-healthkit --clean-list',
  '  dsh-healthkit --clean-restore <批次号>',
  '  dsh-healthkit --clean-purge [--older-than N] [--dry-run]',
  '',
  '恢复面（配置快照 / 预启动探针 / 回滚）：',
  '  dsh-healthkit --boot              预启动静态探针：这份配置还能不能被加载（exit 0 能 / 1 起不来）',
  '  dsh-healthkit --checkpoint        把 profile 配置文件存成一份快照（配置还能用的时候建）',
  '  dsh-healthkit --checkpoints       列出已有的快照',
  '  dsh-healthkit --rollback <id> --yes   写回快照（写回前自动给当前状态再打一份）',
  '  dsh-healthkit --recover [--yes]   探针不过时回滚到最新快照（不带 --yes 只看不动）',
  '',
  '解释与规划：',
  '  dsh-healthkit --findings [--severity P1] [--limit N]',
  '  dsh-healthkit --explain <指纹或规则号>',
  '  dsh-healthkit --plan [--limit N]',
  '',
  '能力域矩阵：',
  '  dsh-healthkit --capabilities   20 个能力域有没有实现 + 三级补救阶梯（先在配置/内置找，最后才装插件）',
  '',
  '推荐源：',
  '  dsh-healthkit --recommend         20 个能力域的推荐源（阶梯 + 去哪找，不联网不给包名）',
  '',
  'CI / 机器可读：',
  '  dsh-healthkit --check            生态三值契约；默认基线门（只看相对上次快照的新增）',
  '  dsh-healthkit --check --absolute 绝对状态门（老行为：存量问题也算）',
  '  dsh-healthkit --check --remediation  附带有序修法清单',
  '  dsh-healthkit --format json      全量 JSON 报告（--out 指定落点）',
  '',
  '验回与时间线：',
  '  dsh-healthkit --verify            上次修的修好了没、有没有回归（开机自动核对过）',
  '',
  '跨次差异：',
  '  dsh-healthkit --diff              与上一次快照比：新增 / 真修好 / 新退役 / 严重度变化',
  '',
  '装载面瘦身：',
  '  dsh-healthkit --trim            同能力多实现 / 超限 / 记忆叠放，给主备候选',
  '',
  '接入自检：',
  '  dsh-healthkit --init            报环境/装没装/还差哪一步（不改任何文件）',
].join('\n');

if (has('help') || has('h')) { console.log(USAGE); process.exit(0); }

// 解释型动作直接复用插件工具的实现，避免 CLI 与工具面两套文案漂移。
if (has('findings') || has('explain') || has('plan')) {
  try {
    var mod2 = await import('../index.js');
    var built = {};
    mod2.buildTools({}).forEach(function (t) { built[t.name] = t; });
    var res2 = null;
    if (has('plan')) res2 = await built.audit_plan.execute({ limit: Number(arg('limit', '5')) });
    else if (has('explain')) res2 = await built.audit_explain.execute({ finding: arg('explain', '') });
    else res2 = await built.audit_findings.execute({ severity: arg('severity', 'all'), limit: Number(arg('limit', '20')) });
    if (has('json')) console.log(JSON.stringify(res2, null, 2));
    else console.log(res2.summary);
    process.exit(res2 && res2.found === false ? 2 : 0);
  } catch (e) { console.error('failed: ' + e.message); process.exit(1); }
}

if (has('unretire')) {
  // 撤销记档（审计反哺 V08）：与 audit_retire action=restore 共用同一份存取逻辑。
  var unKey = arg('unretire', null);
  try {
    var engU = await import('../src/engine.mjs');
    var snapU = audit({ scenario: arg('scenario', 'general'), skipRetire: true });
    var storeU = engU.loadRetirements(snapU.facts.home);
    var exactU = storeU[unKey] ? [unKey] : Object.keys(storeU).filter(function (fp) { return fp.split('#')[0] === unKey; });
    if (!exactU.length) { console.error('no retirement matches: ' + unKey); process.exit(2); }
    for (var ui = 0; ui < exactU.length; ui++) delete storeU[exactU[ui]];
    engU.saveRetirements(snapU.facts.home, storeU);
    console.log('unretired: ' + exactU.join(', '));
    process.exit(0);
  } catch (e) { console.error('unretire failed: ' + e.message); process.exit(1); }
}

if (has('retire')) {
  // 退役只能带理由——CLI 与 audit_retire 工具面共用同一份逻辑（engine 的 load/saveRetirements）。
  var retireKey = arg('retire', null);
  var retireReason = arg('reason', '');
  if (!retireReason) { console.error('--retire 必须带 --reason "原因"'); process.exit(2); }
  try {
    var eng2 = await import('../src/engine.mjs');
    var snap4 = audit({ scenario: arg('scenario', 'general'), skipRetire: true });
    var hit4 = (snap4.allFindings || []).find(function (f) { return f.fp === retireKey || f.ruleId === retireKey; });
    if (!hit4) { console.error('no finding matches: ' + retireKey); process.exit(2); }
    var store4 = eng2.loadRetirements(snap4.facts.home);
    store4[hit4.fp] = { reason: retireReason, at: new Date().toISOString(), title: hit4.title };
    eng2.saveRetirements(snap4.facts.home, store4);
    console.log('retired: ' + hit4.fp + '  (' + hit4.title + ')');
    process.exit(0);
  } catch (e) { console.error('retire failed: ' + e.message); process.exit(1); }
}

if (has('capabilities')) {
  try {
    var cmMod = await import('../src/capability-map.mjs');
    var snap3 = audit({ scenario: arg('scenario', 'general') });
    var mx = cmMod.buildMatrix(snap3.facts);
    if (has('json')) console.log(JSON.stringify({ byStatus: mx.byStatus, rows: mx.rows }, null, 2));
    else console.log(cmMod.renderMatrix(mx));
    process.exit(0);
  } catch (e) { console.error('capabilities failed: ' + e.message); process.exit(1); }
}

if (has('verify')) {
  try {
    var verMod = await import('../src/verify.mjs');
    var snapV = audit({ scenario: arg('scenario', 'general') });
    var lastV = verMod.readLastVerify(snapV.facts.home);
    var resV = lastV || verMod.checkPending(snapV, { home: snapV.facts.home });
    if (has('json')) console.log(JSON.stringify(resV, null, 2));
    else {
      console.log(resV.hasPending
        ? ('待验清单（来自 ' + String(resV.pendingAt || '').replace('T', ' ').slice(0, 19) + '）：\n  真修好 ' + resV.fixed.length + ' 条 / 还在 ' + resV.stillThere.length + ' 条 / 被静音 ' + resV.muted.length + ' 条 / 回归 ' + (resV.regressions || []).length + ' 条')
        : (resV.note || '没有待验清单。'));
      var tlV = verMod.timeline(snapV.facts.home, 12);
      if (tlV.length) {
        console.log('最近几次的变化：');
        tlV.slice().reverse().forEach(function (t) {
          console.log('  ' + String(t.at).replace('T', ' ').slice(5, 19) + '  分数 ' + t.score + '  新增 ' + t.added + ' / 真修好 ' + t.fixed + ' / 被静音 ' + t.muted);
        });
      }
    }
    process.exit(0);
  } catch (e) { console.error('verify failed: ' + e.message); process.exit(1); }
}

if (has('diff')) {
  try {
    var snapMod2 = await import('../src/snapshot.mjs');
    var snapCur = snapMod2.latestRun(home());
    var snapPrev = snapMod2.latestRun(home(), snapCur ? snapCur.stamp : null);
    var snapDiff = snapMod2.diffRuns(snapPrev, snapCur);
    if (has('json')) console.log(JSON.stringify(snapDiff, null, 2));
    else console.log(snapMod2.renderDiff(snapDiff));
    process.exit(0);
  } catch (e) { console.error('diff failed: ' + e.message); process.exit(1); }
}

if (has('trim')) {
  try {
    var trimMod = await import('../src/trim.mjs');
    var snap2 = audit({ scenario: arg('scenario', 'general') });
    var ta = trimMod.analyze(snap2.facts);
    if (has('json')) console.log(JSON.stringify({ served: ta.served, maxBundles: ta.maxBundles, groups: ta.groups, suggestions: ta.suggestions }, null, 2));
    else console.log(trimMod.render(ta));
    process.exit(0);
  } catch (e) { console.error('trim failed: ' + e.message); process.exit(1); }
}

if (has('recommend')) {
  // 能力域推荐源：可订阅的 JSON 文档（schema: dsh-healthkit/recommend/v1）。
  // 只给「去哪找 + 怎么按阶梯补」，不联网、不推荐具体包名。
  try {
    var recMod = await import('../src/recommend.mjs');
    var snapR = audit({ scenario: arg('scenario', 'general') });
    var recDoc = recMod.buildRecommend(snapR.facts);
    var recOut = arg('out', null);
    if (recOut) {
      var recPath = (await import('../src/reportpath.mjs')).jsonReportPath(recOut);
      fs.writeFileSync(recPath, JSON.stringify(recDoc, null, 2) + '\n', 'utf8');
      console.log('推荐源已写入 ' + recPath);
    } else if (has('json')) {
      console.log(JSON.stringify(recDoc, null, 2));
    } else {
      console.log(recMod.renderRecommend(recDoc));
    }
    process.exit(0);
  } catch (e) { console.error('recommend failed: ' + e.message); process.exit(1); }
}

if (has('check')) {
  // 生态三值契约（与 dsh-plugin-doctor 的 --format check 同形）：
  // PASS/WARN/FAIL + 退出码 0/1/2。用途：让「整机健康」与「单插件合规」能被同一套 CI 消费。
  try {
    var chkMod = await import('../src/report-json.mjs');
    var snapC = audit({ scenario: arg('scenario', 'general') });
    // P1：默认基线门（只看新增/回归）；--absolute 回退到老的绝对状态门。
    var baseline = null;
    if (!has('absolute')) {
      try {
        var snapModC = await import('../src/snapshot.mjs');
        var prevC = snapModC.latestRun(home());
        if (prevC) baseline = { at: prevC.at || null, score: typeof prevC.score === 'number' ? prevC.score : null, fps: (prevC.findings || []).map(function (f) { return f.fp; }).filter(Boolean) };
      } catch (e) { baseline = null; }
    }
    var env = chkMod.buildGateEnvelope(snapC, { version: snapC.self && snapC.self.version, baseline: baseline, remediation: has('remediation') });
    if (has('json')) console.log(JSON.stringify(env, null, 2));
    else {
      console.log('contract: ' + env.schema + '  mode=' + env.mode + '  exit=' + env.exitCode);
      var byStatus = { PASS: 0, WARN: 0, FAIL: 0 };
      env.checks.forEach(function (c) { byStatus[c.status] = (byStatus[c.status] || 0) + 1; });
      if (env.mode === 'gate') {
        console.log('相对基线（' + String(env.baselineAt || '-').replace('T', ' ').slice(0, 19) + ' · ' + env.baselineScore + ' 分）：'
          + '新增 FAIL ' + env.newFail + ' · 新增 WARN ' + env.newWarn + ' · 存量不计 ' + env.suppressed);
        console.log(env.note);
        // 只看「新增」的那几条：存量问题在 gate 模式下不阻塞，列表意义不大。
        // 只列「新增且参与门禁」的：能力域是结构事实，标了 gating:false。
        var fresh = env.checks.filter(function (c) { return c.fresh === true && c.gating !== false && c.status !== 'PASS'; });
        var shown = fresh.length ? fresh : [];
        shown.forEach(function (c) { console.log('  [' + c.status + '][新增] ' + c.id + ' ' + c.name); });
      } else {
        console.log('PASS ' + byStatus.PASS + ' / WARN ' + byStatus.WARN + ' / FAIL ' + byStatus.FAIL + '（共 ' + env.checks.length + ' 项）');
        env.checks.filter(function (c) { return c.status !== 'PASS'; }).forEach(function (c) {
          console.log('  [' + c.status + '] ' + c.id + ' ' + c.name);
        });
      }
      if (env.remediation && env.remediation.length) {
        console.log('');
        console.log('修法（有序）：');
        env.remediation.slice(0, 8).forEach(function (t, i) { console.log('  ' + (i + 1) + '. ' + t); });
      }
    }
    process.exit(env.exitCode);
  } catch (e) { console.error('check failed: ' + e.message); process.exit(1); }
}

if (has('init')) {
  // 必须 await：写成 .then() 会让下面的默认体检分支继续跑，
  // 结果是「--init 顺手跑了一次体检、写了报告还记了账」。
  try {
    var mod = await import('../src/init.mjs');
    var initRes = mod.inspect(home());
    if (has('json')) console.log(JSON.stringify(initRes, null, 2));
    else console.log(mod.renderInit(initRes));
    process.exit(initRes.ready ? 0 : 1);
  } catch (e) { console.error('init failed: ' + e.message); process.exit(1); }
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

// ---- 先修哪几条（①）：只读，不写报告、不记账 ----
if (has('why')) {
  var whyRes = audit({ scenario: arg('scenario', 'general') });
  console.log(attributionLines(whyRes.score, whyRes.attribution).join('\n'));
  process.exit(0);
}

// ---- 分数账本（P3）：只读，不改配置 ----
if (has('trend')) {
  var trendDays = Number(arg('trend', '30'));
  if (!Number.isFinite(trendDays) || trendDays <= 0) trendDays = 30;
  var tstats = historyStats({ days: trendDays });
  if (has('json')) process.stdout.write(JSON.stringify(tstats, null, 2) + '\n');
  else console.log(renderHistory(tstats));
  process.exit(0);
}

// ---- 恢复面（A2）：配置快照 / 预启动探针 / 回滚 ----
//
// 与清理器的分工：清理器动的是**数据**（回收区、7 天可还原），这里动的是**配置**。
// 所有写回动作都必须显式 --yes，并且写回前自动给当前状态再打一份快照。
if (has('boot')) {
  var bres = bootPreflight(home());
  if (has('json')) console.log(JSON.stringify(bres, null, 2));
  else console.log(renderBoot(bres));
  process.exit(bres.canBoot ? 0 : 1);
}
if (has('checkpoint')) {
  var cmd = checkpoint(home(), { reason: arg('reason', 'manual'), keep: Number(arg('keep', '10')) || 10 });
  console.log('已建快照 ' + cmd.id + '：' + cmd.files.length + ' 个配置文件 / ' + cmd.profiles + ' 个 profile');
  console.log('（只快照配置面：package.json、cordis.patch.yml、cordis.yml、pnpm-workspace.yaml、agent.cordis.yml；不含 node_modules）');
  process.exit(0);
}
if (has('checkpoints')) {
  var cps = listCheckpoints(home());
  if (!cps.length) console.log('还没有快照：先跑 dsh-healthkit --checkpoint');
  cps.forEach(function (c) {
    console.log(c.id + '  ' + c.at + '  ' + c.files + ' 文件  ' + (c.reason || ''));
  });
  process.exit(0);
}
if (has('rollback')) {
  var cpId = arg('rollback', '');
  if (!has('yes')) {
    console.error('--rollback 会写回配置文件，必须加 --yes（写回前会自动给当前状态再打一份快照）');
    process.exit(2);
  }
  var rbres = rollback(home(), cpId, {});
  if (!rbres.ok) { console.error('回滚失败: ' + (rbres.detail || rbres.reason)); process.exit(2); }
  console.log('已回滚到 ' + rbres.id + '（快照时间 ' + rbres.at + '）：写回 ' + rbres.written.length + ' 个文件');
  rbres.written.forEach(function (w) { console.log('  ' + w); });
  if (rbres.skipped.length) { console.log('跳过 ' + rbres.skipped.length + ' 项：'); rbres.skipped.forEach(function (s) { console.log('  ' + s); }); }
  console.log('当前状态已存为 ' + rbres.backup + '（回滚错了还能回来）');
  console.log('下一步：' + rbres.next + '（静态探针确认是否真救回来了）');
  process.exit(0);
}
if (has('recover')) {
  var pre = bootPreflight(home());
  if (!has('yes')) {
    console.log(renderBoot(pre));
    var candidates = listCheckpoints(home());
    console.log('');
    console.log(pre.canBoot
      ? '静态看不用救。要强制回滚到最新快照：--recover --yes --force'
      : (candidates.length
        ? '可回滚到最新快照 ' + candidates[candidates.length - 1].id + '：--recover --yes'
        : '没有可用快照：--checkpoint 先建一份（在配置还能用时建才有意义）'));
    process.exit(pre.canBoot ? 0 : 1);
  }
  var rres2 = recover(home(), { preflight: pre, force: has('force') });
  if (!rres2.acted) {
    console.log('没动任何文件：' + (rres2.reason === 'already-bootable' ? '静态看能启动' : rres2.reason === 'no-checkpoint' ? '没有可用快照' : String(rres2.reason)));
    process.exit(rres2.reason === 'already-bootable' ? 0 : 2);
  }
  console.log('已回滚到 ' + rres2.rolledBackTo + '（写回 ' + rres2.written.length + ' 个文件，当前状态存为 ' + rres2.backup + '）');
  console.log(renderBoot(rres2.after));
  process.exit(rres2.after.canBoot ? 0 : 1);
}

// ---- 清理器（P1）：全部先进回收区，7 天内可还原 ----
var cleanAge = Number(arg('min-age', '14'));
if (!Number.isFinite(cleanAge)) cleanAge = 14;

if (has('clean-preview')) {
  console.log(renderScan(cleanScan({ minAgeDays: cleanAge })));
  process.exit(0);
}
if (has('clean-list')) {
  var batches = cleanList();
  if (!batches.length) console.log('回收区为空');
  batches.forEach(function (b) {
    console.log(b.batch + '  ' + fmtBytes(b.bytes) + ' / ' + b.entries + ' 项  建于 ' + b.createdAt + '  ' + (b.ageDays === null ? '' : b.ageDays + ' 天前') + '  还原截止 ' + (b.restoreBefore || '-'));
  });
  process.exit(0);
}
if (has('clean-apply')) {
  var cleanIds = String(arg('clean-apply', '')).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  var cres = cleanApply(cleanIds, { confirm: has('confirm'), dryRun: has('dry-run'), minAgeDays: cleanAge });
  if (!cres.ok) {
    console.error('清理失败: ' + cres.error);
    (cres.skipped || []).forEach(function (s) { console.error('  skip: ' + s); });
    process.exit(2);
  }
  console.log((cres.dryRun ? '[预演] 将释放 ' : '已释放 ') + fmtBytes(cres.freedBytes) + ' / ' + cres.items.length + ' 项' + (cres.batch ? '，批次 ' + cres.batch + '，还原截止 ' + cres.restoreBefore : ''));
  (cres.skipped || []).forEach(function (s) { console.log('  skip: ' + s); });
  process.exit(0);
}
if (has('clean-restore')) {
  var rres = cleanRestore(arg('clean-restore', ''));
  if (!rres.ok) { console.error('还原失败: ' + rres.error); process.exit(2); }
  console.log('已还原 ' + rres.restored.length + ' 项' + (rres.conflicts.length ? '，冲突 ' + rres.conflicts.length + ' 项' : ''));
  rres.conflicts.forEach(function (c) { console.log('  ' + c); });
  process.exit(0);
}
if (has('clean-purge')) {
  var purgeAge = Number(arg('clean-purge', '7'));
  if (!Number.isFinite(purgeAge)) purgeAge = 7;
  var pres = cleanPurge({ olderThanDays: purgeAge, dryRun: has('dry-run') });
  console.log((pres.dryRun ? '[预演] 将永久删除 ' : '已永久删除 ') + (pres.dryRun ? pres.candidates.length : pres.purged.length) + ' 个批次，' + fmtBytes(pres.bytes));
  process.exit(0);
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
  // P1：CLI 记为 human；--source 可覆盖（automation / ci）；--no-record 完全不记账。
  if (!has('no-record')) historyAppend(result, { scenario: scenario, source: arg('source', 'human') });
  // 写运行快照：跨次差异归因的基线
  try {
    var snapMod = await import('../src/snapshot.mjs');
    snapMod.writeRun(result, { home: home(), scenario: scenario, version: 'cli' });
  } catch (e) { /* 快照写失败不该让体检失败 */ }
  // 待验清单也要写：只跑 CLI 的人此前永远不会触发跨重启验回（清单恒空 ⇒ audit_verify 空转）。
  try {
    var verMod = await import('../src/verify.mjs');
    verMod.writePending(result, { home: home() });
  } catch (e) { /* 待验清单写失败不该让体检失败 */ }
  var factsOut = arg('dump-facts', null);
  if (factsOut) { fs.mkdirSync(path.dirname(factsOut), { recursive: true }); fs.writeFileSync(factsOut, JSON.stringify(result.facts, null, 2), 'utf8'); }
  var fbArg = arg('feedback', null);
  if (fbArg) {
    var fbMod = await import('../src/feedback.mjs');
    var parts = String(fbArg).split('=');
    var key = parts[0];
    var known = String(parts[1] || '').toLowerCase() === 'known';
    var poolAll = (result.allFindings || []).concat(result.retired || []);
    var hitFb = poolAll.filter(function (f) { return f.fp === key || f.ruleId === key; })[0];
    if (!hitFb) { console.error('no finding matches: ' + key); process.exit(2); }
    fbMod.append(result.facts.home, {
      at: new Date().toISOString(), fp: hitFb.fp, ruleId: hitFb.ruleId,
      severity: hitFb.severity, title: hitFb.title || '', known: known, note: null,
    });
    console.log('recorded: ' + hitFb.ruleId + ' = ' + (known ? 'known' : 'unknown'));
    console.log(fbMod.renderStats(fbMod.stats(result.facts.home)));
    process.exit(0);
  }
  if (has('digest')) {
    var wk = await import('../src/weekly.mjs');
    var dg = wk.buildDigest(result, { limit: 3 });
    if (has('json')) console.log(JSON.stringify(dg, null, 2));
    else console.log(dg.lines.join('\n'));
    process.exit(0);
  }
  if (arg('format', 'md') === 'json') {
    var jsonMod = await import('../src/report-json.mjs');
    var jsonRep = jsonMod.buildJsonReport(result, { version: result.self && result.self.version });
    var rpMod = await import('../src/reportpath.mjs');
    var jsonPath = rpMod.jsonReportPath(out);
    fs.writeFileSync(jsonPath, JSON.stringify(jsonRep, null, 2) + '\n', 'utf8');
    if (has('json')) console.log(JSON.stringify(jsonRep, null, 2));
    else console.log('JSON 报告已写入 ' + jsonPath);
    process.exit(0);
  }
  fs.writeFileSync(out, result.report, 'utf8');
  if (has('json')) process.stdout.write(JSON.stringify({ score: result.score, findings: result.findings, retired: result.retired.length }, null, 2) + '\n');
  else {
    if (bundleIndex) console.log('bundleIndex: ' + (bundleIndex.ok || 0) + '/' + (bundleIndex.requested || 0) + ' bundles, ' + Object.keys(bundleIndex.idToBundles || {}).length + ' ids');
    // 产品审计 P0：默认首屏 = 结论 + ≤3 条最值得动；全量清单留在 --verbose 与报告文件里。
    var digestMod = await import('../src/digest.mjs');
    var first = digestMod.renderFirstScreen(result, { limit: 3 });
    console.log('score=' + result.score.total + '/10 (raw ' + result.score.raw + ', band ' + result.score.band + ', P0=' + result.score.p0Open + ', retired=' + result.retired.length + ')');
    console.log('');
    first.lines.forEach(function (l) { console.log(l); });
    if (has('verbose')) {
      console.log('');
      console.log('全量发现：');
      result.findings.forEach(function (f) { console.log('  [' + f.severity + ']' + (f.advisory ? '(建议)' : '') + ' ' + f.ruleId + ' ' + f.title); });
    }
    console.log('');
    console.log('report=' + out);
  }
} catch (e) { console.error('audit failed: ' + e.message); process.exit(1); }
