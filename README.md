# DSH 体检（dsh-healthkit）

给 DeepSeek Harness 做体检：**跑一次，给 0–10 分、分维度明细，以及「先修哪几条最划算」**。

不替你优化，只告诉你哪儿该修。

## 安装

```bash
# 发布版（npm）
dsh plugin --profile <profile> add dsh-healthkit

# 开发版（符号链接，改源码重启即生效）
dsh plugin --profile <profile> add link:/path/to/dsh-healthkit
```

开发期用 `link:`（符号链接，改源码重启宿主即生效）。`file:` 是拷贝，改源码不生效，
得 `dsh plugin --profile <profile> install --force` 重装。装完重启宿主一次。

## 八个工具

| 工具 | 干什么 |
| --- | --- |
| `audit_run` | 只读体检：总分、分档、P0/P1/P2 条数与清单 |
| `audit_report` | 同上，并把完整 Markdown 报告写成文件（缺省落本会话工作区 `AUDIT-<日期>.md`） |
| `audit_clean` | 清理可再生垃圾：默认只预览，执行先移入回收区，7 天内可还原 |
| `audit_trend` | 分数历史：次数、最新分与变化、均值、最好/最差、P0 未关、sparkline |
| `audit_findings` | 问题清单（按严重度排序，带指纹与修法），可按 severity 过滤 |
| `audit_explain` | 解释某一条：维度、证据、测到的值、置信度、修法 |
| `audit_plan` | 修复顺序：先解 P0 封顶，再按单条增量排，给出全修完的终点 |
| `audit_trim` | 装载面瘦身：同能力多实现、超 bundles 上限、记忆插件叠放，给主备候选 |

不想用工具、只想在终端跑：

```bash
dsh-healthkit                 # 人读的报告（= node bin/audit.mjs）
dsh-healthkit --help          # 全部动作（不跑体检、不记账）
dsh-healthkit --json          # 机读
dsh-healthkit --why           # 每条问题修掉能涨多少
dsh-healthkit --trend         # 分数历史
dsh-healthkit --findings      # 问题清单 / --explain <fp> 解释一条 / --plan 修复顺序
dsh-healthkit --trim          # 装载面瘦身候选（只给建议，不改配置）
dsh-healthkit --init          # 接入自检：报环境/装没装/还差哪一步
dsh-healthkit --retire <fp> --reason "原因"   # 误报记档（--list-retired 查看）
```

## 面板

**原生侧边栏面板（推荐）**：装上并重启后，右侧栏会出现「体检」标签——总分、分档、
P0/P1/P2/INFO、未解决/已退役、可清理空间、服务插件水位、最新分与记账，以及按严重度排的前 8 条
（带修法提示与指纹）。走 `sidebarRightTabs` + `slots`，**不占端口、不用记地址、不经过 iframe**。

**独立网页（备用）**：`http://127.0.0.1:<宿主端口>/dsh-healthkit-panel`
（端口跟宿主 GUI 一致）。服务端渲染、页面零 JS、每 60 秒自刷新；数据接口
`/dsh-healthkit-panel/api/summary` 可程序化读取。

- 侧边栏的 iframe 浏览器**不执行页面脚本**，所以网页面板直接塞进侧边栏会空白——要么用原生标签，
  要么在系统浏览器里打开。0.5.3 起网页面板也改成了服务端渲染，禁脚本环境照样能显示。
- **只读**：GET 不记账、不写状态，浏览器预取/刷新都安全；每分钟缓存一次。
- **只认回环**：非 127.0.0.1/::1 的请求直接 403。
- 面板挂不上不影响工具面（降级成没有面板，结果写进 `plugin-status.json` 的 `panel` 字段）。

## 它量什么

分维度看：安全、一致性、装载整洁、模型成本、可维护性等。每条问题带指纹，修好记成
`verified`，下次不会又冒出来当新问题。

P0 会封顶总分（≥1 条封 5.0，≥3 条封 4.0）——所以分数涨得快，通常意味着 P0 真被修掉了，
而不是规则变宽松。

体检是**只读**的：不写配置、不联网、不读你的会话内容。

## 清理为什么敢按

- **永不直删**：一律进 `$DSH_HOME/dsh-healthkit/trash/<批次>/`，带 manifest，7 天内搬回原样
- **今天的备份绝不动**：`_backup` 只淘汰 ≥14 天的
- **护栏硬挡**：`node_modules` / `sessions` / `attachments` / `skills` / `data` / `.git` /
  credentials 一律拒绝；`apply` 必须给具体 ids，没有「全清」
- **需确认档**（远程工作区镜像）不给 `confirm` 就不动

## 现状

R1–R23 全跑；测试全绿：夹具回归 12/12、不变量 5/5、报告落点 8/8、版本号守卫、数据目录迁移守卫 4/4、新工具形状、面板路由与回环守卫、`apply()` 注入路径（假 ctx 跑出 8 工具 + 3 路由）；真宿主 `failures: []`。

数据目录 `$DSH_HOME/dsh-healthkit/`：插件首次启动会把旧的 `dsh-auditkit` 整目录 rename 过来（账本、退役库、回收区一起带走），rename 失败则回落旧目录继续用，不半搬。

规划与取舍见 `docs/`。宿主契约（注册工具的四个坑、`process.cwd` 陷阱）与探针手法见
`docs/NOTES-host-contract.md`，修过的 bug 见 `docs/ISSUES.md`，
权限预设的四层（`defaultPreset` 为什么不改存量会话）见 `docs/PRESET-LAYER.md`。

## License

MIT © 2026 zuoyunlai
