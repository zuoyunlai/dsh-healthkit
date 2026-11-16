# 开发笔记：宿主契约与验证手法

README 只讲怎么用，这份记工程上真踩过的东西。全部是**运行层实测**，不是文档推断（2026-11-16）。

## 一、注册工具的四个坑

1. **不要裸访问 `ctx.<service>`。** Cordis 的 `ctx` 是 Proxy，未 inject 的属性访问会抛
   `cannot get property "x" without inject`。把它放在 try 外面，会让 `apply()` 抛穿 →
   插件实例创建失败 → 工具静默消失，而 `plugin list` / `--dump-config` 里看着一切正常。
2. `ctx.get('tools')` 在 `apply()` 挂载那一刻可能是 `undefined`（服务晚到）。
   用 `ctx.inject(['tools'], cb)` 等服务到位再注册，服务重建时能自愈。
3. 工具**必须**声明 `output: { schema, render }`，否则注册报
   `tool "x" must declare output { schema, render, presentationMeta? }` ——
   此时 `toolsReady` 会是 true 而 `registered` 为空，只看前一行会误判成功。
   schema 里 `type` 只能是单个字符串，`additionalProperties` 只能是布尔。
4. `apply()` 第一行就落档（`$DSH_HOME/dsh-auditkit/plugin-status.json`）。
   宿主启动器**不打印**被跳过/失败的 bundle，没有这个文件只能靠猜。

还有一条本轮踩实的：**`process.cwd()` 不是用户的工作目录**。Electron 桌面端里它是
`~/.dsh/profiles/<profile>`，CLI 启动器里是启动 shell 的目录。要工作区只能问
`workingDirectory` 服务（`wd.get(exec.agent.session)`，`exec` 是 `execute` 的第二参）；
要不到就落自己拥有的目录。见 `docs/ISSUES.md` #1。

## 二、探针宿主（真挂载一次，不改桌面 profile）

桌面 profile 拒绝 CLI（`profile "desktop" is managed exclusively by the Electron application`），
所以用隔离 home + 零拷贝 profile：

```bash
H=E:/auditkit-boot-home
mkdir -p "$H/profiles/probe"
cp ~/.dsh/profiles/desktop/{package.json,cordis.patch.yml} "$H/profiles/probe/"
# node_modules 用 junction 指回真 profile，避免几百 MB 拷贝（Windows）
powershell -NoProfile -Command 'New-Item -ItemType Junction -Path "E:\auditkit-boot-home\profiles\probe\node_modules" -Target "$env:USERPROFILE\.dsh\profiles\desktop\node_modules"'
DSH_HOME=$H dsh --profile probe --dump-config   # 只看合成树（含 skipped 原因）
DSH_HOME=$H dsh --profile probe1 --no-open      # 真挂载一次（profile 名，别加 app 参数；--no-open 免得弹浏览器）
cat $H/dsh-auditkit/plugin-status.json          # 看 registered / failures
```

## 三、包管理

- 开发期依赖用 `link:`（符号链接，改完重启宿主即生效）；`file:` 是拷贝，改源码无效。
- 手工覆盖 profile 的 `node_modules` 会被宿主启动时的依赖对账还原，只能走
  `dsh plugin --profile <p> add|remove|install`。

## 四、命名

**显示名「DSH 体检」，工程名 `dsh-auditkit`。** 「体检」是给用户看的：做一次、有报告、能对比，
而且**不承诺接管**（没人指望体检中心替你戒烟）；`auditkit` 是给代码和宿主看的，说的是
「这是审计工具」，而这正是可信度来源。

一度考虑过「DSH 管家」，否掉不是不好听，而是它默认了「我替你打理」—— 这套东西刻意不接管：
包操作不代跑、优化建议不计分、清理必须能还原。名不副实，用户第三次使用就发现了。
