// dsh-healthkit 分数账本（P3）
//
// 为什么单独一层：engine.audit() 保持纯函数（只读、可重复），
// 记账放在调用层（CLI / 工具壳）。这样「只读体检」的承诺不被污染，
// 审计器自己的账本出问题也不影响体检结论。
//
// 文件：$DSH_HOME/dsh-healthkit/history.jsonl（append-only，一行一次体检）
// 读取时按本地日期折叠成每日一次（取当天最后一次），这样一天跑十次也不会把趋势画歪。
import fs from 'node:fs';
import path from 'node:path';
import { dshHome, readJson } from './util.mjs';
import { dataDir } from './paths.mjs';

const MAX_RECORDS = 2000;
// 每 N 次记账才做一次「是否越界」检查（见 C5 注释）。
const TRIM_EVERY = 20;
let appendsSinceTrim = 0;
const BARS = '▁▂▃▄▅▆▇█';

export function historyPath() { return path.join(dataDir(), 'history.jsonl'); }

function localDay(ms) {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 10);
}

function counts(findings) {
  const by = { P0: 0, P1: 0, P2: 0 };
  for (const f of findings || []) if (by[f.severity] !== undefined) by[f.severity]++;
  return by;
}

function topKeys(findings) {
  return (findings || [])
    .filter((f) => f.severity === 'P0' || f.severity === 'P1')
    .slice(0, 12)
    .map((f) => f.fp || f.ruleId);
}

// 记一笔。result 是 engine.audit() 的返回值。
export function append(result, opts) {
  const o = opts || {};
  const at = Date.now();
  const by = counts(result.findings);
  const rec = {
    at: new Date(at).toISOString(),
    day: localDay(at),
    scenario: o.scenario || (result.score && result.score.scenario) || 'general',
    total: result.score ? result.score.total : null,
    raw: result.score ? result.score.raw : null,
    band: result.score ? result.score.band : null,
    p0: by.P0, p1: by.P1, p2: by.P2,
    findings: (result.findings || []).length,
    retired: (result.retired || []).length,
    topKeys: topKeys(result.findings).slice(0, 6),
  };
  try {
    const p = historyPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(rec) + '\n', 'utf8');
    // C5：trim() 要整文件读回，2000 条时每次记账都多一次全文 IO。
    // 改成每 20 次记账才检查一次（越界后冗余 ≤19 行，可忽略）。
    if (++appendsSinceTrim >= TRIM_EVERY) { appendsSinceTrim = 0; trim(); }
  } catch (e) { /* 记账失败不该让体检失败 */ }
  return rec;
}

function trim() {
  try {
    const p = historyPath();
    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    if (lines.length <= MAX_RECORDS) return 0;
    const keep = lines.slice(lines.length - MAX_RECORDS);
    fs.writeFileSync(p, keep.join('\n') + '\n', 'utf8');
    return lines.length - keep.length;
  } catch (e) { return 0; }
}

export function load() {
  const out = [];
  try {
    const txt = fs.readFileSync(historyPath(), 'utf8');
    for (const line of txt.split('\n')) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch (e) { /* 坏行跳过 */ }
    }
  } catch (e) { /* 没有账本 */ }
  return out;
}

// 按本地日期折叠：同一天只保留最后一次
export function daily(records) {
  const map = new Map();
  for (const r of records) {
    const k = r.day || localDay(new Date(r.at).getTime());
    const prev = map.get(k);
    if (!prev || String(r.at) >= String(prev.at)) map.set(k, r);
  }
  return [...map.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));
}

export function sparkline(values) {
  if (!values.length) return '';
  return values.map((v) => {
    const i = Math.max(0, Math.min(BARS.length - 1, Math.round((Number(v) / 10) * (BARS.length - 1))));
    return BARS[i];
  }).join('');
}

export function stats(opts) {
  const o = opts || {};
  const days = Number.isFinite(o.days) ? o.days : 30;
  const all = load();
  const series = daily(all).filter((r) => typeof r.total === 'number');
  const cutoff = Date.now() - days * 86400000;
  const win = series.filter((r) => new Date(r.day + 'T00:00:00').getTime() >= cutoff);
  const latest = win.length ? win[win.length - 1] : null;
  const previous = win.length > 1 ? win[win.length - 2] : null;
  const vals = win.map((r) => r.total);
  const tail7 = vals.slice(-7);
  const avg = (a) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null);
  const openP0 = latest ? latest.p0 : null;
  return {
    days,
    runs: all.length,
    daysTracked: win.length,
    latest: latest ? latest.total : null,
    latestDay: latest ? latest.day : null,
    previous: previous ? previous.total : null,
    delta: latest && previous ? Math.round((latest.total - previous.total) * 100) / 100 : null,
    avg7: avg(tail7),
    avgAll: avg(vals),
    best: vals.length ? Math.max(...vals) : null,
    worst: vals.length ? Math.min(...vals) : null,
    p0: openP0,
    sparkline: sparkline(vals.slice(-30)),
    series: win.map((r) => ({ day: r.day, total: r.total, p0: r.p0, p1: r.p1, p2: r.p2 })),
  };
}

export function renderStats(s) {
  if (!s.daysTracked) {
    return '还没有历史（账本：' + historyPath() + '）\n跑一次体检就开始记；只读，不改任何配置。';
  }
  const lines = [];
  const arrow = s.delta === null ? '' : (s.delta > 0 ? '（+' + s.delta + '）' : s.delta < 0 ? '（' + s.delta + '）' : '（持平）');
  lines.push('近 ' + s.days + ' 天 ' + s.daysTracked + ' 次体检 · 最新 ' + s.latest + '/10' + arrow + ' · ' + s.latestDay);
  if (s.sparkline) lines.push(s.sparkline);
  lines.push('均值 ' + (s.avg7 === null ? '-' : s.avg7) + '（近 7 次） · 历史 ' + (s.avgAll === null ? '-' : s.avgAll) + ' · 最好 ' + s.best + ' · 最差 ' + s.worst + ' · P0 未关 ' + s.p0);
  lines.push('账本 ' + historyPath() + '（' + s.runs + ' 条记录，每日折叠）');
  return lines.join('\n');
}
