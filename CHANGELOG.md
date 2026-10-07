# Changelog

## 0.1.0

首个版本。

- 三条注入通道：系统提示词（`systemPrompt.section`，`interpolate: false`）、运行时上下文（`systemPrompt.context`）、每轮用户消息（`agent/pre-step`）。
- **默认关闭**：装完不会改变任何请求。是否注入由两层决定 —— 设置页的**默认模式**（默认关），以及输入框旁按钮写的**会话级覆盖**（跟随默认 / 强制开 / 强制关）。按钮只在「跟随默认」已经给出想要结果时清掉覆盖，不留多余的记录。
- 三个入口：设置页（`settings.section`，含默认模式）、输入框旁会话级开关（`conversation.input.left`）、四条斜杠命令。
- 片段增删改、启停、同通道内排序；会话内一次性片段。
- `{{cwd}}` / `{{model}}` / `{{provider}}` 三个变量，三条通道统一语法。
- 注入预览：按下一轮真实内容拼出三个通道，并明确报告转义、截断与整段舍弃。
- 三通道共享字符预算，超出时按「上下文 → 消息 → 系统提示词」的顺序让位，并且**只截断或整段舍弃一个通道**，不会连挂多条提示把预算吃掉。
- 存储为 `<DSH_HOME>/prompt/snippets.json`（schema v2），写入带新鲜度校验，并发修改会被重放而不是覆盖。
- **修复：连续花括号会击穿上下文通道的转义。** 原先用 `replaceAll('{{', '{ {')`，只处理不重叠的成对括号，用户写 `{{{a}}}` 会得到 `{ {{a}}}` —— 仍是一个真实变量组，宿主读到未知变量即抛错，**整次模型调用失败**（现场报错：`unknown prompt variable "{{a}}" in context "prompt:user-snippets"`）。改为逐字符扫描，并新增 `test/interpolate.test.mjs`：把宿主的 `interpolate()` 逐字抄来当裁判，用 27 组对抗性文本验证。
- 新增 `test/check-encoding.mjs`：全树扫描 CP936 损坏与 BOM。这台机器的 `Get-Content -Raw` + `WriteAllText` 往返会把 UTF-8 文件按 CP936 重新编码，本轮实际损坏过 `lib/client.js` 两次、`test/unit.test.mjs` 一次 —— 该脚本是提交前的必跑项。
- 124 个测试：单元 43、插值安全 6、集成 41、客户端 22、架构 12。
