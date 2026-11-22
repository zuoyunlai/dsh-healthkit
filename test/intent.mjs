// 2026-11-20 反哺 P1：《停用 ≠ 该卸载》回归。
//
// 背景：市场/官方插件页的「停用」只把包从 dsh.profile.bundles 摘掉，依赖留着。
// 旧版 R1 一律判 P1 并给 `dsh plugin remove` —— 照着修会把用户主动保留的插件删掉。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRules } from '../src/rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const base = JSON.parse(fs.readFileSync(path.join(here, '..', 'fixtures', 'facts-2026-11-16.json'), 'utf8'));
// 清空白名单：夹具里那两个包本来就在 allowlist 里，不清空 R1 永远不触发。
const allow = {};

function factsWith(mut) {
  const f = JSON.parse(JSON.stringify(base));
  const p = f.profiles.find((x) => x.name === 'desktop') || f.profiles[0];
  mut(p, f);
  return f;
}
const by = (list, id) => list.filter((f) => f.ruleId === id);

// ① 没有停用记录：R1 必须命中，但修法不许直接给 remove 命令
{
  const fs1 = factsWith((p) => { p.marketDisabled = []; p.marketStateReadable = true; });
  const f = runRules(fs1, allow);
  const r1 = by(f, 'R1');
  assert.equal(r1.length, 1, '无停用记录时应报 R1（1 条）');
  assert.match(r1[0].fixHint, /先确认/, 'R1 修法必须先要求确认是否还需要');
  assert.doesNotMatch(r1[0].fixHint, /plugin --profile \S+ remove/, 'R1 不得直接把 remove 当修法');
  assert.equal(r1[0].confidence, 'MEASURED', '读到市场状态时置信度应为 MEASURED');
}

// ② 停用记录覆盖：降噪为 R1b INFO，不再判 R1
{
  const fs2 = factsWith((p) => {
    p.marketDisabled = ['dsh-wsl-tool', 'dsh-find-plugins'];
    p.marketStateReadable = true;
  });
  const f = runRules(fs2, allow);
  assert.equal(by(f, 'R1').length, 0, '停用记录里的包不得判 R1');
  const r1b = by(f, 'R1b');
  assert.equal(r1b.length, 1, '应报 1 条 R1b（按停用选择未挂载）');
  assert.equal(r1b[0].severity, 'INFO', 'R1b 不计分');
  assert.match(r1b[0].title, /符合预期/);
}

// ③ 读不到市场状态：R1 仍在，但置信度降级（不能当成已证故障）
{
  const fs3 = factsWith((p) => { p.marketDisabled = []; p.marketStateReadable = false; });
  const r1 = by(runRules(fs3, allow), 'R1');
  assert.equal(r1.length, 1);
  assert.equal(r1[0].confidence, 'MEDIUM', '未读到停用记录时不得声称 MEASURED');
}

// ④ R2：disabled 条目对应停用记录 → 不报 R2，改报 R2b
{
  const fs4 = factsWith((p, f) => {
    p.depsNotBundled = []; p.depsNotBundledRaw = [];
    p.marketDisabled = ['dsh-gone']; p.marketStateReadable = true;
    f.patchEntries['desktop'] = [{ id: 'dsh-gone', disabled: true, name: null }];
  });
  const f = runRules(fs4, allow);
  assert.equal(by(f, 'R2').length, 0, '停用记录对应的 disabled 条目不得判「疑似空转」');
  assert.equal(by(f, 'R2b').length, 1, '应报 1 条 R2b（保留的停用记录）');
}

// ⑤ 对照：同样一条 disabled 但不在停用记录里 → 仍按 R2 报（不放宽真问题）
{
  const fs5 = factsWith((p, f) => {
    p.depsNotBundled = []; p.depsNotBundledRaw = [];
    p.marketDisabled = []; p.marketStateReadable = true;
    f.patchEntries['desktop'] = [{ id: 'dsh-ghost', disabled: true, name: null }];
  });
  const f = runRules(fs5, allow);
  assert.equal(by(f, 'R2').length, 1, '没有停用记录的 disabled 空转仍要报 R2');
  assert.match(by(f, 'R2')[0].fixHint, /保留它/, 'R2 修法要提醒「停用记录别删」');
}

// ⑥ 记录写完整包名、patch 行写短 id（真实形态：@scope/dsh-x ↔ x）→ 不报 R2，报 R2b
{
  const fs6 = factsWith((p, f) => {
    p.depsNotBundled = []; p.depsNotBundledRaw = [];
    p.marketDisabled = ['@yolk_vat-y/dsh-project-memory']; p.marketStateReadable = true;
    f.patchEntries['desktop'] = [{ id: 'project-memory', disabled: true, name: null }];
  });
  const f = runRules(fs6, allow);
  assert.equal(by(f, 'R2').length, 0, '短 id 与完整包名必须能对上，不得判「疑似空转」');
  assert.equal(by(f, 'R2b').length, 1, '应报 1 条 R2b（识别为你的停用记录）');
}

// ⑦ 反向：记录写短名、依赖是全名 → 降噪为 R1b，不得判 R1
{
  const fs7 = factsWith((p) => {
    p.depsNotBundled = ['@yolk_vat-y/dsh-project-memory'];
    p.depsNotBundledRaw = ['@yolk_vat-y/dsh-project-memory'];
    p.marketDisabled = ['project-memory']; p.marketStateReadable = true;
  });
  const f = runRules(fs7, allow);
  assert.equal(by(f, 'R1').length, 0, '记录写短名时不得把对应依赖判成 R1');
  assert.equal(by(f, 'R1b').length, 1, '应报 1 条 R1b');
}

console.log('intent: 通过（R1 降噪 / R1b / 置信度降级 / R2 与 R2b 分流 / 短 id↔完整包名）');
