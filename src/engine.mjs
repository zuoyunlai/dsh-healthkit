import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { collect } from './collect.mjs';
import { cachedCollect, wasCached } from './cache.mjs';
import { runRules } from './rules.mjs';
import { drain, renderDegradations } from './degrade.mjs';
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

import { attribution, validateRubric } from './score.mjs';
import { needsActionLine } from './digest.mjs';
import { latestRun, diffRuns } from './snapshot.mjs';

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
  // 2026-11-20 审计 P1：URL.pathname 带百分号编码（C:\\Users\\张三 → %E5%BC%A0…），
  // 安装路径含中文/空格时 rubric.json 读不到，整个插件直接失效。fileURLToPath 才解编码。
  var here = path.dirname(fileURLToPath(import.meta.url));
  var cfgDir = path.join(here, '..', 'config');
  var rubric = readJson(path.join(cfgDir, 'rubric.json'), null);
  var allowlist = readJson(path.join(cfgDir, 'allowlist.json'), {});
  if (!rubric) throw new Error('rubric.json missing');
  // 架构审计 B4：同一进程里 13 个工具各跑一遍全量采集太贵（每次 ~1s / 1.2 万次系统调用）。
  // 只有 facts 走缓存，评分/退役/快照仍然现算；opts.fresh=true 可绕过。
  var facts = cachedCollect(Object.assign({}, opts || {}, {
    engineAssetMarkers: Array.isArray(allowlist.engineAssetMarkers) ? allowlist.engineAssetMarkers : null,
  }));
  // 2026-11-20 反哺 P4：结论必须带「什么时候采的、是不是现采」。
  facts.collectedAt = facts.collectedAt || new Date().toISOString();
  facts.cacheHit = wasCached();
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
  // 架构审计 B1：rubric 是评分的输入，写错一个字就会静默改变对外承诺。
  // 自检结果进 self.notes（不进评分），让「分数不对」有据可查。
  try {
    validateRubric(rubric).forEach(function (m) { self.notes.push('rubric 自检：' + m); });
    if (sc.dropped && sc.dropped.dimension.length) {
      self.notes.push('有 ' + sc.dropped.dimension.length + ' 条问题的 dimension 不在 rubric 里，已丢弃：' + sc.dropped.dimension.join(','));
    }
    if (sc.dropped && sc.dropped.severity.length) {
      self.notes.push('有 ' + sc.dropped.severity.length + ' 条问题的 severity 不在 penalty 表里（按 0 罚）：' + sc.dropped.severity.join(','));
    }
    if (sc.unknownScenario) self.notes.push('scenario「' + (opts.scenario || 'general') + '」不在 rubric.scenarios 里，权重按默认口径。');
  } catch (e) { self.notes.push('rubric 自检失败：' + ((e && e.message) || e)); }
  try {
    var hist = require_history(facts.home);
    self.historyRuns = hist;
  } catch (e) {
    self.historyRuns = null;
    self.notes.push('账本读取失败：' + ((e && e.message) || e));
  }
  // 审计反哺 V10：报告并入跨次三分（新增/真修好/新退役）——分数变化必须能区分
  // 「真修好了」与「被静音了」，两者健康度含义相反。本次快照尚未写入，latestRun 即上一次。
  var runDiff = null;
  try {
    var prevRun = latestRun(facts.home);
    if (prevRun) {
      runDiff = diffRuns(prevRun, {
        at: new Date().toISOString(), score: sc.total,
        findings: kept.map(function (f) { return { fp: f.fp, ruleId: f.ruleId, severity: f.severity, title: f.title || '' }; }),
        retired: retired.map(function (f) { return f.fp; }),
      });
    }
  } catch (e) { runDiff = null; }
  var firstScreen = needsActionLine({ findings: kept, attribution: attr, facts: facts });
  var report = renderReport(facts, kept, sc, { retired: retired, attr: attr, version: pkgVersion, self: self, diff: runDiff, firstScreen: firstScreen });
  // P2-4：把本次采集期间记下的降级取出来（并清空，避免下次重复）。
  var degradations = drain();
  return { facts: facts, findings: kept, retired: retired, allFindings: findings, score: sc, attribution: attr, report: report, self: self,
           firstScreen: firstScreen, rubricVersion: sc.rubricVersion, degradations: degradations };
}
