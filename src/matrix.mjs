// 规则矩阵（C2）：把「24 条规则 × 谁该看 × 哪一层能自动判」摊成一张可公开的表。
//
// 为什么不是「全目录 × 宿主版本」的兼容矩阵：那张表要求逐个装插件、逐个启动宿主，
// 做不到还硬做就是编数据。这里换一个**诚实且能自动更新**的矩阵：真源是 `src/rules.mjs`
// 的代码本身（静态抽取 ruleId / severity / title），谁改了规则而没改表，测试会红。
//
// 三个受众身份（这也是 README 里一直在说的三件事）：
//   user  —— 用户日常体检：要读得懂「这条为什么扣我分」
//   boot  —— 动过配置之后：能不能起来（预启动探针那 5 类）
//   gate  —— CI：只判新增与回归
import fs from 'node:fs';
import path from 'node:path';

export const MATRIX_SCHEMA = 'dsh-healthkit/matrix/v1';

// 能被「预启动探针」直接复判的规则（起不来的那几类）。这份映射是**判断**，
// 所以放在这里显式写出来，而不是从代码里猜。
export const BOOT_COVERED = {
  R1: '依赖装了但没被 patch 挂载',
  R2: 'disabled 指向的包不在依赖里',
  R22: 'file:/link: 依赖目标不存在',
  R23: 'bundle 没声明 dsh.bundle（宿主静默跳过）',
  R24: 'profile 自身不可解析',
};

// 能被清理器接手产出动作的规则
export const CLEAN_COVERED = { R4: '.bak/副本堆积', R17: '大目录', R18: '引擎资产（判为不可回收）' };

function readRulesSource(root) {
  try { return fs.readFileSync(path.join(root, 'src', 'rules.mjs'), 'utf8'); } catch (e) { return ''; }
}

// 从规则源码里抽取 ruleId → {severity, dimension, title}。
//
// 两点实测教训（第一版正则直接漏了 R2c）：
//   ① title 常是三元/拼接表达式（`yamlUnavailable ? 'A' : 'B' + err`），
//      「title: '...'」这种写法在 R2c 上根本不匹配 → 改为取 title: 之后**第一个引号串**；
//   ② ruleId 与 title 之间可能隔着几行（severity/dimension/evidence），窗口要留够。
// 抽不到就显式标注「见源码」，不许静默丢规则——丢一条等于矩阵骗人。
export function extractRules(root0) {
  const root = root0 || '.';
  const src = readRulesSource(root);
  const out = new Map();
  const idRe = /ruleId:\s*'([^']+)'/g;
  let m;
  while ((m = idRe.exec(src)) !== null) {
    const id = m[1];
    const tail = src.slice(m.index, m.index + 900);
    const sev = (tail.match(/severity:\s*'([^']+)'/) || tail.match(/severity:\s*[^,\n]*?'(P0|P1|P2|INFO)'/) || [])[1] || '';
    const dim = (tail.match(/dimension:\s*'([^']+)'/) || [])[1] || '';
    const tIdx = tail.indexOf('title:');
    let title = '';
    if (tIdx !== -1) {
      const seg = tail.slice(tIdx, tIdx + 240);
      const lit = seg.match(/'([^']{2,90})'/);
      title = lit ? lit[1] : '（标题是表达式，见源码）';
    } else {
      title = '（源码里没找到 title，见规则本身）';
    }
    if (!out.has(id)) out.set(id, { ruleId: id, severity: sev, dimension: dim, title: title.slice(0, 80) });
  }
  return Array.from(out.values()).sort((a, b) => {
    const pa = a.ruleId.match(/^R(\d+)(.*)$/);
    const pb = b.ruleId.match(/^R(\d+)(.*)$/);
    const na = pa ? Number(pa[1]) : 99;
    const nb = pb ? Number(pb[1]) : 99;
    if (na !== nb) return na - nb;
    return String(a.ruleId).localeCompare(String(b.ruleId));
  });
}

export function buildMatrix(root0) {
  const root = root0 || '.';
  const rules = extractRules(root);
  const rows = rules.map((r) => ({
    ruleId: r.ruleId,
    severity: r.severity || '—',
    dimension: r.dimension || '—',
    title: r.title,
    audit: true,                       // 所有规则都进体检
    boot: Object.prototype.hasOwnProperty.call(BOOT_COVERED, r.ruleId),
    clean: Object.prototype.hasOwnProperty.call(CLEAN_COVERED, r.ruleId),
    gate: r.severity === 'P0' || r.severity === 'P1' || r.severity === 'P2',
  }));
  return {
    schema: MATRIX_SCHEMA,
    generatedFrom: 'src/rules.mjs',
    count: rows.length,
    bootCodes: Object.keys(BOOT_COVERED),
    cleanCodes: Object.keys(CLEAN_COVERED),
    rows,
  };
}

export function renderMatrix(m) {
  const L = [];
  L.push('# 规则矩阵');
  L.push('');
  L.push('> 本文件由 `dsh-healthkit --matrix --out docs/MATRIX.md` 生成，真源是 `src/rules.mjs`。');
  L.push('> 改了规则不重新生成，`test/matrix.mjs` 会红——这张表不可能比代码旧。');
  L.push('');
  L.push('三条身份用三列表示：**体检**（日常评分）/ **探针**（改完配置能不能起来）/ **门禁**（CI 只判新增与回归）。');
  L.push('');
  L.push('| 规则 | 严重度 | 维度 | 抓什么 | 体检 | 探针 | 清理 | 门禁 |');
  L.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of m.rows) {
    L.push('| `' + r.ruleId + '` | ' + r.severity + ' | ' + r.dimension + ' | ' + r.title + ' |' +
      ' ✓ |' + (r.boot ? ' ✓ |' : ' |') + (r.clean ? ' ✓ |' : ' |') + (r.gate ? ' ✓ |' : ' |'));
  }
  L.push('');
  L.push('## 预启动探针直接复判的 ' + m.bootCodes.length + ' 类');
  L.push('');
  for (const k of m.bootCodes) L.push('- `' + k + '` — ' + BOOT_COVERED[k]);
  L.push('');
  L.push('## 清理器能接手的 ' + m.cleanCodes.length + ' 类');
  L.push('');
  for (const k of m.cleanCodes) L.push('- `' + k + '` — ' + CLEAN_COVERED[k]);
  L.push('');
  L.push('## 这张表不做什么');
  L.push('');
  L.push('- 不是「全目录 × 宿主版本」的兼容矩阵：那需要逐个装插件、逐个启动宿主，本仓不做这件事（做不到就不编）。');
  L.push('- 不承诺「探针列没有勾的规则就与启动无关」：只表示探针不直接复判它。');
  return L.join('\n');
}
