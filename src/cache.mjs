// 事实缓存：一次 collect 实测约 1.0–1.5s（2101 次 readdir + 10315 次 stat + 232 次读文件），
// 而 21 个工具几乎每个都各自 audit() 一遍，面板还每分钟重算一次。
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
// 2026-11-20：报告要说清「这份结论是现采的还是缓存的」，否则用户会以为刚改的配置已生效。
let lastWasCached = false;

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
  for (const n of ['cordis.yml', 'cordis.patch.yml', 'cordis.patch.yaml', 'profiles', 'data', 'cache', '_backup', 'remote-workspaces']) {
    parts.push(n + '=' + stamp(path.join(h, n)));
  }
  // 2026-11-17 审查 P1-3：不要 stamp 整个 logs/（新建任何日志文件都会改目录 mtime，
  // 缓存因此几乎次次失效）。collect 只读这一个文件，就只 stamp 它。
  //
  // 2026-11-20 审计 P2：路径写错过——collect 读的是 $DSH_HOME/unlag-reload.log（顶层），
  // 这里戳的是 logs/unlag-reload.log，日志变化永远不触发重采。
  parts.push('log:unlag-reload.log=' + stamp(path.join(h, 'unlag-reload.log')));
  // 同一批审计：以下都是 collect 真实读取、但旧指纹没覆盖的源。
  parts.push('machines=' + stamp(path.join(h, 'remote-workspaces', 'machines.json')));
  parts.push('presets=' + stamp(path.join(h, '.agent-presets')));
  parts.push('ws=' + stamp(path.join(h, 'storages', 'workspace.json')));
  try {
    for (const f of fs.readdirSync(h).filter((x) => /^[.]credentials/.test(x)).sort()) {
      parts.push('cred:' + f + '=' + stamp(path.join(h, f)));
    }
  } catch (e) { /* 没有就是没有 */ }
  let profs = [];
  try {
    profs = fs.readdirSync(path.join(h, 'profiles'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) { profs = []; }
  for (const p of profs) {
    parts.push('p:' + p + '=' + stamp(path.join(h, 'profiles', p, 'package.json')));
    // 注释承诺过 profile 内的 cordis*.yml 也在指纹里，旧实现漏了它们：
    // 只改已有 patch 文件时，60s 内会命中旧 facts（改完重跑看到旧结论）。
    for (const f of ['cordis.patch.yml', 'cordis.patch.yaml', 'cordis.yml', 'pnpm-workspace.yaml', path.join('.dsh-market', 'state.json')]) {
      parts.push('p:' + p + '/' + f + '=' + stamp(path.join(h, 'profiles', p, f)));
    }
  }
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
  // 2026-11-20 审计 P2：键里必须带「会改变 facts 形状」的 opts。
  // 否则 CLI --probe-all 缓存的带 bundleIndex 的 facts，会被宿主工具当成默认结果复用（反之亦然）。
  const key = home + '|' + (o.bundleIndex ? 'bi' : '-') + '|' + (Array.isArray(o.engineAssetMarkers) ? 'm' : '-');
  const hit = store.get(key);
  if (hit && now - hit.at < TTL_MS && hit.fp === fingerprint(home)) { lastWasCached = true; return hit.facts; }
  lastWasCached = false;
  const facts = collect(o);
  store.set(key, { at: now, fp: fingerprint(home), facts, home });
  if (store.size > 4) store.delete(store.keys().next().value);
  return facts;
}

export function wasCached() { return lastWasCached; }

export function clearFactsCache(home) {
  if (home) store.delete(home);
  else store.clear();
}

export function factsCacheInfo() {
  const out = [];
  // 键是 home|bi|- 这种复合串，对外仍报真实 home（自检/调试用）。
  for (const [key, v] of store) out.push({ home: v.home || String(key).split('|')[0], key, ageMs: Date.now() - v.at, fresh: Date.now() - v.at < TTL_MS });
  return out;
}
