// 首次价值信号（产品审计 §5 的指标 1）。
//
// 「首次运行是否产出了用户事前不知道的结论」是判断「值不值得装」的唯一真指标，
// 而它只能由用户自己回答——这个插件不联网、不遥测、不上传会话，所以答案只记在本机
// （$DSH_HOME/dsh-healthkit/feedback.jsonl），一行一条，永不外发。
//
// 记账口径：
//   · 同一条发现（fp）只保留最后一次回答（用户看了修法可能改主意）；
//   · firstValueRate = 「原先不知道」的占比 —— 低于 30% 说明这插件在给用户讲他早就会的事。
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.mjs';

export function feedbackPath(home) {
  return path.join(dataDir(home), 'feedback.jsonl');
}

export function append(home, rec) {
  const p = feedbackPath(home);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(rec) + '\n', 'utf8');
  return rec;
}

export function load(home) {
  const p = feedbackPath(home);
  let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch (e) { return []; }
  const out = [];
  for (const line of txt.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* 坏行跳过 */ }
  }
  return out;
}

export function stats(home) {
  const rows = load(home);
  const byFp = new Map();
  for (const r of rows) {
    if (!r || !r.fp) continue;
    const prev = byFp.get(r.fp);
    if (!prev || String(r.at || '') >= String(prev.at || '')) byFp.set(r.fp, r);
  }
  const uniq = [...byFp.values()];
  const known = uniq.filter((r) => r.known === true).length;
  const unknown = uniq.filter((r) => r.known === false).length;
  const answered = known + unknown;
  return {
    answered,
    known,
    unknown,
    firstValueRate: answered ? Math.round((unknown / answered) * 1000) / 10 : null,
    lastAt: uniq.length ? uniq.map((r) => r.at).sort().slice(-1)[0] : null,
  };
}

export function renderStats(s) {
  if (!s || !s.answered) {
    return '还没有任何反馈。跑完体检后对某条发现回一句「这条我原先知道 / 不知道」，'
      + '就能算出这个插件的首次价值率（它只记在本机，不外发）。';
  }
  return '首次价值信号：已回答 ' + s.answered + ' 条，其中 ' + s.unknown + ' 条是你原先不知道的（'
    + s.firstValueRate + '%）。'
    + (s.firstValueRate < 30 ? '偏低——说明它多在你已经知道的事上说话。' : '');
}
