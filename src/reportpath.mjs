// 报告落点解析：把「缺省写到会话工作区」从口头承诺变成一条可测的规则。
//
// 背景（2026-11-16 实测，issue #1）：0.4.0 的缺省是 path.join(process.cwd(), 'AUDIT-<日期>.md')。
// 宿主是 Electron 应用，其进程 cwd 是 profile 目录，于是报告被静默写进
// C:\Users\<user>\.dsh\profiles\desktop\ —— 与工具描述「缺省写当前工作区」不符。
// 结论：process.cwd() 在宿主进程里不可作为「工作区」的代理，本模块不再使用它。
//
// 解析顺序（第一个命中的生效）：
//   1. out（显式参数）——绝对路径照用；相对路径以会话工作区为基准
//   2. config.reportDir —— 同上（绝对照用；相对以会话工作区为基准）
//   3. 会话工作区 —— <workspace>/AUDIT-<日期>.md
//   4. 兜底 —— $DSH_HOME/dsh-auditkit/reports/AUDIT-<日期>.md（本插件自己的数据目录）
// 取不到工作区又给了相对路径时返回 error，由调用方显式报错——不猜、不静默落盘。
import path from 'node:path';
import os from 'node:os';

export function dshHome(env) {
  const e = env || process.env;
  if (e && typeof e.DSH_HOME === 'string' && e.DSH_HOME) return e.DSH_HOME;
  return path.join(os.homedir(), '.dsh');
}

export function localDate(now) {
  const d = now || new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function reportFileName(now) {
  return 'AUDIT-' + localDate(now) + '.md';
}

const trimmed = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');

export function resolveReportPath(opts) {
  const o = opts || {};
  const home = trimmed(o.home) || dshHome();
  const ws = trimmed(o.workspace) || '';
  const name = reportFileName(o.now);
  const out = trimmed(o.out);
  const cfg = trimmed(o.reportDir);

  if (out) {
    if (path.isAbsolute(out)) return { path: out, source: 'out' };
    if (!ws) return { error: 'out 是相对路径，但当前会话取不到工作目录；请改绝对路径', source: 'out' };
    return { path: path.resolve(ws, out), source: 'out' };
  }
  if (cfg) {
    if (path.isAbsolute(cfg)) return { path: path.join(cfg, name), source: 'config.reportDir' };
    if (!ws) return { error: 'config.reportDir 是相对路径，但当前会话取不到工作目录；请改绝对路径', source: 'config.reportDir' };
    return { path: path.join(path.resolve(ws, cfg), name), source: 'config.reportDir' };
  }
  if (ws) return { path: path.join(ws, name), source: 'workspace' };
  return { path: path.join(home, 'dsh-auditkit', 'reports', name), source: 'fallback' };
}
