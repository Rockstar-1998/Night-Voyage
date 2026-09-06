# 解禁思维链上限由 max_tokens 动态决定且限制最低 max_tokens - Walkthrough

## 改动摘要
1. **Rust 后端协议适配层 (`src-tauri/src/services/provider_adapter.rs`)**：
   - 彻底废除 `resolve_thinking_config` 中对 4096 的锁死限制；
   - 对 `thinking_budget_tokens` 仅保留 `>= 1024` 的官方协议最低下限限制，不设硬性上限；
   - 当用户留空 `thinking_budget_tokens` 时，直接沿用 `max_output_tokens` 预算并保障最低 1024，使 RP 玩家设定的大 `max_tokens`（如 16k/32k/64k）能充分用于深度思维推演；
   - 在 `build_anthropic_http_request` 中自动确保 `max_tokens > budget_tokens`（若小于等于 budget 则自动提升至 `budget + 1024`，保证正文输出空间与网关合法性）。
2. **PC 端前端蓝图节点 (`src/components/blueprint/nodes/SamplingParamsAnthropicNode.tsx`)**：
   - `max_tokens`：开启 thinking 时，输入限制最低值动态提升为 `Math.max(1025, (props.config.thinking_budget_tokens ?? 1024) + 1)`，placeholder 提示 `留空 = 不覆盖（开启思考时自动保底）`；
   - `thinking_budget_tokens`：只限制最低 1024，placeholder 提示 `留空 = 沿用 max_tokens 预算`。
3. **移动端前端蓝图表单 (`src-mobile/components/blueprint/MobileNodeConfigForms.tsx`)**：
   - `AnthropicSamplingParamsForm` 严格对齐 PC 端改动：开启 thinking 时 `max_tokens` 动态约束最低值并优化 placeholder，`thinking_budget_tokens` 提示 `留空沿用 max_tokens 预算`。

---

## 改动动机
用户深入调研后提出：旧式手动 thinking budget 最低 1,024 tokens，最高取决于具体模型/API 的 max_tokens 等限制，不能一概而论；鉴于节点已经有了 `max_tokens`，就只限制最低 `max_tokens` 即可。
此前代码存在两大缺陷：
1. 留空 budget 时，旧逻辑用 `clamp(1024, 4096)` 强行将大模型的长思维链锁死在 4096，导致 RP 玩家配置了大 max_tokens 时思考过程依然被提前截断；
2. 开启 thinking 时如果用户在 `max_tokens` 输入了过小的值（如小于 1024），容易与 budget 冲突导致网关拒绝。
本次改动遵循用户总结，解禁思维链上限，由 `max_tokens` 动态决定，并保障最低 `max_tokens` 与最低 budget 合法性。

---

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端仅调整动态最低值约束与 UI 提示，核心动态预算分配与请求组装由 Rust 处理 |
| C2 Zero-Fallback Errors | √ | 保留显式最低 1024 校验与 max_tokens 严格大于判定，无静默吞错 |
| C3 Responsiveness | √ | 无任何阻塞主线程操作 |
| C4 AI UI Isolation | √ | 未破坏 AI 渲染沙箱层 |
| C5 Mobile Frontend Independence | √ | PC 端与移动端组件物理代码完全隔离，各自独立维护 |
| C6 Project Cache Location | √ | 工具链与构建缓存位于 D:\data\Night Voyage\.cache |
| C7 PC/Android Coverage | √ | PC 节点与移动端表单同步完成最低约束与提示升级 |

---

## 验收记录
1. **TypeScript 双端类型检查**：
   - `npx tsc --noEmit -p tsconfig.json; npx tsc --noEmit -p tsconfig.mobile.json`（全部通过，0 错误）
2. **Rust 单元测试**：
   - `cargo test --manifest-path src-tauri/Cargo.toml`（124 passed; 0 failed）
3. **全量 Release 双端构建**：
   - `scripts\build_dual_release.bat`（构建成功，耗时 3m 05s）
     ```
     Finished `release` profile [optimized] target(s) in 3m 05s
     Built application at: D:\data\Night Voyage\src-tauri\target\release\night-voyage.exe
     [Night Voyage] Release build succeeded.
     ```

---

## 已知限制或后续待办
- 无。思维链预算已完全解禁，完美支持 RP 场景下的长思维链推演。
