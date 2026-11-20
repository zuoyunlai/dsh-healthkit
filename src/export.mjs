// 脱敏求助材料（2026-11-20 反哺 P6）。
//
// 用户在群里/issue 里贴体检结果时，最常缺的是版本、profile、错误行；最常多贴的是
// 带着用户名和 token 的路径。本模块只做两件事：**脱敏**、**拼一份能直接贴的材料**。
// 不写盘、不上传、不打包整份配置——默认只返回文本，落盘由调用方显式决定。
import os from 'node:os';
import path from 'node:path';

export const EXPORT_SCHEMA = 'dsh-healthkit/export-bundle/v1';

const KEY_PATTERNS = [
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[REDACTED:key]'],
  [/\bghp_[A-Za-z0-9]{10,}\b/g, '[REDACTED:key]'],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}\b/g, '[REDACTED:key]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{6,}\b/g, '[REDACTED:key]'],
  [/\bAKIA[0-9A-Z]{12,}\b/g, '[REDACTED:key]'],
  [/Bearer\s+[A-Za-z0-9._-]{8,}/gi, 'Bearer [REDACTED]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED:email]'],
];

function escRe(s) { return String(s).replace(/[.*+?^$()|[\]{}\\]/g, '\\$&'); }

export function redact(text, opts) {
  const o = opts || {};
  const counts = { home: 0, user: 0, key: 0, email: 0 };
  let s = String(text == null ? '' : text);
  const home = o.home || '';
  let userHome = o.userHome;
  if (userHome === undefined) { try { userHome = os.homedir(); } catch (e) { userHome = ''; } }
  if (home && s.indexOf(home) !== -1) { counts.home = s.split(home).length - 1; s = s.split(home).join('~/.dsh'); }
  if (userHome && s.indexOf(userHome) !== -1) { counts.user = s.split(userHome).length - 1; s = s.split(userHome).join('~'); }
  // 顺序有讲究：先密钥/邮箱，再用户名。反之「bob@example.com」会先被改成
  // 「[REDACTED:user]@example.com」，邮箱规则就再也匹配不上了（计数会漏）。
  for (const pair of KEY_PATTERNS) {
    const kind = pair[1].indexOf('email') !== -1 ? 'email' : 'key';
    const before = s;
    s = s.replace(pair[0], pair[1]);
    if (s !== before) counts[kind] += 1;
  }
  const uname = userHome ? path.basename(userHome) : '';
  if (uname && uname.length >= 2) {
    const re = new RegExp('(^|[^A-Za-z0-9_-])' + escRe(uname) + '([^A-Za-z0-9_-]|$)', 'g');
    const before = s;
    s = s.replace(re, function (m, a, b) { return a + '[REDACTED:user]' + b; });
    if (s !== before) counts.user += 1;
  }
  return { text: s, counts: counts };
}

export function buildBundle(result, opts) {
  const o = opts || {};
  const r = result || {};
  const facts = r.facts || {};
  const sc = r.score || {};
  const fs0 = r.firstScreen || {};
  const lines = [];
  lines.push('# DSH 体检求助材料');
  lines.push('');
  lines.push('- 引擎：dsh-healthkit ' + ((r.self && r.self.version) || o.version || '?') + ' · rubric ' + (sc.rubricVersion || r.rubricVersion || '?'));
  lines.push('- 采集时间：' + String(facts.collectedAt || '?').replace('T', ' ').slice(0, 19) + (facts.cacheHit ? '（缓存）' : '（现采）'));
  lines.push('- 平台：' + process.platform + ' / node ' + process.version);
  lines.push('- 分数：' + (typeof sc.total === 'number' ? sc.total : '?') + ' / 10（' + (sc.band || '-') + '）· P0 ' + (sc.p0Open || 0));
  lines.push('');
  if (fs0.text) { lines.push('## 结论'); lines.push(''); lines.push(fs0.text); lines.push(''); }
  const faults = ((r.attribution || {}).rowsFault) || [];
  const others = (r.findings || []).filter(function (f) { return f.advisory !== true && f.severity !== 'INFO'; });
  const picked = others.filter(function (f) { return faults.some(function (x) { return x.ruleId === f.ruleId; }); }).slice(0, 8);
  const rest = others.filter(function (f) { return picked.indexOf(f) === -1; }).slice(0, 8);
  if (picked.length) {
    lines.push('## 故障处置（影响加载/启动）');
    lines.push('');
    picked.forEach(function (f) {
      lines.push('- [' + f.severity + '] ' + f.ruleId + ' · ' + f.title);
      if (f.fixHint) lines.push('  - 修法：' + String(f.fixHint).replace(/\s+/g, ' ').slice(0, 300));
      if (f.evidence && f.evidence.length) lines.push('  - 证据：' + f.evidence.slice(0, 3).join(' / '));
    });
    lines.push('');
  }
  if (rest.length) {
    lines.push('## 其他计分项（可保留现状）');
    lines.push('');
    rest.forEach(function (f) { lines.push('- [' + f.severity + '] ' + f.ruleId + ' · ' + f.title); });
    lines.push('');
  }
  const broken = facts.profileErrors || [];
  const degraded = r.degradations || [];
  if (broken.length || degraded.length) {
    lines.push('## 覆盖缺口（这些地方没法下结论）');
    lines.push('');
    broken.forEach(function (p) { lines.push('- profile「' + p.name + '」未被体检：' + (p.reason === 'parse-error' ? 'package.json 解析失败' : '有 node_modules 但没有 package.json')); });
    degraded.forEach(function (d) { lines.push('- ' + (d.code || 'degraded') + '：' + (d.detail || '') + (d.count > 1 ? ' ×' + d.count : '')); });
    lines.push('');
  }
  lines.push('## 复现');
  lines.push('');
  lines.push('    dsh-healthkit --scenario general');
  lines.push('    dsh-healthkit --plan');
  lines.push('    dsh-healthkit --boot');
  lines.push('');
  lines.push('> 已脱敏：本机路径、用户名、密钥与邮箱。未包含完整配置内容，也未上传任何东西。');
  lines.push('');
  const red = redact(lines.join('\n'), { home: facts.home, userHome: o.userHome });
  return { schema: EXPORT_SCHEMA, at: new Date().toISOString(), bytes: Buffer.byteLength(red.text, 'utf8'), redactions: red.counts, markdown: red.text };
}
