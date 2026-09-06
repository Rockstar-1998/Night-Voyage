# 修复蓝图编译器无视原生思维链强制注入 thinking Schema - Walkthrough

## 改动摘要
1. **Rust 蓝图执行引擎 (`src-tauri/src/services/blueprint_executor.rs`)**：
   - 彻底修复 `inject_core_schema_baseline` 函数中无条件盲目向 JSON Schema 注入 `thinking` 属性的严重缺陷；
   - 增加上下文感知检查：
     1. 若当前图激活了原生思维链（`result.sampling_params.thinking_enabled == Some(true)`），模型将在协议原生通道输出思维链，严禁在 JSON Schema 中强行塞入 `thinking` 字段；
     2. 若蓝图整张图已经存在 `field_name == "thinking"` 的 `SchemaField` 节点（说明作者通过 Gate 分支显式控制其生效时机），当执行路径未访问该节点时，尊重分支选择，严禁跨分支强制回填；
   - 增加单元测试：`test_native_thinking_suppresses_schema_thinking_injection` 与 `test_unvisited_branch_thinking_suppresses_injection`。

---

## 改动动机
用户在实机使用 V2.2 预设时，在蓝图前端勾选了“原生思维链”（避开“指令思维链”），但编译发送给模型的 API 请求体中仍然包含：
```json
"thinking": {
  "type": "string",
  "description": "模型的内部推理过程（角色动机、策略分析），不对外展示给玩家"
}
```
导致模型出现“双重思维链”：先在 Anthropic 原生思考通道完整思考了一次，紧接着在输出 JSON 正文时又被迫额外生成了一遍 `"thinking"` 属性，不仅严重浪费 tokens、降低响应速度，且践踏了蓝图 Gate 互斥分支的设计意图。
排查定位发现：旧版 `blueprint_executor.rs` 的 `inject_core_schema_baseline` 盲目假定“任何蓝图都必须有 thinking 和 text”，在 DFS 遍历结束后强制向缺失的 properties 注入了硬编码的 thinking description，导致原生思维链通道下的分支被强行反向篡改。

---

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端仅提交 Gate 选择与蓝图拓扑，图遍历、条件分支调度与 Schema 基线判定全由 Rust 后端严格负责 |
| C2 Zero-Fallback Errors | √ | 尊重图分支的真实执行状态，消除虚假注入与隐式强加 |
| C3 Responsiveness | √ | 避免模型在 JSON 中重复输出冗长思维链，显著降低网络耗时与推理延迟 |
| C4 AI UI Isolation | √ | 未修改 AI 渲染沙箱层 |
| C5 Mobile Frontend Independence | √ | 改动集中于后端 blueprint_executor，双端完全共享此后端修复 |
| C6 Project Cache Location | √ | 工具链与构建缓存位于 D:\data\Night Voyage\.cache |
| C7 PC/Android Coverage | √ | 后端蓝图执行器为 PC 与 Android 端共用核心，双端同步受益 |

---

## 验收记录
1. **针对性单元测试**：
   - `cargo test --manifest-path src-tauri/Cargo.toml test_native_thinking`（通过）
   - `cargo test --manifest-path src-tauri/Cargo.toml test_unvisited_branch_thinking`（通过）
2. **全量单元测试**：
   - `cargo test --manifest-path src-tauri/Cargo.toml`（126 passed; 0 failed）
3. **TypeScript 双端类型检查**：
   - `npx tsc --noEmit -p tsconfig.json; npx tsc --noEmit -p tsconfig.mobile.json`（通过，0 errors）
4. **全量 Release 双端构建**：
   - `scripts\build_dual_release.bat`（构建成功，耗时 7m 29s）
     ```
     Finished `release` profile [optimized] target(s) in 7m 29s
     Built application at: D:\data\Night Voyage\src-tauri\target\release\night-voyage.exe
     [Night Voyage] Release build succeeded.
     ```

---

## 已知限制或后续待办
- 无。蓝图 Gate 互斥分支对 SchemaField 节点的动态启闭完全恢复正常，原生思维链模式下不会再出现多余的 thinking schema。
