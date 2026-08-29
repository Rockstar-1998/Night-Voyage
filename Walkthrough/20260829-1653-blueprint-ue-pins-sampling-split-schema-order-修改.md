# 蓝图修订：横向布局 + UE 式引脚 + 真数据流 + Sampling 拆分 + Schema 顺序可控

## 1. 改动摘要

按用户四项修订需求完成蓝图编辑器改造：

1. **回退为横向布局 + UE 式分类引脚**：`nodeLayout.ts` / `mobileNodeLayout.ts` 已是横向布局（输入左缘、输出右缘），并将端口分为三类——`exec`（三角，执行流）、`value`（圆，数据值，按数据类型着色）、`bool`（菱形，判定节点分支出口）。常量节点为纯值节点（只有 `value` 出口，无 `exec` 入口）；分支节点为 `exec 入 + value 入 + bool 出 × N`。两个 canvas 独立渲染对应形状（C5）。

2. **真数据流（取代 Branch 回溯）**：后端 `blueprint_executor.rs` 新增 `BlueprintValue` / `ValueEnvironment` 缓存、`evaluate_pure_node`（pull-based 反向求值）、`read_input_value`。`Constant` 输出值沿 `value` 边向下游传递，删除旧 `resolve_constant_source` 回溯逻辑及其注释。运行时图结构由 `Start → Constant → Branch` 变为 `Start → Branch(exec)` + `Constant → Branch(value)`。

3. **Sampling Params 拆分为 OpenAI / Anthropic 两版**：新增 `SamplingParamsOpenAi` / `SamplingParamsAnthropic` 两个节点类型与对应配置结构；执行器按 `context.protocol`（新增 `SamplingDialect` 解析）自动路由，只应用匹配版本参数，不匹配版本遍历通过但不出参；非法协议（非 `anthropic` / `chat_completions`）显式报错（新增 `UnknownSamplingProtocol`）。legacy `sampling_params` 保留可加载可执行但不可新建，按方言裁剪字段。

4. **Schema 字段顺序可控**：`SchemaFieldConfig` 新增可编辑 `order: i32`；执行器 `order_schema_properties` 改为按 `(order, 遍历插入序)` 稳定排序，核心基线字段 `thinking(-2)` / `text(-1)` 固定在前；删除原 `schema_field_priority` 硬编码（thinking→text→字母序）。双端配置面板新增 `order` 数值输入。

### 关键文件
- 后端：`src-tauri/src/models/blueprint.rs`、`src-tauri/src/services/blueprint_executor.rs`、`src-tauri/src/commands/blueprint.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/services/preset_service.rs`
- 前端契约：`src/lib/blueprint/types.ts`、`src/lib/backend/gates.ts`
- PC：`nodeLayout.ts`、`BlueprintCanvas.tsx`、`NodeConfigPanel.tsx`、`NodeSelector.tsx`、`BlueprintEditor.tsx`、`nodes/SamplingParamsOpenAiNode.tsx`（新）、`nodes/SamplingParamsAnthropicNode.tsx`（新）、`nodes/SchemaFieldNode.tsx`
- 移动端：`mobileNodeLayout.ts`、`MobileBlueprintCanvas.tsx`、`MobileNodeConfigForms.tsx`、`MobileNodeConfigPanel.tsx`、`BlueprintEditor.tsx`、`MobilePresetBlueprintEntry.tsx`
- 数据/脚本：`测试预设/Night Voyage 默认预设.nvpreset.json`、`测试预设/gen_default_preset.py`

## 2. 改动动机

- 用户要求回到横向蓝图、引入 Unreal Engine 式分类连接引脚（值节点/布尔判断节点按类型区分，如 Constant 只需出口连线）。
- 旧图把 Constant 串在执行流上靠 Branch 回溯取值，语义脆弱；改为真数据流让值由 `value` 边显式传递，图语义清晰。
- OpenAI 与 Anthropic 采样参数支持的能力集不同（thinking / penalty 等），拆分后避免同名字段互相覆盖，并按会话协议精确路由。
- 原 `order_schema_properties` 硬编码 thinking→text→字母序，作者无法控制；改为显式 `order` 字段使顺序作者可控。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 引脚分类校验、`SamplingDialect` 路由、`(order, 遍历序)` 排序、旧图归一化全部在 Rust 侧；前端只渲染与提示保存 |
| C2 Zero-Fallback Errors | √ | 非法协议显式报错；值引脚未连报错；旧图迁移必须可见（`showToast` + `setDirty`/`setMigrated`），无静默兜底 |
| C3 Responsiveness | √ | 归一化为异步 IPC 命令；画布渲染为纯函数计算，不阻塞 UI 线程 |
| C4 AI UI Isolation | N/A | 本次不涉及 AI 生成 UI |
| C5 Mobile Frontend Independence | √ | PC 与移动端各自独立实现 `nodeLayout` / canvas / 配置表单；仅共享 `src/lib/blueprint/types.ts` 类型定义（既有约定） |
| C6 Project Cache Location | N/A | 本次无运行时缓存写入 |
| C7 PC/Android Coverage | √ | 每个新功能（UE 引脚、真数据流、Sampling 双版本、schema order）均双端同步覆盖 |

## 4. 验收记录

- **构建命令**：`scripts/build_dual_release.bat`（后端 + PC 前端）→ `Release build succeeded`；`npm run build:mobile` → `✓ built in 1m 4s`；`npx tsc --noEmit -p tsconfig.json` 与 `-p tsconfig.mobile.json` 均无错误。
- **后端测试**：`cargo test --lib blueprint` → `38 passed; 0 failed`（含新增的 OpenAI/Anthropic 路由、未知协议报错、schema order 可控、旧图归一化相关测试）。
- **预期效果**：
  - 蓝图为横向布局，端口按 exec(三角)/value(圆)/bool(菱形) 区分形状与颜色。
  - Constant 仅 `value` 出口；Branch 有 `exec` 入 + `value` 入 + 多个 `bool` 出。
  - 新建 Sampling 时出现 OpenAI / Anthropic 两个独立节点类型，分别只含对应协议支持的字段。
  - Schema Field 配置面板出现 `order` 输入，调整后可改变 `properties` / `required` 生成顺序。
  - 旧预设加载时若拓扑为旧式（Constant 串 exec），编辑器提示「已升级为 value 引脚拓扑，请保存」。

## 5. 已知限制或后续待办

- 旧随包预设 `Night Voyage 默认预设.nvpreset.json` 已手工归一化 `e3 → value`，无需运行时迁移即可加载；但若用户有其它旧图，仍需编辑器加载时的归一化提示并手动保存。
- `SamplingDialect` 目前只接受 `chat_completions` / `anthropic`；若未来接入第三种协议家族，需扩展解析与对应节点类型。
- 执行顺序标签（BFS 顺序）为渲染层辅助信息，真实执行顺序仍由后端执行器决定，二者语义独立。
