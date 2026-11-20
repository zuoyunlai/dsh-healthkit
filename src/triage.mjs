// 按症状进入诊断（2026-11-20 反哺 P5）。
//
// 用户遇到问题时的说法是「升级后工具不见了」，不是「我要跑 audit_boot」。
// 本模块只做**路由**：症状 → 该看哪几条规则、下一步跑什么命令。
// 刻意不新增判定引擎：所有结论仍来自 rules.mjs，避免两套判据漂移。

export const TRIAGE_SCHEMA = 'dsh-healthkit/triage/v1';

export const SYMPTOMS = {
  'plugin-gone': {
    label: '插件列表里还在，工具/命令却不见了',
    keywords: ['工具不见', '工具没了', '工具消失', 'tool', '命令不见', '插件没生效'],
    checks: ['R14', 'R14b', 'R23', 'R24'],
    steps: [
      '看装载日志有没有 stand-in module / newly not running（R14 / R14b）',
      '确认包有没有声明 dsh.bundle（R23：缺了宿主会静默跳过）',
      '确认 profile 的 package.json 能被解析（R24：读不出时报告本身是残缺的）',
    ],
  },
  'boot-fail': {
    label: '升级或改配置后，宿主起不来',
    keywords: ['起不来', '启动失败', '开机失败', 'boot', '黑屏', '打不开'],
    checks: ['R2c', 'R22', 'R23', 'R24'],
    steps: [
      '先跑 audit_boot：静态判断这份配置还能不能被加载（不 spawn 宿主）',
      '补丁文件解析不出（R2c）时先修语法，别继续改别的',
      'file:/link: 依赖目标不存在（R22）会让加载直接失败',
      '起来之后用 audit_checkpoint 留一份可用配置，回滚才有落点',
    ],
  },
  'not-loaded': {
    label: '装了但没生效 / 不确定是不是停了',
    keywords: ['没生效', '没加载', '停用', 'disabled', '没启用', '装了没用'],
    checks: ['R1', 'R1b', 'R2', 'R2b', 'R23'],
    steps: [
      '先分清「你主动停用」（R1b / R2b，符合预期）和「装了没启用」（R1）',
      'R1 命中时先确认是否还需要：需要就把包加回 dsh.profile.bundles，不要直接卸载',
      'R2 的 disabled 条目如果是你停用留下的记录，保留；删条目等于撤销记录',
    ],
  },
  'context-heavy': {
    label: '每轮很慢 / 上下文很吃 / token 花得多',
    keywords: ['很慢', '卡', 'token', '上下文', '压缩', 'context'],
    checks: ['R16', 'R13', 'R12'],
    steps: [
      'R16：几套记忆/上下文插件同时在注入，先定主备而不是全留',
      'R13：压缩策略覆盖率不足时长会话会先失忆',
      '静态拿不到每轮真实注入量时标 UNKNOWN，不猜数字',
    ],
  },
  disk: {
    label: '磁盘越来越大',
    keywords: ['磁盘', '占空间', '越来越大', '清理', 'disk', 'c 盘'],
    checks: ['R17', 'R18', 'R4'],
    steps: [
      '先 audit_clean 预览（默认只演不练）',
      '引擎资产判为不可回收（R18）：删了要重下，别为了腾空间动它',
      '执行走临时区 + 7 天可还原，不要手工 rm',
    ],
  },
};

function norm(s) { return String(s || '').toLowerCase(); }

export function detectSymptom(text) {
  const t = norm(text);
  if (!t) return null;
  if (SYMPTOMS[t]) return t;
  let best = null;
  let bestScore = 0;
  for (const id of Object.keys(SYMPTOMS)) {
    const s = SYMPTOMS[id];
    let score = 0;
    for (const k of s.keywords) if (t.indexOf(norm(k)) !== -1) score += 1;
    if (t.indexOf(norm(s.label)) !== -1) score += 2;
    if (score > bestScore) { bestScore = score; best = id; }
  }
  return bestScore > 0 ? best : null;
}

export function triage(result, opts) {
  const o = opts || {};
  const id = detectSymptom(o.symptom);
  const all = (result && result.findings) || [];
  if (!id) {
    return {
      schema: TRIAGE_SCHEMA, symptom: o.symptom || '', label: '', known: false,
      matched: [], steps: [],
      summary: '没认出这个症状。可用：' + Object.keys(SYMPTOMS).map(function (k) { return k + '（' + SYMPTOMS[k].label + '）'; }).join('；'),
    };
  }
  const s = SYMPTOMS[id];
  const matched = all.filter(function (f) { return s.checks.indexOf(f.ruleId) !== -1; })
    .map(function (f) { return { ruleId: f.ruleId, severity: f.severity, title: f.title, fp: f.fp, confidence: f.confidence }; });
  const lines = [];
  lines.push('症状：' + s.label);
  lines.push(matched.length
    ? '本次体检里命中 ' + matched.length + ' 条相关项：'
    : '本次体检里没有命中这个症状对应的规则（不等于没问题：静态检查看不到的项见下）。');
  matched.forEach(function (m) { lines.push('  - [' + m.severity + '] ' + m.ruleId + ' ' + m.title + (m.confidence === 'UNKNOWN' ? '（UNKNOWN，判不了）' : '')); });
  lines.push('下一步：');
  s.steps.forEach(function (x) { lines.push('  · ' + x); });
  return { schema: TRIAGE_SCHEMA, symptom: id, label: s.label, known: true, matched: matched, steps: s.steps, summary: lines.join('\n') };
}

export function renderTriage(t) { return t.summary; }
