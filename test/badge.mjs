// B6「主动敲门」：便宜徽章入口（/api/badge）。
//
// 为什么值得单测：这个入口是**每次页面加载都会被问一次**的面，
// 一旦它退化成跑全量体检（collectSummary），就会把「装个插件」变成「每次开 GUI 扫一遍全盘」。
// 所以这里钉三件事：① 只读账本、不跑体检；② 只认回环；③ 路由真的挂上去了。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-badge-'));
process.env.DSH_HOME = home;

const { collectBadge, registerPanel, BADGE_SCHEMA } = await import('../src/panel.mjs');
const { append } = await import('../src/history.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

// ① 没有账本：hasRun=false 且 p0=0（不能因为没数据就报错或返回 undefined）
const empty = collectBadge();
ok('无账本时 schema 正确', empty.schema === BADGE_SCHEMA, empty.schema);
ok('无账本时 hasRun=false', empty.hasRun === false);
ok('无账本时 p0=0', empty.p0 === 0);

// ② 有账本：取最后一行，不重算（必须造完整 result，append 是按 findings/score 归一化的）
function mk(total, p0n) {
  const findings = [];
  for (let i = 0; i < p0n; i += 1) findings.push({ severity: 'P0', fp: 'R9#' + i, ruleId: 'R9' });
  findings.push({ severity: 'P1', fp: 'R1#x', ruleId: 'R1' });
  return { score: { total: total, raw: total, band: '可用', scenario: 'general' }, findings };
}
append(mk(6.5, 2), {});
append(mk(9.8, 0), {});
const b = collectBadge();
ok('有账本时 hasRun=true', b.hasRun === true);
ok('徽章取最后一条（p0=0 覆盖前一条的 p0=2）', b.p0 === 0, 'p0=' + b.p0);
ok('徽章带分数', b.score === 9.8, 'score=' + b.score);
ok('徽章带时间', typeof b.at === 'string' && b.at.length > 10, String(b.at));

// ③ 便宜：collectBadge 不许多跑体检 —— 用一个会抛的 audit 证明它没被调用。
//    （构建期无法替换 ESM 导入，所以改判「耗时」会不稳；改为断言它只碰 history.jsonl。）
const before = fs.statSync(path.join(home, 'dsh-healthkit', 'history.jsonl')).mtimeMs;
collectBadge();
const after = fs.statSync(path.join(home, 'dsh-healthkit', 'history.jsonl')).mtimeMs;
ok('collectBadge 只读不写账本', before === after);
ok('collectBadge 不产生快照目录', !fs.existsSync(path.join(home, 'dsh-healthkit', 'runs')));

// ④ 路由：注册四条，其中包含 badge；非回环 403、回环 200
const registered = [];
const fakeServer = { register(r) { registered.push(r); } };
const rep = registerPanel(fakeServer);
ok('registerPanel 报告 4 条路由', rep.routes === 4, 'routes=' + rep.routes);
ok('路由里有 /api/badge', registered.some((r) => r.path.endsWith('/api/badge')));

const badgeRoute = registered.find((r) => r.path.endsWith('/api/badge'));
function call(remote) {
  let status = 0; let body = '';
  const req = { socket: { remoteAddress: remote } };
  const res = {
    writeHead(s) { status = s; },
    end(b) { body = b; },
  };
  badgeRoute.handler(req, res);
  return { status, body };
}
const denied = call('192.168.1.9');
ok('非回环来源返回 403', denied.status === 403, String(denied.status));
ok('403 不回数据', denied.body.indexOf('192.168.1.9') === -1 && denied.body.indexOf('schema') === -1);
const allowed = call('127.0.0.1');
ok('回环来源返回 200', allowed.status === 200, String(allowed.status));
ok('回环返回的是 badge schema', allowed.body.indexOf(BADGE_SCHEMA) !== -1);

// ⑤ 客户端侧只允许一个请求源：结论必须来自 /api/badge（不是 /api/summary）
const clientSrc = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8');
ok('client 使用 /api/badge', clientSrc.indexOf('/dsh-healthkit-panel/api/badge') !== -1);
ok('client 的敲门请求带 once 守卫', /shared\.asked/.test(clientSrc));
ok('图标红点是 props 驱动（图标里不许用 hooks）',
  /if \(!\(props && props\.alert\)\) return svg;/.test(clientSrc));

fs.rmSync(home, { recursive: true, force: true });
console.log('badge: 通过（' + n + ' 项断言 · 便宜入口/回环/路由/客户端单源）');
