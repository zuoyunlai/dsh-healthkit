// 最小 SemVer 范围判定（P1-4 的地基）。
//
// 为什么值得单测：它决定「本插件声明覆盖不覆盖当前宿主」。判错一个方向就是**说谎**——
// 说覆盖而实际不兼容，正是 0.13.0 把用户右栏清空却没被任何门拦下的原因。
// 这里连预发布段（`0.2.2-rc.5` vs `0.2.2-0`）一起钉住：DSH 发的是 rc 版本，
// 而 semver 里「数字段 < 字母段」这条规则很容易写反。
import assert from 'node:assert/strict';
const { parseVersion, compareVersions, satisfies } = await import('../src/verrange.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

// ① 解析
ok('解析普通版本', JSON.stringify(parseVersion('1.2.3')) === JSON.stringify({ core: [1, 2, 3], pre: [] }));
ok('解析预发布版本', JSON.stringify(parseVersion('0.2.2-rc.5').pre) === JSON.stringify(['rc', '5']));
ok('解析带 v 前缀', !!parseVersion('v0.2.2'));
ok('非法版本返回 null', parseVersion('abc') === null && parseVersion('0.2') === null);

// ② 比较：核心段
ok('1.2.3 < 1.3.0', compareVersions('1.2.3', '1.3.0') < 0);
ok('1.2.3 == 1.2.3', compareVersions('1.2.3', '1.2.3') === 0);
// ③ 比较：预发布段（数字 < 字母；无预发布 > 有预发布）
ok('0.2.2-rc.5 > 0.2.2-0（字母段大于数字段）', compareVersions('0.2.2-rc.5', '0.2.2-0') > 0);
ok('0.2.2-rc.5 < 0.2.2（正式版更大）', compareVersions('0.2.2-rc.5', '0.2.2') < 0);
ok('rc.10 > rc.9（数字段按数值比，不按字典序）', compareVersions('0.2.2-rc.10', '0.2.2-rc.9') > 0);
ok('rc.5 < rc.10', compareVersions('0.2.2-rc.5', '0.2.2-rc.10') < 0);

// ④ 范围：本插件真实声明
const DECL = '>=0.2.2-0 <0.3.0';
ok('rc.5 落在声明内（0.13.0 的真实宿主）', satisfies('0.2.2-rc.5', DECL) === true);
ok('0.2.2 正式版落在声明内', satisfies('0.2.2', DECL) === true);
ok('0.2.1-rc.1 不在声明内', satisfies('0.2.1-rc.1', DECL) === false);
ok('0.3.0 不在声明内', satisfies('0.3.0', DECL) === false);
ok('0.2.2-rc.1 在声明内（比 -0 大）', satisfies('0.2.2-rc.1', DECL) === true);

// ⑤ 单边与等号
ok('单下界', satisfies('9.9.9', '>=1.0.0') === true);
ok('单上界', satisfies('0.9.0', '<1.0.0') === true);
ok('等号', satisfies('1.0.0', '=1.0.0') === true && satisfies('1.0.1', '=1.0.0') === false);
ok('>=', satisfies('1.0.0', '>=1.0.0') === true);
ok('>', satisfies('1.0.0', '>1.0.0') === false);
ok('<=', satisfies('1.0.0', '<=1.0.0') === true);

// ⑥ 判不了就必须返回 null —— 不许猜
ok('不支持 ^ 语法返回 null', satisfies('0.2.2', '^0.2.1') === null);
ok('不支持 ~ 语法返回 null', satisfies('0.2.2', '~0.2.1') === null);
ok('不支持 || 返回 null', satisfies('0.2.2', '>=0.1.0 || >=0.3.0') === null);
ok('通配 x 返回 null', satisfies('0.2.2', '0.2.x') === null);
ok('空范围返回 null', satisfies('0.2.2', '') === null);
ok('非法版本返回 null', satisfies('abc', '>=0.1.0') === null);

console.log('verrange: 通过（' + n + ' 项断言 · 预发布比较 / 范围判定 / 判不了就 null）');
