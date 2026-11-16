// 能力域矩阵：把「现在有什么能力、缺什么、缺了怎么补」摊开。
//
// 依据 PLAN-2026-11-16.md §4：
//   · 判定单位是**能力域**（20 个），不是插件名——插件会改名、下架，能力不会。
//   · **六种状态**：present / missing / redundant / degraded / conflicting / unknown。
//     「冗余与冲突同样是缺口」：装了 5 套记忆插件、或者抓取能力被两个实现同时接管，
//     都是缺口，不是「有就万事大吉」。
//   · **补救阶梯固定四级**：配置 → provider → 插件 → 习惯。
//   · **硬规则**：任何指向「装插件」的建议必须写明「为什么只用配置补不上」。
//     写不出这句就不许出这条建议（见 assertPluginAdvice）。
//
// 只读：全部判据来自静态证据；取不到证据时给 unknown，不猜用户需不需要。
import fs from 'node:fs';
import path from 'node:path';

export const STATES = ['present', 'missing', 'redundant', 'degraded', 'conflicting', 'unknown'];

export const STATE_LABEL = {
  present: '有实现',
  missing: '无实现',
  redundant: '多实现',
  degraded: '有实现但失效',
  conflicting: '实现互相冲突',
  unknown: '无法判定',
};

// ---------------------------------------------------------------- 判据采集

// 从 patch 条目的 config 里抠出各域需要的信号。
// patchEntries 已在 collect 阶段采好（含 config），这里不再读盘。
export function deriveSignals(facts) {
  const sig = {
    fetchProviders: [], searchProviders: [], takeovers: [],
    modelProviders: [], modelPolicies: [], compactionAuto: null,
    memoryPlugins: [], memoryLayers: [], permission: null,
    blockedDomains: [], allowedUrlHosts: [], automationBundles: [],
    profiles: [],
  };
  const profiles = (facts && facts.profiles) || [];
  sig.profiles = profiles.map((p) => p.name);

  for (const p of profiles) {
    const entries = (facts && facts.patchEntries && facts.patchEntries[p.name]) || [];
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const c = e.config || {};
      const name = e.name || e.id;
      if (c.fetchProvider) sig.fetchProviders.push({ profile: p.name, id: e.id, name, provider: c.fetchProvider });
      if (c.searchProvider) sig.searchProviders.push({ profile: p.name, id: e.id, name, provider: c.searchProvider });
      if (c.fetchProviderTakeover === true) sig.takeovers.push({ profile: p.name, id: e.id, name, provider: c.fetchProvider || null });
      if (c.providers && typeof c.providers === 'object') {
        sig.modelProviders.push({ profile: p.name, id: e.id, name, list: Object.keys(c.providers) });
      }
      if (Array.isArray(c.modelPolicies)) {
        for (const m of c.modelPolicies) {
          sig.modelPolicies.push({ profile: p.name, provider: m.provider || null, model: m.model || null });
        }
      }
      if (typeof c.auto === 'boolean') sig.compactionAuto = c.auto;
      if (c.memoryTopology && c.memoryTopology.layers) {
        for (const layer of Object.keys(c.memoryTopology.layers)) {
          sig.memoryLayers.push({ profile: p.name, id: e.id, name, layer });
        }
      }
      if (c.defaultPreset || c.presets) {
        sig.permission = {
          profile: p.name,
          defaultPreset: c.defaultPreset || null,
          presets: Object.keys(c.presets || {}),
        };
      }
      if (Array.isArray(c.blockedDomains)) sig.blockedDomains = sig.blockedDomains.concat(c.blockedDomains);
      if (Array.isArray(c.allowedUrlHosts)) sig.allowedUrlHosts = sig.allowedUrlHosts.concat(c.allowedUrlHosts);
    }
    (p.thirdPartyBundles || []).forEach((b) => {
      if (/(automation|schedule|cron)/i.test(b)) sig.automationBundles.push({ profile: p.name, name: b });
    });
    (p.bundles || []).forEach((b) => {
      if (/(memory|chronicle|mnemon|openviking)/i.test(b)) {
        if (!sig.memoryPlugins.some((x) => x.name === b)) sig.memoryPlugins.push({ profile: p.name, name: b });
      }
    });
  }
  return sig;
}

// ---------------------------------------------------------------- 域定义

// re 同时匹配 bundle 名与描述。宁窄勿宽：把「插件市场」误判成「搜索实现」比少报更糟。
const THIRD_RE = {
  search: /(free-search|web search|web-search|search engine|搜索引擎|crawl|scrap)/i,
  browser: /(browser|ego)/i,
  image: /(image-gen|image generation|image gen|文生图)/i,
  vision: /(vision|modlens|ocr|看图|视觉)/i,
  doc: /(office|docx|xlsx|pptx|pdf)/i,
  memory: /(memory|chronicle|mnemon|openviking|recall|记忆)/i,
  remote: /(remote|ssh)/i,
  task: /(automation|schedule|cron|定时)/i,
  theme: /(theme|palette|color|appearance|主题)/i,
  panel: /(sidebar|panel|rightbar|tab)/i,
  market: /(market|awesome|registry|插件市场)/i,
  code: /(git|test|formatter|lint|repo)/i,
  writing: /(lunheng|article|writing|长文|pipeline)/i,
  av: /(tts|voice|speech|audio|video|ffmpeg|语音|视频)/i,
  data: /(table|xlsx|csv|dataframe|chart|plot|visuali|图谱|报表)/i,
  shell: /(shell|bash|niubash|exec|终端)/i,
  persist: /(session|persist|storage|会话.*持久)/i,
};

// 20 个域，与 PLAN §4.1 一一对应。
const DOMAINS = [
  { key: 'model-routing', label: '模型路由', detect: 'modelRouting' },
  { key: 'session-persist', label: '会话持久化', detect: 'sessionPersist' },
  { key: 'file-shell', label: '文件与 shell', detect: 'fileShell' },
  { key: 'web-search', label: '检索（web）', detect: 'webSearch' },
  { key: 'memory-short', label: '记忆（短期）', detect: 'memoryShort' },
  { key: 'memory-long', label: '记忆（长期/项目）', detect: 'memoryLong' },
  { key: 'context-budget', label: '上下文预算', detect: 'contextBudget' },
  { key: 'image-gen', label: '图像生成', detect: 'imageGen' },
  { key: 'vision-ocr', label: '视觉理解 / OCR', detect: 'visionOcr' },
  { key: 'doc-output', label: '文档产出', detect: 'docOutput' },
  { key: 'browser', label: '浏览器自动化', detect: 'browser' },
  { key: 'remote-ssh', label: '远程 / SSH', detect: 'remoteSsh' },
  { key: 'task-orchestration', label: '任务编排', detect: 'taskOrchestration' },
  { key: 'cost-visibility', label: '成本可见性', detect: 'costVisibility' },
  { key: 'security-boundary', label: '安全边界', detect: 'securityBoundary' },
  { key: 'code-engineering', label: '代码工程', detect: 'codeEngineering' },
  { key: 'long-writing', label: '长文写作', detect: 'longWriting' },
  { key: 'av', label: '音视频', detect: 'av' },
  { key: 'data-chart', label: '数据与图表', detect: 'dataChart' },
  { key: 'theme-a11y', label: '主题与可用性', detect: 'themeA11y' },
];

function thirdPartyOf(facts) {
  const out = [];
  for (const p of ((facts && facts.profiles) || [])) {
    for (const b of p.thirdPartyBundles || []) {
      if (!out.some((x) => x.name === b)) out.push({ name: b, profile: p.name });
    }
  }
  return out;
}

function hits(facts, re) {
  return thirdPartyOf(facts).filter((x) => re.test(x.name));
}

// ---------------------------------------------------------------- 判定器
// 每个判定器返回 { status, detail, evidence, extra }

const DETECT = {
  modelRouting(facts, sig) {
    const declared = sig.modelProviders.reduce((n, x) => n + x.list.length, 0);
    const covered = {};
    for (const m of sig.modelPolicies) if (m.provider) covered[m.provider] = true;
    const coveredCount = Object.keys(covered).length;
    if (!declared) return { status: 'unknown', detail: '未读到模型 provider 配置', evidence: [] };
    if (coveredCount >= 1 && coveredCount < declared) {
      return {
        status: 'degraded',
        detail: '声明 ' + declared + ' 个 provider，只有 ' + coveredCount + ' 个有压缩策略（模型目录与可路由面不一致）',
        evidence: sig.modelProviders.map((x) => x.id),
        extra: { declared, covered: coveredCount },
      };
    }
    return { status: 'present', detail: declared + ' 个 provider，' + coveredCount + ' 个有策略', evidence: [] };
  },
  sessionPersist(facts, sig) {
    const h = hits(facts, THIRD_RE.persist);
    if (h.length) return { status: 'present', detail: h.map((x) => x.name).join('、'), evidence: [] };
    return { status: 'unknown', detail: '会话持久化由宿主内置承担，静态审计分不出是否挂载', evidence: [] };
  },
  fileShell(facts, sig) {
    const h = hits(facts, THIRD_RE.shell);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [] };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [] };
    return { status: 'unknown', detail: 'shell 由宿主 ops 能力提供，插件层看不到', evidence: [] };
  },
  webSearch(facts, sig) {
    // 冲突判据：接管型实现与宿主 provider 并存 ⇒ 两个实现抢同一工具位。
    if (sig.takeovers.length && sig.fetchProviders.length) {
      const t = sig.takeovers[0];
      const host = sig.fetchProviders.filter((x) => x.id !== t.id)[0];
      return {
        status: 'conflicting',
        detail: '抓取能力被两个实现同时接管：' + t.name + '（fetchProviderTakeover=true）' +
          (host ? ' 与 ' + host.name + '（fetchProvider=' + host.provider + '）' : ''),
        evidence: sig.takeovers.map((x) => x.id),
        extra: { takeovers: sig.takeovers, providers: sig.fetchProviders },
      };
    }
    const h = hits(facts, THIRD_RE.search);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [] };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [] };
    return { status: 'missing', detail: '没有搜索/抓取实现', evidence: [] };
  },
  memoryShort(facts, sig) {
    const h = hits(facts, THIRD_RE.memory);
    const n = Math.max(h.length, sig.memoryPlugins.length);
    if (n >= 3) return { status: 'redundant', detail: n + ' 套记忆实现同时挂着，每轮都可能注入', evidence: [], extra: { count: n } };
    if (n === 1) return { status: 'present', detail: h[0] ? h[0].name : sig.memoryPlugins[0].name, evidence: [] };
    if (n === 0) return { status: 'missing', detail: '没有记忆实现', evidence: [] };
    return { status: 'present', detail: n + ' 套记忆实现', evidence: [] };
  },
  memoryLong(facts, sig) {
    const long = sig.memoryPlugins.filter((x) => /(project|index|recall|openviking|mnemon)/i.test(x.name));
    if (long.length >= 3) return { status: 'redundant', detail: long.map((x) => x.name).join('、'), evidence: [] };
    if (long.length === 1) return { status: 'present', detail: long[0].name, evidence: [], plugins: [long[0].name] };
    if (long.length === 0) return { status: 'missing', detail: '没有项目级索引 / recall 工具', evidence: [] };
    return { status: 'present', detail: long.map((x) => x.name).join('、'), evidence: [] };
  },
  contextBudget(facts, sig) {
    if (sig.compactionAuto === null) {
      return { status: 'unknown', detail: '未读到 compaction 配置', evidence: [] };
    }
    const n = sig.modelPolicies.length;
    if (n === 0) return { status: 'degraded', detail: '压缩策略 0 条', evidence: [] };
    return { status: 'present', detail: '压缩策略 ' + n + ' 条（auto=' + sig.compactionAuto + '）', evidence: [] };
  },
  imageGen(facts, sig) {
    const h = hits(facts, THIRD_RE.image);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [], plugins: h.map((x) => x.name) };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [], plugins: [h[0].name] };
    return { status: 'missing', detail: '没有图像生成实现', evidence: [] };
  },
  visionOcr(facts, sig) {
    const h = hits(facts, THIRD_RE.vision);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [], plugins: h.map((x) => x.name) };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [], plugins: [h[0].name] };
    return { status: 'missing', detail: '没有视觉/OCR 实现', evidence: [] };
  },
  docOutput(facts, sig) {
    const h = hits(facts, THIRD_RE.doc);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [] };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [] };
    return { status: 'present', detail: '宿主自带 office 类 skill，插件层不需要补', evidence: [] };
  },
  browser(facts, sig) {
    const h = hits(facts, THIRD_RE.browser);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [] };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [] };
    return { status: 'missing', detail: '没有浏览器自动化实现', evidence: [] };
  },
  remoteSsh(facts, sig) {
    const h = hits(facts, THIRD_RE.remote);
    const machines = (facts && facts.machines) || [];
    if (h.length && machines.length) return { status: 'present', detail: h[0].name + '（已注册机器 ' + machines.length + ' 台）', evidence: [] };
    if (h.length) return { status: 'degraded', detail: h[0].name + ' 已装但没有可用机器注册', evidence: [] };
    return { status: 'missing', detail: '没有远程工作区实现', evidence: [] };
  },
  taskOrchestration(facts, sig) {
    const h = hits(facts, THIRD_RE.task);
    if (h.length) return { status: 'present', detail: h.map((x) => x.name).join('、'), evidence: [] };
    if (sig.automationBundles.length) return { status: 'present', detail: sig.automationBundles.map((x) => x.name).join('、'), evidence: [] };
    return { status: 'unknown', detail: '定时任务由宿主 automation 服务承担，静态审计看不到', evidence: [] };
  },
  costVisibility(facts, sig) {
    const c = (facts && facts.costTracker) || null;
    if (!c) return { status: 'degraded', detail: '未发现成本记账文件', evidence: [] };
    if (typeof c.ageDays === 'number' && c.ageDays > 3) {
      return { status: 'degraded', detail: '记账文件已停更 ' + c.ageDays + ' 天', evidence: [c.file] };
    }
    return { status: 'present', detail: '记账 ' + (c.ageDays === null ? '时间未知' : c.ageDays + ' 天前更新'), evidence: [c.file] };
  },
  securityBoundary(facts, sig) {
    if (!sig.permission) return { status: 'unknown', detail: '未读到权限预设配置', evidence: [] };
    const p = sig.permission;
    if (p.defaultPreset === 'danger-full-access') {
      return { status: 'degraded', detail: '默认档位 = danger-full-access', evidence: [] };
    }
    const blocked = sig.blockedDomains.length, allowed = sig.allowedUrlHosts.length;
    return {
      status: 'present',
      detail: '默认档位 ' + p.defaultPreset + '（预设 ' + p.presets.length + ' 个）· 域名黑名单 ' + blocked + ' / 白名单 ' + allowed,
      evidence: [],
    };
  },
  codeEngineering(facts, sig) {
    const h = hits(facts, THIRD_RE.code);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [] };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [] };
    return { status: 'unknown', detail: 'git/测试能力由宿主与 CLI 提供，插件层分不出', evidence: [] };
  },
  longWriting(facts, sig) {
    const h = hits(facts, THIRD_RE.writing);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [] };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [] };
    return { status: 'missing', detail: '没有长文写作流水线', evidence: [] };
  },
  av(facts, sig) {
    const h = hits(facts, THIRD_RE.av);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [] };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [] };
    return { status: 'missing', detail: '没有音视频实现', evidence: [] };
  },
  dataChart(facts, sig) {
    const h = hits(facts, THIRD_RE.data);
    if (h.length >= 2) return { status: 'redundant', detail: h.map((x) => x.name).join('、'), evidence: [] };
    if (h.length === 1) return { status: 'present', detail: h[0].name, evidence: [] };
    return { status: 'unknown', detail: '表格/图表能力可能由宿主 skill 提供，静态审计分不出', evidence: [] };
  },
  themeA11y(facts, sig) {
    const h = hits(facts, THIRD_RE.theme);
    const p = hits(facts, THIRD_RE.panel);
    const all = h.concat(p);
    if (all.length >= 3) return { status: 'redundant', detail: all.map((x) => x.name).join('、'), evidence: [] };
    if (all.length) return { status: 'present', detail: all.map((x) => x.name).join('、'), evidence: [] };
    return { status: 'missing', detail: '没有主题/布局插件', evidence: [] };
  },
};

export function buildMatrix(facts) {
  const sig = deriveSignals(facts);
  const rows = DOMAINS.map(function (d) {
    const r = DETECT[d.detect](facts, sig);
    return {
      key: d.key,
      label: d.label,
      status: r.status,
      detail: r.detail || '',
      evidence: r.evidence || [],
      extra: r.extra || null,
      // 相关实现名：面板与工具展示用。没有就空数组（不猜）。
      plugins: r.plugins || [],
    };
  });
  const byStatus = {};
  for (const s of STATES) byStatus[s] = 0;
  rows.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  return { rows, byStatus, signals: sig };
}

// ---------------------------------------------------------------- 补救阶梯

// 「为什么只用配置补不上」——硬规则：写不出这句，就不许出「装插件」这条建议。
export function assertPluginAdvice(row, advice) {
  if (!/装插件|按关键词搜/.test(advice)) return true;
  // 「为什么配置补不上」可以写成「配置补不上」「配置层补不上」「配置层无法」等；
  // 允许配置与补不上之间插最多 3 个字，避免文案微调就判违规。
  return /配置.{0,3}补不上|配置.{0,3}无法|配置已足够|配置不是问题/.test(advice);
}

export function ladderOf(row) {
  const L = [];
  const gap = row.status;
  if (gap === 'present') {
    return ['已有一个实现：保持现状即可；要换实现时再评估'];
  }
  if (gap === 'redundant') {
    L.push('① 配置层：确认这几条是不是都真的在用（cordis.patch.yml 里有 disabled / enabled 的可以关掉不用的）');
    L.push('② provider 层：若其中有 @deepseek-ai/* 的，优先留内置那条，第三方作为补充');
    L.push('③ 插件层：先别装。多实现本身不是问题，抢同一工具位才是——跑 audit_trim 看谁是主力');
    L.push('④ 习惯层：给「什么时候用哪个」定一条默认路径，别每轮都靠现场挑');
    return L;
  }
  if (gap === 'conflicting') {
    L.push('① 配置层：两个实现同时生效通常是一个配置没收干净——先看能不能只留一个（这是最省事的一步）');
    L.push('② provider 层：确认宿主 provider 与插件 provider 谁是当前唯一入口');
    L.push('③ 插件层：配置层收不干净、provider 层也定不下唯一入口时才考虑卸掉其中一个（卸载不可逆，先跑 audit_trim 看代价）');
    L.push('④ 习惯层：明确「抓取走宿主还是走插件」，避免两套结果混着信');
    return L;
  }
  if (gap === 'degraded') {
    L.push('① 配置层：装了但失效通常是配置过期（凭据/路径/策略没跟上）——先查配置');
    L.push('② provider 层：补凭据、换路由，让它重新可用');
    L.push('③ 插件层：配置层与 provider 层都试过仍失效，才考虑换实现（此时才轮到装插件）');
    L.push('④ 习惯层：给失效能力定一个兜底路径（比如记账停了先用别处记）');
    return L;
  }
  if (gap === 'unknown') {
    L.push('① 配置层：静态审计取不到证据，请到设置页或用对应工具人工确认');
    L.push('② provider 层：确认宿主是否已内置这项能力');
    L.push('③ 插件层：静态审计看不到证据，不足以断言缺失；先人工确认，确实没有再考虑装插件——先跑 --capabilities 看完整矩阵');
    L.push('④ 习惯层：这项能力不一定需要，缺了未必是问题');
    return L;
  }
  // missing
  L.push('① 配置层：先确认是不是已经装了但没启用（profile 的 package.json / cordis.patch.yml）');
  L.push('② provider 层：看 @deepseek-ai/* 里有没有现成的，装了不用额外插件');
  L.push('③ 插件层：配置层与 provider 层都排查过仍无实现（这正是本状态的前提），才考虑装插件——按关键词搜；装前先看它声明的 peer 版本是否匹配当前 DSH');
  L.push('④ 习惯层：没有这项能力也能活，先确认它对你是不是真需求');
  return L;
}

export function renderMatrix(m) {
  const L = [];
  const s = m.byStatus;
  L.push('能力域 ' + m.rows.length + ' 个：' +
    '有实现 ' + s.present + ' / 多实现 ' + s.redundant + ' / 冲突 ' + s.conflicting +
    ' / 失效 ' + s.degraded + ' / 无实现 ' + s.missing + ' / 无法判定 ' + s.unknown);
  L.push('');
  const order = ['conflicting', 'degraded', 'redundant', 'missing', 'unknown', 'present'];
  const titles = {
    conflicting: '互相冲突（最该看：两个实现抢同一位置）',
    degraded: '有实现但失效（装了不顶用）',
    redundant: '多实现（占工具位）',
    missing: '无实现（未必需要，先看阶梯）',
    unknown: '无法判定（静态审计看不到）',
    present: '有实现',
  };
  for (const k of order) {
    const list = m.rows.filter((r) => r.status === k);
    if (!list.length) continue;
    L.push('【' + titles[k] + '】');
    for (const r of list) {
      L.push('  · ' + r.label + '（' + STATE_LABEL[r.status] + '）：' + r.detail);
      if (r.status !== 'present') {
        for (const line of ladderOf(r)) {
          if (!assertPluginAdvice(r, line)) {
            L.push('    [阶梯违规] ' + line);
            continue;
          }
          L.push('    ' + line);
        }
      }
    }
    L.push('');
  }
  L.push('说明：missing / unknown 只表示「当前看不到实现」，不代表你该装。阶梯刻意把配置与宿主内置排在装插件前面。');
  return L.join('\n');
}
