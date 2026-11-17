# 代码审查反哺台账（2026-11-17）

> 依据：对 0.12.0 的逐文件代码审查（正确性 / 安全 / 可维护性 / 性能），总分 6.7/10。
> 本文只记「改了什么、修前修后如何、守卫在哪」，以及**明确没做的两条及理由**。

## 一、P1（三条真窟窿，全部已修）

### P1-1 · `restore()` 路径穿越 + 清单未校验（安全）

修前（`src/clean.mjs`）：`path.join(trashDir(), String(batch))` 之后直接按清单 `moveEntry(it.to, it.from)`——
`batch='../..'` 能让回收区外的 manifest 被读；清单里的 `from` 可指向 `~/.ssh/authorized_keys` 之类，
**恢复即任意文件移动**。对照：`apply()` 侧一直有 `insideHome` + `forbidden` 两道校验，restore 侧是裸的。

修后：
- 批次名只允许单段 `[A-Za-z0-9._-]{1,80}`，且解析后必须是 `trashDir()` 的直接子目录；
- 清单 `items` 必须是数组；
- 每条 `it.to` 必须落在本批次目录内；`it.from` 必须在 `DSH_HOME` 内且不命中护栏；否则该条跳过并记 `conflicts`。

守卫：新增 `test/clean-restore.mjs`（**14 项断言**）：正常还原成功、`'../..'` / `'..'` / `'../../etc'` / `'a/b'` / `''` 全被拒、
清单 `from` 越界拒且**目标文件不被写入**、`to` 越出批次目录拒、`items` 非数组拒、命中 `node_modules` 护栏拒。

### P1-2 · 号称只读的 `audit_digest` 会写 `verify/last.json`（正确性）

修前：`checkPending()` 末尾无条件 `writeJson(lastVerifyPath(home), rec)`。`audit_digest` 调它 ⇒
① 与「只读，不记账」的自我描述矛盾；② **覆盖开机验回记录**，污染这个插件最独特的资产（跨重启验回）。

修后：`verify.mjs` 拆成 `evaluatePending()`（纯计算、不落盘）+ `checkPending()`（旧名字旧行为，`persist:false` 可关）；
`weekly.mjs` 改用 `evaluatePending`。守卫：`test/digest.mjs` 新增断言「digest 不许创建 `verify/last.json`」（19 项断言）。

### P1-3 · 事实缓存指纹含整个 `logs/` 目录（性能）

修前：`cache.mjs` 把 `logs` 放进指纹字段（目录 mtime）。宿主每写一个新日志文件目录 mtime 就变 ⇒
**缓存几乎次次失效**，等于没有缓存（命中时 18ms vs 未命中 ~1s）。而 `collect()` 只读一个文件：
`~/…/logs/unlag-reload.log`。

修后：指纹不再 stamp `logs/` 目录，改为 `log:unlag-reload.log=<mtime:size>`。
守卫：`test/cache.mjs` 新增断言（9 项断言）：新建无关日志文件**不改变**指纹；改 `unlag-reload.log` **必须**变。

## 二、P2（四条代码项已修，一条只做文档）

| # | 修法 | 证据 |
|---|---|---|
| P2-1 | `bin/audit.mjs` 的 `spawnSync` 去掉 `shell: true`，加 `windowsHide: true` | 参数本是字面量，多一层 shell 只增加拼接面与噪音 |
| P2-2 | 面板 HTML 响应加 `x-content-type-options: nosniff` 与 CSP（`default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:`）；`esc()` 补单引号转义 | 原先只有 content-type + cache-control；`esc` 只转 `& < > "` |
| P2-3 | `statusOf()`：退役的 **P0/P1 降为 WARN**（可见、不阻塞），P2/INFO 才是 PASS | 原先退役一律 PASS ⇒ 一个被误记档的 P0 会永久绿掉基线门 |
| P2-4 | `weekly.mjs` 的 `productMetrics` 只算一次，metrics 与仪式提示共用 | 原先算两次，每次各读一遍 history + retirements |
| P2-5 | **只做文档**：README / 本台账写明「首次 `audit()` ≈1s 同步扫盘，会阻塞宿主主线程」 | 改 async 或 worker 属结构性重构，不在本轮 |

## 三、P3

| # | 处置 |
|---|---|
| P3-2 | 已修：`client.js` 的 `fetch` 加 `AbortController`（模块级，新请求 abort 旧请求），避免卸载/重挂后 setState |
| P3-3 | 已修：`history.load()` 按「文件 size+mtime」记忆化，账本一变键就变，不会读旧数据 |
| P3-5 | 已修：`loopbackOnly` 改成显式白名单数组，并**注释清楚**为什么空地址放行（Unix socket 不经网络） |
| P3-4 | **不修**：Node 单线程 + `collectSummary` 全同步，两个请求不可能真正并发；「并发各算一次」不成立 |

## 四、明确没做（两条，理由成立）

1. **P2-6 `index.js` 拆模块**（1.1k 行 → `src/tools/*.mjs`）：属于纯结构重构，风险与收益不成比例——
   16 个工具的 schema/render/execute 内联虽然长，但每块都能一眼看全；拆开后会引入 16 个 import 与
   一次性的「行为是否完全一致」回归面。真正该改的是**新代码**：本轮新增/改动的文件都统一用了 `const`。
2. **P3-1 格式化函数收口**（`num`/`fmt`/`fmtBytes`/`fmtLocal` 四份）：抽 `src/format.mjs` 会让
   `clean.fmtBytes`（被 `index.js`/`bin` 引用）与浏览器侧的 `client.js` 产生跨端耦合；浏览器包不方便
   跨端复用，拆了反而更绕。维持现状，只在注释里标清各自的口径。

## 五、回归

- `npm test` **31 组全绿**（新增 `clean-restore`，digest/cache 各增断言）
- 关键修复的在位检查：`BATCH_NAME_RE`(clean:238)、`evaluatePending`(verify:90 / weekly:14)、
  `log:unlag-reload.log`(cache:37)、`nosniff`(panel:71)、退役分级(report-json:29)
