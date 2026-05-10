# Night Voyage 文档总入口

本文件用于把当前仓库内分散的文档按“规划文档”和“实现文档”两大类整理成统一入口。

> 说明：为避免破坏现有硬编码引用路径，原文档暂时保留在各自原位置，例如 [`plans/backend-ai-handoff.md`](plans/backend-ai-handoff.md) 与 [`plans/gemini-frontend-rewrite-handoff.md`](plans/gemini-frontend-rewrite-handoff.md) 仍保持不变。

---

## 一、规划文档

这类文档主要回答：
- 要做什么
- 为什么这样设计
- 系统应采用什么架构
- 后续能力应该如何扩展

### 产品与版本规划
- [`plans/v1-plan.md`](plans/v1-plan.md)

### 后端与架构规划
- [`plans/backend-ai-handoff.md`](plans/backend-ai-handoff.md)
- [`plans/performance-architecture.md`](plans/performance-architecture.md)
- [`plans/history-memory-injection-architecture.md`](plans/history-memory-injection-architecture.md)
- [`docs/preset-system-architecture.md`](docs/preset-system-architecture.md)
- [`plans/preset-governance-plan.md`](plans/preset-governance-plan.md)
- [`plans/preset-usability-improvements.md`](plans/preset-usability-improvements.md)
- [`plans/kedai-preset-migration-prep.md`](plans/kedai-preset-migration-prep.md)
- [`plans/kedai-night-voyage-migration-plan.md`](plans/kedai-night-voyage-migration-plan.md)
- [`plans/kedai-preset-classification-v1.md`](plans/kedai-preset-classification-v1.md)
- [`plans/kedai-night-voyage-preset-draft-v1.md`](plans/kedai-night-voyage-preset-draft-v1.md)

### 前端规划 / 联调入口
- [`plans/gemini-frontend-rewrite-handoff.md`](plans/gemini-frontend-rewrite-handoff.md)

---

## 二、实现文档

这类文档主要回答：
- 当前代码已经实现到什么程度
- Prompt Compiler / 注入链路如何落地
- 哪些模块之间如何协作
- 实际工程里该如何继续实现

### 注入与编译实现总结
- [`docs/prompt-compiler-and-injection-summary.md`](docs/prompt-compiler-and-injection-summary.md)

### 当前实现相关代码入口
- 后端入口：[`src-tauri/src/lib.rs`](src-tauri/src/lib.rs)
- 聊天命令：[`src-tauri/src/commands/chat.rs`](src-tauri/src/commands/chat.rs)
- 会话命令：[`src-tauri/src/commands/conversations.rs`](src-tauri/src/commands/conversations.rs)
- 角色卡命令：[`src-tauri/src/commands/characters.rs`](src-tauri/src/commands/characters.rs)
- 世界书命令：[`src-tauri/src/commands/world_books.rs`](src-tauri/src/commands/world_books.rs)
- API 档案命令：[`src-tauri/src/commands/providers.rs`](src-tauri/src/commands/providers.rs)
- 资源导入命令：[`src-tauri/src/commands/assets.rs`](src-tauri/src/commands/assets.rs)
- Prompt Compiler：[`src-tauri/src/services/prompt_compiler.rs`](src-tauri/src/services/prompt_compiler.rs)
- 世界书匹配器：[`src-tauri/src/services/world_book_matcher.rs`](src-tauri/src/services/world_book_matcher.rs)
- 前端桥接层：[`src/lib/backend.ts`](src/lib/backend.ts)
- 前端总装配入口：[`src/App.tsx`](src/App.tsx)

---

## 三、推荐使用方式

### 如果你要讨论“未来怎么设计”
优先读：
1. [`plans/v1-plan.md`](plans/v1-plan.md)
2. [`plans/performance-architecture.md`](plans/performance-architecture.md)
3. [`plans/history-memory-injection-architecture.md`](plans/history-memory-injection-architecture.md)
4. [`docs/preset-system-architecture.md`](docs/preset-system-architecture.md)
5. [`plans/preset-governance-plan.md`](plans/preset-governance-plan.md)
6. [`plans/preset-usability-improvements.md`](plans/preset-usability-improvements.md)
7. [`plans/kedai-preset-migration-prep.md`](plans/kedai-preset-migration-prep.md)
8. [`plans/kedai-night-voyage-migration-plan.md`](plans/kedai-night-voyage-migration-plan.md)
9. [`plans/kedai-preset-classification-v1.md`](plans/kedai-preset-classification-v1.md)
10. [`plans/kedai-night-voyage-preset-draft-v1.md`](plans/kedai-night-voyage-preset-draft-v1.md)

### 如果你要讨论“当前代码怎么实现 / 继续怎么接”
优先读：
1. [`plans/backend-ai-handoff.md`](plans/backend-ai-handoff.md)
2. [`plans/gemini-frontend-rewrite-handoff.md`](plans/gemini-frontend-rewrite-handoff.md)
3. [`docs/prompt-compiler-and-injection-summary.md`](docs/prompt-compiler-and-injection-summary.md)
4. 对应运行时代码入口

---

## 四、后续整理建议

如果后面继续收敛文档，建议逐步演进成：

- `plans/`：只放版本规划、路线图、架构方案草案
- `docs/`：只放已经稳定沉淀下来的实现说明、模块设计、工程规范

在真正迁移前，应先确认所有对 [`plans/backend-ai-handoff.md`](plans/backend-ai-handoff.md) 和 [`plans/gemini-frontend-rewrite-handoff.md`](plans/gemini-frontend-rewrite-handoff.md) 的引用规则都已同步更新。