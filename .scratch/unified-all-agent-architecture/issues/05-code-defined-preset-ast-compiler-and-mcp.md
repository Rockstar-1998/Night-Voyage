# 05: 代码化预设 (.nv.ts) 双向 AST 编译器与 MCP 交互端点

**What to build:** 维持 SQLite 数据库作为应用唯一的物理存储权威，将外部分发与 AI 交互载体升级为清晰紧凑的 TypeScript DSL（`.nv.ts`）；利用纯 Rust 实现的 `oxc_parser`（零 Node.js 外部依赖，跨平台覆盖 PC 与 Android）实现“SQLite 图数据 $\longleftrightarrow$ `.nv.ts` 代码”的双向无损转译，并通过 MCP 暴露代码导出与导入工具，使 AI 能够直接用代码辅助创作者编写蓝图。

**Blocked by:** 01: 步长预算节点 (StepBudgetNode) 与单步直出核心循环

**Status:** ready-for-agent

- [ ] 在 `Cargo.toml` 中引入 `oxc_parser` 纯 Rust 依赖（无动态 C 依赖，支持 Android 交叉编译）。
- [ ] 规范 `@night-voyage/blueprint` 语法声明子集（`definePreset.state`, `Macro.define`, `Tools.define`, `flow.branch`）。
- [ ] 实现反向编译器 (`BlueprintGraph -> .nv.ts`)：将 SQLite 内部图拓扑还原为 150 行左右格式规范的 TypeScript 源码。
- [ ] 实现前向编译器 (`.nv.ts -> BlueprintGraph -> SQLite`)：解析 TypeScript AST，提取状态、宏、工具与分支，结合 Dagre 自动排版算法生成合法的蓝图图数据并写入 SQLite。
- [ ] 注册并挂载 MCP 工具 `nv_preset_export_code` 与 `nv_preset_import_code`，并在导入成功后向前端广播视图刷新事件。
- [ ] 编写测试断言：验证测试预设代码在 AST 编译与图还原过程中 100% 无损 round-trip。
