// 事实缓存：一次 collect 实测约 1.0–1.5s（2101 次 readdir + 10315 次 stat + 232 次读文件），
// 而 14 个工具里有 13 个各自 audit() 一遍，面板还每分钟重算一次。
//
// 只缓存**采集结果**（facts），不缓存结论：评分、退役、快照、归因仍然每次现算，
// 因为它们读的是 $DSH_HOME 下会变的小文件（retirements.json / history.jsonl / runs/）。
//
// 失效判定不用定时器，用「指纹」：DSH_HOME 顶层的 profile 目录、每个 profile 的
// package.json、cordis*.yml、data/cache/_backup 的 mtime+size 拼成一条串。
// 改配置文件 → 指纹变 → 下一次自动重采，所以「改完立刻重跑」不会看到旧数据；
// 指纹没覆盖到的极端情形用 opts.fresh（或环境变量 DSH_HEALTHKIT_NO_CACHE=1）兜底。
import fs from 'node:fs';
import path from 'node:path';
import { collect } from './collect.mjs';
import { dshHome } from './util.mjs';

export const TTL_MS = 60 * 1000;

const store = new Map(); // home -> { at, fp, facts }

function stamp(p) {
  try {
    const st = fs.statSync(p);
    return st.mtimeMs + ':' + st.size;
  } catch (e) {
    return '-';
  }
}

export function fingerprint(home) {
  const h = home || dshHome();
  const parts = [];
  for (const n of ['cordis.yml', 'cordis.patch.yml', 'cordis.patch.yaml', 'profiles', 'data', 'cache', '_backup', 'remote-workspaces', 'logs']) {
    parts.push(n + '=' + stamp(path.join(h, n)));
  }
  let profs = [];
  try {
    profs = fs.readdirSync(path.join(h, 'profiles'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) { profs = []; }
  for (const p of profs) parts.push('p:' + p + '=' + stamp(path.join(h, 'profiles', p, 'package.json')));
  return parts.join('|');
}

function disabled() {
  const v = process.env.DSH_HEALTHKIT_NO_CACHE;
  return v === '1' || v === 'true';
}

export function cachedCollect(opts) {
  const o = opts || {};
  const home = dshHome();
  if (o.fresh === true || disabled()) return collect(o);
  const now = Date.now();
  const hit = store.get(home);
  if (hit && now - hit.at < TTL_MS && hit.fp === fingerprint(home)) return hit.facts;
  const facts = collect(o);
  store.set(home, { at: now, fp: fingerprint(home), facts });
  if (store.size > 4) store.delete(store.keys().next().value);
  return facts;
}

export function clearFactsCache(home) {
  if (home) store.delete(home);
  else store.clear();
}

export function factsCacheInfo() {
  const out = [];
  for (const [home, v] of store) out.push({ home, ageMs: Date.now() - v.at, fresh: Date.now() - v.at < TTL_MS });
  return out;
}
