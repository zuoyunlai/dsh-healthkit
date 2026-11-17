// 基线门（竞品分析 P1，借 SonarQube 的「只对新代码设门」）。
//
// 修前：本机 9.81 分、P0=P1=0 的健康机器上 `--check` 仍然 exit=1（PASS 22 / WARN 10）。
// 一道永远红的门只有两种命运：被人 `|| true` 掉，或者被人把发现一条条 retire 掉。
//
// 修后规则：只判「相对基线新增 + 回归」；新增 FAIL 永远 exit 2；新增 WARN 少于 3 条时
// 不下判（fudge，照 SonarQube 的做法避免小改动被不成比例地判死）；无基线时退回绝对门并明说。
import assert from 'node:assert/strict';
import { buildGateEnvelope, buildCheckEnvelope, GATE_FUDGE_MIN } from '../src/report-json.mjs';

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

const F = (fp, severity, confidence) => ({
  fp, ruleId: fp.split('#')[0], severity, dimension: 'consistency',
  title: '问题 ' + fp, evidence: [], measured: {}, confidence: confidence || 'MEASURED', advisory: false,
});
const mk = (findings, score) => ({
  allFindings: findings, findings, retired: [], facts: { home: '/tmp/x', profiles: [] },
  score: { total: score, raw: score, band: '良好', p0Open: 0 }, attribution: { rows: [] },
});

// ① 无基线 ⇒ 绝对门（老行为），并明确写出原因
{
  const env = buildGateEnvelope(mk([F('R1#a', 'P2')], 9.8), {});
  ok('无基线时 mode=absolute', env.mode === 'absolute', env.mode);
  ok('无基线时按绝对状态判（P2 存在 ⇒ exit 1）', env.exitCode === 1, String(env.exitCode));
  ok('无基线要说明怎么才会启用基线门', /基线/.test(env.note || ''), env.note);
}

// ② 全部存量 ⇒ 不阻塞
{
  const cur = mk([F('R1#a', 'P2'), F('R2#b', 'P1')], 9.0);
  const env = buildGateEnvelope(cur, { baseline: { at: '2026-11-17T00:00:00Z', score: 9.0, fps: ['R1#a', 'R2#b'] } });
  ok('全是存量时 exit=0', env.exitCode === 0, String(env.exitCode));
  ok('存量要计入 suppressed（只数参与门禁的）', env.suppressed === 2, String(env.suppressed));
  ok('能力域结构事实单列，不混进存量', env.structural > 0, String(env.structural));
  ok('gate 模式下存量不计入 warn/fail', env.newWarn === 0 && env.newFail === 0);
  ok('文案要说清没有新增', /没有新增/.test(env.note || ''), env.note);
}

// ③ 新增 P0/P1 ⇒ 无论几条都 exit 2（fudge 不放过 FAIL）
{
  const env = buildGateEnvelope(mk([F('R9#new', 'P1')], 6.0), { baseline: { fps: [] } });
  ok('新增 1 条 P1 ⇒ exit 2', env.exitCode === 2, String(env.exitCode));
  ok('新增 FAIL 计数正确', env.newFail === 1, String(env.newFail));
}

// ④ fudge：新增 1–2 条 WARN 不下判，3 条才判
{
  const base = { fps: [] };
  const one = buildGateEnvelope(mk([F('R1#a', 'P2')], 9.7), { baseline: base });
  ok('新增 1 条 WARN ⇒ 被 fudge 放过（exit 0）', one.exitCode === 0, String(one.exitCode));
  ok('fudge 要置位并解释', one.fudged === true && /fudge/.test(one.note || ''), one.note);
  const two = buildGateEnvelope(mk([F('R1#a', 'P2'), F('R2#b', 'P2')], 9.6), { baseline: base });
  ok('新增 2 条 WARN ⇒ 仍 exit 0', two.exitCode === 0, String(two.exitCode));
  const many = [];
  for (let i = 0; i < GATE_FUDGE_MIN; i++) many.push(F('R' + i + '#x', 'P2'));
  const three = buildGateEnvelope(mk(many, 9.5), { baseline: base });
  ok('新增 ' + GATE_FUDGE_MIN + ' 条 WARN ⇒ exit 1', three.exitCode === 1, String(three.exitCode));
  ok('够数时 fudged 为 false', three.fudged === false);
}

// ⑤ 每条 check 要带 fresh 标记（CLI 用它只列新增）
{
  const env = buildGateEnvelope(mk([F('R1#a', 'P2'), F('R2#b', 'P2')], 9.7), { baseline: { fps: ['R1#a'] } });
  const a = env.checks.find((c) => c.fp === 'R1#a');
  const b = env.checks.find((c) => c.fp === 'R2#b');
  ok('存量 check 的 fresh=false', a && a.fresh === false);
  ok('新增 check 的 fresh=true', b && b.fresh === true);
}

// ⑥ P4：UNKNOWN 不许当 PASS；信封补 doctor 的顶层字段
{
  const env = buildCheckEnvelope(mk([F('R11#u', 'INFO', 'UNKNOWN'), F('R12#m', 'INFO', 'MEASURED')], 9.8), {});
  const u = env.checks.find((c) => c.fp === 'R11#u');
  const m = env.checks.find((c) => c.fp === 'R12#m');
  ok('INFO + UNKNOWN ⇒ WARN（skip≠pass）', u.status === 'WARN', u.status);
  ok('INFO + MEASURED ⇒ PASS', m.status === 'PASS', m.status);
  ok('信封带 schema', env.schema === 'dsh-healthkit/check/v1');
  ok('信封带 exitCode（doctor 的字段名）', env.exitCode === env.doctor.exit);
  ok('信封带 generatedAt', !!env.generatedAt);
  ok('信封带 summary 计数', env.summary && env.summary.total === env.checks.length);
  ok('remediation 默认不出现（byte-stable）', !('remediation' in env));
  const withRem = buildCheckEnvelope(mk([F('R10#r', 'P2')], 9.8), { remediation: true });
  const f0 = withRem.checks.find((c) => c.fp === 'R10#r');
  ok('opt-in 后才出现 remediation', Array.isArray(withRem.remediation));
  ok('remediation 是字符串数组', withRem.remediation.every((x) => typeof x === 'string'));
  void f0;
}

console.log('gate: 通过（' + n + ' 项断言 · 基线门/fudge/存量豁免/fresh/契约字段/UNKNOWN）');
