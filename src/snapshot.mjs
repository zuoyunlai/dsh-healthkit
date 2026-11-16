// 运行快照与跨次差异归因（PLAN §7 目录布局 / §11 P2「两次跑分差异与归因」）。
//
// 为什么账本不够：history.jsonl 只存 total/p0/p1/p2 + 前 6 条 P0/P1 的指纹。
// P1 一旦超过 6 条，「这次比上次多出了哪条」就只能猜。快照存全量指纹，才能真比。
//
// 只读审计器写自己的历史是允许的（不是改被检对象）：快照进 $DSH_HOME/dsh-healthkit/runs/。
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.mjs';

const MAX_RUNS = 60;   // 保留最近 60 次；再多也没人翻

export function runsDir(home) {
  return path.join(dataDir(home), 'runs');
}

// 说明：snapshotsDir 曾是「快照目录」的别名，全仓无人引用（架构审计 C2）。
// 保留实现但不再 export，避免调用方误以为这是目录真源（真源是 runsDir）。
function snapshotsDir(home) {
  return path.join(dataDir(home), 'snapshots');
}

function stampOf(at) {
  const d = new Date(at);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  // 毫秒：同一秒内跑两次体检是常态（先 audit_run 再 audit_diff），
  // 只到秒会让后写的覆盖先写的，差异归因就永远比不出东西来。
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + 'T' +
    p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '-' + p(d.getMilliseconds(), 3);
}

// 写一次运行快照。返回写入的路径（写失败返回 null，不影响体检）。
export function writeRun(result, opts) {
  const o = opts || {};
  try {
    const home = o.home || dataDir();
    const at = o.at || Date.now();
    const stamp = stampOf(at);
    const dir = runsDir(home);
    fs.mkdirSync(dir, { recursive: true });
    const rec = {
      at: new Date(at).toISOString(),
      stamp: stamp,
      scenario: o.scenario || (result.score && result.score.scenario) || 'general',
      version: o.version || null,
      score: result.score ? result.score.total : null,
      raw: result.score ? result.score.raw : null,
      band: result.score ? result.score.band : null,
      // 全量指纹：差异归因的原料。P0/P1/P2/INFO 都存，不只 P0/P1。
      findings: (result.findings || []).map(function (f) {
        return {
          fp: f.fp || f.ruleId,
          ruleId: f.ruleId,
          severity: f.severity,
          dimension: f.dimension || '',
          title: f.title || '',
          advisory: f.advisory === true,
          fixHint: f.fixHint || null,
        };
      }),
      retired: (result.retired || []).map(function (f) { return f.fp || f.ruleId; }),
    };
    // 同毫秒内可能连写多次（先 audit_run 再 audit_diff）。
    // 文件名加后缀只保证不覆盖，**顺序要靠 seq 字段**：
    // 字典序里 '-' (0x2D) < '.' (0x2E)，'x-1.json' 会排在 'x.json' 前面，
    // 于是「上一次/下一次」反了。所以给每份快照一个单调递增的 seq，排序时用它。
    let seq = 0;
    try {
      for (const f of fs.readdirSync(dir).filter(function (x) { return /\.json$/.test(x); })) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (j.stamp === stamp && typeof j.seq === 'number' && j.seq >= seq) seq = j.seq + 1;
        } catch (e) { /* 坏快照跳过 */ }
      }
    } catch (e) { /* 目录还不存在 */ }
    rec.seq = seq;

    let p = path.join(dir, stamp + '.json');
    let n = 1;
    while (fs.existsSync(p)) {           // 极端情况（同毫秒）也不覆盖
      p = path.join(dir, stamp + '-' + n + '.json');
      n++;
    }
    fs.writeFileSync(p, JSON.stringify(rec, null, 2) + '\n', 'utf8');
    trimRuns(dir);
    return p;
  } catch (e) {
    return null;
  }
}

function trimRuns(dir) {
  try {
    const files = fs.readdirSync(dir).filter(function (f) { return /\.json$/.test(f); }).sort();
    if (files.length <= MAX_RUNS) return 0;
    const drop = files.slice(0, files.length - MAX_RUNS);
    for (const f of drop) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (e) { /* ignore */ }
    }
    return drop.length;
  } catch (e) { return 0; }
}

export function listRuns(home) {
  const dir = runsDir(home);
  const out = [];
  try {
    for (const f of fs.readdirSync(dir).filter(function (x) { return /\.json$/.test(x); })) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        out.push({ file: f, at: j.at, stamp: j.stamp, seq: j.seq || 0, score: j.score, scenario: j.scenario, count: (j.findings || []).length });
      } catch (e) { /* 坏快照跳过 */ }
    }
  } catch (e) { /* 没有 runs 目录 */ }
  // 按**记录里的时间**排序，不按文件名。
  //
  // 2026-11-16 踩过：文件名在同毫秒冲突时会加 '-1' 后缀，
  // 而字典序里 '-' (0x2D) < '.' (0x2E) ⇒ 'x-1.json' 排在 'x.json' **前面**，
  // 于是「上一次」变成了「下一次」，差异归因整个反了。
  // 本机因为两次写不在同一毫秒而没暴露，CI 上稳定复现。
  return out.sort(function (a, b) {
    const d = String(a.at).localeCompare(String(b.at));
    if (d !== 0) return d;
    const ds = (a.seq || 0) - (b.seq || 0);   // 同毫秒按写入顺序
    if (ds !== 0) return ds;
    return String(a.file).localeCompare(String(b.file));
  });
}

// 按**文件名**加载（stamp+'.json' 或带 '-1' 后缀的那种）。
// 为什么不能只按 stamp 加载：同毫秒写入时文件会是 '<stamp>.json' 与 '<stamp>-1.json' 两个，
// 按 stamp 找只能命中第一个，于是「第二次写入」永远读不出来，差异归因就少一条。
export function loadRunByFile(home, file) {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(path.join(runsDir(home), file), 'utf8'));
  } catch (e) { return null; }
}

// 按 stamp 加载；同 stamp 有多份时取**最后写入**的那份（seq 最大）。
export function loadRun(home, stamp) {
  const all = listRuns(home).filter(function (r) { return r.stamp === stamp; });
  if (!all.length) return null;
  return loadRunByFile(home, all[all.length - 1].file);
}

// 差异归因：这次比上次多了什么、少了什么、还在。
// 「少了」有两种：真修好了，或者被退役了（不算修好）——必须分开报。
export function diffRuns(prev, cur) {
  // 没有上一次快照时，说「全部新增」是误导：那是「没有基线」，不是「新增了 20 条」。
  if (!prev) {
    return {
      prevAt: null, curAt: cur ? cur.at : null,
      prevScore: null, curScore: cur ? cur.score : null,
      delta: null,
      added: [], gone: [], kept: (cur && cur.findings || []).length, severityChanged: [],
      fixed: [], newlyRetired: [],
      noBaseline: true,
    };
  }
  const pf = {};
  (prev && prev.findings || []).forEach(function (f) { pf[f.fp] = f; });
  const cf = {};
  (cur && cur.findings || []).forEach(function (f) { cf[f.fp] = f; });
  const retiredNow = {};
  (cur && cur.retired || []).forEach(function (f) { retiredNow[f] = true; });
  const retiredPrev = {};
  (prev && prev.retired || []).forEach(function (f) { retiredPrev[f] = true; });

  const added = [];
  const gone = [];
  const kept = [];
  const severityChanged = [];

  for (const fp of Object.keys(cf)) {
    if (!pf[fp]) {
      if (retiredPrev[fp]) continue;      // 上次就退役了，不算新增
      added.push(cf[fp]);
    } else {
      kept.push(cf[fp]);
      if (pf[fp].severity !== cf[fp].severity) {
        severityChanged.push({ fp: fp, from: pf[fp].severity, to: cf[fp].severity, title: cf[fp].title });
      }
    }
  }
  for (const fp of Object.keys(pf)) {
    if (!cf[fp]) {
      gone.push({ fp: fp, ruleId: pf[fp].ruleId, severity: pf[fp].severity, title: pf[fp].title, retiredNow: !!retiredNow[fp] });
    }
  }

  const order = { P0: 0, P1: 1, P2: 2, INFO: 3 };
  const bySev = (a, b) => (order[a.severity] === undefined ? 9 : order[a.severity]) - (order[b.severity] === undefined ? 9 : order[b.severity]);

  added.sort(bySev);
  gone.sort(bySev);

  return {
    prevAt: prev ? prev.at : null,
    curAt: cur ? cur.at : null,
    prevScore: prev ? prev.score : null,
    curScore: cur ? cur.score : null,
    delta: (prev && cur && typeof prev.score === 'number' && typeof cur.score === 'number')
      ? Math.round((cur.score - prev.score) * 100) / 100 : null,
    added,
    gone,
    kept: kept.length,
    severityChanged,
    // 真修好 = 消失且没被退役；被退役的单独列，不算修好
    fixed: gone.filter(function (g) { return !g.retiredNow; }),
    newlyRetired: gone.filter(function (g) { return g.retiredNow; }),
  };
}

// 找最近一次有快照的运行（可排除自己这次刚写的）
export function latestRun(home, excludeStamp) {
  const all = listRuns(home);
  for (let i = all.length - 1; i >= 0; i--) {
    if (!excludeStamp || all[i].stamp !== excludeStamp) return loadRunByFile(home, all[i].file);
  }
  return null;
}

export function renderDiff(d) {
  if (!d || !d.prevAt) {
    return '没有可对比的上一次快照（这是第一次有快照的运行，本次已存为基线）。当前 ' +
      (d && d.curScore !== null && d.curScore !== undefined ? d.curScore : '?') + '/10 · ' +
      (d && d.kept ? d.kept : 0) + ' 条问题。下次再跑就能对比了。';
  }
  const L = [];
  L.push('上次 ' + d.prevAt + ' → 本次 ' + d.curAt);
  L.push('分数 ' + d.prevScore + ' → ' + d.curScore + (d.delta === null ? '' : '（' + (d.delta > 0 ? '+' : '') + d.delta + '）'));
  L.push('');
  L.push('【新增 ' + d.added.length + ' 条】');
  if (!d.added.length) L.push('  （无）');
  d.added.forEach(function (f) { L.push('  + [' + f.severity + '] ' + f.ruleId + ' ' + f.title + '  ' + f.fp); });
  L.push('');
  L.push('【已修好 ' + d.fixed.length + ' 条】（消失且未被退役）');
  if (!d.fixed.length) L.push('  （无）');
  d.fixed.forEach(function (f) { L.push('  - [' + f.severity + '] ' + f.ruleId + ' ' + f.title + '  ' + f.fp); });
  L.push('');
  L.push('【新退役 ' + d.newlyRetired.length + ' 条】（误报记档，不算修好）');
  if (!d.newlyRetired.length) L.push('  （无）');
  d.newlyRetired.forEach(function (f) { L.push('  ~ ' + f.fp); });
  if (d.severityChanged.length) {
    L.push('');
    L.push('【严重度变化 ' + d.severityChanged.length + ' 条】');
    d.severityChanged.forEach(function (f) { L.push('  ! ' + f.fp + '：' + f.from + ' → ' + f.to); });
  }
  L.push('');
  L.push('持续存在 ' + d.kept + ' 条。');
  return L.join('\n');
}
