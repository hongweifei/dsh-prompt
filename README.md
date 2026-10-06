# @dsh-external/dsh-prompt

DSH 提示词注入插件：把可复用的提示词片段注入到模型的三个位置，并随时增删改。

「一个提示词」其实有三种完全不同的生命期，所以本插件分成三条通道：

| 通道 | 注入位置 | 适合放什么 | 生效范围 |
|---|---|---|---|
| **系统提示词** `system` | 系统提示词里的一个 section | 固定人设与规则 | 每一轮、每个请求 |
| **运行时上下文** `context` | 宿主的 runtime-context 快照（一条 user 角色消息） | 每轮的环境事实 | 每轮刷新 |
| **每轮用户消息** `message` | 每轮开头的一条用户消息 | 临时要求 | 每轮一次 |

三条通道各自可开关，并且可以**按会话**覆盖（跟随全局 / 强制开 / 强制关）。

## 三个入口

- **设置页**：设置 → 「提示词片段」。完整管理：增删改、启停、同通道内上移下移、会话内片段、注入预览、存储路径。
- **输入框旁的快捷开关**：对话输入框工具行里的一枚小按钮，左键循环 `跟随全局 → 强制开 → 强制关 → 跟随全局`，鼠标悬停提示「下一次点击会变成什么」。
- **斜杠命令**：无 Web 连接的 profile 也能用。
  - `/prompt` — 列出片段与各通道状态
  - `/prompt-add <名称> | <system|context|message> | <正文>`
  - `/prompt-remove <id>`
  - `/prompt-session [status|auto|on|off|add <正文>|clear]`

## 变量

片段正文里可以写三个变量，三个通道都支持：

| 变量 | 含义 |
|---|---|
| `{{cwd}}` | 当前会话的工作目录 |
| `{{model}}` | 当前模型 id |
| `{{provider}}` | 当前 provider |

变量取自**正在组装的那次请求所属的 agent**，不是宿主进程的目录 —— 否则面板报的路径和会话实际所在的目录会不一致。

## 两处必须知道的实现约束

1. **系统提示词通道注册为 `interpolate: false`。** 宿主的 `systemPrompt.section` 默认会对文本做 `{{变量}}` 插值，遇到未知变量会**抛错并让整次模型调用失败**。本插件自己做变量替换，然后把字面文本交出去，所以用户写 `{{` 永远不会炸。
2. **运行时上下文通道无法关闭插值**（`PromptContext` 没有这个字段），所以该通道会把每一处 `{{` 改写成 `{ {`，让宿主的扫描器看不到变量组。**这个改写会在注入预览里明确提示**，不会静默发生。

   ⚠ 这里有个真实踩过的坑：天真的 `replaceAll('{{', '{ {')` **只处理不重叠的成对括号**。用户写 `{{{a}}}` 时它得到 `{ {{a}}}` —— 里面**仍然有一个 `{{a}}` 组**，宿主读到未知变量就抛错，整次模型调用直接失败（现场报错：`unknown prompt variable "{{a}}" in context "prompt:user-snippets"`）。现在的实现是逐字符扫描，无论连续多少个花括号都不会留下 `{{`。`test/interpolate.test.mjs` 把宿主自己的 `interpolate()` 逐字抄来当裁判，用 27 组对抗性文本验证转义结果。

## 配置

放在 profile 的 `cordis.patch.yml` 里，作为 `id: prompt` 覆盖：

```yaml
- id: prompt
  name: '@dsh-external/dsh-prompt'
  config:
    enabled: true
    maxChars: 8000      # 三通道合计字符上限；0 = 不限制
    sectionOrder: 100   # 系统提示词 section 的位置（0 = persona，500 = plan policy）
    contextOrder: 200   # 运行时上下文的位置（宿主自带的是 110/115/120）
    refreshMs: 3000     # 存储快照重读间隔；0 = 只靠启动与面板写入刷新
```

## 数据

片段存在 `<DSH_HOME>/prompt/snippets.json`，一个文件，跨项目共享（提示词是偏好，不属于某个项目）。可以直接手改；插件每 3 秒重读一次，保存后立即生效。

写入走宿主自己的 `ctx.fs` 与新鲜度校验：面板保存时会重新读取并**重放在别人写入之后**，不会把并发修改覆盖掉。

## 安装

```bash
# 在 profile 目录里（web 这类 CLI 管理的 profile）
dsh plugin --profile web add "link:<本仓库路径>"
```

desktop 这类由 Electron 管理的 profile 只能用宿主内的 plugin_manager 安装，安装后**需要重启应用**（宿主半边在进程启动时载入）。客户端半边改完只需刷新页面。

## 测试

```bash
node test/run.mjs         # 全部：单元 42 + 插值安全 6 + 集成 39 + 客户端 19 + 架构 12 = 118
node test/preview.mjs     # 渲染真实面板 → test/preview.html
node test/shots.mjs       # 截图到 test/shots/（zh/en × light/dark）
node test/probe-live.mjs  # 用真实存储回读三个通道的最终文本（排查现场用）
```

`test/shots/*.png` 是随仓库提交的文档，改面板就要重新生成；`shots.mjs` 会比较四张图的哈希，**两张图字节相同就直接报错**（Edge 会按 URL 缓存 `file://`，否则第二次截图会静默复用第一张）。

## 许可

MIT
