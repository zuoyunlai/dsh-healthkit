export function renderReport(facts, findings, sc, opts) {
  var lines = [];
  var L = function (s) { lines.push(s); };
  var today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  L('# DSH 体检报告 ' + today);
  L('');
  L('> 引擎 dsh-auditkit ' + (opts.version || '?') + ' · rubric ' + sc.rubricVersion + ' · 场景 ' + sc.scenario + ' · DSH_HOME ' + facts.home);
  L('> 只读审计。修复建议均为 L3-plan（只给命令与预检，不执行）。');
  L('');
  L('## 一、评分');
  L('');
  L('**总分 ' + sc.total + ' / 10**（' + sc.band + '）· 未加权原始分 ' + sc.raw + ' · 未关闭 P0 = ' + sc.p0Open);
  if (sc.capReason) L('**封顶原因**：' + sc.capReason + '（原始分 ' + sc.raw + ' 已按上限 ' + sc.total + ' 计）');
  L('');
  L('| 维度 | 权重 | 得分 | 命中规则 |');
  L('|---|---|---|---|');
  sc.dims.forEach(function (d) {
    L('| ' + d.label + ' | ' + d.weight + '% | ' + d.score + ' | ' + (d.items.length ? d.items.join(', ') : '-') + ' |');
  });
  L('');
  var attrLines = attributionLines(sc, opts.attr);
  if (attrLines.length) {
    L('## 一之二、先修哪几条');
    L('');
    attrLines.forEach(function (s) { L(s); });
  }
  var order = { P0: 0, P1: 1, P2: 2, INFO: 3 };
  var sorted = findings.slice().sort(function (a, b) { return (order[a.severity] || 9) - (order[b.severity] || 9); });
  var cnt = { P0: 0, P1: 0, P2: 0, INFO: 0 };
  sorted.forEach(function (f) { cnt[f.severity] = (cnt[f.severity] || 0) + 1; });
  L('## 二、结论摘要');
  L('');
  L('P0 ' + cnt.P0 + ' / P1 ' + cnt.P1 + ' / P2 ' + cnt.P2 + ' / INFO ' + cnt.INFO + '；未知项 ' + sorted.filter(function (f) { return f.confidence === 'UNKNOWN'; }).length + ' 个（按 UNKNOWN 计罚，不猜）。');
  L('');
  L('## 三、问题清单');
  L('');
  if (!sorted.length) L('（无）');
  sorted.forEach(function (f) {
    L('### [' + f.severity + '] ' + f.title);
    L('');
    L('- 规则：`' + f.ruleId + '` · 维度：' + f.dimension + ' · 置信度：' + f.confidence);
    if (f.evidence.length) L('- 证据：' + f.evidence.map(function (e) { return '`' + e.replace(facts.home, '~/.dsh') + '`'; }).join(' / '));
    var keys = Object.keys(f.measured || {});
    if (keys.length) L('- 实测：' + keys.map(function (k) { return k + '=' + JSON.stringify(f.measured[k]); }).join('，'));
    if (f.fixHint) L('- 修法：' + f.fixHint + '（**未执行**）');
    L('');
  });
  var adv = sorted.filter(function (f) { return f.advisory === true; });
  if (adv.length) {
    L('## 三之二、建议（不计分，需人工判断）');
    L('');
    adv.forEach(function (f) { L('- `' + f.ruleId + '` ' + f.title); });
    L('');
  }
  if (opts && opts.retired && opts.retired.length) {
    L('## 三之三、已退役（误报记档，不计分）');
    L('');
    opts.retired.forEach(function (f) { L('- `' + f.fp + '` — ' + (f.retired && f.retired.reason ? f.retired.reason : '无理由')); });
    L('');
  }
  L('## 四、修复建议（L3-plan，不执行）');
  L('');
  var fixes = sorted.filter(function (f) { return f.fixHint; });
  if (!fixes.length) L('（无）');
  fixes.forEach(function (f) {
    L('1. `' + f.ruleId + '` — ' + f.fixHint);
  });
  L('');
  L('## 五、采集摘要');
  L('');
  L('- profiles：' + facts.profiles.map(function (p) { return p.name + '(deps ' + p.deps.length + '/bundles ' + p.bundles.length + ')'; }).join('，'));
  L('- YAML 解析可用：' + facts.yamlAvailable + ' · 配置纳入 VCS：' + facts.vcs);
  L('- 装载日志：' + (facts.logs.reloadLines || 0) + ' 行 · 服务插件 ' + (facts.logs.servedPlugins === null ? '未知' : facts.logs.servedPlugins) + ' · stand-in ' + ((facts.logs.standIn || []).length));
  L('- 磁盘 top5：' + facts.disk.slice().sort(function (a, b) { return b.bytes - a.bytes; }).slice(0, 5).map(function (d) { return d.name + ' ' + Math.round(d.bytes / 1048576) + 'MB'; }).join('，'));
  L('- 引擎资产：' + (facts.engineAssets.length ? facts.engineAssets.map(function (a) { return a.path.replace(facts.home, '~/.dsh'); }).join('，') : '未识别'));
  L('');
  L('---');
  L('由 dsh-auditkit 生成。规则不可靠时会输出 UNKNOWN 而不是猜测；误报请用 audit_retire 记档（P2 交付）。');
  return lines.join('\n') + '\n';
}


// 「先修哪几条」的小节内容。report 与 CLI/工具共用，避免两处文案漂移。
export function attributionLines(sc, attr) {
  var out = [];
  if (!attr) return out;
  var hasRows = attr.rows && attr.rows.length;
  if (!hasRows && !attr.stage1) return out;
  var sign = function (n) { return n > 0 ? '+' + n : String(n); };
  out.push('> 分两步：先解 P0 封顶，再在解封后的基准上逐条算。单条增量**互不叠加**（分维度上限仍会互相影响）；「全修完」才是加总真值。');
  out.push('');
  if (attr.stage1) {
    out.push('**第一步 ｜ 处理掉全部 P0（' + attr.stage1.count + ' 条）** ' + attr.stage1.from + ' → ' + attr.stage1.to + '（' + sign(attr.stage1.delta) + (attr.capped ? '，解除封顶' : '') + '）');
    out.push('');
    attr.stage1.items.forEach(function (s) { out.push('- ' + s); });
    out.push('');
  }
  if (hasRows) {
    out.push('**第二步 ｜ P0 清零后，再修这一条还能涨多少**（基准 ' + attr.stage2Base + '）');
    out.push('');
    out.push('| 增量 | 规则 | 问题 |');
    out.push('|---|---|---|');
    attr.rows.slice(0, 8).forEach(function (r) {
      out.push('| ' + sign(r.delta) + ' | ' + r.ruleId + ' | ' + (r.title || '') + (r.target ? '（' + r.target + '）' : '') + ' |');
    });
    out.push('');
  }
  out.push('**全部计分项都修完** → ' + attr.potentialAll + ' / 10');
  out.push('');
  return out;
}
