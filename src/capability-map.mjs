// 能力域矩阵：把「你现在有哪些能力、缺哪些、缺了怎么补」摊开。
//
// 设计立场（用户 2026-11-15 拍板）：**装插件是最后手段**。所以每个缺口的补救阶梯固定三级：
//   ① 配置层 —— 是不是已有实现只是没开/没配（cordis.patch.yml、providers 段）
//   ② 宿主内置 —— @deepseek-ai/* 是否已经带着这个能力
//   ③ 装插件 —— 只给搜索关键词，不给具体包名（包会改名、会下架，推荐具体包等于给自己挖坑）
//
// 状态判定只看静态证据，不猜用户「需不需要」某个能力：missing 只说明当前没有实现，
// 不代表你该装。判定不确定时给 unknown，不给假结论。

// 域定义：re 同时匹配 bundle 名与它的 package.json 描述（由 collect 提供）。
// 宁窄勿宽——把「插件市场」误判成「搜索实现」这种错，比少报一个域更糟。
var DOMAINS = [
  { key: 'search', label: '搜索 / 抓取', re: /(free-search|web search|web-search|search engine|搜索引擎|crawl|scrap)/i, hint: 'web search fetch 搜索' },
  { key: 'browser', label: '浏览器自动化', re: /(browser|ego)/i, hint: 'browser automation 浏览器' },
  { key: 'image', label: '图像生成', re: /(image-gen|image generation|image gen|文生图)/i, hint: 'image generation 图像生成' },
  { key: 'vision', label: '视觉理解', re: /(vision|modlens|ocr|看图|视觉)/i, hint: 'vision ocr 视觉' },
  { key: 'office', label: '文档处理', re: /(office|docx|xlsx|pptx|pdf)/i, hint: 'office docx pdf 文档', note: '宿主自带 office 类 skill，插件层通常不需要补' },
  { key: 'memory', label: '会话记忆 / 上下文', re: /(memory|chronicle|mnemon|openviking|context|recall)/i, hint: 'memory 记忆 上下文' },
  { key: 'codeindex', label: '代码 / 项目索引', re: /(project-memory|index_repo|codegraph|symbol)/i, hint: 'code index 项目索引' },
  { key: 'automation', label: '定时任务', re: /(automation|schedule|cron)/i, hint: 'automation 定时' },
  { key: 'remote', label: '远程工作区', re: /(remote|ssh)/i, hint: 'remote ssh 远程' },
  { key: 'theme', label: '主题 / 外观', re: /(theme|palette|color|appearance)/i, hint: 'theme 主题' },
  { key: 'panel', label: '面板 / 侧边栏扩展', re: /(sidebar|panel|rightbar|tab)/i, hint: 'sidebar panel 面板' },
  { key: 'market', label: '插件发现 / 市场', re: /(market|awesome|registry)/i, hint: 'plugin market 插件市场' },
  // 供应商配置写在 profile 的 config 里，静态审计读不到 → 不猜，标 unknown。
  { key: 'provider', label: '模型供应商', re: /(provider|openai-compat|anthropic|gemini)/i, hint: 'provider 模型供应商', unknown: true },
  { key: 'compress', label: '上下文压缩', re: /(compress|compact|summar)/i, hint: 'compaction 压缩' },
  { key: 'voice', label: '语音 / TTS', re: /(tts|voice|speech|语音)/i, hint: 'tts voice 语音' },
  { key: 'video', label: '视频处理', re: /(video|ffmpeg|frame)/i, hint: 'video 视频' },
  { key: 'data', label: '数据 / 表格', re: /(table|xlsx|csv|dataframe|报表)/i, hint: 'table data 表格' },
  { key: 'chart', label: '图表 / 可视化', re: /(chart|plot|visuali|图谱|graph)/i, hint: 'chart 图表' },
  { key: 'notify', label: '通知 / 提醒', re: /(notify|notification|提醒)/i, hint: 'notify 通知' },
  { key: 'cleanup', label: '备份 / 清理', re: /(clean|backup|purge|healthkit)/i, hint: 'cleanup 清理' },
];

var STATUS_LABEL = {
  ok: '有实现',
  redundant: '多实现',
  missing: '无实现',
  unknown: '无法判定',
};

function firstSentences(items, n) {
  return items.slice(0, n || 3).map(function (x) { return x.name; }).join('、');
}

export function buildMatrix(facts) {
  var profiles = (facts && facts.profiles) || [];
  var thirdParty = [];
  var bundledNames = [];
  profiles.forEach(function (p) {
    (p.thirdPartyBundles || []).forEach(function (b) {
      if (!thirdParty.some(function (x) { return x.name === b; })) {
        thirdParty.push({ name: b, profile: p.name, desc: '' });
      }
    });
    (p.bundles || []).forEach(function (b) {
      if (bundledNames.indexOf(b) < 0) bundledNames.push(b);
    });
  });

  var rows = DOMAINS.map(function (d) {
    var hits = thirdParty.filter(function (x) { return d.re.test(x.name + ' ' + x.desc); });
    var status;
    if (d.unknown && !hits.length) status = 'unknown';
    else if (!hits.length) status = 'missing';
    else if (hits.length >= 2) status = 'redundant';
    else status = 'ok';
    return {
      key: d.key,
      label: d.label,
      status: status,
      count: hits.length,
      plugins: hits.map(function (x) { return x.name; }),
      hint: d.hint,
      note: d.note || '',
    };
  });

  var byStatus = { ok: 0, redundant: 0, missing: 0, unknown: 0 };
  rows.forEach(function (r) { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  return { rows: rows, byStatus: byStatus, thirdParty: thirdParty, bundled: bundledNames };
}

// 补救阶梯：只给方向与判据，不替用户选包。
export function ladderOf(row) {
  if (row.status === 'ok') {
    return ['已有一个实现：保持现状即可；要换实现时再评估'];
  }
  if (row.status === 'redundant') {
    return [
      '① 配置层：确认这几条是不是都真的在用（cordis.patch.yml 里有 disabled / enabled 的可以关掉不用的）',
      '② 宿主内置：若其中有 @deepseek-ai/* 的，优先留内置那条，第三方作为补充',
      '③ 装插件：先别装。多实现本身不是问题，抢同一工具位才是——跑 audit_trim 看谁是主力',
    ];
  }
  return [
    '① 配置层：先确认是不是已经装了但没启用（profile 的 package.json / cordis.patch.yml）',
    '② 宿主内置：看 @deepseek-ai/* 里有没有现成的，装了不用额外插件',
    '③ 装插件：真要补，按关键词搜「' + row.hint + '」，别按名字猜；装前先看它声明的 peer 版本是否匹配当前 DSH',
  ];
}

export function renderMatrix(m) {
  var L = [];
  var s = m.byStatus;
  L.push('能力域 ' + m.rows.length + ' 个：有实现 ' + s.ok + ' / 多实现 ' + s.redundant + ' / 无实现 ' + s.missing);
  L.push('');
  var groups = [
    { k: 'redundant', title: '多实现（优先看，占工具位）' },
    { k: 'missing', title: '无实现（未必需要，先看阶梯再决定）' },
    { k: 'ok', title: '有实现' },
  ];
  groups.forEach(function (g) {
    var list = m.rows.filter(function (r) { return r.status === g.k; });
    if (!list.length) return;
    L.push('【' + g.title + '】');
    list.forEach(function (r) {
      L.push('  · ' + r.label + '（' + STATUS_LABEL[r.status] + (r.count ? ' ' + r.count + ' 个' : '') + '）' + (r.plugins.length ? '：' + firstSentences(r.plugins.map(function (n) { return { name: n }; }), 4) : ''));
      if (r.note) L.push('    注：' + r.note);
      if (r.status === 'unknown') {
        L.push('    静态审计读不到这一项的真实配置：请到设置里看，或用 audit_explain 看相关规则。');
      } else if (r.status !== 'ok') {
        ladderOf(r).forEach(function (line) { L.push('    ' + line); });
      }
    });
    L.push('');
  });
  L.push('说明：missing 只表示「当前没有实现」，不代表你该装。阶梯刻意把配置与宿主内置排在装插件前面。');
  return L.join('\n');
}
