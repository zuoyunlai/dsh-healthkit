# 收录投稿台账（2026-11-17）

> 目标：把 6 个自有 DSH 插件投进各个 awesome 类清单仓。
> 本次只做**投稿**（PR），不改任何插件代码。

## 一、盘点结论（先扫再投）

扫了 8 个候选清单仓 + 名下 6 个 `dsh-plugin` 仓库，用 `git trees` 递归比对（GitHub code search 对这些仓返回 0 命中，是假阴性）。

| 清单仓 | 投稿形式 | 投稿前状态 |
|---|---|---|
| `awesome-dsh-plugin/awesome-dsh-plugin`（主榜 ★24.8k） | `data/plugins/<owner>__<repo>.yml` 一个文件 | 已有 5 个自有条目；缺 `dsh-healthkit` |
| `beancookie/awesome-dsh-plugin` | `README.md` + `README.en.md` 各加一行 | **一个都没有**（#267/#278 两条 PR 至今 OPEN 未合） |
| `billLiao/awesome-dsh-plugin` | `categories/<分类>.md` 加一行 | **6 个全有**——它每 8 小时自动抓 `dsh-plugin` topic，无需投 |
| `dshworks/awesome-dsh-plugins`（★35） | `lists/<分类>.md` | 已有 5 个；**缺 `dsh-theme-palette`**（自动同步，不投） |
| `0xsline/awesome-deepseek-harness`（★1380） | `README.md` + `README.zh-CN.md` | 有 pet 与 lunheng；**缺 4 个** |
| `Alex-Yanggg/awesome-DSH-plugin`（★103） | `README.md`（手维护）+ `catalog/plugins.json`（双语元数据）+ `docs/README.zh-CN.md`（脚本生成） | **一个都没有**（#180 OPEN 未合） |
| `kejixiaoliang/awesome-dsh-plugins`（★84） | `plugins/<分类>.md` + `data/descriptions-en.json` + 4 个生成物 | 有 lunheng；缺 4 个（#195/#147 OPEN 未合） |
| `dshworks/awesome-dsh-themes`（★5） | 主题目录 | 已有 `dsh-theme-palette`——无需投 |
| `dshworks/awesome-dsh-workbench` | 工作台目录（需实拍截图） | 不适用：我们是插件不是工作台 |

**结论**：实际可投 4 个仓。其中 `billLiao` 与 `dshworks/*` 已被自动同步收录，无需再投。

## 二、开出的 PR（4 个）

| 清单仓 | PR | 内容 | 取代的旧 PR |
|---|---|---|---|
| `beancookie/awesome-dsh-plugin` | **#297** | 6 个插件，中英各 6 行，按分类字母序 | #267、#278（已关，附说明） |
| `Alex-Yanggg/awesome-DSH-plugin` | **#196** | 6 个插件 + `catalog/plugins.json` 双语元数据 + 重新生成的 `docs/README.zh-CN.md` | #180（已关） |
| `0xsline/awesome-deepseek-harness` | **#854** | 补 4 个缺失条目，中英各 4 行 | — |
| `kejixiaoliang/awesome-dsh-plugins` | **#222** | 5 个插件 + `descriptions-en.json` + 重新生成的 README/INDEX/web data | #195、#147（已关） |

外加主榜的 **#16020**（`dsh-healthkit`）——两道门禁已全绿，等维护者审阅。

## 三、每个仓的门槛核对与做法

### beancookie #297
- 门槛：`dsh.bundle` manifest + 真实代码 + `dsh-plugin` topic + 描述不带营销词。**无仓库年龄门槛**。
- 做法：按分类块的**字母序**插入（脚本按 `owner/repo` 小写比较定位），中英两版同步。
- 校验：插入后**零行删除/改写**，只 +12 行；分类内字母序自检通过（该仓原有的 3 处乱序在改动前就存在，不是我们引入的）。

### Alex-Yanggg #196
- 门槛：`catalog/plugins.json` 的 schema 要求 `description` 同时有 `en` 与 `zh-CN`；CI 跑 `python scripts/generate_readmes.py --check`。
- 做法：README.md（手维护）+ catalog 双语元数据 + 用**仓内脚本**重新生成中文镜像。本地跑 `--check` 通过。
- 分类选择：`dsh-healthkit`→developer-tools、`dsh-chronicle`→data-research-knowledge、`dsh-pet-plugin`→ai-design-media、`dsh-theme-palette`/`dsh-rightbar-quicknav`→ui-user-experience、`lunheng`→agent-automation。

### 0xsline #854
- 门槛：手写维护 README 英文目录 + 中文镜像；条目必须是一行事实描述。
- 做法：只补缺的 4 个（pet 与 lunheng 已在里面），中英各 4 行，差量只有新增、无改写。
- CI：`awesome-lint` 已 **SUCCESS**。

### kejixiaoliang #222
- 门槛：`node scripts/validate.mjs` 校验条目格式 `- [name](url) — 描述` 与「同一仓库不重复收录」；英文描述另存 `data/descriptions-en.json`。
- 做法：`plugins/*.md` 各加一行 + descriptions-en.json 补英文 + 用仓内 `gen-readme.mjs`/`gen-index.mjs`/`gen-web-data.mjs` 重新生成 4 个产物。
- 坑：`descriptions-en.json` 上游用 **1 空格缩进**，重写时若用默认 2 空格，整个文件会被 diff 成全改动——已按上游格式输出，差量降到 9 行。
- 本地 `validate.mjs`：目录 358 条（唯一 358），无格式错误、无重复。

## 四、四条经验

1. **code search 不可信**：这几个仓用 `search/code` 查都是 0 命中，实际是没有条目；改用 `git trees` 递归比对才确认。
2. **合批优于散投**：同仓多条散 PR 会互相冲突（改同一个 JSON 或 README 区域）。合批成一条后，把旧的散 PR 关掉并写明「已被取代」，维护者只需审一条。
3. **生成物必须用仓内脚本重生成**：Alex-Yanggg 与 kejixiaoliang 的 README/INDEX 都是脚本产物，手改会在 CI 的 `--check` 上红。
4. **JSON 缩进属于契约的一部分**：kejixiaoliang 的 `descriptions-en.json` 用 1 空格缩进，重写时用默认缩进会把整个文件变成噪音 diff。

## 五、CI 现状（2026-11-17 21:28 实测）

| PR | CI |
|---|---|
| 0xsline #854 | `awesome-lint: SUCCESS` |
| beancookie #297 | `action_required`（fork PR 的 workflow 需维护者批准后才会跑） |
| Alex-Yanggg #196 | 同上 |
| kejixiaoliang #222 | 同上 |

`action_required` 不是失败：这三个仓的 CI 由 `pull_request` 触发，外部贡献者的 workflow 需要维护者手动批准才能运行——仓库里其他贡献者的 PR（如 `add-eccvik-lmtagent`）也是同样状态。

## 六、复跑清单

```bash
# 四个 PR
gh pr view 297 --repo beancookie/awesome-dsh-plugin
gh pr view 196 --repo Alex-Yanggg/awesome-DSH-plugin
gh pr view 854 --repo 0xsline/awesome-deepseek-harness
gh pr view 222 --repo kejixiaoliang/awesome-dsh-plugins
```
