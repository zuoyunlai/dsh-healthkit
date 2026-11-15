// dsh-auditkit 宿主半边（最小壳）
// 契约依据（实测自 dsh-pet 的 cordis.patch.yml + package.json）：
//   bundle 包用 `- insert: [{id, name}]` 把条目插进配置树；入口 = package.json 的 main。
// 工具注册面【未验证】：先探测可用面并记档，注册失败只降级不崩——
//   不猜 contract 形状，避免 apply() 抛错导致整个插件静默消失。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const name = 'dsh-auditkit';

function homeDir() { return process.env.DSH_HOME || path.join(os.homedir(), '.dsh'); }
function statusPath() { return path.join(homeDir(), 'dsh-auditkit', 'plugin-status.json'); }

function writeStatus(patch) {
  try {
    const p = statusPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { prev = {}; }
    fs.writeFileSync(p, JSON.stringify(Object.assign(prev, patch), null, 2) + '\n', 'utf8');
    return true;
  } catch (e) { return false; }
}

const TOOLS = [
  {
    name: 'audit_run',
    description: '对当前 DSH 安装跑一次只读体检，返回总分与问题计数（不修改任何配置）',
    parameters: { type: 'object', properties: { scenario: { type: 'string', description: 'general|code|design|writing' }, probeAll: { type: 'boolean', description: '是否枚举 bundle 贡献（约 60s）' } }, required: [] },
    execute: async (args) => {
      const { audit } = await import('./src/engine.mjs');
      const r = audit({ scenario: (args && args.scenario) || 'general' });
      const by = {};
      r.findings.forEach((f) => { by[f.severity] = (by[f.severity] || 0) + 1; });
      return { score: r.score.total, raw: r.score.raw, band: r.score.band, p0: r.score.p0Open, counts: by, retired: r.retired.length, findings: r.findings.length };
    },
  },
  {
    name: 'audit_report',
    description: '返回上一次体检的结论摘要与报告路径（报告默认写在工作区的 AUDIT-<日期>.md）',
    parameters: { type: 'object', properties: { out: { type: 'string', description: '报告输出路径，缺省写工作区' } }, required: [] },
    execute: async (args) => {
      const fs2 = await import('node:fs');
      const { audit } = await import('./src/engine.mjs');
      const r = audit({ scenario: 'general' });
      const out = (args && args.out) || path.join(process.cwd(), 'AUDIT-' + new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) + '.md');
      fs2.writeFileSync(out, r.report, 'utf8');
      return { report: out, score: r.score.total, findings: r.findings.length };
    },
  },
];

export function apply(ctx, config) {
  const surfaces = [];
  let tools = null;
  try { if (ctx && typeof ctx.get === 'function') tools = ctx.get('tools'); } catch (e) { /* 可选服务 */ }
  if (!tools && ctx && ctx.tools) tools = ctx.tools;   // 仅探测，不做裸访问假设
  if (tools) {
    ['register', 'add', 'define', 'tool'].forEach((k) => { if (typeof tools[k] === 'function') surfaces.push('tools.' + k); });
    if (typeof tools === 'function') surfaces.push('tools()');
  }
  const registered = [];
  const failures = [];
  if (tools && typeof tools.register === 'function') {
    for (const t of TOOLS) {
      try { tools.register(t); registered.push(t.name); }
      catch (e) { failures.push(t.name + ': ' + (e && e.message ? e.message : String(e))); }
    }
  }
  writeStatus({
    version: '0.1.0',
    loadedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    detectedSurfaces: surfaces,
    registered,
    failures,
    configKeys: config && typeof config === 'object' ? Object.keys(config) : [],
  });
}
