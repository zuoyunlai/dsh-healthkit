# 侧栏面板 UI / 可视化评审 · 核实与反哺（2026-11-16）

> 对象：dsh-healthkit 0.8.6 侧栏面板（`client.js` React 半边）与网页面板（`src/panel.mjs`）
> 来源：UI 设计师 + 数据可视化工程师两份独立评审（专家意见，非事实）
> 方法：逐条对**代码特征（非行号）**、**实时 API 响应**、**history.jsonl 数据**做机器核实；每项标 `坐实 / 修正 / 推翻 / 未复核`
> 边界：宿主主题 token 真值读不到（`app.asar` 非可列目录），凡涉及宿主变量的对比度按 `client.js` 的 fallback 值计算

## 一、核实结论汇总

| 类别 | 条数 | 坐实 | 修正 | 推翻 |
|---|---|---|---|---|
| 信息层级 / 排版 / 间距 / 一致性（设计） | 21 | 17 | 3 | 1 |
| 可视化与数据事实（可视化） | 14 | 10 | 4 | 0 |
| 两位专家均未发现的运行期缺陷 | 2 | 2（新增） | — | — |

三个**P0 级新增事实**（专家评审时都不存在或未触及）：

1. **面板当前在对外服务 NaN**：实测 `GET /dsh-healthkit-panel` 返回 `<div class="v">NaN</div>`，`/api/summary` 返回 `score:null, band:"-", plan.base:null`。
2. **根因是重复挂载**：`~/.dsh/dsh-healthkit/plugin-status.json` 记 `panel.ok:false`，三条路由全部 `webserver: duplicate exact route`——本实例注册失败，对外服务的是另一代实例。
3. **同一份文件在进程外调用 `collectSummary()` 得 `score 9.81 / band 良好 / plan.base 9.81`**，证明计算路径没算错，问题在运行期实例/模块代次。

## 二、台账（逐条）

### A. 信息层级

| # | 专家结论 | 核实 | 证据 |
|---|---|---|---|
| A1 | 零值徽章反客为主（`P0 0` 满红、`P1 0` 满橙） | 坐实 | `badge()` 不区分零值；`SEV_COLOR.P0 = C.bad = #dc2626`、`P1 = C.warn = #d97706`；实测分布 `P2 3 / INFO 14`，`p0=p1=0` |
| A2 | 唯一超限指标没有视觉信号（`56 / 43`） | 坐实 | `metric()` 只有 label/value/sub 三参，无 tone；API 实测 `trim.served=56, maxBundles=43` |
| A3 | 17 条问题等权重直铺，INFO 淹没 P2 | 坐实 | `d.items.map(findingItem)` 全量无分组；实测 `items=17`，其中 `INFO=14`、`P2=3` |
| A4 | `headline` 被降级成脚注、与时间戳同行 | 坐实 | 结论与 `d.at.replace('T',' ').slice(0,19)` 拼在同一行 11px dim 里 |
| A5 | 5 张卡塞 2 列网格留空洞 | 坐实 | `gridTemplateColumns: '1fr 1fr'` + `metric()` 调用 5 次 |
| A6 | 章节标题无区隔（11px/700/dim） | 坐实 | `section()` 只有字号字重色值差，无线、无背景、无计数 |

### B. 排版

| # | 专家结论 | 核实 | 证据 |
|---|---|---|---|
| B1 | 字号 8 级、含半像素 | 坐实 | 实测取值：10 / 10.5 / 11 / 11.5 / 12 / 12.5 / 13 / 17（8 级；半像素 3 处） |
| B2 | 数字不等宽、分数刷新会跳动 | 坐实 | 无 `fontVariantNumeric`；分数直接 `String(d.score)`，9.0 会渲染成 `9` |
| B3 | 按字符 `slice()` 截断且无省略号 | 坐实 | `fixHint.slice(0,40)`、`r.title.slice(0,46)` |
| B4 | 摘要第二行被 fixHint 占掉，展开后重复 | 坐实 | 折叠态 `dimension · fixHint(40字)`，展开态 `kv(fix, fixHint)` 再出现一次 |
| B5 | 单字符 sparkline 塞进副行 | 坐实 | `d.trend.sparkline` 当前值 `"█"`，长度 1 |
| B6 | `（首次）` 与实际不符 | 坐实 | `delta` 按**日**折叠（`previous = win[len-2]`），`daysTracked=1` ⇒ `delta=null`；而 `runs=43` |

### C. 间距与节奏

| # | 专家结论 | 核实 | 证据 |
|---|---|---|---|
| C1 | 容器内边距 10/12 比宿主窄 | 坐实 | `padding: '10px 12px'` |
| C2 | 圆角 4 种（5/9/10/12） | **修正** | 实测只有 3 种：`5`（badge）、`9`（问题条 ×2）、`10`（metric）；**没有 12** |
| C3 | 间距 5/6/7/8/10 混用 | 坐实 | `gap` 实测取值 8(×2) / 7 / 6 / 5；`padding` 另用 8/10/14 |
| C4 | 列表缩进 18px 吃掉窄栏宽度 | 坐实 | `paddingLeft: 18` 三处 |

### D. 视觉一致性

| # | 专家结论 | 核实 | 证据 |
|---|---|---|---|
| D1 | 严重度色不跟主题、11px 文字实测不达 AA | **修正（方向对，数字有偏）** | `C.fg/dim/line/card/accent` 走 `var(--dsw-alias-*)`，但 `ok/warn/bad/info` 四个是硬编码 hex。实算：`#dc2626`/白 4.83（过）、`#dc2626`/#171d24 3.51（不过）、`#d97706`/白 3.19（不过）、`#6b7280`/白 **4.83**（专家写 ≈4.2，修正）、`#6b7280`/#171d24 3.51（不过）。结论成立：**同一规则浅色过、深色不过** |
| D2 | 两个面板是两套设计 | 坐实 | 网页版 `.v{font-size:26px}` + `repeat(auto-fit,minmax(210px,1fr))` + 严重度色 `#f85149/#d29922/#58a6ff`；侧栏版 17px + `1fr 1fr` + `#dc2626/#d97706/#2563eb` |
| D3 | 后端枚举裸奔进中文界面 | 坐实 | 明细行直接拼 `it.dimension`（`disk`/`modelCost`/`consistency`/`plugins`），能力域直接印 `degraded`/`redundant`/`unknown` |
| D4 | 4 个层级压成 1 个 `C.dim` | 坐实 | 章节标题、二级元信息、INFO 严重度、footer、空态全用 `C.dim` |
| D5 | 刷新无反馈、且不是按钮 | 坐实 | 两处 `<a href="#">`；`state.loading && !d` 只在无数据时渲染加载文案 |
| D6 | 错误态抹掉旧数据 | 坐实 | `catch` 里 `setState({data: null, ...})` |
| D7 | 千字节区间显示 `0.0 MB` | 坐实 | `mb()` 只有 GB / MB 两档 |
| D8 | 死 token 与未用数据 | **修正** | `C.ok`：`client.js` 里 0 处引用（真死 token）；`d.raw`：`client.js` 0 处，但 `panel.mjs` **透传了**（`raw: r.score.raw`）却从未渲染 ⇒ 应表述为「透传了没画」 |

### E. 可视化与数据事实

| # | 专家结论 | 核实 | 证据 |
|---|---|---|---|
| E1 | 时间轴 UTC，比本地早 8 小时 | 坐实 | `history.mjs:43` 写 `new Date(at).toISOString()`；`stamp()` 取 `.slice(11,16)`。实测最后一条 `2026-11-16T13:58:50.900Z`，本地 21:58 |
| E2 | 0–10 固定域 × 34px ⇒ 1 分 = 2.95px，参考线不可见 | 坐实 | `H=30, PAD=2`，`y(10)=2`；`preserveAspectRatio:'none'` 拉到 34px ⇒ 1.13px/unit；`ref(10)` 与 `strokeWidth:.4 + opacity:.18` 叠加 |
| E3 | 同一张卡两个口径打架（`（首次）` vs 有起伏的线） | 坐实 | 见 B6；`trend.recent` 实测 20 点、range 8.36→9.81 |
| E4 | 分数与维度关系不可见；payload 缺 `dims` | 坐实 | 实测顶层 keys 无 `dims`（`at,score,raw,band,count,findings,retired,p0,p1,p2,info,headline,trend,items,plan,clean,trim,capabilities,retiredList`）；`score.mjs` 已算出 `dims/cappedBy` |
| E5 | sparkline 量化粗 + 154px 装不下 | **修正** | 8 档 `▁▂▃▄▅▆▇█` ⇒ 步长 **10/7 ≈ 1.43 分/档**（专家写 1.25）；当前长度 1，装不下的是 30 字符上限这个设计，而非当前值 |
| E6 | 徽章 0 值满色、INFO 抢视觉、无分母 | 坐实 | 同 A1；`score.mjs` 明确跳过 INFO 与 advisory，14/17 条不计分 |
| E7 | 折线被塞进半宽卡、右侧空一列 | 坐实 | 同 A5；趋势图在 `metric` 网格内 |
| E8 | 「次数」密度不携带信息 | **修正** | 实测最近 20 条里相邻间隔 <60s 的对数为 **12/19**（专家写 13/19，随数据增长变化） |
| E9 | 该画图的地方在用文字 | 坐实 | 能力域 `rows` 实测 12 行文字；`trim 56/43` 纯文字；`plan.rows` 纯文字 |
| E10 | 信息密度：整页 ≈2690px | 未复核（估算） | 依赖字体与主题，本次未逐像素测量；`items=17`（14 INFO）这一驱动事实已坐实 |
| E11 | 历史里有 `total=5.0 / raw=8.78` 的封顶记录 | **修正** | 确实存在，但**不止一条**：实测 `raw−total>0.05` 的记录 **5 条**（6.11/6.91/8.78 等） |
| E12 | `daysTracked=1` | 坐实 | API `trend.daysTracked=1`（`history` 有 2 个 UTC 日期，但按本地日折叠后都落在 11-16） |
| E13 | disk 维度 7 条全是 INFO、按 items 重算会画反 | 坐实 | 实测 `disk/INFO=7`、`disk` 维度计分 0；分布 `security/P2=1, modelCost/P2=1, context/P2=1, consistency/INFO=2, modelCost/INFO=1, plugins/INFO=4, disk/INFO=7` |
| E14 | `test/panel.mjs` 断言 `<polyline>` 与 `<div class="v">` | 坐实 | 第 49 行断言 `class="v"` 数字，第 51 行断言 `includes('<polyline')` |
| E15 | clean 字节堆叠条不可画（2 组 99.9997%:0.0003%） | **修正** | 实测 **3 组**：49892949 / 104361 / 133 字节（比例结论不变） |

### F. 专家未覆盖（本次核实新增）

| # | 事实 | 证据 | 处置 |
|---|---|---|---|
| F1 | 网页面板当前渲染 `NaN` | `curl /dsh-healthkit-panel` ⇒ `<div class="v">NaN</div>`、`<div class="v">-</div>` | 渲染层 NaN 兜底（P0） |
| F2 | 面板路由重复注册，`panel.ok=false` | `plugin-status.json`：三条路由 `duplicate exact route`；profile 只声明一次 `dsh-healthkit` ⇒ 运行期双实例 | 注册幂等 + 报告真实状态（P0）；彻底修复需单实例重启宿主 |

## 三、修订清单（合并后最终口径）

### P0 —— 先让面板正确且重新有主角

1. **F1/F2 NaN 兜底 + 路由注册幂等**：分数字符串化统一走 `num()`（非有限数 → `—`）；`registerPanel` 撞到 duplicate 时记 `reason:'already-registered'` 并视为可用，不再谎报三条全失败。
2. **E1 时间戳本地化**：`stamp()` 改按本地时区 `HH:MM`；网页版页头 `at` 同步（否则两处都早 8 小时）。
3. **A1/E6 零值徽章去色**：`badge(text, color, zero)`——零值透明底 + `C.dim` + `opacity .45`；非零改「浅底 + 竖条 + 文字用 `C.fg`」，避开小字号色相不达 AA。
4. **A2 超限转红**：`metric(label, value, sub, tone)`，`trim.served > maxBundles` 时数值与边框转 `C.bad`，副行写「超 N 个」。
5. **A3 INFO 折叠组**：计分项常显，INFO 收进 `<details>`「其余 N 条 INFO（不计分）」。
6. **D8/E11 封顶差额**：`raw − score > 0.05` 时在分数字旁标「封顶前 9.81」，否则不渲染。
7. **E2 折线换分档带**：0–5/5–7/7–8.5/8.5–10 四段底带 + 当前位置竖标 + **内叠细折线**（保留 `<polyline>` 以免打断既有断言）+ 末点；`max−min < 1.0` 时只留带与一句话结论。

### P1 —— 建立分辨率台阶

8. 首屏重排：英雄卡（总分大字号 + 分档药丸 + 严重度 chip + 分隔线）→ 2×2 指标（第 4 格补「可涨 +N」）→ 趋势卡 → 问题 → 修复顺序。
9. 字号收 6 级（10/11/12/13/16/31）、圆角 3 级（5/8/10）、间距落 8 栅格、容器 `padding: 12px 14px`。
10. 章节标题：加 `borderTop` + 计数（`17 条 · 3 条计分`）。
11. 修复收益横条：`plan.rows` 相对归一；`maxDelta < 0.05` 退化为一行文字。
12. 枚举中文化：`DIM_ZH` / `STATUS_ZH` 映射表，缺失回落原值。
13. 刷新改真 `<button>` + `loading` 反馈 + 注入一次性 `<style id="hk-style">`（幂等）补齐 `:focus-visible`、`details` 展开提示。
14. 徽章补分母：`3 计分 / 17 总`；P2 换中性蓝灰，`accent` 只留给交互。

### P2 —— 打磨与口径

15. 错误态保留旧数据（顶部错误条 + 重试，不再整屏替换）。
16. `mb()` 补 KB 档；删 `sparkline`；`（首次）` 改按 `runs` 分「首次 / 首日基线」；数值节点 `tabular-nums` + 总分 `toFixed(2)`；`slice()` 改 `line-clamp`；`C.ok` 用于分档色。
17. **`dims` 透传**（`collectSummary` 加 7 行）+ 维度横条（默认折叠，只在有维度 <9.0 或存在 `cappedBy` 时展开）——唯一需要动服务端的一处。
18. 两个面板统一到书面 `PANEL-STYLESPEC`（本轮只同步正确性：时间戳、NaN、封顶；视觉统一另议）。

## 四、明确不做（附数据理由）

7 维雷达（380px 无几何分辨率、4 个 10 分 + 3 个 9.5 ⇒ 近乎正七边形）、严重度甜甜圈、7 条维度迷你折线（`history.jsonl` 只记 total/p0/p1/p2，无 dims 历史）、半圆仪表盘、clean 字节堆叠条（3 组比例 99.9997%:0.0003%）、20 域热力矩阵、GitHub 日历热力图（52 周放不进 380px，`daysTracked=1`）。

## 五、边界与未复核项

- **对比度的宿主真值未知**：`C` 表五个颜色走 `var(--dsw-alias-*)`，宿主实际取值读不到；上文比值按 fallback 计算，方向可靠（`#d97706` 类中等饱和色撑不住 11px），具体数值需按宿主 token 复算。
- **E10 整页高度 2690px 未逐像素复核**：属估算，依赖字体与主题；其驱动事实（17 条 / 14 INFO）已坐实。
- **渲染结果本身未验收**：本次只核代码与接口；面板实际观感需重载窗口后人工确认（本轮同时修掉了 NaN，重载前请勿把 `NaN` 当成新回归）。
- 专家书面建议中的行号会随本次修订漂移，本报告一律以**代码特征**为准。
