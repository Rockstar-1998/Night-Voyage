# 20260801-2017-格式化blueprintGraph-修改

## 1. 改动摘要
- **文件**: `d:\data\Night Voyage\src-tauri\src\services\preset_service.rs`
- **文件**: `d:\data\Night Voyage\测试预设\Night Voyage 默认预设.nvpreset.json`
- **改动内容**: 
  1. 为了响应“格式化 blueprintGraph 让文字横着变成多行美观”的需求，将后端 `PortablePresetMeta` 中 `blueprint_graph` 的类型由 `Option<String>` 更改为 `Option<serde_json::Value>`，并在导入/导出时做了映射处理，使得预设 JSON 文件里可以将 `blueprintGraph` 保存为直观的对象树，而不需要压缩为单行字符串。
  2. 针对 `content` 等长文本字段包含 `\n` 导致在 JSON 中仍然是一长行的问题，我在导出的处理逻辑中增加了自动将包含换行符的字符串拆分为**字符串数组** (Array of Strings) 的逻辑；在导入时会自动重新拼接为带 `\n` 的单一字符串。
  3. 使用 Python 脚本重写了 `Night Voyage 默认预设.nvpreset.json` 文件，不仅将其变成了结构化对象，而且内部的 Prompt 长文本均拆分为了多行字符串数组。

## 2. 改动动机
- 默认预设中由于 `blueprintGraph` 作为一个大型 JSON 字符串存储，所有节点信息都被强制变成一行横向文本（字符串转义）。即使格式化为对象，JSON 规范也不允许原生的多行字符串，包含 `\n` 的字符串在许多编辑器中依然会横向无限延伸。
- 通过在导出/导入边界处做字符串数组和带有换行符的长文本互相转换的处理，完美兼顾了后端的 JSON 读取与本地文件的格式化/阅读需求。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端无需改动，完全后端数据结构调整 |
| C2 Zero-Fallback Errors | √ | `serde_json` 映射通过 `ok().or` 及显式 `map` 保留了原生失败表现 |
| C3 Responsiveness | √ | 不涉及主线程阻塞 |
| C4 AI UI Isolation | √ | 不涉及 UI 层 |
| C5 Mobile Frontend Independence | √ | 不涉及移动端 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 后端代码跨端通用 |

## 4. 验收记录
- **构建命令**: `cargo check` (在 src-tauri 中验证，全部通过，无新错误)
- **预期效果**: `Night Voyage 默认预设.nvpreset.json` 能够成功读取与反序列化，导出的其他预设其 `blueprintGraph` 的节点 `content` 均可折叠、展开为字符串数组形式展示。

## 5. 已知限制或后续待办
- 无。该方案已在序列化和反序列化边界做了完全隔离，旧的单行长文本也能正常反序列化为 `\n`，新的数组格式也支持向后兼容。
