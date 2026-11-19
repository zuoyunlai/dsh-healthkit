// 采集降级通道（P2-4）。
//
// 审计指出的病：16 处空 catch —— 单看每处都合理，合起来会把「采集失败」显示成「一切正常」。
// 这个模块给降级留一条出口：记 code + 次数 + 一句人话，取一次就清空（不许重复出现）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'healthkit-degrade-'));
process.env.DSH_HOME = home;

const { createSink, note, drain, resetSink, renderDegradations, DEGRADE_SCHEMA } = await import('../src/degrade.mjs');
const history = await import('../src/history.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

// ① sink 语义：同 code 合并计数，不同 code 各一条
resetSink();
const s = createSink();
s.add('a', 'x');
s.add('a', 'x', 2);
s.add('b', 'y');
ok('同 code 合并计数', s.list().find((x) => x.code === 'a').count === 3, JSON.stringify(s.list()));
ok('不同 code 各自一条', s.list().length === 2);
ok('detail 被截断到 200', s.add('c', 'z'.repeat(500)).detail.length <= 200);
ok('schema 串存在', typeof DEGRADE_SCHEMA === 'string' && DEGRADE_SCHEMA.indexOf('degradations') !== -1);

// ② 渲染：空数组什么都不显示（正常路径零噪声），非空必须说清「判不了」
ok('空降级不渲染任何东西', renderDegradations([]) === '');
const line = renderDegradations([{ code: 'history-bad-lines', count: 2, detail: '详情' }]);
ok('非空渲染带 code 与次数', line.indexOf('history-bad-lines×2') !== -1, line);
ok('渲染里写明「判不了」而不是「没问题」', line.indexOf('判不了') !== -1, line);
ok('渲染里带一句人话详情', line.indexOf('详情') !== -1);

// ③ 全局桶：note → drain 取走并清空（不允许下次再出现）
resetSink();
note('x', 'y', 1);
ok('drain 取出', drain().length === 1);
ok('drain 之后为空（不重复刷屏）', drain().length === 0);

// ④ 账本坏行必须留痕（否则「趋势」看起来像「首次体检」）
const dir = path.join(home, 'dsh-healthkit');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'history.jsonl'),
  JSON.stringify({ at: '2026-11-01T00:00:00.000Z', day: '2026-11-01', total: 9, p0: 0, p1: 0, p2: 0 }) + '\n' +
  '{ this is broken }\n' +
  JSON.stringify({ at: '2026-11-02T00:00:00.000Z', day: '2026-11-02', total: 9.2, p0: 0, p1: 0, p2: 0 }) + '\n',
  'utf8');
resetSink();
const rows = history.load();
ok('坏行不影响好行读入', rows.length === 2, String(rows.length));
const dg = drain();
ok('坏行记成降级', dg.some((x) => x.code === 'history-bad-lines' && x.count === 1), JSON.stringify(dg));
ok('降级写的是「趋势可能偏低」这种人话', /趋势/.test((dg.find((x) => x.code === 'history-bad-lines') || {}).detail || ''));

// ⑤ 快照坏文件同样留痕
const snap = await import('../src/snapshot.mjs');
const runs = path.join(dir, 'runs');
fs.mkdirSync(runs, { recursive: true });
fs.writeFileSync(path.join(runs, 'r1.json'), JSON.stringify({ at: '2026-11-01T00:00:00.000Z', seq: 1, score: { total: 9 }, findings: [] }), 'utf8');
fs.writeFileSync(path.join(runs, 'r2.json'), '{ broken snapshot', 'utf8');
resetSink();
const list = snap.listRuns(home);
ok('坏快照不影响好快照', list.length === 1, String(list.length));
ok('坏快照记成降级', drain().some((x) => x.code === 'runs-bad-json'), 'none');

// ⑥ 引擎结果里带 degradations 字段（且健康态是空数组，不制造噪声）
const { audit } = await import('../src/engine.mjs');
resetSink();
const r = audit({ record: false, skipRetire: true });
ok('audit 结果带 degradations 数组', Array.isArray(r.degradations), typeof r.degradations);

fs.rmSync(home, { recursive: true, force: true });
console.log('degrade: 通过（' + n + ' 项断言 · 降级留痕/合并/清空/渲染，正常路径零噪声）');
