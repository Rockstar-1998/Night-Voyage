# 修复 Anthropic 思维链思考预算下限导致网关转换失败 - Walkthrough

## 改动摘要
1. **后端适配层 (`src-tauri/src/services/provider_adapter.rs`)**：
   - 在 `resolve_thinking_config` 中，将 thinking budget 的有效范围下限由 `128` 修复为 `1024`（`.clamp(1024, 128000)`）。
   - 在 `build_anthropic_http_request` 中新增对 Anthropic 协议硬约束的保护：当启用 thinking 时，若 `max_tokens <= budget_tokens`，自动将 `max_tokens` 设为 `budget + 1024`，保证网关在进行协议转换时不因最大输出小于等于预算而被拒绝。
2. **后端预设校验器 (`src-tauri/src/validators/preset_validator.rs`)**：
   - `normalize_thinking_budget_tokens_impl` 中将预算下限由 128 调整为 1024（`thinkingBudgetTokens 必须 >= 1024`）。
3. **PC 端前端蓝图节点 (`src/components/blueprint/nodes/`)**：
   - `SamplingParamsAnthropicNode.tsx`：将 `thinking_budget_tokens` 输入框的 label、`min` 属性及 `Math.max` 下限全部由 `128` 修正为 `1024`。
   - `SamplingParamsNode.tsx`：将 `thinking_budget_tokens` 输入框的 label、`min` 属性及 `Math.max` 下限全部由 `128` 修正为 `1024`。
   - `BranchNode.tsx`：将分支节点规则列表由 `<For>` 重构为 `<Index>`，消除按键输入导致整行 DOM 销毁重建而引发的输入失焦。
4. **移动端前端蓝图表单与预设 (`src-mobile/components/blueprint/`)**：
   - `MobileNodeConfigForms.tsx`：`SamplingParamsForm` 与 `AnthropicSamplingParamsForm` 的 `thinking_budget_tokens` label 与校验下限全部修正为 `≥1024`。
5. **预设导出与路径友好提示 (`src-tauri/src/commands/presets/mod.rs`, `src/lib/backend/presets.ts`)**：
   - 新增 `presets_export_to_file` Tauri 命令，PC 端导出预设后直接弹出弹窗告知具体保存路径，并支持一键打开导出文件。

---

## 改动动机
用户在使用 Anthropic 协议模型（端点 `https://note3-prev-api.askdiandian.com`）对话时报错：
`失败原因:LLM 请求失败: 500 Internal Server Error {"title":"Request conversion failed","status":500,"detail":"The request is invalid. Check the request and try again.","traceId":"e8549a45688fef2ad4981161990d1217","error_type":"gateway.request_conversion_failed"}`

经实机抓包与阶梯压测（分别测试 budget = 128, 512, 1000, 1023, 1024）：
- Anthropic 官方规范要求 `budget_tokens >= 1024` 且 `max_tokens > budget_tokens`。
- 当 `budget < 1024` 时，Anthropic 兼容层直接报 `gateway.request_conversion_failed`（500 拒绝转换）。
- 当 `budget >= 1024` 时，直接返回 200 SUCCESS。
因此需要全面修正双端前端及后端针对 thinking_budget_tokens 的合法下限及配额保证。

---

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 前端仅调整 UI 输入框下限（min 属性与显示文案），核心协议组装与上限保底逻辑全部由 Rust 后端处理 |
| C2 Zero-Fallback Errors | √ | 校验器对非法低值严格返回错误，无静默吞错；网络层严格抛出网关原始返回 |
| C3 Responsiveness | √ | 不引入任何阻塞主线程或阻塞 UI 的操作 |
| C4 AI UI Isolation | √ | 未修改 AI 渲染沙箱层 |
| C5 Mobile Frontend Independence | √ | PC 端（src/）与移动端（src-mobile/）组件各自独立维护，零代码耦合 |
| C6 Project Cache Location | √ | 工具链与构建缓存位于 D:\data\Night Voyage\.cache |
| C7 PC/Android Coverage | √ | PC 端蓝图节点与移动端蓝图表单同步完成下限由 128 到 1024 的升级改造 |

---

## 验收记录
1. **端点实机测试**：
   - 使用 Python 对 `https://note3-prev-api.askdiandian.com` 进行压测：`budget=1024` 成功返回 200，证明了下限约束的有效性（128/512/1000/1023 均被网关拒绝 500）。
2. **TypeScript 双端类型检查**：
   - `npx tsc --noEmit -p tsconfig.json`（通过，0 错误）
   - `npx tsc --noEmit -p tsconfig.mobile.json`（通过，0 错误）
3. **Rust 单元测试与双端全量 Release 构建**：
   - `cargo test --manifest-path src-tauri/Cargo.toml`（124 passed; 0 failed）
   - `scripts/build_dual_release.bat`（执行全量 Release 构建成功）
     ```
     Finished `release` profile [optimized] target(s) in 3m 04s
     Built application at: D:\data\Night Voyage\src-tauri\target\release\night-voyage.exe
     [Night Voyage] Release build succeeded.
     ```

---

## 已知限制或后续待办
- 无已知限制。各端协议在 thinking budget 规范上已完全与 Anthropic 官方要求对齐。
