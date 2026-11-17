# 规则矩阵

> 本文件由 `dsh-healthkit --matrix --out docs/MATRIX.md` 生成，真源是 `src/rules.mjs`。
> 改了规则不重新生成，`test/matrix.mjs` 会红——这张表不可能比代码旧。

三条身份用三列表示：**体检**（日常评分）/ **探针**（改完配置能不能起来）/ **门禁**（CI 只判新增与回归）。

| 规则 | 严重度 | 维度 | 抓什么 | 体检 | 探针 | 清理 | 门禁 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `R1` | P1 | consistency | 装了但未挂载的依赖  | ✓ | ✓ | | ✓ |
| `R2` | P2 | consistency | disabled 指向的包不在依赖里（疑似空转）  | ✓ | ✓ | | ✓ |
| `R2c` | P2 | consistency | 无法读取 patch（体检器缺 YAML 解析器，不代表配置有问题） | ✓ | | | ✓ |
| `R3` | P2 | consistency | 冷静期豁免打在未安装的包上  | ✓ | | | ✓ |
| `R3b` | P2 | consistency | 豁免锁定的版本与实装不符  | ✓ | | | ✓ |
| `R3c` | INFO | consistency | 豁免含历史多版本列表且不含实装版本（需人工判断） | ✓ | | | |
| `R3d` | INFO | consistency | 无法读取冷静期豁免（YAML 不可用或无该文件） | ✓ | | | |
| `R4` | P2 | consistency | .bak/副本堆积  | ✓ | | ✓ | ✓ |
| `R5` | P1 | consistency | 配置未纳入版本控制（profiles/.git 不存在） | ✓ | | | ✓ |
| `R6` | P2 | consistency | 多 profile 的 providers 段已漂移 | ✓ | | | ✓ |
| `R7` | P2 | security | 未显式声明权限 preset（ | ✓ | | | ✓ |
| `R7a` | P0 | security | 默认档位 = danger-full-access 且 approval = never（ | ✓ | | | ✓ |
| `R7b` | P1 | security | approval = never（ | ✓ | | | ✓ |
| `R8` | P1 | security | 凭据文件对同进程 shell 可读（栅栏只在工具层） | ✓ | | | ✓ |
| `R9` | P0 | security | 外部密钥不在 ~/.ssh 下  | ✓ | | | ✓ |
| `R10` | P2 | security | 高危扩展面未设白名单/黑名单  | ✓ | | | ✓ |
| `R11` | INFO | modelCost | 成本记账停更  | ✓ | | | |
| `R12` | P2 | modelCost | 插件声明了模型值，但无法静态核对运行时实际值（ | ✓ | | | ✓ |
| `R13` | P1 | context | 压缩策略覆盖率  | ✓ | | | ✓ |
| `R14` | P1 | reliability | 装载日志出现 stand-in module  | ✓ | | | ✓ |
| `R14b` | P1 | reliability | 装载日志出现 newly not running  | ✓ | | | ✓ |
| `R15` | INFO | plugins | 客户端服务插件数  | ✓ | | | |
| `R16` | P2 | context | 同时挂载  | ✓ | | | ✓ |
| `R17` | INFO | disk | 大目录  | ✓ | | ✓ | |
| `R18` | INFO | disk | 引擎资产（判为不可回收）： | ✓ | | ✓ | |
| `R19` | INFO | disk | 默认工作区不干净： | ✓ | | | |
| `R19b` | INFO | disk | 默认工作区里有  | ✓ | | | |
| `R20` | P2 | plugins | 能力冗余： | ✓ | | | ✓ |
| `R21` | INFO | plugins | 未发现本地 agent preset（全部为内置预设） | ✓ | | | |
| `R21a` | P2 | plugins | 预设『 | ✓ | | | ✓ |
| `R21b` | P2 | plugins | 预设『 | ✓ | | | ✓ |
| `R21d` | INFO | plugins | 预设『 | ✓ | | | |
| `R21e` | INFO | plugins | 本地预设  | ✓ | | | |
| `R22` | P0 | reliability | file:/link: 依赖目标不存在  | ✓ | ✓ | | ✓ |
| `R23` | P0 | reliability | bundle 未声明 dsh.bundle，宿主会静默跳过  | ✓ | ✓ | | ✓ |
| `R24` | P0 | reliability | profile「 | ✓ | ✓ | | ✓ |

## 预启动探针直接复判的 5 类

- `R1` — 依赖装了但没被 patch 挂载
- `R2` — disabled 指向的包不在依赖里
- `R22` — file:/link: 依赖目标不存在
- `R23` — bundle 没声明 dsh.bundle（宿主静默跳过）
- `R24` — profile 自身不可解析

## 清理器能接手的 3 类

- `R4` — .bak/副本堆积
- `R17` — 大目录
- `R18` — 引擎资产（判为不可回收）

## 这张表不做什么

- 不是「全目录 × 宿主版本」的兼容矩阵：那需要逐个装插件、逐个启动宿主，本仓不做这件事（做不到就不编）。
- 不承诺「探针列没有勾的规则就与启动无关」：只表示探针不直接复判它。
