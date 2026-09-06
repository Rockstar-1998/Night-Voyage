# 修复蓝图 OpenAI 采样节点保存失败（serde 命名不一致）

- 日期：2026-09-06
- 类型：debug

## 一、改动摘要

| 文件 | 改动 |
|------|------|
| `src-tauri/src/models/blueprint.rs` | ① `NodeType::SamplingParamsOpenAi`（L34）与 `NodeConfig::SamplingParamsOpenAi`（L67）各加 `#[serde(rename = "sampling_params_openai")]`；② 测试模块追加回归测试 `sampling_params_openai_serde_round_trip` |

## 二、改动动机（Bug 复现与根因）

**现象**：蓝图编辑器创建「SamplingParams（OpenAI 版）」节点后保存失败：
`保存蓝图失败：blueprint_graph JSON 无效: unknown variant 'sampling_params_openai', expected one of ... 'sampling_params_open_ai' ...`

**根因**：前后端节点类型命名不一致。Rust 端 `NodeConfig` / `NodeType` 用容器级 `#[serde(rename_all = "snake_case")]`，serde 将 `SamplingParamsOpenAi` 中的 `OpenAi` 按内部大小写边界拆分为 `open_ai`，得到序列化名 `sampling_params_open_ai`；而前端（`src/lib/blueprint/types.ts` L31/L216 + PC/mobile 编辑器共 30+ 处）统一使用 `sampling_params_openai`（无下划线）。前端拼法在后端反序列化时命中 `unknown variant`，保存即失败。

`sampling_params_anthropic` 未出问题是巧合——`Anthropic` 是单词，snake_case 转换无歧义，前后端恰好一致。

**无存量数据风险**：该类型节点自上线起从未保存成功过，数据库中不存在 `sampling_params_open_ai` 拼法的存量图，无需数据迁移。

## 三、修复方案

后端对齐前端（前端 30+ 处不动，改动最小）：

```rust
#[serde(rename = "sampling_params_openai")]
SamplingParamsOpenAi,
```

NodeType 与 NodeConfig 两个 variant 各加一行显式 rename，与 `sampling_params_anthropic` 命名风格保持对称。

## 四、约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 只改后端序列化合约，前端零改动 |
| C2 Zero-Fallback Errors | √ | 修复后反序列化不再报错；未知 variant 仍显式报错（保持原有行为） |
| C3 Responsiveness | √ | 纯序列化常量，无性能影响 |
| C4 AI UI Isolation | √ | 不涉及 |
| C5 Mobile Frontend Independence | √ | 前端零改动，双端自动一致 |
| C6 Project Cache Location | √ | 无缓存写入 |
| C7 PC/Android Coverage | √ | 后端共享，双端同时修复 |

## 五、验收记录

- 单元测试：`cargo test sampling_params_openai`（注入项目工具链 PATH 后运行）
  - 反序列化前端拼法 `sampling_params_openai` 成功
  - 序列化往返保持前端拼法（断言不出现 `open_ai`）
  - `NodeType` 判别值输出 `"sampling_params_openai"`
- 双端构建：`scripts/build_dual_release.bat`（输出见提交记录）
- 人工验收：
  1. 启动应用 → 蓝图编辑器 → 任意预设 → 添加「SamplingParams（OpenAI 版）」节点 → 保存 → **不再报错**
  2. 重新打开该预设 → 节点仍在且配置完整
  3. OpenAI 协议会话中该节点参数生效（temperature 等出现在请求体）

## 六、已知限制与后续

1. 本修复只解决「保存失败」；协议分支的采样节点装配（match_value 带空格 `chat completions`、端口无 `out_` 前缀、占位节点 `n_prompt_6_cin4`）属用户在编辑器内自行修补的预设侧工作，不在本修复范围。
2. 若未来前端重命名节点类型，此 serde 合约测试会第一时间报警。
