// dsh-healthkit 清理器（P1）
//
// 设计红线（用户 2026-11-16 拍板）：
//   ① 只碰「明确可再生」的一档：缓存、按龄淘汰的备份、审计器自己的过期索引；
//   ② 永远不直删：先移进 $DSH_HOME/dsh-healthkit/trash/<批次>/，能一键还原，7 天后才真删；
//   ③ profiles/node_modules/sessions/attachments/skills/data/凭据 一律不动，代码里用护栏硬挡；
//   ④ 「需确认」档（远程工作区镜像）默认不选中，必须显式 confirm 才动。
//
// 为什么不照抄「清出 X GB」：实测 ~/.dsh 2.2G 里大头是 node_modules 701M + dsh-runtimes 506M
// + dsh-ops 108M（都是必需品），attachments/sessions 在 30/60/90 天 TTL 下回收 0MB。
// 真正可动的只有 ~150M 量级。工具不许为了数字好看去动必需资产。
import fs from 'node:fs';
import { dataDir } from './paths.mjs';
import path from 'node:path';
import { dshHome, exists, readJson, walk, daysAgo } from './util.mjs';

const MIN_AGE_DAYS = 14;
const PURGE_AFTER_DAYS = 7;
const INDEX_STALE_HOURS = 48;

// 护栏：这些名字一律不许被搬进回收区、也不许从回收区永久删除。
//
// 2026-11-17 修（架构审计 P0-A1）：原写法是 `[\\/]name([\\/]|\$)`，
// 而 `\$` 在正则字面量里是**转义的字面美元号**，不是结尾锚点。于是
// 「路径终段就是受保护名」这种最该拦的情形全部漏过——实测
// `C:/_backup/node_modules` 直接通过，只有 `.../node_modules/xxx` 才被挡。
// 改成真锚点 `(^|[\\/])` + `([\\/]|$)`，并把名单抽出来给测试遍历。
export const PROTECTED_NAMES = [
  'node_modules', 'sessions', 'attachments', 'skills',
  'data', 'storages', 'llm-deepseek', '.git',
];
const FORBIDDEN = [
  /(^|[\\/])(node_modules|sessions|attachments|skills|data|storages|llm-deepseek|\.git)([\\/]|$)/i,
  /credentials/i,
];

export function trashDir() { return path.join(dataDir(), 'trash'); }

export function fmtBytes(n) {
  if (!n || n < 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v = v / 1024; i++; }
  return (i === 0 ? String(Math.round(v)) : v.toFixed(v >= 100 ? 0 : 1)) + ' ' + u[i];
}

function insideHome(p) {
  const home = path.resolve(dshHome());
  const r = path.resolve(p);
  return r !== home && r.indexOf(home + path.sep) === 0;
}

export function forbidden(p) {
  if (!p || typeof p !== 'string') return null;
  for (let i = 0; i < FORBIDDEN.length; i++) if (FORBIDDEN[i].test(p)) return FORBIDDEN[i].toString();
  return null;
}

function entry(p, kind) {
  let bytes = 0, files = 0;
  try {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) {
      const w = walk(p, { maxDepth: 6, skipNodeModules: false });
      bytes = w.bytes; files = w.files;
    } else {
      bytes = st.size; files = 1;
    }
  } catch (e) { /* 读不到就按 0 记 */ }
  return { path: path.resolve(p), name: path.basename(p), kind: kind || (fs.existsSync(p) && fs.statSync(p).isDirectory() ? 'dir' : 'file'), bytes, files };
}

function group(id, label, risk, reason, entries) {
  const g = { id, label, risk, reason, entries };
  g.bytes = entries.reduce((a, e) => a + e.bytes, 0);
  g.files = entries.reduce((a, e) => a + e.files, 0);
  return g;
}

// 只读：算出当前有哪些可清理对象。不动任何文件。
export function scan(opts) {
  const o = opts || {};
  const minAge = Number.isFinite(o.minAgeDays) ? o.minAgeDays : MIN_AGE_DAYS;
  const home = dshHome();
  const groups = [];

  const cacheDefs = [
    { id: 'cache-image-gen', label: '图片生成缓存', dir: path.join(home, 'cache', 'dsh-image-gen') },
    { id: 'cache-attachments', label: '附件缩略图缓存', dir: path.join(home, 'cache', 'attachments') },
  ];
  for (const c of cacheDefs) {
    if (!exists(c.dir)) continue;
    groups.push(group(c.id, c.label, 'safe', '可再生缓存：删了下次按需重建', [entry(c.dir, 'dir')]));
  }

  // _backup：只按龄淘汰，今天生成的 profile 备份绝不动
  const bak = path.join(home, '_backup');
  if (exists(bak)) {
    const aged = [];
    let dirs = [];
    try { dirs = fs.readdirSync(bak, { withFileTypes: true }); } catch (e) { dirs = []; }
    for (const d of dirs) {
      const p = path.join(bak, d.name);
      let st = null;
      try { st = fs.lstatSync(p); } catch (e) { continue; }
      const age = daysAgo(st.mtimeMs);
      if (age === null || age < minAge) continue;
      aged.push(entry(p, d.isDirectory() ? 'dir' : 'file'));
    }
    if (aged.length) groups.push(group('backup-aged', '过期配置备份（≥' + minAge + '天）', 'aged', '当年改动前的回滚快照，超过 ' + minAge + ' 天基本不会再回滚；移入回收区仍可还原', aged));
  }

  // 审计器自己的过期 bundle 索引
  const idx = path.join(dataDir(home), 'bundle-index.json');
  if (exists(idx)) {
    const st = fs.statSync(idx);
    const hours = Math.floor((Date.now() - st.mtimeMs) / 3600000);
    if (hours >= INDEX_STALE_HOURS) {
      groups.push(group('auditkit-stale-index', '审计器过期 bundle 索引', 'safe', '超过 ' + INDEX_STALE_HOURS + ' 小时自动失效，重跑会重建', [entry(idx, 'file')]));
    }
  }

  // 远程工作区镜像：注册表里仍有记录，删掉等于删用户同步副本 → 需确认
  const rw = path.join(home, 'remote-workspaces');
  if (exists(rw)) {
    let dirs = [];
    try { dirs = fs.readdirSync(rw, { withFileTypes: true }); } catch (e) { dirs = []; }
    for (const d of dirs) {
      if (!d.isDirectory() || !/^\d+\.\d+\.\d+\.\d+-/.test(d.name)) continue;
      const p = path.join(rw, d.name);
      groups.push(group('mirror:' + d.name, '远程工作区镜像 ' + d.name, 'confirm', 'machines.json 里仍有该机器；删掉是删本地同步副本，需显式确认', [entry(p, 'dir')]));
    }
  }

  const total = groups.reduce((a, g) => a + g.bytes, 0);
  const safeTotal = groups.filter((g) => g.risk !== 'confirm').reduce((a, g) => a + g.bytes, 0);
  const confirmTotal = total - safeTotal;
  return { groups, totalBytes: total, totalFiles: groups.reduce((a, g) => a + g.files, 0), safeBytes: safeTotal, confirmBytes: confirmTotal, minAgeDays: minAge };
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}

function moveEntry(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

// 执行清理：只从 scan() 的结果里挑，逐个再过护栏。默认不动 confirm 档。
export function apply(ids, opts) {
  const o = opts || {};
  const wanted = Array.isArray(ids) ? ids.filter(Boolean) : (ids ? [String(ids)] : []);
  if (!wanted.length) return { ok: false, error: '必须显式指定要清理的分组 id（先跑 preview 看清单）' };
  const s = scan(o);
  const picked = [];
  const skipped = [];
  for (const id of wanted) {
    const g = s.groups.find((x) => x.id === id);
    if (!g) { skipped.push(id + '：不存在或当前无可清理内容'); continue; }
    if (g.risk === 'confirm' && !o.confirm) { skipped.push(id + '：需确认档，要加 confirm 才动'); continue; }
    picked.push(g);
  }
  if (!picked.length) return { ok: false, error: '没有可执行的分组', skipped };

  const planned = [];
  for (const g of picked) {
    for (const e of g.entries) {
      if (!insideHome(e.path)) { skipped.push(e.path + '：不在 DSH_HOME 内'); continue; }
      const f = forbidden(e.path);
      if (f) { skipped.push(e.path + '：命中护栏 ' + f); continue; }
      if (!exists(e.path)) { skipped.push(e.path + '：已不存在'); continue; }
      planned.push({ group: g.id, path: e.path, kind: e.kind, bytes: e.bytes, files: e.files });
    }
  }
  if (!planned.length) return { ok: false, error: '全部被护栏挡下', skipped };

  const freedBytes = planned.reduce((a, x) => a + x.bytes, 0);
  if (o.dryRun) return { ok: true, dryRun: true, batch: null, freedBytes, items: planned, skipped };

  const batch = stamp();
  const dir = path.join(trashDir(), batch);
  const items = [];
  let n = 0;
  for (const it of planned) {
    n++;
    const to = path.join(dir, 'items', String(n).padStart(3, '0') + '-' + path.basename(it.path));
    try {
      moveEntry(it.path, to);
      items.push({ from: it.path, to, bytes: it.bytes, files: it.files, group: it.group, kind: it.kind });
    } catch (e) {
      skipped.push(it.path + '：移动失败 ' + (e && e.message ? e.message : String(e)));
    }
  }
  const manifest = {
    batch,
    createdAt: new Date().toISOString(),
    restoreBefore: new Date(Date.now() + PURGE_AFTER_DAYS * 86400000).toISOString(),
    home: dshHome(),
    totals: { bytes: items.reduce((a, x) => a + x.bytes, 0), files: items.reduce((a, x) => a + x.files, 0), entries: items.length },
    items,
    skipped,
  };
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  } catch (e) {
    return { ok: false, error: '腾挪已完成但清单写入失败：' + (e && e.message ? e.message : String(e)), items };
  }
  return { ok: true, dryRun: false, batch, freedBytes: manifest.totals.bytes, items, skipped, restoreBefore: manifest.restoreBefore };
}

export function listBatches() {
  const root = trashDir();
  const out = [];
  if (!exists(root)) return out;
  let dirs = [];
  try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return out; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const m = readJson(path.join(root, d.name, 'manifest.json'), null);
    if (!m) continue;
    out.push({ batch: m.batch || d.name, createdAt: m.createdAt, ageDays: daysAgo(new Date(m.createdAt).getTime()), bytes: (m.totals && m.totals.bytes) || 0, files: (m.totals && m.totals.files) || 0, entries: (m.totals && m.totals.entries) || 0, restoreBefore: m.restoreBefore });
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return out;
}

export function restore(batch) {
  if (!batch) return { ok: false, error: '要还原哪个批次？先跑 list' };
  const dir = path.join(trashDir(), String(batch));
  const m = readJson(path.join(dir, 'manifest.json'), null);
  if (!m) return { ok: false, error: '批次不存在或清单损坏：' + batch };
  const restored = [];
  const conflicts = [];
  const keep = [];
  for (const it of m.items) {
    if (!exists(it.to)) { keep.push(it); continue; }
    if (exists(it.from)) { conflicts.push(it.from + '：原位置已有同名，跳过'); keep.push(it); continue; }
    try {
      moveEntry(it.to, it.from);
      restored.push(it.from);
    } catch (e) {
      conflicts.push(it.from + '：还原失败 ' + (e && e.message ? e.message : String(e)));
      keep.push(it);
    }
  }
  m.items = keep;
  m.totals = { bytes: keep.reduce((a, x) => a + x.bytes, 0), files: keep.reduce((a, x) => a + x.files, 0), entries: keep.length };
  m.lastRestore = { at: new Date().toISOString(), restored: restored.length };
  try {
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(m, null, 2) + '\n', 'utf8');
    if (!keep.length) fs.rmSync(dir, { recursive: true, force: true });
  } catch (e) { /* 清单回写失败不影响已还原的文件 */ }
  return { ok: true, batch: m.batch || String(batch), restored, conflicts };
}

export function purge(opts) {
  const o = opts || {};
  const olderThan = Number.isFinite(o.olderThanDays) ? o.olderThanDays : PURGE_AFTER_DAYS;
  const victims = listBatches().filter((b) => b.ageDays !== null && b.ageDays >= olderThan);
  // 二次校验：purge 是唯一不可逆的一步。清单里只要有一项原始路径命中护栏，
  // 整个批次拒绝删除（护栏漏过的历史批次就靠这一层兜住），并如实报出来。
  const candidates = [];
  const refused = [];
  for (const v of victims) {
    const m = readJson(path.join(trashDir(), v.batch, 'manifest.json'), null);
    const items = m && Array.isArray(m.items) ? m.items : [];
    let hit = null;
    for (const it of items) {
      const g = forbidden(it && it.from);
      if (g) { hit = { path: it.from, guard: g }; break; }
    }
    if (hit) refused.push({ batch: v.batch, path: hit.path, guard: hit.guard });
    else candidates.push(v);
  }
  if (o.dryRun) return { ok: true, dryRun: true, purged: [], candidates: candidates.map((v) => v.batch), refused, bytes: candidates.reduce((a, v) => a + v.bytes, 0) };
  const purged = [];
  for (const v of candidates) {
    try { fs.rmSync(path.join(trashDir(), v.batch), { recursive: true, force: true }); purged.push(v.batch); } catch (e) { /* 下次再试 */ }
  }
  return { ok: true, dryRun: false, purged, refused, bytes: candidates.reduce((a, v) => a + v.bytes, 0) };
}

export function renderScan(s) {
  const lines = [];
  lines.push('可清理 ' + fmtBytes(s.totalBytes) + '（安全档 ' + fmtBytes(s.safeBytes) + ' · 需确认 ' + fmtBytes(s.confirmBytes) + '）');
  for (const g of s.groups) {
    const tag = g.risk === 'confirm' ? '[需确认]' : (g.risk === 'aged' ? '[按龄]' : '[安全]');
    lines.push('- ' + tag + ' ' + g.id + ' · ' + g.label + ' · ' + fmtBytes(g.bytes) + ' / ' + g.files + ' 文件');
    lines.push('    ' + g.reason);
  }
  if (!s.groups.length) lines.push('（没有可清理对象）');
  return lines.join('\n');
}
