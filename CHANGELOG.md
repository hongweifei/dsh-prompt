# Changelog

## 0.1.0

首个版本。

- 三条注入通道：系统提示词（`systemPrompt.section`，`interpolate: false`）、运行时上下文（`systemPrompt.context`）、每轮用户消息（`agent/pre-step`）。
- 三个入口：设置页（`settings.section`）、输入框旁会话级快捷开关（`conversation.input.left`）、四条斜杠命令。
- 片段增删改、启停、同通道内排序；会话级覆盖（跟随全局 / 强制开 / 强制关）与会话内一次性片段。
- `{{cwd}}` / `{{model}}` / `{{provider}}` 三个变量，三条通道统一语法。
- 注入预览：按下一轮真实内容拼出三个通道，并明确报告转义、截断与整段舍弃。
- 三通道共享字符预算，超出时按「上下文 → 消息 → 系统提示词」的顺序让位，并且**只截断或整段舍弃一个通道**，不会连挂多条提示把预算吃掉。
- 存储为 `<DSH_HOME>/prompt/snippets.json`，写入带新鲜度校验，并发修改会被重放而不是覆盖。
- **修复：连续花括号会击穿上下文通道的转义。** 原先用 `replaceAll('{{', '{ {')`，只处理不重叠的成对括号，用户写 `{{{a}}}` 会得到 `{ {{a}}}` —— 仍是一个真实变量组，宿主读到未知变量即抛错，**整次模型调用失败**（现场报错：`unknown prompt variable "{{a}}" in context "prompt:user-snippets"`）。改为逐字符扫描，并新增 `test/interpolate.test.mjs`：把宿主的 `interpolate()` 逐字抄来当裁判，用 27 组对抗性文本验证。
- 118 个测试：单元 42、插值安全 6、集成 39、客户端 19、架构 12。
