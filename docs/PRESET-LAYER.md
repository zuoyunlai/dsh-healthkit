# 权限预设的四层：谁在管「这个会话能做什么」

> 这份笔记回答一个反复被问的问题：**把 `defaultPreset` 改成 `workspace-write`，为什么当前会话还是 `danger-full-access`？**
> 答案不是改失败了，而是预设从来不是「一个全局开关」，它按层快照。体检规则 R7 / R7a / R7b 就是按这个分层做的判定。

## 四层，从广到窄

| 层 | 存在哪里 | 什么时候生效 | 改它影响谁 |
|---|---|---|---|
| **宿主全局** | `~/.dsh/cordis.yml`（以及 profile 的 `cordis.patch.yml`） | 宿主启动时读 | 之后新建的一切 |
| **profile 默认** | `profiles/<p>/cordis.patch.yml` 的 `defaultPreset` + `presets` | 新会话 / 新任务创建的那一刻 | **只影响新建的**，存量不回写 |
| **会话** | 会话自己的记录（创建时快照） | 该会话的每一次工具调用 | 只有这个会话 |
| **自动化 / 定时任务** | 任务定义里保存的 preset | 每次独立运行 | 只有这条任务 |

关键点：**下面三层都是「创建时快照」**。它们不会因为你在上游改了默认值而跟着变——这正是安全设计的本意：改全局默认不该悄悄放宽某个正在跑的会话。

## 症状与判定

```
我把 defaultPreset 从 danger-full-access 改成 workspace-write 了，重启也做了，
但当前会话写入工作区之外仍然成功。
```

这不是没生效，是**这个会话在创建时就是 danger-full-access**。要确认，看三处：

1. `~/.dsh/dsh-healthkit/plugin-status.json` 的 `configKeys`（插件能看到什么配置面）；
2. 会话列表里该会话的 preset 字段；
3. `audit_findings` 看 R7 系列报的是哪一层。

新开一个会话，它就应该是 `workspace-write`。

## 体检怎么判这三条

| 规则 | 级别 | 条件 | 含义 |
|---|---|---|---|
| **R7** | P2 | profile 的 patch 层里没有 `id: permission` 条目 | 走宿主默认：能跑，但「默认值是什么」不由你决定 |
| **R7b** | P1 | 预设里 `approval: never` | 没有人能拦住它，只能靠沙箱 |
| **R7a** | **P0** | `defaultPreset: danger-full-access` **且** `approval: never` | 无沙箱 + 无审批 = 完全放行，且是默认值，每个新会话都继承 |

单独 `danger-full-access`（approval 仍然会问）不是 P0——危险在于「默认给所有人」而不是「你手动用过一次」。

另有一条组合判定：**凭据文件存在 × `danger-full-access`** 会单独报出来（凭据在可写范围内是可被读到并外发的）。

## 怎么改才算改对

想收紧，改的是**新会话的默认值**：

```yaml
# profiles/<p>/cordis.patch.yml —— 加一个 permission 条目（形状照你宿主的来）
- id: permission
  config:
    defaultPreset: workspace-write
    presets:
      danger-full-access:
        approval: ask      # 关键：把 never 换成 ask，R7a 就解了
```

> 这段是按 R7 的判定反推的：体检认的是 patch 数组里 `id: permission` 的那一条的 `config`。
> 你宿主里如果已有 permission 条目，改它的 config 就行；没有才新增。

想让**存量的**那个会话也收紧：只能新开一个会话（或改那条自动化任务的 preset）。没有「热改」通道，这是故意的。

## 一句话总结

`defaultPreset` 是**新会话的出生设定**，不是运行中的开关。体检只报「你出生时被设成了什么」，不改你的设定。
