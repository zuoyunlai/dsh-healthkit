// 面板契约（架构审计 B5 + B6）。
//
// B5：payload 是唯一高频变更的面，却是唯一没有契约的（report/check 都有 /v1）。
// B6：分档阈值原先在 4–5 处各写一份（rubric / client 的 BANDS / client 的 bandColor /
//     维度色 9,7 / panel 的 headlineOf 6,8），改 rubric 一处，别处不会跟着变。
//
// 本测试钉住：
//   ① payload 有 schema 串、必需键齐全、bands 严格降序；
//   ② client.js 不再自己写死分档阈值（8.5/7/5 必须来自 payload）。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const { collectSummary, PANEL_SCHEMA, PANEL_REQUIRED_KEYS } = await import('../src/panel.mjs');

let n = 0;
function ok(name, cond, detail) {
  n += 1;
  assert.ok(cond, name + (detail ? ' :: ' + detail : ''));
}

const d = collectSummary();
ok('payload 必须带 schema 串', d.schema === PANEL_SCHEMA, String(d.schema));
for (const k of PANEL_REQUIRED_KEYS) ok('payload 必需键存在：' + k, k in d);

ok('bands 至少 2 档', Array.isArray(d.bands) && d.bands.length >= 2);
const mins = (d.bands || []).map((b) => b.min);
ok('bands 必须严格降序：' + JSON.stringify(mins), mins.every((v, i) => i === 0 || v < mins[i - 1]));
ok('bands 每档都要有 label', (d.bands || []).every((b) => typeof b.label === 'string' && b.label));
ok('总分与分档必须自洽', typeof d.score !== 'number' || d.bands.some((b) => d.score >= b.min));

// 阈值真源只能是 rubric：client 里不许再出现「score >= 8.5」这类写死边界
const client = fs.readFileSync(path.join(root, 'client.js'), 'utf8');
ok('client 不许硬编码分档阈值 score >= 8.5', !/score\s*>=\s*8\.5/.test(client));
ok('client 不许硬编码分档阈值 score >= 7', !/score\s*>=\s*7\b/.test(client));
ok('client 不许硬编码维度色阈值 score >= 9', !/score\s*>=\s*9\b/.test(client));
ok('client 应从 payload 读 bands', /bandSegments\(\s*bands\s*\)|bandSegments\(\s*d\.bands\s*\)/.test(client));

// 2026-11-17：语言检测的接口契约（修过一个真 bug）。
// 运行时 locale 服务只有 getLocale/getSnapshot/subscribe/setLocale/addLanguage/register/bind，
// **没有 current()**；原实现调 current() 导致 typeof 检查恒假、永远回退中文。
// 断言看「代码」而不是「注释」：client.js 的注释里会提到被修掉的旧写法，不能算违规。
const clientCode = client.replace(/^\s*\/\/.*$/gm, '');
ok('client 不许调 locale 的 current()（该接口不存在）', !/loc\.current\s*\(/.test(clientCode));
ok('client 必须用 getLocale 或 getSnapshot 读 active', /getLocale\s*\(|getSnapshot\s*\(/.test(clientCode));
ok('client 必须订阅 locale 变化（实时切语言）', /\.subscribe\s*\(/.test(clientCode));
ok('Body/TabTitle 必须读实时语言，不许在 apply 里定死', /useLang\(ctx\)/.test(clientCode) && !/let lang = I18N\./.test(clientCode));

// 2026-11-17 回归：client 曾按「极差 < 1 分」把折线整个关掉，而服务端版本一直画，
// 两端口径分叉 → 用户看到「趋势图没了」。图和说明是两件事，图不许条件省略。
ok('client 不许按极差省略折线', !/spread\s*>=\s*[\d.]+\s*\?/.test(client));
ok('client 必须始终渲染 polyline', /h\('polyline'/.test(client));

console.log('panel-contract: 通过（' + n + ' 项断言 · schema/必需键/bands 降序/阈值单一真源）');
