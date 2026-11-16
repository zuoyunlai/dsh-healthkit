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
        open: '未解决', cleanable: '可清理', plugins: '插件 / 上限', trend: '最新分',
        step1: '第一步', step2: '第二步', all: '全部修完', none: '没有未解决的问题',
        first: '首次', capped: '解除封顶', onlyOne: '只有 1 个数据点，再跑几次才有折线',
        caps: '能力域', noRedundant: '没有缺口的域',
        capsHint: '四级补救阶梯用 audit_capabilities：配置 → provider → 插件 → 习惯',
      },
      en: {
        title: 'Checkup', refresh: 'Refresh', loading: 'Loading…', retry: 'Retry', error: 'Panel error: ',
        readOnly: 'read-only', issues: 'Findings (expand for root cause)', plan: 'Fix order',
        advice: 'Suggestions', retired: 'Retired', dim: 'Dimension', at: 'Location', evidence: 'Evidence',
        measured: 'Measured', fix: 'Fix', noFix: 'No canned fix — judge from evidence',
        advisory: 'advisory', confidence: 'confidence', score: 'Score', band: 'Band',
        open: 'Open', cleanable: 'Cleanable', plugins: 'Plugins / limit', trend: 'Latest',
        step1: 'Step 1', step2: 'Step 2', all: 'Fix everything', none: 'No open findings',
        first: 'first run', capped: 'uncapped', onlyOne: 'Only 1 data point — run a few more times',
        caps: 'Capabilities', noRedundant: 'No gaps',
        capsHint: 'Four-step ladder via audit_capabilities: config → provider → plugin → habit',
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

    function pickLocale(ctx) {
      try {
        const loc = ctx && typeof ctx.get === 'function' ? ctx.get('locale') : null;
        const cur = loc && typeof loc.current === 'function' ? String(loc.current() || '') : '';
        return cur.toLowerCase().indexOf('en') === 0 ? I18N.en : I18N.zh;
      } catch (e) { return I18N.zh; }
    }

    function icon(size) {
      const s = size || 16;
      return h('svg', {
        width: s, height: s, viewBox: '0 0 24 24', fill: 'none',
        stroke: C.accent, strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d: 'M3 12h4l2 6 4-14 2 8h6' }));
    }

    function badge(text, color) {
      return h('span', {
        style: {
          display: 'inline-block', minWidth: 40, padding: '1px 6px', borderRadius: 5,
          fontSize: 11, fontWeight: 700, textAlign: 'center', color, background: color + '22',
        },
      }, text);
    }

    function metric(label, value, sub) {
      return h('div', {
        style: { border: '1px solid ' + C.line, borderRadius: 10, padding: '8px 10px', background: C.card, minWidth: 0 },
      },
        h('div', { style: { fontSize: 11, color: C.dim, marginBottom: 2 } }, label),
        h('div', { style: { fontSize: 17, fontWeight: 700, color: C.fg, lineHeight: 1.25 } }, value),
        sub ? h('div', { style: { fontSize: 11, color: C.dim, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis' } }, sub) : null,
      );
    }

    function mb(n) {
      if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '0 B';
      if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
      return (n / 1048576).toFixed(1) + ' MB';
    }

    // SVG 折线：y 轴固定 0–10（不按 min/max 自适应，否则 8.3→8.4 会被画成陡坡）。
    // 用「按次」数据而不是按天折叠：改完配置当天再跑一次就能看见变化。
    function trendChart(pts, lang) {
      const list = (pts || []).filter(function (p) { return typeof p.total === 'number'; });
      if (list.length < 2) {
        return h('div', { style: { fontSize: 11, color: C.dim, marginTop: 6 } }, lang.onlyOne);
      }
      const W = 100, H = 30, PAD = 2;
      const x = function (i) { return PAD + (i / (list.length - 1)) * (W - 2 * PAD); };
      const y = function (v) { return H - PAD - (Math.max(0, Math.min(10, v)) / 10) * (H - 2 * PAD); };
      const points = list.map(function (p, i) { return x(i).toFixed(2) + ',' + y(p.total).toFixed(2); }).join(' ');
      const ref = function (v) {
        return h('line', {
          key: 'r' + v, x1: PAD, y1: y(v), x2: W - PAD, y2: y(v),
          stroke: 'currentColor', strokeOpacity: 0.18, strokeWidth: 0.4,
          strokeDasharray: '2 2', vectorEffect: 'non-scaling-stroke',
        });
      };
      const stamp = function (p) { return String(p.at || p.day || '').slice(11, 16) || String(p.day || '').slice(5); };
      const vals = list.map(function (p) { return p.total; });
      const lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
      return h('div', { style: { marginTop: 8 } },
        h('svg', {
          viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none',
          style: { width: '100%', height: 34, display: 'block', color: C.dim },
        },
          ref(10), ref(8), ref(5),
          h('polyline', {
            points: points, fill: 'none', stroke: C.accent, strokeWidth: 1.4,
            strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke',
          })),
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.dim } },
          h('span', null, stamp(list[0]) + ' · ' + list[0].total),
          h('span', null, '低 ' + lo + ' / 高 ' + hi + ' · ' + list.length + ' 次'),
          h('span', null, stamp(list[list.length - 1]) + ' · ' + list[list.length - 1].total)),
      );
    }

    function section(title) {
      return h('div', { style: { fontSize: 11, fontWeight: 700, color: C.dim, margin: '14px 0 6px', letterSpacing: '.02em' } }, title);
    }

    function kv(label, node) {
      return h('div', { style: { margin: '6px 0' } },
        h('div', { style: { fontSize: 10, color: C.dim, fontWeight: 600 } }, label),
        h('div', { style: { fontSize: 12, color: C.fg, whiteSpace: 'pre-wrap', wordBreak: 'break-all' } }, node));
    }

    function findingItem(it, lang) {
      const summary = h('summary', {
        style: { cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'flex-start', listStyle: 'none' },
      },
        badge(it.severity, SEV_COLOR[it.severity] || C.dim),
        h('div', { style: { minWidth: 0, flex: 1 } },
          h('div', { style: { fontSize: 12.5, color: C.fg, lineHeight: 1.45 } },
            h('b', null, it.ruleId), ' ', it.title),
          h('div', { style: { fontSize: 11, color: C.dim, marginTop: 2 } },
            (it.dimension || '') + (it.fixHint ? ' · ' + String(it.fixHint).slice(0, 40) : '')),
        ),
      );

      const body = [];
      body.push(kv(lang.dim + ' / ' + lang.confidence,
        (it.dimension || '—') + ' · ' + it.confidence + (it.advisory ? ' · ' + lang.advisory : '')));
      if (it.target) body.push(kv(lang.at, it.target));
      if (it.evidence && it.evidence.length) body.push(kv(lang.evidence, it.evidence.join('\n')));
      if (it.measured) body.push(kv(lang.measured, it.measured));
      body.push(kv(lang.fix, it.fixHint || lang.noFix));
      body.push(h('div', { style: { fontSize: 10, color: C.dim, fontFamily: 'ui-monospace,Consolas,monospace', marginTop: 4 } }, it.fp));

      return h('details', {
        key: it.fp,
        style: { border: '1px solid ' + C.line, borderRadius: 9, padding: '7px 9px', marginBottom: 7, background: C.card },
      }, summary, h('div', { style: { marginTop: 7, paddingTop: 7, borderTop: '1px solid ' + C.line } }, body));
    }

    function useSummary() {
      const [state, setState] = useState({ loading: true, data: null, error: null });
      const load = useCallback(function () {
        setState(function (s) { return { loading: true, data: s.data, error: null }; });
        fetch(API, { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (d) { setState({ loading: false, data: d, error: null }); })
          .catch(function (e) { setState({ loading: false, data: null, error: (e && e.message) || String(e) }); });
      }, []);
      useEffect(function () { load(); }, [load]);
      return { state, load };
    }

    function Panel(props) {
      const lang = props.lang || I18N.zh;
      const { state, load } = useSummary();
      const d = state.data;

      const header = h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
        icon(18),
        h('div', { style: { fontSize: 13, fontWeight: 700, color: C.fg } }, lang.title),
        h('div', { style: { flex: 1 } }),
        h('a', {
          href: '#', onClick: function (e) { e.preventDefault(); load(); },
          style: { fontSize: 12, color: C.accent, textDecoration: 'none' },
        }, lang.refresh),
      );

      if (state.loading && !d) return h('div', { style: { padding: 14, color: C.dim, fontSize: 12 } }, header, lang.loading);
      if (state.error) {
        return h('div', { style: { padding: 14 } }, header,
          h('div', { style: { fontSize: 12, color: C.bad, marginBottom: 8 } }, lang.error + state.error),
          h('a', { href: '#', onClick: function (e) { e.preventDefault(); load(); }, style: { fontSize: 12, color: C.accent } }, lang.retry));
      }
      if (!d) return h('div', { style: { padding: 14, color: C.dim, fontSize: 12 } }, header, lang.loading);

      const delta = typeof d.trend.delta === 'number' ? d.trend.delta : null;
      const trend = d.trend.latest + (delta === null ? '（' + lang.first + '）' : (delta >= 0 ? ' (+' + delta + ')' : ' (' + delta + ')'));

      const sevRow = h('div', { style: { display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' } },
        badge('P0 ' + d.p0, SEV_COLOR.P0), badge('P1 ' + d.p1, SEV_COLOR.P1),
        badge('P2 ' + d.p2, SEV_COLOR.P2), badge('INFO ' + d.info, SEV_COLOR.INFO));

      const grid = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 } },
        metric(lang.score, String(d.score), d.band),
        metric(lang.open + ' / ' + lang.retired, d.count + ' / ' + d.retired, null),
        metric(lang.cleanable, d.clean ? mb(d.clean.bytes) : '—', d.clean ? d.clean.groups.length + ' 组' : null),
        metric(lang.plugins, d.trim ? d.trim.served + ' / ' + d.trim.maxBundles : '—', d.trim ? d.trim.groups.length + ' 组冗余' : null),
        metric(lang.trend, trend, d.trend.runs + ' 次 / ' + d.trend.daysTracked + ' 天 ' + (d.trend.sparkline || '')),
      );

      const issues = (d.items && d.items.length)
        ? d.items.map(function (it) { return findingItem(it, lang); })
        : h('div', { style: { fontSize: 12, color: C.dim } }, lang.none);

      const planNodes = [];
      if (d.plan && d.plan.stage1) {
        planNodes.push(h('li', { key: 's1', style: { fontSize: 12, margin: '3px 0' } },
          h('b', null, lang.step1 + '｜' + d.plan.stage1.count + ' 条 P0'),
          '：' + d.plan.stage1.from + ' → ' + d.plan.stage1.to + '（' + (d.plan.stage1.delta > 0 ? '+' : '') + d.plan.stage1.delta + (d.plan.capped ? '，' + lang.capped : '') + '）',
        ));
      } else {
        planNodes.push(h('li', { key: 's1', style: { fontSize: 12, margin: '3px 0' } }, h('b', null, lang.step1), '：P0 = 0，无需解封顶'));
      }
      if (d.plan && d.plan.rows && d.plan.rows.length) {
        planNodes.push(h('li', { key: 's2', style: { fontSize: 12, margin: '3px 0' } },
          h('b', null, lang.step2 + '｜' + d.plan.base + ' 为基准'),
          h('div', null, d.plan.rows.map(function (r, i) {
            return h('div', { key: i, style: { fontSize: 11.5, color: C.fg, marginTop: 2 } },
              (r.delta > 0 ? '+' : '') + r.delta + ' · ' + r.ruleId + ' ' + String(r.title || '').slice(0, 46));
          })),
        ));
      }
      planNodes.push(h('li', { key: 'all', style: { fontSize: 12, margin: '3px 0' } },
        h('b', null, lang.all + ' → ' + (d.plan ? d.plan.potentialAll : d.score) + ' / 10')));

      const adviceNodes = [];
      if (d.trim && d.trim.suggestions) {
        d.trim.suggestions.forEach(function (s, i) {
          adviceNodes.push(h('li', { key: 't' + i, style: { fontSize: 12, margin: '3px 0' } }, s));
        });
      }
      if (d.clean && d.clean.groups && d.clean.groups.length) {
        adviceNodes.push(h('li', { key: 'c', style: { fontSize: 12, margin: '3px 0' } },
          '可清理 ' + mb(d.clean.bytes) + '：' + d.clean.groups.map(function (g) { return g.label + ' ' + mb(g.bytes); }).join('、') + '（先预览，执行移入回收区 7 天可还原）'));
      }
      if (!adviceNodes.length) adviceNodes.push(h('li', { key: 'n', style: { fontSize: 12, color: C.dim } }, '—'));

      const capsNode = d.capabilities
        ? h('div', null,
            section(lang.caps + '（' + d.capabilities.present + ' 有 / ' + d.capabilities.redundant + ' 多 / ' +
              d.capabilities.conflicting + ' 冲突 / ' + d.capabilities.degraded + ' 失效 / ' + d.capabilities.missing + ' 无）'),
            h('ul', { style: { margin: 0, paddingLeft: 18 } },
              (d.capabilities.rows && d.capabilities.rows.length
                ? d.capabilities.rows.map(function (x, i) {
                    return h('li', { key: 'r' + i, style: { fontSize: 12, margin: '3px 0' } },
                      h('b', null, x.label), ' · ' + x.status + '：' + x.detail);
                  })
                : [h('li', { key: 'none', style: { fontSize: 12, color: C.dim } }, lang.noRedundant)])),
            h('div', { style: { fontSize: 10.5, color: C.dim, marginTop: 4 } }, lang.capsHint))
        : null;

      const retiredNode = d.retiredList && d.retiredList.length
        ? h('details', { style: { border: '1px solid ' + C.line, borderRadius: 9, padding: '7px 9px', marginTop: 8 } },
            h('summary', { style: { cursor: 'pointer', fontSize: 12, color: C.dim } }, lang.retired + ' ' + d.retiredList.length),
            h('div', { style: { marginTop: 6 } }, d.retiredList.map(function (x, i) {
              return h('div', { key: i, style: { fontSize: 11, color: C.dim, marginTop: 3 } }, x.ruleId + ' · ' + x.title);
            })))
        : null;

      return h('div', { style: { padding: '10px 12px', overflowY: 'auto', height: '100%', boxSizing: 'border-box', color: C.fg } },
        header,
        h('div', { style: { fontSize: 11, color: C.dim, marginBottom: 8 } },
          String(d.headline || '') + ' · ' + String(d.at || '').replace('T', ' ').slice(0, 19)),
        grid,
        sevRow,
        trendChart(d.trend.recent, lang),
        section(lang.issues),
        issues,
        section(lang.plan),
        h('ol', { style: { margin: 0, paddingLeft: 18 } }, planNodes),
        section(lang.advice),
        h('ul', { style: { margin: 0, paddingLeft: 18 } }, adviceNodes),
        capsNode,
        retiredNode,
        h('div', { style: { fontSize: 10.5, color: C.dim, marginTop: 12 } }, lang.readOnly + ' · 数据缓存 60 秒'),
      );
    }

    function TitleSpan(props) {
      const lang = props.lang || I18N.zh;
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        icon(16), h('span', { style: { fontSize: 12 } }, lang.title));
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'locale'],
      apply(ctx) {
        let lang = I18N.zh;
        try { lang = pickLocale(ctx); } catch (e) { /* 退回中文 */ }
        const Body = function () { return h(Panel, { lang }); };
        const TabTitle = function () { return h(TitleSpan, { lang }); };
        try { console.info(TAG, 'client loaded'); } catch (e) { /* ignore */ }

        ctx.effect(function () {
          return ctx.inject(['sidebarRightTabs', 'sidebarRight'], function (injected) {
            const tabs = injected.get('sidebarRightTabs');
            if (!tabs || typeof tabs.register !== 'function') {
              try { console.warn(TAG, 'sidebarRightTabs 不可用，面板不挂载'); } catch (e) { /* ignore */ }
              return;
            }
            const disposers = [];
            try {
              disposers.push(tabs.register({
                id: IMPL_ID, kind: KIND, keepMounted: true, priority: 'extension',
                title: function () { return lang.title; },
                guide: [{ id: KIND, order: 70, title: function () { return lang.title; }, icon: icon }],
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
