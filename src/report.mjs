export function renderReport(facts, findings, sc, opts) {
  var lines = [];
  var L = function (s) { lines.push(s); };
  var today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  L('# DSH 体检报告 ' + today);
  L('');
  L('> 引擎 dsh-healthkit ' + (opts.version || '?') + ' · rubric ' + sc.rubricVersion + ' · 场景 ' + sc.scenario);
  L('> 被检实例：DSH_HOME = ' + facts.home + ((facts.profiles || []).length ? ' · profile ' + facts.profiles.map(function (p) { return p.name; }).join('、') : ''));
  L('> 采集时间 ' + String(facts.collectedAt || '?').replace('T', ' ').slice(0, 19) + '（' + (facts.cacheHit ? '命中 60 秒事实缓存' : '本次现采') + '）');
  L('> 范围：只读静态审计（profile 配置、装载日志、磁盘用量）。插件运行时的工具注册、宿主内部状态**不在本检查范围内**——这类只能标 UNKNOWN，不猜。');
  L('> 修复建议均为 L3-plan（只给命令与预检，不执行）。');
  L('');
  if (opts.firstScreen && opts.firstScreen.text) {
    L('## 零、先看这一句');
    L('');
    L(opts.firstScreen.text);
    L('');
  }
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
  // 审计反哺 V10：跨次对比——区分「真修好」（消失且未被退役）与「被静音」（新退役）。
  if (opts && opts.diff) {
    var dd = opts.diff;
    L('## 三之三之二、跨次对比：新增 ' + dd.added.length + ' / 真修好 ' + dd.fixed.length + ' / 新退役 ' + dd.newlyRetired.length +
      '（上一次 ' + String(dd.prevAt || '?').replace('T', ' ').slice(0, 19) + '，分数 ' + dd.prevScore + ' → ' + dd.curScore +
      (typeof dd.delta === 'number' ? '，' + (dd.delta > 0 ? '+' : '') + dd.delta : '') + '）');
    L('');
    if (dd.added.length) L('- **新增**：' + dd.added.map(function (f) { return f.ruleId + ' ' + String(f.title || '').slice(0, 40); }).join('；'));
    if (dd.fixed.length) L('- **真修好**（消失且未被退役）：' + dd.fixed.map(function (f) { return f.ruleId + ' ' + String(f.title || '').slice(0, 40); }).join('；'));
    if (dd.newlyRetired.length) L('- **新退役**（被静音，**不算修好**）：' + dd.newlyRetired.map(function (f) { return f.fp; }).join('、'));
    if (dd.severityChanged && dd.severityChanged.length) L('- 严重度变化：' + dd.severityChanged.map(function (f) { return f.fp + ' ' + f.from + '→' + f.to; }).join('；'));
    if (!dd.added.length && !dd.fixed.length && !dd.newlyRetired.length) L('- 与上一次一致（持续存在 ' + dd.kept + ' 条）。');
    L('');
  } else {
    L('## 三之三之二、跨次对比');
    L('');
    L('- 没有可对比的上一次快照：**本次为基线**，下次体检起可对比。');
    L('');
  }
  // §13.7 自审分离：本插件自身的状态单列一节，**不参与评分**。
  // 体检器自己出问题（比如工具没注册全、数据目录读不到）不能影响被检对象的分数。
  if (opts && opts.self && Object.keys(opts.self).length) {
    var sl = opts.self;
    L('## 三之四、本插件自身状态（不计入评分）');
    L('');
    L('- 版本：' + (sl.version || '?') + ' · rubric ' + sc.rubricVersion);
    L('- 工具面：' + (sl.tools && sl.tools.length ? sl.tools.join('、') : 'CLI 模式（工具由宿主注册，不在此处列出）'));
    L('- 数据目录：' + (sl.dataDir || '未知') + ' · 账本 ' + (sl.historyRuns === null || sl.historyRuns === undefined ? '未知' : sl.historyRuns + ' 次') + ' · 已退役 ' + (sl.retiredCount || 0) + ' 条');
    if (sl.notes && sl.notes.length) L('- 备注：' + sl.notes.join('；'));
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
  L('由 dsh-healthkit 生成。规则不可靠时会输出 UNKNOWN 而不是猜测；误报记档：dsh-healthkit --retire <指纹> --reason "原因"，用 --list-retired 查看已记档。');
  return lines.join('\n') + '\n';
}


// 「先修哪几条」的小节内容。report 与 CLI/工具共用，避免两处文案漂移。
export function attributionLines(sc, attr) {
  var out = [];
  if (!attr) return out;
  var fault = attr.rowsFault || [];
  var hygiene = attr.rowsHygiene || [];
  var hasRows = attr.rows && attr.rows.length;
  if (!hasRows && !attr.stage1) return out;
  var sign = function (n) { return n > 0 ? '+' + n : String(n); };
  // 2026-11-20 反哺 P2：先回答「要不要动」，再谈分数。
  out.push('> 先分清两类：**故障处置**（不修会让插件加载失败、被静默跳过或宿主起不来）与**配置优化**（可以保留现状）。分数是两类问题的合计量，不是待办清单。');
  out.push('');
  if (attr.stage1) {
    out.push('**必须处理 ｜ P0（' + attr.stage1.count + ' 条）** ' + attr.stage1.from + ' → ' + attr.stage1.to + '（' + sign(attr.stage1.delta) + (attr.capped ? '，解除封顶' : '') + '）');
    out.push('');
    attr.stage1.items.forEach(function (s) { out.push('- ' + s); });
    out.push('');
  }
  if (fault.length) {
    out.push('**故障处置 ｜ 按影响排（不是按涨分）**');
    out.push('');
    out.push('| 影响 | 规则 | 问题 |');
    out.push('|---|---|---|');
    fault.slice(0, 8).forEach(function (r) {
      out.push('| ' + (r.saves || '影响加载') + ' | ' + r.ruleId + ' | ' + (r.title || '') + (r.target ? '（' + r.target + '）' : '') + ' |');
    });
    out.push('');
  } else {
    out.push('**故障处置**：没有会影响加载/启动的计分项。');
    out.push('');
  }
  if (hygiene.length) {
    out.push('**配置优化 ｜ 可保留现状**（不影响能不能加载；不建议为了分数动手）');
    out.push('');
    hygiene.slice(0, 8).forEach(function (r) {
      out.push('- ' + (r.ruleId ? '`' + r.ruleId + '` ' : '') + (r.title || '') + (r.target ? '（' + r.target + '）' : ''));
    });
    out.push('');
  }
  out.push('> 单条增量互不叠加，只用于比较优先级。**「全修完 → ' + attr.potentialAll + ' / 10」是评分公式的终点，不是建议动作**；不追求满分。');
  out.push('');
  return out;
}
