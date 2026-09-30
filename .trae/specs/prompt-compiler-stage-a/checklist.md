# Checklist

- [x] `src-tauri/src/services/prompt_compiler.rs` 包含 `PromptCompileInput` 结构体
- [x] `src-tauri/src/services/prompt_compiler.rs` 包含 `PromptCompileMode` 枚举（ClassicChat, ClassicRegenerate, AgentDirectorPlaceholder）
- [x] `src-tauri/src/services/prompt_compiler.rs` 包含 `PromptBudget` 结构体
- [x] `src-tauri/src/services/prompt_compiler.rs` 包含 `PromptBlockKind` 枚举（WorldVariable 已替换 CharacterStateOverlay，含 TODO 注释）
- [x] `src-tauri/src/services/prompt_compiler.rs` 包含 `PromptBlockSource` 枚举
- [x] `src-tauri/src/services/prompt_compiler.rs` 包含 `PromptBlock` 结构体
- [x] `src-tauri/src/services/prompt_compiler.rs` 包含 `PromptCompileDebugReport` 结构体
- [x] `src-tauri/src/services/prompt_compiler.rs` 包含 `PromptCompileResult` 结构体
- [x] `compile_chat_messages()` 改造为接收 `PromptCompileInput` 输出 `PromptCompileResult`
- [x] 每个 `PromptBlock` 包含正确的 `kind`、`source`、`priority`、`required` 元数据
- [x] `stream_llm_response()` 链路改为先 compile 再由 Provider Adapter 转 request
- [x] 预算裁剪按 `RetrievedDetail` → `PlotSummary` → `WorldBookMatch` → `WorldVariable` 顺序执行
- [x] `CurrentUser` 不被裁剪
- [x] `PresetRule` 和 `CharacterBase` 尽量不裁剪
- [x] `PromptCompileDebugReport` 正确填充编译过程信息
- [x] WorldVariable 层代码中标记 TODO 注释，暂不实现
- [x] Provider Adapter 接收 `PromptCompileResult` IR，转换为 provider-specific 请求体
