# BACKLOG · 下一批待办

> 规则：只记「已定位、未动手」的事。每条给现象 / 证据 / 位置 / 修法方向 / 验收 / 优先级。
> 做完就删条目，结论进 CHANGELOG 与对应 FIXLOG。

## B1 · 模型路由判据口径不一致（P2，不影响功能）

- **现象**：能力域矩阵「模型路由」判 degraded，文案是「声明 10 个 provider，只有 5 个有压缩策略（模型目录与可路由面不一致）」。
- **证据（2026-11-22 本机实测）**：
  - 「声明 10」= desktop 6（minimax-cn / zai-coding-cn / new / new-claude / openrouter / longhua）+ web 4（前四个同名再算一次）→ **跨 profile 累加且不去重**，实际不同 provider 是 6 个；
  - 「有策略 5」= `compaction-basic.modelPolicies` 里 `provider` 去重后的 5 个（deepseek-account / zai-coding-cn / minimax-cn / new / new-claude），其中 **deepseek-account 并不在 providers 段**（账号内置 provider）→ 分子分母不是同一集合；
  - 真实缺口只有 2 个：**longhua（12 个模型，无策略）**、**openrouter（0 个模型，只有 apiKeyEnv 的空壳）**。
- **位置**：`src/capability-map.mjs` 的 `DETECT.modelRouting`（判据）与 `deriveSignals` 里 `modelProviders` / `modelPolicies` 的采集（:51-58）。
- **修法方向**：按 **(profile, provider) 对** 或按**模型覆盖率**（复用 R13 已有口径）算，保证分子分母同集合；0 模型的空壳 provider 单列提示、不算缺口。文案要能说清「缺的是哪几个 provider / 哪些模型」。
- **验收**：新增 fixture 测试覆盖三种情形——全覆盖 → present；部分覆盖 → degraded 且数字与 provider 名单对得上；含空壳 provider → 不误判。同时看 `docs/MATRIX.md` 是否需要同步。
- **备注**：能力域不计分，属结论可读性问题；先修口径再说要不要改文案强度。

## B2 · `clean` 在 Windows junction 上的「不跟随链接」是否失效（P2，待实测）

- **现象**：0.14.2 发布时发现 `test/clean-symlink.mjs` 在本机跑不起来，进而怀疑产品面。
- **证据（2026-11-22 本机实测，Node 26 / win32）**：
  - `fs.symlinkSync(target, link, 'junction')` 成功，但 `fs.lstatSync(link).isSymbolicLink()` 返回 **false**、`isDirectory()` 返回 **true**；
  - 目录符号链接（`'dir'`）需要权限，直接 `EPERM`；
  - 因此该用例的前置断言（要求 `isSymbolicLink()`）在本机必然失败，CI（ubuntu）正常。
- **位置**：`src/clean.mjs` 的扫描/腾挪里所有依赖 `isSymbolicLink()` 的守卫；`test/clean-symlink.mjs` 的前置断言。
- **修法方向**：① 先实测 —— 造一个 junction 指向 DSH_HOME 之外的大目录，跑 `clean scan/apply`，看字节数是否跟随、腾挪是否解引用；② 若确失效，改用不依赖 `isSymbolicLink()` 的探测（`fs.readlinkSync` 能成功即视为重解析点，或 lstat bigint + 平台分支）；③ 测试前置失败时应 **SKIP 并打印原因**，而不是 assert 失败——但**不许为了绿灯放宽真实断言**。
- **验收**：junction 与真 symlink 两种链路都要有用例；CI（ubuntu）仍真跑。
- **备注**：0.14.2 台账（`docs/FIXLOG-2026-11-22-r1-r2.md` §七）已记同一条，这里是待办入口。

## B3 · 能力矩阵「冲突/多实现」两处粗筛：按名字计数，按 entry id 认对手（P2）

- **现象**（2026-11-22 真机复跑，同一台机器）：
  - 「检索（web）」判 **conflicting**：文案是「抓取能力被两个实现同时接管：dsh-free-search（fetchProviderTakeover=true）与 @deepseek-ai/dsh-web（fetchProvider=fs-quality-fetch）」；
  - 「图像生成」在 trim 里报 **image ×3**（dsh-image-gen + @liustack/modlens + @goodandready/dsh-vision-bridge）；
  - 「主题与可用性」判 **redundant**（dsh-theme-palette + dsh-better-sidebar + dsh-rightbar-quicknav）。
- **证据**：
  - patch 实测：`- id: web-search-free`（dsh-free-search）`fetchProviderTakeover: true`；`- id: web`（@deepseek-ai/dsh-web）`fetchProvider: fs-quality-fetch` —— 而 `fs-quality-fetch` **正是 dsh-free-search 注册的 provider**。这是「宿主 web 把抓取委托给插件 provider」的**单入口接线**，不是两家抢位。
  - dsh-free-search README「fetch provider 接管」节：未设置或仍是出厂 `http` → 接管为 `fs-quality-fetch`；**已被显式指向其它 provider → 不抢占**。真冲突只发生在「第二个也注册 fetch provider 的插件」（例：`dsh-web-fetch-playwright`、`dsh-chatgpt-subscription`），否则会互相写 `web` config → web 服务重建 → 重复 apply（issue #82）。
  - `src/capabilities.mjs` 的 `image` 正则含 `vision hub|vision bridge|ocr|modlens`，于是视觉插件被计成图像生成实现；真正的图像生成只有 dsh-image-gen。
  - `DETECT.themeA11y`：`THIRD_RE.theme` 命中数 + `THIRD_RE.panel` 命中数 `>= 3` 即判 redundant —— 配色、侧栏增强、右侧导航三件套本就分工不同。
- **位置**：`src/capability-map.mjs` 的 `DETECT.webSearch`（按 **patch entry id** 排除对手，而不是 provider id）、`DETECT.themeA11y`；`src/capabilities.mjs` 的 `image` 正则。
- **修法方向**：① conflicting 按 **provider id** 判，且当 `web.fetchProvider` 恰等于 takeover 插件注册的 provider 时判 present（委托接线）；② 只有「两个不同插件各自注册 fetch provider 且都被显式指向」才算冲突；③ `image` 正则去掉视觉/OCR 词（视觉归 vision-ocr 域）；④ `themeA11y` 改成按「布局/主题各自的职责」而不是命中数判断，或把 panel 类拆成独立域。
- **验收**：fixture 三条 —— 宿主委托插件 provider → present；两个第三方各注册 provider 且都指向 → conflicting；仅插件 takeover、宿主未指向 → 不报冲突（present 或 unknown）。另加 image/theme 两域的反例，确保视觉插件与侧栏三件套不被算成重复。
- **备注**：与 B1（模型路由分子分母不同集合）同源，都是「按名字/数量粗筛」；修的时候建议一次改完，别分三次发。

## B4 · 「bundles 上限 43」是插件硬编码常量，且与 R15 口径不同源（P2）

- **现象**：`audit_trim` 报「服务插件 56 个，超过宿主 bundles 上限 43」；R15 报「客户端服务插件数 56 > 最大 bundles 42/43」。两个 43 看着像同一条官方规则，其实来源不同，也**都不是宿主给的**。
- **证据（2026-11-22 本机）**：
  - `src/trim.mjs:21`：`var maxBundles = (facts && facts.maxBundles) || 43;`。全仓 grep 过，`facts.maxBundles` **从未被赋值**（只有 trim 读、panel/toolface 转述），所以永远走硬编码 43；
  - `src/rules.mjs:232-234`：R15 的「最大 bundles」是**现算**——`Math.max(0, ...profiles.map(p => p.bundles.length))`，取各 profile 里最长的 bundle 列表。本次会话里就见过 **42 与 43 两种值**，因为 desktop 的 bundles 数变过；
  - 两数当前都等于 43 纯属巧合（desktop 恰好 43 条）。若它变成 45，同一次报告会自相矛盾：R15 说 45、trim 仍说 43；
  - 宿主侧没找到断言 bundles 数量上限的常量或文档：`app.asar` 里的 dsh 源码不落盘，`app.asar.unpacked` 只有 native 库；仓库文档里出现的 43 全是我们自己报告的复述。
- **语义真相**：R15 报的不是「超过官方上限」，而是「**宿主报的服务插件数 > 任何 profile 声明的 bundle 数**」——这是配比失衡信号（entry 膨胀 / 服务被重复挂载），INFO/P3 量级，不是硬约束。
- **位置**：`src/trim.mjs:21`（常量与文案 :65/:87）、`src/rules.mjs:232-234`、`src/toolface.mjs:924`（工具描述也写「bundles 上限」）、`src/panel.mjs:459`。
- **修法方向**：① trim 改用与 R15 同一套现算值（`max(p.bundles.length)`），删掉硬编码 43；② 文案去掉「宿主上限」，写成「服务插件 56 / 最大 profile bundles 43（经验阈值，非宿主上限）」或直接写「服务插件数 > 任何 profile 的 bundle 数」；③ 工具描述、面板、建议句三处一起改，避免只改一处又漂；④ 将来若真拿到官方常量，再换源并在 docs 里注明出处。
- **验收**：fixture 两个 profile 不同 bundles 长度 → 断言 `trim.maxBundles === max(bundles.length)`；同一次运行里 R15 与 trim 的数值必须一致；所有对外文案不得出现「宿主上限」字样。
- **备注**：与 B1/B3 同族（口径与措辞）；单独发也行，因为它只碰文案与一个默认值，改动面比 B1/B3 小。


