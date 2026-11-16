/**
 * dsh-healthkit · 体检 —— Client 半边（右侧栏原生面板）
 *
 * 为什么要有这一半：Host 半边注册的 /dsh-healthkit-panel 是**独立网页**，只能放在
 * 侧边栏的 iframe 浏览器里打开；而那个 iframe 不给脚本执行权，早先版本全靠 JS
 * 渲染，于是整页空白（系统浏览器能看、侧边栏看不到）。改成原生面板后：
 *   · 直接长在侧边栏里，不占端口、不用记地址、不用担心 iframe 沙箱；
 *   · 数据仍走 Host 的只读 JSON API，面板本身不做任何计算。
 *
 * 形态照 dsh-chronicle 的 client 半边：window.__ModuleLoader__ + 手写 createElement
 * （没有 JSX、没有构建步骤，改完重启即可生效）。
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
        title: '体检', score: '总分', band: '分档', open: '未解决', retired: '已退役',
        clean: '可清理', trim: '服务插件 / 上限', trend: '最新分 / 记账',
        top: '先看这些（按严重度）', refresh: '刷新', loading: '读取中…',
        retry: '重试', empty: '没有未解决的问题', error: '面板出错：',
        readOnly: '只读 · 不写配置 · 不联网',
      },
      en: {
        title: 'Checkup', score: 'Score', band: 'Band', open: 'Open', retired: 'Retired',
        clean: 'Cleanable', trim: 'Plugins / limit', trend: 'Latest / log',
        top: 'Top findings', refresh: 'Refresh', loading: 'Loading…',
        retry: 'Retry', empty: 'No open findings', error: 'Panel error: ',
        readOnly: 'read-only',
      },
    };

    // 宿主主题令牌（取不到就退回中性色，深浅主题都不至于看不见）
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
      },
        h('path', { d: 'M3 12h4l2 6 4-14 2 8h6' }),
      );
    }

    function badge(text, color) {
      return h('span', {
        style: {
          display: 'inline-block', minWidth: 40, padding: '1px 6px', borderRadius: 5,
          fontSize: 11, fontWeight: 700, textAlign: 'center',
          color, background: color + '22',
        },
      }, text);
    }

    function metric(label, value, sub) {
      return h('div', {
        style: {
          border: '1px solid ' + C.line, borderRadius: 10, padding: '8px 10px',
          background: C.card, minWidth: 0,
        },
      },
        h('div', { style: { fontSize: 11, color: C.dim, marginBottom: 2 } }, label),
        h('div', { style: { fontSize: 18, fontWeight: 700, color: C.fg, lineHeight: 1.25 } }, value),
        sub ? h('div', { style: { fontSize: 11, color: C.dim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, sub) : null,
      );
    }

    function mb(n) {
      if (typeof n !== 'number' || !isFinite(n) || n <= 0) return '0 B';
      if (n >= 1073741824) return (n / 1073741824).toFixed(1) + ' GB';
      return (n / 1048576).toFixed(1) + ' MB';
    }

    function useSummary(lang) {
      const [state, setState] = useState({ loading: true, data: null, error: null });
      const load = useCallback(() => {
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
      const { state, load } = useSummary(lang);
      const d = state.data;

      const header = h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 },
      },
        icon(18),
        h('div', { style: { fontSize: 13, fontWeight: 700, color: C.fg } }, lang.title),
        h('div', { style: { flex: 1 } }),
        h('a', {
          href: '#', onClick: function (e) { e.preventDefault(); load(); },
          style: { fontSize: 12, color: C.accent, textDecoration: 'none' },
        }, lang.refresh),
      );

      if (state.loading && !d) {
        return h('div', { style: { padding: 14, color: C.dim, fontSize: 12 } }, header, lang.loading);
      }
      if (state.error) {
        return h('div', { style: { padding: 14 } },
          header,
          h('div', { style: { fontSize: 12, color: C.bad, marginBottom: 8 } }, lang.error + state.error),
          h('a', { href: '#', onClick: function (e) { e.preventDefault(); load(); }, style: { fontSize: 12, color: C.accent } }, lang.retry),
        );
      }
      if (!d) return h('div', { style: { padding: 14, color: C.dim, fontSize: 12 } }, header, lang.loading);

      const delta = typeof d.trend.delta === 'number' ? d.trend.delta : null;
      const trend = d.trend.latest + (delta === null ? '（首次）' : (delta >= 0 ? ' (+' + delta + ')' : ' (' + delta + ')'));

      const sevRow = h('div', { style: { display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' } },
        badge('P0 ' + d.p0, SEV_COLOR.P0),
        badge('P1 ' + d.p1, SEV_COLOR.P1),
        badge('P2 ' + d.p2, SEV_COLOR.P2),
        badge('INFO ' + d.info, SEV_COLOR.INFO),
      );

      const grid = h('div', {
        style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 },
      },
        metric(lang.score, String(d.score), d.band),
        metric(lang.open + ' / ' + lang.retired, d.findings + ' / ' + d.retired, null),
        metric(lang.clean, d.clean ? mb(d.clean.bytes) : '—', d.clean ? d.clean.candidates + ' 组' : null),
        metric(lang.trim, d.trim ? d.trim.served + ' / ' + d.trim.maxBundles : '—', d.trim ? d.trim.groups + ' 组冗余' : null),
        metric(lang.trend, trend, d.trend.runs + ' 次 / ' + d.trend.daysTracked + ' 天 ' + (d.trend.sparkline || '')),
      );

      const items = (d.top || []).length
        ? d.top.map(function (x, i) {
            return h('div', {
              key: i,
              style: { display: 'flex', gap: 8, padding: '7px 0', alignItems: 'flex-start', borderBottom: i === d.top.length - 1 ? 'none' : '1px solid ' + C.line },
            },
              badge(x.severity, SEV_COLOR[x.severity] || C.dim),
              h('div', { style: { minWidth: 0 } },
                h('div', { style: { fontSize: 12, color: C.fg, lineHeight: 1.4 } },
                  h('b', null, x.ruleId), ' ', x.title),
                x.fixHint ? h('div', { style: { fontSize: 11, color: C.dim, marginTop: 2 } }, x.fixHint) : null,
                h('div', { style: { fontSize: 10, color: C.dim, marginTop: 2, fontFamily: 'ui-monospace,Consolas,monospace' } }, x.fp),
              ),
            );
          })
        : h('div', { style: { fontSize: 12, color: C.dim } }, lang.empty);

      return h('div', { style: { padding: '10px 12px', overflowY: 'auto', height: '100%', boxSizing: 'border-box', color: C.fg } },
        header,
        h('div', { style: { fontSize: 11, color: C.dim, marginBottom: 8 } },
          lang.readOnly + ' · ' + String(d.at || '').replace('T', ' ').slice(0, 19)),
        grid,
        sevRow,
        h('div', { style: { marginTop: 12, fontSize: 11, fontWeight: 700, color: C.dim } }, lang.top),
        h('div', { style: { marginTop: 2 } }, items),
      );
    }

    function TitleSpan(props) {
      const lang = props.lang || I18N.zh;
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        icon(16),
        h('span', { style: { fontSize: 12 } }, lang.title));
    }

    return {
      inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'locale'],
      apply(ctx) {
        let lang = I18N.zh;
        try {
          lang = pickLocale(ctx);
        } catch (e) { /* 退回中文 */ }
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
                id: IMPL_ID,
                kind: KIND,
                keepMounted: true,
                priority: 'extension',
                title: function () { return lang.title; },
                guide: [{ id: KIND, order: 70, title: function () { return lang.title; }, icon: icon }],
              }));
            } catch (e) {
              try { console.warn(TAG, '注册 tab 类型失败：', (e && e.message) || e); } catch (e2) { /* ignore */ }
              return;
            }

            // 宿主按 id 还是 kind 分发正文没有文档：两个 key 都注册，命中哪个都不会空。
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
