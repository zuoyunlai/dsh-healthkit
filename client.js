/**
 * dsh-healthkit · 体检 —— Client 半边（右侧栏原生面板）
 *
 * 数据全部来自 Host 的只读接口 /dsh-healthkit-panel/api/summary，client 侧只负责画。
 * 面板要回答四个问题的顺序：总分多少 → 哪里有问题 → 为什么 → 怎么修 / 先修哪个。
 * 折叠用原生 <details>（不依赖脚本状态，展开状态由浏览器自己管）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-healthkit',
  factory(require) {
    'use strict';
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useCallback } = React;

    const TAG = '[dsh-healthkit]';
    const IMPL_ID = 'dsh-healthkit';
    const KIND = 'dsh-healthkit.health';
    const API = '/dsh-healthkit-panel/api/summary';

    const I18N = {
      zh: {
        title: '体检', refresh: '刷新', loading: '读取中…', retry: '重试', error: '面板出错：',
        readOnly: '只读', issues: '问题清单（点开看根因与修法）', plan: '修复顺序',
        advice: '优化建议', retired: '已退役', dim: '维度', at: '位置', evidence: '证据',
        measured: '测到的值', fix: '怎么修', noFix: '该规则没有固定修法，按证据自行判断',
        advisory: '建议项（不计分）', confidence: '置信度', score: '总分', band: '分档',
        open: '未解决', cleanable: '可清理', plugins: '插件数 / 基线', trend: '最新分',
        step1: '第一步', step2: '第二步', all: '全部修完', none: '没有未解决的问题',
        first: '首次', firstDay: '首日基线', capped: '解除封顶', onlyOne: '只有 1 个数据点，再跑几次才有折线',
        gainTitle: '可涨', trendTitle: '分数趋势', axisNote: '轴固定 0–10 · 近 {n} 次',
        basedOn: '以 {v} 为基准', fixTiny: '单条收益都低于 0.05 分，没有可画的横条',
        caps: '能力域', noRedundant: '没有缺口的域',
        capsHint: '四级补救阶梯用 audit_capabilities：配置 → provider → 插件 → 习惯',
        stable: '近 {n} 次稳定在 {a}–{b}，无可见波动',
        infoGroup: '其余 {n} 条 INFO（不计分，仅提示）',
        scored: '{a} 计分 / {b} 总',
        cappedBefore: '封顶前 {v}',
        over: '超 {a} 个',
        gain: '可涨 +{a}',
        fixes: '修复收益（互不叠加）',
        dimsHead: '维度分', dimsHint: '权重 {w}%',
        lowest: '最低 {a}',
        verifyTitle: '上次发现的变化，现在怎样了',
        verifyFixed: '已修好', verifyStill: '还在', verifyMuted: '被静音（不算修好）', verifyRegress: '回归（本次新冒出）',
        verifyUnverifiable: '无法复核', verifyNotApplicable: '已不适用',
        verifyHint: '开机自动核对：还是否命中、有没有把别的东西搞坏。只报告，不改配置；对象已不在检查范围时不算修好。',
        verifyNone: '没有待验清单（下次重启宿主会自动核对）。',
        timelineTitle: '最近几次的变化',
        timelineHint: '至少跑两次体检才有可比的变化（第一次是基线）。',
        timelineRow: '新增 {a} / 真修好 {b} / 被静音 {c}',
        p0Tip: '上次体检发现 {n} 个 P0（点开面板先解这些封顶项）',
        p0Chip: 'P0 {n}',
      },
      en: {
        title: 'Checkup', refresh: 'Refresh', loading: 'Loading…', retry: 'Retry', error: 'Panel error: ',
        readOnly: 'read-only', issues: 'Findings (expand for root cause)', plan: 'Fix order',
        advice: 'Suggestions', retired: 'Retired', dim: 'Dimension', at: 'Location', evidence: 'Evidence',
        measured: 'Measured', fix: 'Fix', noFix: 'No canned fix — judge from evidence',
        advisory: 'advisory', confidence: 'confidence', score: 'Score', band: 'Band',
        open: 'Open', cleanable: 'Cleanable', plugins: 'Plugins / baseline', trend: 'Latest',
        step1: 'Step 1', step2: 'Step 2', all: 'Fix everything', none: 'No open findings',
        first: 'first run', firstDay: 'first-day baseline', capped: 'uncapped', onlyOne: 'Only 1 data point — run a few more times',
        gainTitle: 'Available', trendTitle: 'Score trend', axisNote: '0–10 axis · last {n}',
        basedOn: 'baseline {v}', fixTiny: 'Every single fix is worth < 0.05 — no bars to draw',
        caps: 'Capabilities', noRedundant: 'No gaps',
        capsHint: 'Four-step ladder via audit_capabilities: config → provider → plugin → habit',
        verifyTitle: 'What changed since last time',
        verifyFixed: 'Fixed', verifyStill: 'Still there', verifyMuted: 'Muted (not fixed)', verifyRegress: 'Regressed',
        verifyUnverifiable: 'Unverifiable', verifyNotApplicable: 'Not applicable',
        verifyHint: 'Checked at boot: still hit? anything broken? Reports only, never edits; gone from the checked scope does not count as fixed.',
        verifyNone: 'No pending list (the next host restart will check).',
        timelineTitle: 'Recent changes',
        timelineHint: 'Needs at least two runs to compare (the first is the baseline).',
        timelineRow: '+{a} / fixed {b} / muted {c}',
        p0Tip: 'Last checkup found {n} P0 — open the panel to clear the score cap first',
        p0Chip: 'P0 {n}',
        stable: 'Steady at {a}–{b} over {n} runs',
        infoGroup: '{n} more INFO findings (not scored)',
        scored: '{a} scored / {b} total',
        cappedBefore: 'uncapped {v}',
        over: '{a} over limit',
        gain: '+{a} available',
        fixes: 'Fix value (not additive)',
        dimsHead: 'Dimension scores', dimsHint: 'weight {w}%',
        lowest: 'lowest {a}',
      },
    };

    const C = {
      fg: 'var(--dsw-alias-label-primary, #1f2328)',
      dim: 'var(--dsw-alias-label-secondary, #6b7280)',
      line: 'var(--dsw-alias-border, rgba(128,128,128,.28))',
      card: 'var(--dsw-alias-bg-layer-2, transparent)',
      accent: 'var(--dsw-alias-brand-primary, #2563eb)',
      ok: '#16a34a', warn: '#d97706', bad: '#dc2626', info: '#6b7280',
    };
    const SEV_COLOR = { P0: C.bad, P1: C.warn, P2: C.accent, INFO: C.info };

    // B6「主动敲门」（2026-11-17 产品修订）：
    //
    // 竞品赢在「坏的那一刻用户能看见入口」，我们原来只有右侧栏 tab——装完不打开就等于没装。
    // 但敲门不能用 /api/summary：那会跑一次全量体检（几百毫秒 + 全盘扫），而客户端每次页面
    // 加载都会问一次。所以走便宜入口 /api/badge：Host 只读账本最后一行，不跑体检、不写状态。
    // 语义也诚实——它说的是「上次体检发现的 P0」，不是「现在有 P0」。
    //
    // 一次加载只问一次：结论存在模块级 shared 里，标签与面板订阅同一份，不重复请求。
    const BADGE_API = '/dsh-healthkit-panel/api/badge';
    const shared = { badge: null, asked: false, subs: new Set() };
    function publishBadge(b) {
      shared.badge = b;
      shared.subs.forEach(function (fn) { try { fn(b); } catch (e) { /* ignore */ } });
    }
    function askBadge() {
      if (shared.asked) return;
      shared.asked = true;
      try {
        fetch(BADGE_API, { credentials: 'same-origin' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (b) { publishBadge(b); })
          .catch(function () { publishBadge({ hasRun: false, p0: 0 }); });
      } catch (e) { publishBadge({ hasRun: false, p0: 0 }); }
    }
    function useAlertP0() {
      const [p0, setP0] = useState(function () {
        return shared.badge && typeof shared.badge.p0 === 'number' ? shared.badge.p0 : 0;
      });
      useEffect(function () {
        askBadge();
        const fn = function (b) { setP0(b && typeof b.p0 === 'number' ? b.p0 : 0); };
        shared.subs.add(fn);
        if (shared.badge) fn(shared.badge);
        return function () { shared.subs.delete(fn); };
      }, []);
      return p0;
    }

    // 语言检测：只认宿主 locale 服务的真实契约。
    //
    // 2026-11-17 修：原实现调 `loc.current()` —— 运行时 `locale` 服务**没有这个方法**
    // （只有 getLocale / getSnapshot / subscribe / setLocale / addLanguage / register / bind），
    // 于是 typeof 检查永远为假、恒回退中文：切到英文宿主，侧栏标签仍是「体检」。
    // 另外回退方向也改对：DSH 的语言回退链终止于英文，所以「非中文也非英文」应回退 en 而不是 zh。
    function pickLocale(ctx) {      try {
        const loc = ctx && typeof ctx.get === 'function' ? ctx.get('locale') : null;
        if (!loc) return I18N.zh;
        let id = '';
        if (typeof loc.getLocale === 'function') {
          const snap = loc.getLocale();
          id = String((snap && snap.active) || '');
        } else if (typeof loc.getSnapshot === 'function') {
          const snap = loc.getSnapshot();
          id = String((snap && snap.active) || '');
        }
        const low = id.toLowerCase();
        if (low.indexOf('zh') === 0) return I18N.zh;
        if (low.indexOf('en') === 0) return I18N.en;
        // 第三语言（ja/es/fr/de/ru/pt…）：我们只有中英两套文案，按 DSH 的回退链落到英文。
        if (low) return I18N.en;
      } catch (e) { /* 落到底部回退 */ }
      try {
        const nav = typeof navigator !== 'undefined' ? String(navigator.language || '') : '';
        if (nav.toLowerCase().indexOf('zh') === 0) return I18N.zh;
      } catch (e) { /* ignore */ }
      return I18N.zh;
    }

    // 实时跟语言切换：宿主 locale 变更会 bump revision 并通知订阅者。
    // 原来 lang 在 apply 时就定死，用户切语言后面板不会跟着变。
    function useLang(ctx) {
      const [lang, setLang] = useState(function () { return pickLocale(ctx); });
      useEffect(function () {
        let loc = null;
        try { loc = ctx && typeof ctx.get === 'function' ? ctx.get('locale') : null; } catch (e) { loc = null; }
        if (!loc || typeof loc.subscribe !== 'function') return undefined;
        const sync = function () { setLang(pickLocale(ctx)); };
        sync();
        let off = null;
        try { off = loc.subscribe(sync); } catch (e) { off = null; }
        return function () { try { if (typeof off === 'function') off(); } catch (e) { /* ignore */ } };
      }, []);
      return lang;
    }

    // 侧栏标签 chip / 指南卡片的图标 = 仓库根 logo.svg 的同一份几何（绿色圆角底 + 白色手形）。
    // 宿主不会把 package.json 的 icon 文件塞进标签：`sidebar.right.pane.tab.title` 是唯一能画图的地方，
    // 而面板跑在 web 端、插件静态文件没有公开 URL，所以只能把路径内联进来（不能 <img src>）。
    const LOGO_VIEWBOX = '0 0 658.9 658.9';
    const LOGO_PATH = 'M437.13 104.46c-42.38,0 -81.78,19.26 -107.89,52.66 -26.12,-32.97 -65.51,-52.66 -107.9,-52.66 -76.63,0 -139.14,63.79 -139.14,142.14 0,35.11 12.84,69.36 36.39,95.48 9.85,11.99 19.69,23.98 29.54,35.54l87.77 -62.08c7.28,-5.14 17.55,-3.86 23.12,2.99l32.97 40.25 75.78 -66.36c7.28,-6.43 17.98,-5.57 23.98,1.71 6.42,7.28 5.56,17.98 -1.72,23.97l-89.05 77.93c-7.28,6.42 -18.41,5.56 -24.41,-2.14l-33.82 -41.53 -71.93 50.95c59.09,69.36 133.58,151.13 158.42,151.13 32.11,0 158.41,-148.57 210.65,-212.36 23.54,-26.54 36.82,-60.37 36.82,-95.9 0,-78.36 -62.51,-141.72 -139.58,-141.72l0 0z';

    function HealthkitIcon(props) {
      const s = props && typeof props.size === 'number' ? props.size : 16;
      const svg = h('svg', {
        width: s, height: s, viewBox: LOGO_VIEWBOX,
        className: props && props.className,
        style: { display: 'block', flex: 'none' },
        'aria-hidden': 'true', focusable: 'false',
      },
        h('rect', { width: 658.9, height: 658.9, rx: 65.98, ry: 65.98, fill: '#6EAB3B' }),
        h('path', { fill: '#FEFEFE', fillRule: 'nonzero', d: LOGO_PATH }),
      );
      // 红点是 props 驱动的，**刻意不在图标里用 hooks**：这个组件会被宿主用
      // `guide: [{ icon: HealthkitIcon }]` 拿去渲染，若宿主直接调用（而非 createElement），
      // 组件内的 hooks 会炸成 "invalid hook call"。状态一律由父组件（TitleSpan）传进来。
      if (!(props && props.alert)) return svg;
      return h('span', {
        style: { position: 'relative', display: 'inline-flex', flex: 'none' },
        title: props.title || '',
      },
        svg,
        h('span', {
          style: {
            position: 'absolute', top: -2, right: -2, width: 7, height: 7, borderRadius: '50%',
            background: C.bad, boxShadow: '0 0 0 1.5px var(--dsw-alias-bg-layer-1, #ffffff)',
          },
        }, null));
    }

    // 数值兜底：服务端算出 NaN/undefined 时不要让面板印出 "NaN"（0.8.6 实测踩过：
    // 重复挂载的旧实例算不出分，页面直接显示 NaN）。
    function num(v, digits) {
      const n = typeof v === 'number' ? v : Number(v);
      if (!isFinite(n)) return '—';
      return digits == null ? String(n) : n.toFixed(digits);
    }

    function fmt(n, digits) {
      return num(n, digits);
    }

    // 严重度徽章：零值不再满色抢视觉（P0 0 / P1 0 在健康机器上恒为 0），
    // 非零时把色相放到「竖条 + 浅底」上，文字仍用宿主保证过对比度的 C.fg
    // —— 11px 粗体不属于 WCAG 的「大字」，色相不能直接当文字色。
    function badge(text, color, zero) {
      if (zero) {
        return h('span', {
          style: {
            display: 'inline-flex', alignItems: 'center', minWidth: 40, padding: '1px 6px',
            borderRadius: 5, fontSize: 11, fontWeight: 700, textAlign: 'center',
            color: C.dim, opacity: 0.5, background: 'transparent', border: '1px solid ' + C.line,
          },
        }, text);
      }
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 5, minWidth: 40, padding: '1px 6px',
          borderRadius: 5, fontSize: 11, fontWeight: 700, textAlign: 'center',
          color: C.fg, background: color + '1f', border: '1px solid ' + color + '4d',
        },
      },
        h('span', { style: { width: 2, height: 9, borderRadius: 1, background: color, flex: 'none' } }, null),
        text);
    }

    // tone='bad' 让「已经超限」的指标自己说话（装载面 56/43 是本机最该动的事）；
    // pct 给一条限位轨道，用填充表达「满/超」，不新增高度预算。
    function metric(label, value, sub, tone, pct) {
      const bad = tone === 'bad';
      return h('div', {
        style: {
          border: '1px solid ' + (bad ? C.bad + '55' : C.line), borderRadius: 10,
          padding: '8px 10px', background: C.card, minWidth: 0,
        },
      },
        h('div', { style: { fontSize: 11, color: C.dim, marginBottom: 2 } }, label),
        h('div', {
          style: {
            fontSize: 16, fontWeight: 700, lineHeight: 1.25, color: bad ? C.bad : C.fg,
            fontVariantNumeric: 'tabular-nums',
          },
        }, value),
        typeof pct === 'number'
          ? h('div', { style: { marginTop: 5, height: 4, borderRadius: 2, background: C.line, overflow: 'hidden' } },
              h('div', {
                style: {
                  width: Math.max(2, Math.min(100, pct)) + '%', height: '100%', borderRadius: 2,
                  background: bad ? C.bad : C.accent,
                },
              }, null))
          : null,
        sub ? h('div', {
          style: {
            fontSize: 11, color: C.dim, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          },
        }, sub) : null,
      );
    }

    function mb(n) {
      if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '0 B';
      if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
      if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
      if (n >= 1024) return Math.round(n / 1024) + ' KB';
      return Math.round(n) + ' B';
    }

    // 分数趋势 = 分档带 + 细折线。
    // 为什么不再用裸折线：0–10 固定域 + 34px 高 ⇒ 1 分 = 2.95px；9.78 落在离顶 2.9px 处，
    // 9.6→9.78 只差 0.53px（亚像素）——图占 60px 却不传达信息。分档带把 y 轴变成
    // 「我在哪一档、离下一档多远」，折线只负责形态。
    // 段界与 config/rubric.json 的 bands 对齐（0/5/7/8.5/10）。
    // 阈值不在这里写死（架构审计 B6）：分档边界由 payload 的 d.bands 下发，
    // 真源只有 config/rubric.json 一处。这里只负责把「档位 → 配色」定下来。
    const BAND_PALETTE = [C.ok, C.accent, C.warn, C.bad];
    function bandSegments(bands) {
      const list = (Array.isArray(bands) && bands.length >= 2)
        ? bands.slice().sort(function (a, b) { return b.min - a.min; })
        : [{ min: 8.5, label: '良好' }, { min: 7, label: '可用' }, { min: 5, label: '需治理' }, { min: 0, label: '高风险' }];
      return list.map(function (b, i) {
        const top = i === 0 ? 10 : list[i - 1].min;
        return {
          from: b.min, to: top, label: b.label,
          range: fmt(b.min) + '–' + fmt(top),
          color: BAND_PALETTE[Math.min(i, BAND_PALETTE.length - 1)],
        };
      });
    }

    // history.jsonl 里的 at 是 UTC（toISOString 写入），直接 slice(11,16) 会让面板
    // 比本地时间早 8 小时，所以这里按浏览器本地时区重算。
    function stamp(p) {
      const raw = p && (p.at || p.day);
      if (!raw) return '';
      const t = new Date(raw);
      if (isNaN(t.getTime())) return String(raw).slice(5);
      return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    }

    function trendChart(pts, lang, bands) {
      const list = (pts || []).filter(function (p) { return typeof p.total === 'number' && isFinite(p.total); });
      if (list.length < 2) {
        return h('div', { style: { fontSize: 11, color: C.dim, marginTop: 6 } }, lang.onlyOne);
      }
      const W = 100, H = 30, PADX = 1.5;
      const x = function (i) { return PADX + (i / (list.length - 1)) * (W - 2 * PADX); };
      const y = function (v) { return H - (Math.max(0, Math.min(10, v)) / 10) * H; };
      const vals = list.map(function (p) { return p.total; });
      const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      const spread = hi - lo;

      const segments = bandSegments(bands);
      const bandRects = segments.map(function (b) {
        return h('rect', {
          key: 'b' + b.from, x: (b.from / 10) * W, y: 0,
          width: ((b.to - b.from) / 10) * W, height: H,
          fill: b.color, fillOpacity: 0.1,
        });
      });
      const ticks = [5, 7, 8.5].map(function (v) {
        return h('line', {
          key: 't' + v, x1: 0, y1: y(v), x2: W, y2: y(v),
          stroke: 'currentColor', strokeOpacity: 0.22, strokeWidth: 1,
          strokeDasharray: '2 2', vectorEffect: 'non-scaling-stroke',
        });
      });
      const lastX = x(list.length - 1);
      const marker = h('line', {
        x1: lastX, y1: 0, x2: lastX, y2: H,
        stroke: 'currentColor', strokeOpacity: 0.45, strokeWidth: 1,
        strokeDasharray: '1.5 1.5', vectorEffect: 'non-scaling-stroke',
      });
      // 折线永远画（2026-11-17 用户反馈「趋势怎么没折线了」）。
      // 上一版按「极差 < 1 分就先不画」处理，本机 9.6–9.81 恰好命中 → 图直接消失，
      // 读者只会认为功能坏了。分档带已经承担「我在哪一档」的语义，贴顶的平线不再有
      // 误导性；极差小时另加一行「稳定在 a–b」的补充说明，而不是拿说明替掉图。
      const shape = h('polyline', {
        points: list.map(function (p, i) { return x(i).toFixed(2) + ',' + y(p.total).toFixed(2); }).join(' '),
        fill: 'none', stroke: C.accent, strokeWidth: 1.6,
        strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke',
      });

      const legend = h('div', {
        style: { display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap', fontSize: 10, color: C.dim },
      },
        segments.map(function (b) {
          return h('span', { key: 'l' + b.from, style: { display: 'inline-flex', alignItems: 'center', gap: 3 } },
            h('span', {
              style: { width: 6, height: 6, borderRadius: 2, background: b.color, opacity: 0.75, flex: 'none' },
            }, null),
            b.range + ' ' + b.label);
        }),
      );

      return h('div', { style: { marginTop: 8 } },
        h('svg', {
          viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none',
          style: { width: '100%', height: 40, display: 'block', color: C.dim },
          role: 'img',
          'aria-label': '分数趋势：近 ' + list.length + ' 次，' + lo + ' 到 ' + hi + '（10 分制）',
        }, bandRects, ticks, marker, shape),
        spread < 1
          ? h('div', { style: { fontSize: 11, color: C.dim, marginTop: 3 } },
            String(lang.stable).replace('{n}', String(list.length)).replace('{a}', String(lo)).replace('{b}', String(hi)))
          : null,
        legend,
        h('div', {
          style: {
            display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.dim, marginTop: 2,
          },
        },
          h('span', null, stamp(list[0]) + ' · ' + list[0].total),
          h('span', null, '低 ' + lo + ' / 高 ' + hi + ' · ' + list.length + ' 次'),
          h('span', null, stamp(list[list.length - 1]) + ' · ' + list[list.length - 1].total)),
      );
    }

    // ---- 排版音阶 ----------------------------------------------------------
    // 原先 8 级字号（含 10.5/11.5/12.5 半像素）、4 种圆角、5/6/7/8 混用间距。
    // 现在：字号 6 级、圆角 3 级、间距落 8 栅格。
    const FS = { tiny: 10, small: 11, body: 12, label: 13, num: 16, hero: 31 };
    const RADIUS = { card: 10, nested: 8, pill: 5 };

    // 后端枚举 → 中文（en 侧原值本身就是英文，不映射）。
    const DIM_ZH = {
      security: '安全', consistency: '一致性', modelCost: '模型成本', plugins: '插件',
      reliability: '可靠性', disk: '磁盘', context: '上下文',
    };
    const STATUS_ZH = {
      present: '有', redundant: '多实现', conflicting: '冲突',
      degraded: '失效', missing: '缺失', unknown: '未知',
    };
    const CAPS_ROWS = [
      ['present', '有', C.ok], ['redundant', '多', C.accent], ['conflicting', '冲突', C.warn],
      ['degraded', '失效', C.warn], ['missing', '无', C.bad], ['unknown', '未知', C.dim],
    ];

    // 章节标题：窄栏里「一条线」比「更粗的字」省视觉预算；右侧带计数便于跳读。
    function section(title, note) {
      return h('div', {
        style: {
          display: 'flex', alignItems: 'baseline', gap: 6,
          fontSize: FS.small, fontWeight: 700, color: C.fg, letterSpacing: '.03em',
          paddingTop: 12, borderTop: '1px solid ' + C.line, margin: '18px 0 8px',
        },
      },
        h('span', null, title),
        note ? h('span', { style: { marginLeft: 'auto', fontSize: FS.tiny, fontWeight: 400, color: C.dim } }, note) : null);
    }

    function kv(label, node) {
      return h('div', { style: { margin: '6px 0' } },
        h('div', { style: { fontSize: FS.tiny, color: C.dim, fontWeight: 600 } }, label),
        h('div', { style: { fontSize: FS.body, color: C.fg, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }, node));
    }

    function findingItem(it, lang) {
      const dimLabel = DIM_ZH[it.dimension] || it.dimension || '—';
      const summary = h('summary', {
        className: 'hk-row',
        style: { cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start', listStyle: 'none' },
      },
        badge(it.severity, SEV_COLOR[it.severity] || C.dim, it.severity === 'INFO'),
        h('div', { style: { minWidth: 0, flex: 1 } },
          // 用 line-clamp 按宽度断行：slice(0,40) 会切在词中间且没有省略号。
          h('div', {
            style: {
              fontSize: FS.label, color: C.fg, lineHeight: 1.45,
              display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            },
          }, h('b', null, it.ruleId), ' ', it.title),
          h('div', { style: { fontSize: FS.small, color: C.dim, marginTop: 2 } },
            dimLabel + (it.confidence ? ' · ' + it.confidence : '')),
        ),
        h('span', { className: 'hk-chev', style: { flex: 'none', fontSize: FS.body, color: C.dim } }, '›'),
      );

      const body = [];
      body.push(kv(lang.dim + ' / ' + lang.confidence,
        dimLabel + ' · ' + (it.confidence || '—') + (it.advisory ? ' · ' + lang.advisory : '')));
      if (it.target) body.push(kv(lang.at, it.target));
      if (it.evidence && it.evidence.length) body.push(kv(lang.evidence, it.evidence.join('\n')));
      if (it.measured) body.push(kv(lang.measured, it.measured));
      body.push(kv(lang.fix, it.fixHint || lang.noFix));
      body.push(h('div', {
        style: { fontSize: FS.tiny, color: C.dim, fontFamily: 'ui-monospace,Consolas,monospace', marginTop: 4 },
      }, it.fp));

      return h('details', {
        key: it.fp,
        style: {
          border: '1px solid ' + C.line, borderRadius: RADIUS.card,
          padding: '7px 9px', marginBottom: 6, background: C.card,
        },
      }, summary, h('div', { style: { marginTop: 7, paddingTop: 7, borderTop: '1px solid ' + C.line } }, body));
    }

    // 只有最近一次请求算数（见 load 里的 abort）。
    let currentAbort = null;

    function useSummary() {
      const [state, setState] = useState({ loading: true, data: null, error: null });
      // P3-2：面板可能被卸载/重挂（keepMounted + 双 key 注册），旧请求回来会对着
      // 已卸载组件 setState。用一个模块级 AbortController 让新请求中止旧请求。
      const load = useCallback(function () {
        setState(function (s) { return { loading: true, data: s.data, error: null }; });
        try { if (currentAbort) currentAbort.abort(); } catch (e) { /* ignore */ }
        currentAbort = typeof AbortController === 'function' ? new AbortController() : null;
        const signal = currentAbort ? currentAbort.signal : undefined;
        fetch(API, { cache: 'no-store', signal })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (d) {
            setState({ loading: false, data: d, error: null });
            // 面板拿到全量数据时顺手校准 chip：即使宿主上还没有 /api/badge 路由（旧版 Host），
            // 打开过一次面板之后标签上的 P0 也会显示正确。
            if (d && typeof d.p0 === 'number') publishBadge({ hasRun: true, p0: d.p0 });
          })
          // 一次 60 秒缓存窗口里的瞬时失败，不该把「有内容的只读面板」整屏换成错误页：
          // 留着旧数据，把错误挂成顶部一条。
          .catch(function (e) {
            setState(function (s) {
              return { loading: false, data: s.data, error: (e && e.message) || String(e) };
            });
          });
      }, []);
      useEffect(function () { load(); }, [load]);
      return { state, load };
    }

    // 内联样式表达不了 :focus-visible / [open] 过渡，注入一份作用域样式。
    // 面板对两个 key 各注册一次（keepMounted），所以注入必须按 id 幂等。
    function usePanelStyle() {
      useEffect(function () {
        if (typeof document === 'undefined') return;
        const id = 'hk-panel-style';
        if (document.getElementById(id)) return;
        const el = document.createElement('style');
        el.id = id;
        el.textContent = [
          'summary.hk-row::-webkit-details-marker{display:none}',
          'summary.hk-row .hk-chev{transition:transform .12s ease;display:inline-block}',
          'details[open]>summary.hk-row .hk-chev{transform:rotate(90deg)}',
          'summary.hk-row:focus-visible,button:focus-visible,a:focus-visible{',
          'outline:2px solid var(--dsw-alias-brand-primary,#2563eb);outline-offset:2px;border-radius:6px}',
        ].join('');
        document.head.appendChild(el);
      }, []);
    }

    // 分数用分档色：>24px 属于 WCAG 大字（阈值 3:1），色相在这里是合法的，
    // 而在 11px 正文里不合法（见文档 docs/REVIEW-PANEL-2026-11-16.md §D1）。
    function bandColor(score, bands) {
      if (!isFinite(score)) return C.dim;
      const segs = bandSegments(bands);
      for (let i = 0; i < segs.length; i++) if (score >= segs[i].from) return segs[i].color;
      return C.bad;
    }

    // 英雄卡：面板最重要的一件事得有压倒性的地位（原先是 17px，和「47.6 MB」同级）。
    function heroCard(d, lang, sevRow, gap, bands) {
      const color = bandColor(typeof d.score === 'number' ? d.score : NaN, bands);
      return h('div', {
        style: {
          border: '1px solid ' + C.line, borderRadius: RADIUS.card,
          background: C.card, padding: '12px 13px',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
          h('span', { style: { fontSize: FS.small, color: C.dim } }, lang.score),
          h('span', {
            style: {
              marginLeft: 'auto', fontSize: FS.small, fontWeight: 700, color,
              background: color + '1f', border: '1px solid ' + color + '4d',
              borderRadius: RADIUS.pill, padding: '1px 8px',
            },
          }, d.band || '—')),
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 4, marginTop: 2 } },
          h('span', {
            style: {
              fontSize: FS.hero, fontWeight: 700, lineHeight: 1.1, color,
              fontVariantNumeric: 'tabular-nums',
            },
          }, fmt(d.score, 2)),
          h('span', { style: { fontSize: FS.body, color: C.dim } }, '/ 10'),
          gap > 0.05
            ? h('span', { style: { marginLeft: 4, fontSize: FS.tiny, color: C.dim } },
              String(lang.cappedBefore).replace('{v}', fmt(d.raw, 2)))
            : null),
        sevRow,
        h('div', {
          style: {
            display: 'flex', gap: 10, marginTop: 8, paddingTop: 6,
            borderTop: '1px solid ' + C.line, fontSize: FS.tiny, color: C.dim,
          },
        },
          h('span', null, lang.open + ' ' + fmt(d.count)),
          h('span', null, lang.retired + ' ' + fmt(d.retired)),
          h('span', { style: { marginLeft: 'auto' } }, fmt(d.trend.runs) + ' 次记账')),
      );
    }

    function Panel(props) {
      const lang = props.lang || I18N.zh;
      const { state, load } = useSummary();
      usePanelStyle();
      const d = state.data;

      const refreshBtn = h('button', {
        type: 'button', disabled: state.loading, onClick: function () { load(); },
        style: {
          display: 'inline-flex', alignItems: 'center', height: 26, padding: '0 9px',
          borderRadius: RADIUS.nested, border: '1px solid ' + C.line, background: C.card,
          color: C.accent, fontSize: FS.small, fontFamily: 'inherit',
          cursor: state.loading ? 'default' : 'pointer', opacity: state.loading ? 0.6 : 1,
        },
      }, state.loading ? lang.loading : lang.refresh);

      const header = h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
        h(HealthkitIcon, { size: 18 }),
        h('div', { style: { fontSize: FS.label, fontWeight: 700, color: C.fg } }, lang.title),
        h('div', { style: { flex: 1 } }),
        refreshBtn,
      );

      if (!d) {
        return h('div', { style: { padding: '12px 14px' } }, header,
          state.error
            ? h('div', { style: { fontSize: FS.body, color: C.bad } }, lang.error + state.error)
            : h('div', { style: { fontSize: FS.body, color: C.dim } }, lang.loading));
      }

      const delta = typeof d.trend.delta === 'number' ? d.trend.delta : null;
      const runs = typeof d.trend.runs === 'number' ? d.trend.runs : null;
      // delta 是按「天」折叠算的：一天里跑 43 次时 delta 恒为 null，
      // 印「首次」就是对着第 43 次体检说首次。按 runs 分档才对。
      const trendSub = delta !== null
        ? (delta >= 0 ? '+' : '') + delta + ' vs 上一日'
        : (runs && runs > 1 ? lang.firstDay : lang.first);

      const items = Array.isArray(d.items) ? d.items : [];
      const isScored = function (x) { return x.severity !== 'INFO' && x.advisory !== true; };
      const scoredItems = items.filter(isScored);
      const infoItems = items.filter(function (x) { return !isScored(x); });

      const sevRow = h('div', { style: { display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' } },
        badge('P0 ' + fmt(d.p0), SEV_COLOR.P0, !d.p0),
        badge('P1 ' + fmt(d.p1), SEV_COLOR.P1, !d.p1),
        badge('P2 ' + fmt(d.p2), SEV_COLOR.P2, !d.p2),
        badge('INFO ' + fmt(d.info), SEV_COLOR.INFO, false),
        h('span', { style: { alignSelf: 'center', marginLeft: 2, fontSize: FS.tiny, color: C.dim } },
          String(lang.scored).replace('{a}', String(scoredItems.length)).replace('{b}', String(items.length))));

      // 封顶差额：raw 一直在 payload 里，只是从没被画过。差 > 0.05 才算数。
      const gap = (typeof d.raw === 'number' && typeof d.score === 'number' && isFinite(d.raw) && isFinite(d.score))
        ? Math.round((d.raw - d.score) * 100) / 100
        : 0;

      const served = d.trim ? d.trim.served : null;
      const maxBundles = d.trim ? d.trim.maxBundles : null;
      const trimOver = (typeof served === 'number' && typeof maxBundles === 'number') ? served - maxBundles : 0;
      const trimPct = (typeof served === 'number' && maxBundles) ? (served / maxBundles) * 100 : null;
      const gain = (d.plan && typeof d.plan.potentialAll === 'number' && typeof d.score === 'number' && isFinite(d.score))
        ? Math.round((d.plan.potentialAll - d.score) * 100) / 100
        : null;

      // 5 张卡进 2 列会留一个空洞；改成 2×2，补上「可涨」（修完能到几分）。
      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 } },
        metric(lang.cleanable, d.clean ? mb(d.clean.bytes) : '—',
          d.clean
            ? (d.clean.groups.length + ' 组' + (d.clean.notCleanable && d.clean.notCleanable.length
              ? ' · 另 ' + d.clean.notCleanable.length + ' 个大目录不在清理档'
              : ''))
            : null),
        metric(lang.plugins,
          served == null ? '—' : fmt(served) + ' / ' + fmt(maxBundles),
          served == null ? null : (trimOver > 0 ? String(lang.over).replace('{a}', String(trimOver)) : '未超基线'),
          trimOver > 0 ? 'bad' : null,
          trimPct),
        metric(lang.trend, d.trend.latest == null ? '—' : fmt(d.trend.latest, 2), trendSub),
        metric(lang.gainTitle, gain == null ? '—' : '+' + fmt(gain, 2),
          d.plan && d.plan.potentialAll != null ? lang.all + ' → ' + fmt(d.plan.potentialAll, 2) : null),
      );

      const trendCard = h('div', {
        style: {
          border: '1px solid ' + C.line, borderRadius: RADIUS.card,
          background: C.card, padding: '8px 10px', marginTop: 8,
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, fontSize: FS.small, color: C.dim } },
          h('span', { style: { fontWeight: 700, color: C.fg } }, lang.trendTitle),
          h('span', { style: { marginLeft: 'auto', fontSize: FS.tiny } },
            lang.axisNote.replace('{n}', fmt((d.trend.recent || []).length)))),
        trendChart(d.trend.recent, lang, d.bands));

      // 维度横条：默认折叠——健康态 7 条都在 9.5–10，条形几乎等长；
      // 只有「有维度 < 9 分或存在 dimensionCaps」时才自动展开。
      const dims = Array.isArray(d.dims) ? d.dims : [];
      const dimsNeed = dims.filter(function (x) {
        return (typeof x.score === 'number' && x.score < 9) || x.cappedBy;
      });
      const dimsBlock = dims.length
        ? h('details', {
          open: dimsNeed.length > 0,
          style: {
            border: '1px solid ' + C.line, borderRadius: RADIUS.card,
            background: C.card, padding: '7px 9px', marginTop: 8,
          },
        },
          h('summary', { style: { cursor: 'pointer', fontSize: FS.small, color: C.dim } },
            dimsNeed.length
              ? String(lang.lowest).replace('{a}',
                (DIM_ZH[dimsNeed[0].key] || dimsNeed[0].key) + ' ' + fmt(dimsNeed[0].score, 2))
              : String(lang.dimsHead) + '（' + dims.length + ' 维均 ≥ 9.0）'),
          h('div', { style: { marginTop: 6 } },
            dims.map(function (x) {
              const pct = Math.max(2, Math.min(100, (Number(x.score) || 0) / 10 * 100));
              const tone = bandColor(x.score, d.bands);
              return h('div', {
                key: x.key, title: x.label,
                style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 },
              },
                h('span', { style: { flex: 'none', width: 52, fontSize: FS.small, color: C.fg } },
                  DIM_ZH[x.key] || x.key),
                h('span', { style: { flex: 'none', width: 26, fontSize: FS.tiny, color: C.dim } },
                  fmt(x.weight) + '%'),
                h('span', {
                  style: { flex: 1, minWidth: 0, height: 8, borderRadius: 4, background: C.line, overflow: 'hidden' },
                },
                  h('span', {
                    style: { display: 'block', width: pct + '%', height: '100%', borderRadius: 4, background: tone },
                  }, null)),
                h('span', {
                  style: {
                    flex: 'none', width: 30, textAlign: 'right', fontSize: FS.small,
                    color: C.fg, fontVariantNumeric: 'tabular-nums',
                  },
                }, fmt(x.score, 2)));
            })))
        : null;

      const issues = scoredItems.length
        ? scoredItems.map(function (it) { return findingItem(it, lang); })
        : h('div', { style: { fontSize: FS.body, color: C.dim } }, lang.none);

      // 14/17 条是 INFO（不计分）。它们不该占着主视线，但一条也不能少。
      const infoBlock = infoItems.length
        ? h('details', {
          style: {
            border: '1px dashed ' + C.line, borderRadius: RADIUS.card,
            padding: '7px 9px', marginTop: 8,
          },
        },
          h('summary', { style: { cursor: 'pointer', fontSize: FS.small, color: C.dim } },
            String(lang.infoGroup).replace('{n}', String(infoItems.length))),
          h('div', { style: { marginTop: 6 } },
            infoItems.map(function (it) { return findingItem(it, lang); })))
        : null;

      const planHead = [];
      if (d.plan && d.plan.stage1) {
        planHead.push(h('div', { key: 'p1', style: { fontSize: FS.body, color: C.fg, marginBottom: 4 } },
          h('b', null, lang.step1 + '｜' + fmt(d.plan.stage1.count) + ' 条 P0'),
          '：' + fmt(d.plan.stage1.from, 2) + ' → ' + fmt(d.plan.stage1.to, 2) +
          '（' + (d.plan.stage1.delta > 0 ? '+' : '') + fmt(d.plan.stage1.delta, 2) +
          (d.plan.capped ? '，' + lang.capped : '') + '）'));
      } else {
        planHead.push(h('div', { key: 'p0', style: { fontSize: FS.body, color: C.dim, marginBottom: 4 } },
          h('b', { style: { color: C.fg } }, lang.step1), '：P0 = 0，无需解封顶'));
      }

      const rows = (d.plan && d.plan.rows) || [];
      const maxDelta = rows.length ? Math.max.apply(null, rows.map(function (r) { return Number(r.delta) || 0; })) : 0;
      // 边际收益不叠加：Σ单条 ≠ potentialAll − base，标题必须写明。
      const planBars = rows.length && maxDelta >= 0.05
        ? h('div', null,
            h('div', { style: { fontSize: FS.tiny, color: C.dim, marginBottom: 4 } },
              (d.plan.base != null ? lang.basedOn.replace('{v}', fmt(d.plan.base, 2)) + ' · ' : '') + lang.fixes),
            rows.map(function (r, i) {
              const pct = Math.max(4, Math.min(100, (Number(r.delta) || 0) / maxDelta * 100));
              return h('div', {
                key: 'r' + i, title: String(r.title || ''),
                style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 5 },
              },
                h('span', { style: { flex: 'none', fontSize: FS.small, color: C.fg, fontWeight: 700 } }, String(r.ruleId || '—')),
                h('span', {
                  style: {
                    flex: 1, minWidth: 0, height: 8, borderRadius: 4,
                    background: C.line, overflow: 'hidden',
                  },
                },
                  h('span', {
                    style: {
                      display: 'block', width: pct + '%', height: '100%',
                      borderRadius: 4, background: SEV_COLOR[r.severity] || C.accent,
                    },
                  }, null)),
                h('span', {
                  style: {
                    flex: 'none', width: 38, textAlign: 'right', fontSize: FS.small,
                    color: C.fg, fontVariantNumeric: 'tabular-nums',
                  },
                }, (Number(r.delta) > 0 ? '+' : '') + fmt(r.delta, 2)));
            }))
        : h('div', { style: { fontSize: FS.body, color: C.dim } }, lang.fixTiny);

      const planBlock = h('div', null,
        planHead,
        planBars,
        h('div', { style: { marginTop: 6, fontSize: FS.body, color: C.fg } },
          h('b', null, lang.all + ' → ' + fmt(d.plan && d.plan.potentialAll, 2) + ' / 10')));

      const adviceNodes = [];
      if (d.trim && d.trim.suggestions) {
        d.trim.suggestions.forEach(function (s, i) {
          adviceNodes.push(h('li', { key: 't' + i, style: { fontSize: FS.body, margin: '3px 0' } }, s));
        });
      }
      if (d.clean && d.clean.groups && d.clean.groups.length) {
        adviceNodes.push(h('li', { key: 'c', style: { fontSize: FS.body, margin: '3px 0' } },
          '可清理 ' + mb(d.clean.bytes) + '：' +
          d.clean.groups.map(function (g) { return g.label + ' ' + mb(g.bytes); }).join('、') +
          '（先预览，执行移入回收区 7 天可还原）'));
      }
      if (!adviceNodes.length) adviceNodes.push(h('li', { key: 'n', style: { fontSize: FS.body, color: C.dim } }, '—'));

      const capsNode = d.capabilities
        ? h('div', null,
            section(lang.caps, fmt(d.capabilities.rows ? d.capabilities.rows.length : 0) + ' 个域有缺口'),
            // 20 个域的状态是「构成占比」，用彩底药丸扫一眼就知道缺口在哪，
            // 比原来那句长长的「8 有 / 4 多 / 1 冲突 / 2 失效 / 1 无」好读。
            h('div', { style: { display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 6 } },
              CAPS_ROWS.map(function (row) {
                return badge(row[1] + ' ' + fmt(d.capabilities[row[0]]), row[2], !d.capabilities[row[0]]);
              })),
            h('div', null,
              (d.capabilities.rows && d.capabilities.rows.length
                ? d.capabilities.rows.map(function (x, i) {
                  return h('div', { key: 'r' + i, style: { fontSize: FS.body, margin: '3px 0' } },
                    h('b', null, x.label), ' · ' + (STATUS_ZH[x.status] || x.status) + '：' + x.detail);
                })
                : h('div', { style: { fontSize: FS.body, color: C.dim } }, lang.noRedundant))),
            h('div', { style: { fontSize: FS.tiny, color: C.dim, marginTop: 4 } }, lang.capsHint))
        : null;

      // ① 跨重启验回：修好了没 / 还在 / 被静音（不算修好）/ 回归。
      // 四个状态分开列——分数上升可能来自「被静音」而非「真修好」。
      const vf = d.verify || { hasPending: false };
      const vRows = [];
      (vf.fixed || []).forEach(function (x, i) {
        vRows.push(h('div', { key: 'fx' + i, style: { fontSize: FS.body, margin: '3px 0', color: C.fg } },
          h('b', { style: { color: C.ok } }, '✓ ' + lang.verifyFixed + ' '), x.ruleId + ' ', x.title));
      });
      (vf.stillThere || []).forEach(function (x, i) {
        vRows.push(h('div', { key: 'st' + i, style: { fontSize: FS.body, margin: '3px 0', color: C.fg } },
          h('b', null, '· ' + lang.verifyStill + ' '), x.ruleId + ' ', x.title));
      });
      (vf.muted || []).forEach(function (x, i) {
        vRows.push(h('div', { key: 'mu' + i, style: { fontSize: FS.body, margin: '3px 0', color: C.warn } },
          h('b', null, '~ ' + lang.verifyMuted + ' '), x.ruleId));
      });
      // 2026-11-20：不出现有两种「不是修好」的原因，必须分开显示。
      (vf.unverifiable || []).forEach(function (x, i) {
        vRows.push(h('div', { key: 'uv' + i, style: { fontSize: FS.body, margin: '3px 0', color: C.warn } },
          h('b', null, '? ' + lang.verifyUnverifiable + ' '), x.ruleId + ' ', x.title));
      });
      (vf.notApplicable || []).forEach(function (x, i) {
        vRows.push(h('div', { key: 'na' + i, style: { fontSize: FS.body, margin: '3px 0', color: C.dim } },
          h('b', null, '– ' + lang.verifyNotApplicable + ' '), x.ruleId + ' ', x.title));
      });
      (vf.regressions || []).forEach(function (x, i) {
        vRows.push(h('div', { key: 'rg' + i, style: { fontSize: FS.body, margin: '3px 0', color: C.bad } },
          h('b', null, '! ' + lang.verifyRegress + ' '), x.ruleId + ' ', x.title));
      });
      const verifyNode = h('div', null,
        section(lang.verifyTitle),
        vRows.length
          ? h('div', null, vRows)
          : h('div', { style: { fontSize: FS.body, color: C.dim } }, lang.verifyNone),
        h('div', { style: { fontSize: FS.tiny, color: C.dim, marginTop: 4 } }, lang.verifyHint));

      // ③ 跨次时间线：每次体检相对上次的「新增 / 真修好 / 被静音」。
      const tl = d.timeline || [];
      const timelineNode = h('div', null,
        section(lang.timelineTitle),
        tl.length
          ? h('div', null, tl.slice().reverse().map(function (t, i) {
              return h('div', { key: 't' + i, style: { fontSize: FS.body, margin: '3px 0', color: C.fg } },
                stamp({ at: t.at }) + ' · ' + fmt(t.score, 2) +
                ' · ' + String(lang.timelineRow).replace('{a}', String(t.added)).replace('{b}', String(t.fixed)).replace('{c}', String(t.muted)));
            }))
          : h('div', { style: { fontSize: FS.body, color: C.dim } }, lang.timelineHint));

      // 产品指标（只在算得出来时给数，算不出来就明说，不编）
      const prod = d.product || null;
      const prodLines = [];
      if (prod && prod.secondRun) {
        const sr = prod.secondRun;
        prodLines.push(sr.returnedAfter7d === true
          ? '第二次运行：是（有效 ' + fmt(sr.effectiveRuns) + ' 次 / ' + fmt(sr.distinctDays) + ' 天，跨 ' + fmt(sr.spanDays) + ' 天）'
          : '第二次运行：算不出来 —— ' + (sr.reason || '样本不足'));
      }
      if (prod && prod.adoption) {
        const ad = prod.adoption;
        prodLines.push(typeof ad.rate === 'number'
          ? '结论采纳率：' + fmt(ad.rate) + '%（真修好 ' + fmt(ad.fixed) + ' / 还在 ' + fmt(ad.stillThere) + (ad.muted ? '；静音 ' + fmt(ad.muted) + ' 不算采纳' : '') + '）'
          : '结论采纳率：算不出来 —— ' + (ad.note || '无数据'));
      }
      if (prod && prod.falsePositive) {
        const fpv = prod.falsePositive;
        prodLines.push(typeof fpv.rate === 'number'
          ? '误报率：' + fmt(fpv.rate) + '%（已退役 ' + fmt(fpv.retired) + ' / 发现 ' + fmt(fpv.findings) + '）'
          : '误报率：只知已退役 ' + fmt(fpv.retired) + ' 条');
      }
      const productNode = prodLines.length
        ? h('details', {
          style: {
            border: '1px solid ' + C.line, borderRadius: RADIUS.card,
            background: C.card, padding: '7px 9px', marginTop: 8,
          },
        },
          h('summary', { style: { cursor: 'pointer', fontSize: FS.small, color: C.dim } }, '产品指标（本地，不外发）'),
          h('div', { style: { marginTop: 6 } }, prodLines.map(function (t, i) {
            return h('div', { key: 'p' + i, style: { fontSize: FS.small, color: C.fg, marginTop: 3 } }, t);
          })))
        : null;

      const retiredNode = d.retiredList && d.retiredList.length
        ? h('details', {
          style: {
            border: '1px solid ' + C.line, borderRadius: RADIUS.card,
            padding: '7px 9px', marginTop: 8,
          },
        },
          h('summary', { style: { cursor: 'pointer', fontSize: FS.body, color: C.dim } },
            lang.retired + ' ' + fmt(d.retiredList.length)),
          h('div', { style: { marginTop: 6 } }, d.retiredList.map(function (x, i) {
            return h('div', { key: i, style: { fontSize: FS.small, color: C.dim, marginTop: 3 } },
              x.ruleId + ' · ' + x.title);
          })))
        : null;

      const errorBar = state.error
        ? h('div', {
          style: {
            fontSize: FS.small, color: C.bad, border: '1px solid ' + C.bad + '55',
            background: C.bad + '14', borderRadius: RADIUS.nested, padding: '5px 8px', marginBottom: 8,
          },
        }, lang.error + state.error)
        : null;

      return h('div', {
        style: {
          padding: '12px 14px', overflowY: 'auto', height: '100%',
          boxSizing: 'border-box', color: C.fg, lineHeight: 1.5,
        },
      },
        header,
        errorBar,
        heroCard(d, lang, sevRow, gap, d.bands),
        h('div', { style: { fontSize: FS.body, color: C.fg, marginTop: 8 } }, d.headline || ''),
        h('div', { style: { fontSize: FS.tiny, color: C.dim, marginTop: 2 } }, '更新 ' + stamp({ at: d.at })),
        grid,
        trendCard,
        dimsBlock,
        section(lang.issues, String(lang.scored).replace('{a}', String(scoredItems.length)).replace('{b}', String(items.length))),
        issues,
        infoBlock,
        section(lang.plan),
        planBlock,
        section(lang.advice),
        h('ul', { style: { margin: 0, paddingLeft: 16 } }, adviceNodes),
        capsNode,
        verifyNode,
        timelineNode,
        productNode,
        retiredNode,
        h('div', { style: { fontSize: FS.tiny, color: C.dim, marginTop: 12 } }, lang.readOnly + ' · 数据缓存 60 秒'),
      );
    }

    function TitleSpan(props) {
      const lang = props.lang || I18N.zh;
      // B6：标签上带 P0 chip —— 面板没打开也能看见「上次体检有封顶项」。
      const p0 = useAlertP0();
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h(HealthkitIcon, { size: 16, alert: p0 > 0, title: String(lang.p0Tip).replace('{n}', String(p0)) }),
        h('span', { style: { fontSize: 12 } }, lang.title),
        p0 > 0
          ? h('span', {
            title: String(lang.p0Tip).replace('{n}', String(p0)),
            style: {
              fontSize: 10, fontWeight: 700, lineHeight: '14px', padding: '0 4px', borderRadius: 7,
              color: '#fff', background: C.bad, fontVariantNumeric: 'tabular-nums', flex: 'none',
            },
          }, String(lang.p0Chip).replace('{n}', String(p0)))
          : null);
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'locale'],
      apply(ctx) {
        const Body = function () { return h(Panel, { lang: useLang(ctx) }); };
        const TabTitle = function () { return h(TitleSpan, { lang: useLang(ctx) }); };
        try { console.info(TAG, 'client loaded'); } catch (e) { /* ignore */ }

        ctx.effect(function () {
          return ctx.inject(['sidebarRightTabs', 'sidebarRight'], function (injected) {
            const tabs = injected.get('sidebarRightTabs');
            if (!tabs || typeof tabs.register !== 'function') {
              try { console.warn(TAG, 'sidebarRightTabs 不可用，面板不挂载'); } catch (e) { /* ignore */ }
              return;
            }
            const disposers = [];
            // P0（0.13.1，DSH 0.2.2-rc.5 暴露）：原来这里写 `return lang.title`，而
            // `lang` 在 apply() 作用域里**根本不存在**（它只在组件里由 useLang 造出来）。
            // 从 0.5.3 起这行一直是错的，但旧宿主要么不调用 title()、要么把异常吞了，
            // 所以一直是潜伏 bug。rc.5 的引导页会在渲染侧栏时逐个调 title() →
            // 一次 ReferenceError 就把整个「引导页 + 标签条」渲染炸掉，表现为**右栏整块空**，
            // 连别的插件的标签一起消失。
            //
            // 两条修正：
            //   ① 用非 Hook 的 pickLocale(ctx)（title 是纯函数调用，不能跑 hooks）；
            //   ② 再包一层 try：**任何 title 异常都不许冒到宿主**——一个插件不该有能力
            //      让用户的整个侧栏变空。
            const titleText = function () {
              try {
                const dict = pickLocale(ctx) || I18N.zh;
                return String(dict.title || I18N.zh.title);
              } catch (e) {
                return I18N.zh.title;
              }
            };
            try {
              disposers.push(tabs.register({
                id: IMPL_ID, kind: KIND, keepMounted: true, priority: 'extension',
                title: titleText,
                guide: [{ id: KIND, order: 70, title: titleText, icon: HealthkitIcon }],
              }));
            } catch (e) {
              try { console.warn(TAG, '注册 tab 类型失败：', (e && e.message) || e); } catch (e2) { /* ignore */ }
              return;
            }
            for (const key of [IMPL_ID, KIND]) {
              try {
                disposers.push(ctx.slots.inject('sidebar.right.pane.tab', function () {
                  return ctx.slots.register({ name: 'sidebar.right.pane.tab', key }, Body);
                }));
                disposers.push(ctx.slots.inject('sidebar.right.pane.tab.title', function () {
                  return ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key }, TabTitle);
                }));
              } catch (e) {
                try { console.warn(TAG, '注册面板槽失败（key=' + key + '）：', (e && e.message) || e); } catch (e2) { /* ignore */ }
              }
            }
            return function () {
              for (const dispose of disposers) {
                try { if (typeof dispose === 'function') dispose(); } catch (e) { /* ignore */ }
              }
            };
          });
        });
      },
    };
  },
});
