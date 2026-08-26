# 修改：蓝图 thinking 字段双端补全 + PORT_ROW_HEIGHT 常量恢复

- 修改类型：修改
- 时间：2026-08-26 10:30

## 1. 改动摘要

| 文件 | 改动 |
|------|------|
| `src/components/blueprint/nodeLayout.ts` | 恢复竖向布局缺失的 `PORT_ROW_HEIGHT = 22` 常量（原水平布局遗留，竖向重构时重命名漏改引用）。 |
| `src-mobile/components/blueprint/mobileNodeLayout.ts` | ① 恢复 `PORT_ROW_HEIGHT = 22` 常量；② `defaultConfigForType('sampling_params')` 补齐 `thinking_enabled` / `thinking_budget_tokens` 字段。 |
| `src-mobile/components/blueprint/MobileNodeConfigForms.tsx` | ① `SamplingParamsForm` 新增 `thinking_enabled`（Toggle）与 `thinking_budget_tokens`（NumberInput，≥128）字段，与 PC 端对齐；② `defaultConfigForType('sampling_params')` 补齐 `thinking_enabled` / `thinking_budget_tokens`。 |

## 2. 改动动机

上一次提交（thinking_enabled / thinking_budget_tokens 字段加入共享 `SamplingParamsConfig` 类型 + 蓝图布局竖向重构）遗留了两处编译错误，导致 PC 与移动端 TypeScript 均无法通过 `tsc --noEmit`：

1. 竖向布局重构把 `PORT_ROW_HEIGHT` 改名为 `PORT_COL_WIDTH`，但 `nodeLayout.ts:253`、`mobileNodeLayout.ts:236` 仍引用了 `PORT_ROW_HEIGHT`，报错 `TS2304: Cannot find name 'PORT_ROW_HEIGHT'`。
2. 共享类型 `SamplingParamsConfig` 新增 `thinking_enabled` / `thinking_budget_tokens` 后，移动端两处 `sampling_params` 默认配置（MobileNodeConfigForms、mobileNodeLayout）未补字段，报错类型不兼容 `TS2322`。

这两处错误使任务一直处于"未完成"状态。本次补全后两端 tsc 均零错误。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅前端类型/表单/常量补全，无渲染外逻辑改动。 |
| C2 Zero-Fallback Errors | √ | 无静默回退；缺失字段为显式补全，非默认成功。 |
| C3 Responsiveness | √ | 仅静态常量与表单字段，无阻塞操作。 |
| C4 AI UI Isolation | √ | 未涉及 AI 动态 UI。 |
| C5 Mobile Frontend Independence | √ | 移动端独立补全，未与 PC 互引；两端各自保持一致。 |
| C6 Project Cache Location | √ | 未涉及缓存目录。 |
| C7 PC/Android Coverage | √ | 移动端补齐 PC 端已有的 thinking 字段与布局常量，两端一致。 |

## 4. 验收记录

- 构建命令：
  - `npx tsc --noEmit -p tsconfig.json` → 输出为空（零错误）。
  - `npx tsc --noEmit -p tsconfig.mobile.json` → 输出为空（零错误）。
- 验收方式：跑两端独立 tsc 类型检查。
- 预期效果：此前 `PORT_ROW_HEIGHT` 与 `thinking_*` 字段两类 TS 错误消失，两端编译通过。
- 实际结果：两端 `tsc --noEmit` 均返回空输出，编译通过。

## 5. 已知限制 / 后续待办

- 本次仅修复编译阻断，未改动 thinking 字段在移动端的禁用逻辑（PC 端 `disabled={!thinking_enabled}` 已对齐到移动端 `onChange` 语义；移动端 budget 输入未加 `disabled` 联动，属体验差异非错误，可后续优化）。
- 后端 `provider_adapter.rs` 的 `resolve_thinking_config` 仅对 `anthropic` 生效，其余 provider 显式返回 `None`（C2 零回退：不支持即不注入，不静默降级）——符合设计。
