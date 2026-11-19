// 最小 SemVer 范围判定（P1-4）。
//
// 为什么自己写：本仓**不引依赖**（`dependencies` 是空的，yaml 也是从 profile 现解析的），
// 而这里只需要判断「声明的 engines.dsh 是否覆盖真机宿主版本」——语法就是我们自己写的那种
// `>=0.2.2-0 <0.3.0`。引 200KB 的 semver 只为了比对一个字符串，得不偿失。
//
// 支持：`>=` `>` `<=` `<` `=` 前缀 + 空格连接（AND），以及预发布比较
// （`0.2.2-rc.5` vs `0.2.2-0`：核心相同则逐段比，数字段 < 字母段）。
// 明确不支持：`||`、`~`、`^`、`x` 通配 —— 遇到就返回 `null`（**判不了**），
// 让调用方去说「判不了」，而不是猜一个 true/false 出来。
export function parseVersion(v) {
  const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : [],
  };
}

function cmpIdent(a, b) {
  const na = /^\d+$/.test(a) ? Number(a) : null;
  const nb = /^\d+$/.test(b) ? Number(b) : null;
  if (na !== null && nb !== null) return na === nb ? 0 : (na < nb ? -1 : 1);
  if (na !== null) return -1;   // 数字段优先级低于字母段
  if (nb !== null) return 1;
  return a === b ? 0 : (a < b ? -1 : 1);
}

export function compareVersions(a, b) {
  const A = parseVersion(a);
  const B = parseVersion(b);
  if (!A || !B) return null;
  for (let i = 0; i < 3; i += 1) {
    if (A.core[i] !== B.core[i]) return A.core[i] < B.core[i] ? -1 : 1;
  }
  if (!A.pre.length && !B.pre.length) return 0;
  // 有预发布段的一方更小
  if (!A.pre.length) return 1;
  if (!B.pre.length) return -1;
  const len = Math.max(A.pre.length, B.pre.length);
  for (let i = 0; i < len; i += 1) {
    if (A.pre[i] === undefined) return -1;
    if (B.pre[i] === undefined) return 1;
    const c = cmpIdent(A.pre[i], B.pre[i]);
    if (c !== 0) return c;
  }
  return 0;
}

// 返回 true / false / null（null = 判不了，语法超出支持范围或版本号非法）
export function satisfies(version, range) {
  const v = parseVersion(version);
  if (!v) return null;
  const parts = String(range || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  for (const p of parts) {
    const m = p.match(/^(>=|<=|>|<|=)?(.+)$/);
    if (!m) return null;
    const op = m[1] || '=';
    const target = m[2];
    if (/[|~^*x]/.test(target)) return null;     // 不支持的语法：判不了
    if (!parseVersion(target)) return null;
    const c = compareVersions(version, target);
    if (c === null) return null;
    if (op === '>=' && !(c >= 0)) return false;
    if (op === '>' && !(c > 0)) return false;
    if (op === '<=' && !(c <= 0)) return false;
    if (op === '<' && !(c < 0)) return false;
    if (op === '=' && c !== 0) return false;
  }
  return true;
}
