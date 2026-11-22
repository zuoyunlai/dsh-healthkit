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
