# 0.14.3 口径批台账（2026-11-22）

## 一、来由

0.14.2 发完后真机复跑，四条数字对不上号 —— 都不是宿主的问题，是判据自己算错了口径。
逐条记在 `docs/BACKLOG.md`（B1–B4），这里记结论与发版核验。

## 二、四条与证据

| 编号 | 现象（修前） | 证据（2026-11-22 本机） | 修法 |
|---|---|---|---|
| B1 | 能力域「模型路由」：声明 10 个 provider，只有 5 个有压缩策略 | 「10」= desktop 6 + web 4 跨 profile 累加（同名各算一次）；「5」= `modelPolicies` 里 provider 去重，且含声明面之外的 `deepseek-account`。真实缺口只有 `longhua`（12 模型）与空壳 `openrouter`（0 模型） | 按 (profile, provider) 同集合比对；缺口 = 声明了模型却无策略的 provider；0 模型空壳单列 |
| B3a | 「检索（web）」判 conflicting | patch：`web.fetchProvider = fs-quality-fetch`（dsh-free-search 注册）+ 插件 `fetchProviderTakeover: true`。dsh-free-search README 明确这是「官方搜索 + 插件抓取」单入口 | 只有「两个插件都想接管」或「两个不同 fetchProvider」才算冲突；委托接线判 present 并写清谁接管、指向谁 |
| B3b | trim 报 `image ×3` | `capabilities` 的 image 正则含 `vision hub\|vision bridge\|ocr\|modlens`，把两个视觉插件算成图像生成 | 正则收窄到真正产出图片的实现；视觉归 vision-ocr 域 |
| B3c | 「主题与可用性」判 redundant | 判据 = theme 命中数 + panel 命中数 ≥3，而配色 / 侧栏增强 / 右侧导航分工不同 | 面板类不再并入主题域 |
| B4 | trim 说「bundles 上限 43」 | `facts.maxBundles` 从没被赋值，恒为硬编码 43；R15 的数是现算的各 profile 最大值（本机先后见过 42/43） | trim 改用同源现算；六处文案（含 UI 中英）去掉「宿主上限」 |
| B2 | 疑 `clean` 会跟随 junction | 造 junction 指向 DSH_HOME 外 1MB 目录：`scan` 只报 500 字节/2 文件、`apply` 后仍是链接、外部文件原样 | **无缺陷，不改产品代码**；测试改 SKIP 守卫（受限沙箱会把 junction 降级成普通目录，那时用例无意义） |

## 三、修后实测（同一台机器）

- `model-routing` → `degraded`：`1 个 provider 声明了模型但没有压缩策略：desktop/longhua（12 个模型）；另有 1 个空壳 provider（0 模型，不计缺口）：desktop/openrouter`
- `web-search` → `present`：`抓取由 dsh-free-search 接管（fetchProviderTakeover=true）；web.fetchProvider = fs-quality-fetch（单入口委托接线，非冲突）`
- `theme-a11y` → `present`（dsh-theme-palette）；trim 不再报 image ×3
- trim → `服务插件 56 个 / 最大 profile bundles 42（基线，非官方上限）`

## 四、发版记录（v0.14.3，2026-11-22）

- 提交 `87b2c27`，tag `v0.14.3`；CI：`ci`（node 20/22）绿，`publish`（publish + release）绿。
- npm `shasum` `29e7198decc1058c903e37e6840efae34ca5f650` == 本地 `npm pack` sha1。
- `_npmUser` 含 `trustedPublisher`（OIDC），attestations 已签名。
- `gitHead` = `87b2c278b63039bdd1ffab7e888ae6f92c882594` = tag 提交。
- GitHub Release `v0.14.3` 非 draft，正文与 CHANGELOG 首段一致（`gh api` 逐行 diff 仅差一个尾随空行 —— awk 抓段带出的换行被 `--notes` 裁掉，0.14.2 时是全等）。
- dist-tags `latest` = 0.14.3。

## 五、遗留

- 本机 profile 里 `dsh-healthkit` 仍是 `link:`，真机跑的是本地源码；要验 registry 版本需换安装方式。
- 本机 npm registry 指向 `npmmirror.com`，核发布结果必须直查 `registry.npmjs.org`。
- backlog 已清空（B1–B4 全部落地）。下一批待定。
