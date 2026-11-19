// 客户端半边的「宿主会调用面」守卫。
//
// 事故（0.13.1）：apply() 里 `title: function () { return lang.title }` —— `lang` 只在
// 组件里由 useLang() 造出来，apply 作用域里根本没有它。这行从 0.5.3 起就是错的，
// 一直没被发现，因为旧宿主不在渲染时调 title()。DSH 0.2.2-rc.5 的引导页会逐个调
// title() 来画胶囊 → 一次 ReferenceError 就让整个「引导页 + 标签条」渲染失败，
// 用户看到的是**右栏整块空**，连别的插件的标签一起没了。
//
// 教训：客户端半边**不是只有组件会被宿主调用**。宿主会调
//   ① title()（tab chip / 引导页胶囊）
//   ② guide[].title()
//   ③ guide[].icon（可能被当函数直接调，而不是 createElement）
// 这三个都不在组件树里，拿不到 hooks，也不该抛异常——一个插件没有资格让用户的侧栏变空。
//
// 本测试用假的模块系统 + 假 ctx 真跑一遍 bundle，把这些面逐个调用。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// react 优先用真机 profile 里的；拿不到就用**桩**，绝不允许跳过。
//
// 教训（0.13.1 审计 P1-3）：最初这里「找不到 react 就 process.exit(0) 并打印跳过」，
// 而查找路径写死了作者本机的 `C:/Users/<me>/.dsh/...`，CI 上必然走跳过分支——
// 于是**专门防「右栏被清空」的守卫，恰恰在 CI 上从来没跑过**。
// 本仓在 CI 门禁上坚持 skip ≠ pass，自己的测试不能例外。
let React = null;
let reactSource = 'real';
const forceStub = process.env.DSH_HEALTHKIT_STUB_REACT === '1';
if (!forceStub) {
  for (const base of [
    path.join(root, 'node_modules') + '/',
    'C:/Users/Zuoyunlai/.dsh/profiles/desktop/node_modules/',
  ]) {
    try { React = createRequire(base)('react'); break; } catch (e) { /* 下一处 */ }
  }
}
if (!React) {
  reactSource = 'stub';
  React = {
    createElement(type, props) { return { type, props, children: Array.prototype.slice.call(arguments, 2) }; },
    useState(init) { return [typeof init === 'function' ? init() : init, function () {}]; },
    useEffect() {},
    useCallback(fn) { return fn; },
    useMemo(fn) { return fn(); },
    useRef() { return { current: null }; },
    Fragment: 'Fragment',
  };
}

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

const src = fs.readFileSync(path.join(root, 'client.js'), 'utf8');

// ① 模块体只允许调用 window.__ModuleLoader__.load 一次，且 id 是包名
const defs = [];
const sandbox = {
  window: { __ModuleLoader__: { load(def) { defs.push(def); } } },
  document: { createElement: () => ({ style: {} }), head: { appendChild() {} } },
  console: { info() {}, warn() {}, error() {} },
  fetch: async () => ({ ok: true, json: async () => ({ hasRun: false, p0: 0 }) }),
  navigator: { language: 'zh-CN' },
  setTimeout, clearTimeout,
};
vm.createContext(sandbox);
new vm.Script(src, { filename: 'client.js' }).runInContext(sandbox);
ok('模块体注册了一个 def', defs.length === 1, String(defs.length));
ok('def.id 是包名 dsh-healthkit', defs[0].id === 'dsh-healthkit', defs[0].id);
ok('def 带 factory', typeof defs[0].factory === 'function');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
ok('def.id 与 package.json 的 name 一致（模块身份按包名对账）', defs[0].id === pkg.name, defs[0].id + ' vs ' + pkg.name);
ok('package.json 导出了 ./client（宿主按它取 bundle）', !!(pkg.exports && pkg.exports['./client']));

if (!React) {
  throw new Error('内部错误：react 与桩都没就位');
}

// ② 物化 factory：只允许 require('react')，其他一律抛（会暴露多余的 external）
const mod = defs[0].factory((name) => {
  if (name === 'react') return React;
  throw new Error('bundle 请求了基座之外的模块：' + name);
});
ok('factory 返回 inject / apply', Array.isArray(mod.inject) && typeof mod.apply === 'function');
ok('inject 列表含 sidebarRightTabs 与 slots',
  mod.inject.indexOf('sidebarRightTabs') !== -1 && mod.inject.indexOf('slots') !== -1, mod.inject.join(','));
ok('inject 列表含 locale', mod.inject.indexOf('locale') !== -1, mod.inject.join(','));

// ③ 假 ctx：真跑 apply，把宿主会调用的面逐个调用
const registered = [];
const slots = [];
function makeCtx(opts) {
  const o = opts || {};
  const locale = o.locale === 'en'
    ? { getLocale: () => ({ active: 'en' }) }
    : (o.noLocale ? null : { getLocale: () => ({ active: 'zh' }) });
  return {
    effect(fn) { return fn(); },
    get(name) { return name === 'locale' ? locale : undefined; },
    inject(deps, cb) {
      cb({
        get(name) {
          if (name === 'sidebarRightTabs') return { register(d) { registered.push(d); return () => {}; } };
          if (name === 'sidebarRight') return {};
          if (name === 'locale') return locale;
          return undefined;
        },
      });
      return () => {};
    },
    slots: {
      inject(name, fn) { return fn(); },
      register(spec, comp) { slots.push({ name: spec.name, key: spec.key, comp }); return () => {}; },
    },
  };
}

mod.apply(makeCtx({}));
ok('apply 调用了 tabs.register 一次', registered.length === 1, String(registered.length));

const def = registered[0];
ok('注册了 kind 与 id', def.kind === 'dsh-healthkit.health' && def.id === 'dsh-healthkit', def.id + '/' + def.kind);
ok('keepMounted 为 true', def.keepMounted === true);
ok('priority=extension', def.priority === 'extension');

// ④ 宿主会调用面之一：title() —— 这条就是本次事故的直接触发点
let titleText = null;
assert.doesNotThrow(() => { titleText = def.title(); }, 'title() 不许抛');
ok('title() 返回非空字符串', typeof titleText === 'string' && titleText.length > 0, String(titleText));
ok('中文宿主下 title 是「体检」', titleText === '体检', String(titleText));

// ⑤ 宿主会调用面之二：guide[].title()
ok('guide 有一项', Array.isArray(def.guide) && def.guide.length === 1);
let guideTitle = null;
assert.doesNotThrow(() => { guideTitle = def.guide[0].title(); }, 'guide[].title() 不许抛');
ok('guide 标题是非空字符串', typeof guideTitle === 'string' && guideTitle.length > 0, String(guideTitle));
ok('guide 有 icon', typeof def.guide[0].icon === 'function');

// ⑥ 宿主会调用面之三：icon 可能被当函数直接调（不是 createElement）
assert.doesNotThrow(() => { def.guide[0].icon({ size: 14 }); }, 'icon(props) 不许抛');
assert.doesNotThrow(() => { def.guide[0].icon({ size: 14, alert: true, title: 'P0 2' }); }, 'icon 带 alert 也不许抛');

// ⑦ 正文与标题席位：两个 key 都注册，且都是组件函数
for (const name of ['sidebar.right.pane.tab', 'sidebar.right.pane.tab.title']) {
  for (const key of ['dsh-healthkit', 'dsh-healthkit.health']) {
    const hit = slots.find((s) => s.name === name && s.key === key);
    ok('席位已注册：' + name + '#' + key, !!hit && typeof hit.comp === 'function');
  }
}

// ⑧ 英文宿主下 title 要是英文（证明 title 真的跟着 locale 走，而不是写死中文）
registered.length = 0;
mod.apply(makeCtx({ locale: 'en' }));
const enTitle = registered[0].title();
ok('英文宿主下 title 是英文', enTitle === 'Checkup', String(enTitle));

// ⑨ locale 服务完全缺失时也不许抛（宿主早期阶段、或跨版本改名）
registered.length = 0;
mod.apply(makeCtx({ noLocale: true }));
assert.doesNotThrow(() => { registered[0].title(); }, '没有 locale 服务时 title() 不许抛');
ok('没有 locale 服务时回落到中文', registered[0].title() === '体检', String(registered[0].title()));

// ⑩ 源码级断言：apply 作用域里不许再出现裸的 `lang.`（注释里引用旧写法不算）
const applyStart = src.indexOf('apply(ctx) {');
const applyBody = src.slice(applyStart, applyStart + 3000).replace(/\/\/[^\n]*/g, '');
ok('apply() 作用域里不许出现裸 lang.', !/return\s+lang\./.test(applyBody), applyBody.match(/return\s+lang\.[^\n]*/) + '');

ok('断言全部真的跑过（不许靠跳过凑绿）', n >= 20, String(n));
ok('记录 react 来源（real/stub 都要能跑）', reactSource === 'real' || reactSource === 'stub', reactSource);
console.log('client-apply: 通过（' + n + ' 项断言 · 宿主调用面 title/guide/icon 全不抛 · react=' + reactSource + '）');
