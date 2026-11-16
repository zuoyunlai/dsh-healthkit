// 能力域 → 候选实现的「推荐源」（第四批第 3 项）。
//
// 形态：一个可订阅的 JSON 文档（schema: dsh-healthkit/recommend/v1），
// 描述 20 个能力域各自的判据、已知候选来源与补救阶梯。
//
// 三条设计红线（都来自既有立场，不是新加的）：
//   ① **装插件是最后手段**——阶梯固定「配置 → provider → 插件 → 习惯」，
//      指向插件那级只给**搜索关键词**，不给具体包名。包会改名、会下架、
//      会撞 npm 相似名保护（实测：本插件的旧包名被近似的旧包名挡住）；
//      推荐具体包等于给订阅者挖坑。
//   ② **不联网**——本模块只产出本地可读的推荐源；候选来源只写「去哪找」
//      （npm 搜索关键词 / 本机已装的实现 / 宿主内置），不代查 registry。
//   ③ **missing ≠ 该装**——每个域都带 note 说明「缺这项不代表你有问题」。

import { buildMatrix, ladderOf, STATE_LABEL } from './capability-map.mjs';

/**
 * 推荐源里的阶梯：**恒为四级**，与本机状态无关。
 *
 * 为什么不让 present 域只给一行：推荐源是**策略文档**——订阅者要看到的是
 * 「任何情况下该按什么顺序补」，而不是「你现在缺不缺」。缺的那一行会让
 * 订阅者以为 present 域不需要阶梯。
 */
function ladderPolicy(row) {
  if (row.status === 'present') {
    return [
      '① 配置层：已有一个实现，保持现状即可；要评估别的实现时从②往下看',
      '② provider 层：换实现前先看 provider 层能不能满足需求',
      '③ 插件层：前两层都不够时才考虑装插件（装前先看 peer 范围是否匹配当前 DSH）',
      '④ 习惯层：给「什么时候用哪个」定一条默认路径，别每轮现场挑',
    ];
  }
  return ladderOf(row);
}

// 每个域的「去哪找」：宿主内置优先，其次 npm 搜索关键词。
const SOURCES = {
  'model-routing': { builtin: '@deepseek-ai/dsh-llm-pi-ai', search: 'provider model route 模型路由', note: '宿主自带 provider 面板，通常不需要插件。' },
  'session-persist': { builtin: '宿主内置 session 服务', search: 'session persist 会话持久化', note: '宿主内置能力，静态审计分不出是否挂载——通常不用管。' },
  'file-shell': { builtin: '@deepseek-ai/dsh-ops', search: 'shell exec 终端', note: '宿主 ops 能力已覆盖文件与 shell。' },
  'web-search': { builtin: '@deepseek-ai/dsh-web', search: 'web search crawl 搜索 抓取', note: '宿主自带 searchProvider/fetchProvider；插件层只在你需要多引擎时加。' },
  'memory-short': { builtin: '@deepseek-ai/dsh-memory', search: 'memory context 记忆 上下文', note: '多套记忆插件同时挂着是本域最常见的问题——先定主备，别急着加。' },
  'memory-long': { builtin: '（宿主无内置项目索引）', search: 'project memory index 代码索引', note: '需要跨会话记住项目结构时才考虑。' },
  'context-budget': { builtin: '@deepseek-ai/dsh-compaction-basic', search: 'compaction context 压缩 上下文', note: '宿主自带压缩策略，先把它配全（覆盖率）再说加不加插件。' },
  'image-gen': { builtin: '（宿主按 provider 配置）', search: 'image generation 文生图', note: '宿主按 provider 配置就能用，插件只是换 provider。' },
  'vision-ocr': { builtin: '（宿主按 provider 配置）', search: 'vision ocr 视觉 识图', note: '多套视觉实现会抢同一工具位——先跑 audit_trim 看谁是主力。' },
  'doc-output': { builtin: '宿主自带 office 类 skill', search: 'office docx pdf 文档', note: '宿主已覆盖，通常不需要插件。' },
  'browser': { builtin: '（宿主按需）', search: 'browser automation 浏览器 自动化', note: '浏览器自动化涉登录态，注意凭据边界。' },
  'remote-ssh': { builtin: '（宿主 remote-workspaces）', search: 'remote ssh 远程 工作区', note: '远程工作区镜像会被清理器列入「需确认」档，先知道这回事。' },
  'task-orchestration': { builtin: '@deepseek-ai/dsh-automation', search: 'automation schedule 定时 自动化', note: '宿主自带定时任务；插件只是换触发方式。' },
  'cost-visibility': { builtin: '宿主用量面板', search: 'usage cost 成本 用量', note: '记账停更多半是「没开」而不是「没装」。' },
  'security-boundary': { builtin: '@deepseek-ai/dsh-permission-presets', search: 'permission sandbox 权限 沙箱', note: '权限档位是宿主配置项，不要靠插件解决。' },
  'code-engineering': { builtin: '宿主 CLI（git/测试）', search: 'git lint format test 代码', note: '代码能力多半由宿主 CLI 提供。' },
  'long-writing': { builtin: '（宿主 skills）', search: 'longform writing pipeline 长文', note: '长文流水线是重资产，先确认真的需要。' },
  'av': { builtin: '（宿主按 provider）', search: 'tts voice video ffmpeg 语音 视频', note: '音视频通常靠 provider，不靠插件。' },
  'data-chart': { builtin: '宿主 office/图表 skill', search: 'table chart data 表格 图表', note: '表格与图表多由宿主 skill 覆盖。' },
  'theme-a11y': { builtin: '@deepseek-ai/dsh-client-ui-theme', search: 'theme palette sidebar 主题 侧栏', note: '主题与侧栏插件容易装重——本域的「多实现」通常就是问题本身。' },
};

/**
 * 产出推荐源文档。
 * @param facts 采集到的事实（用于标注每个域在本机的实际状态）
 */
export function buildRecommend(facts) {
  let mx = null;
  try { mx = buildMatrix(facts); } catch (e) { mx = null; }
  const domains = (mx ? mx.rows : []).map(function (r) {
    const src = SOURCES[r.key] || { builtin: '（未知）', search: '', note: '' };
    return {
      key: r.key,
      label: r.label,
      // 本机状态：可能是六态之一，也可能是 unknown（静态审计看不到）。
      localState: r.status,
      localStateLabel: STATE_LABEL[r.status] || r.status,
      localDetail: r.detail || '',
      // 补救阶梯（固定四级，装插件是最后手段）
      ladder: ladderPolicy(r),
      // 候选来源：宿主内置优先；插件级只给搜索关键词，不给包名。
      sources: {
        builtin: src.builtin,
        searchKeyword: src.search,
        npmNote: '按关键词搜；装前先看它声明的 peer 范围是否匹配当前 DSH，并确认没有同名/近似名保护。',
      },
      note: src.note,
    };
  });
  return {
    schema: 'dsh-healthkit/recommend/v1',
    generatedAt: new Date().toISOString(),
    policy: {
      order: ['配置', 'provider', '插件', '习惯'],
      rule: '任何指向「装插件」的建议必须写明「为什么只用配置补不上」；写不出就不许出。',
      missingMeans: 'missing 只表示「当前看不到实现」，不代表你该装。',
      offline: '本文件由本地采集生成，不联网；候选只给去哪找，不代查 npm、不推荐具体包名。',
    },
    domains: domains,
  };
}

export function renderRecommend(doc) {
  const L = [];
  L.push('能力域推荐源 · ' + doc.domains.length + ' 个域（' + doc.policy.order.join(' → ') + '）');
  L.push('');
  for (const d of doc.domains) {
    L.push('【' + d.label + '】本机：' + d.localStateLabel + (d.localDetail ? ' — ' + d.localDetail : ''));
    L.push('  宿主内置：' + d.sources.builtin);
    d.ladder.forEach(function (l) { L.push('  ' + l); });
    if (d.sources.searchKeyword) L.push('  要找插件：搜「' + d.sources.searchKeyword + '」');
    if (d.note) L.push('  注：' + d.note);
    L.push('');
  }
  L.push(doc.policy.rule);
  L.push(doc.policy.missingMeans);
  L.push(doc.policy.offline);
  return L.join('\n');
}
