# load_blueprint_gates 空状态语义修复

## 改动摘要

| 文件 | 操作 | 说明 |
|------|------|------|
| `src-tauri/src/commands/blueprint.rs` | 修改 | `load_blueprint_gates` 命令：预设无 `blueprint_graph` 时返回空 vec 而非报错 |

### 函数级改动

`load_blueprint_gates`（行 107-162）：

- **原逻辑**：`blueprint_graph` 为 NULL 或空串时，`ok_or_else(...)` 报错
  `"preset {id} has no blueprint_graph"`，前端走错误分支显示红色错误框。
- **新逻辑**：NULL 或空串时 `return Ok(Vec::new())`，前端走空状态分支显示
  "该预设蓝图没有可配置的 Gate 选项"提示。
- JSON 解析失败（数据损坏）仍显式报错，不变。

## 改动动机

用户运行时报错："加载失败：preset 5 has no blueprint_graph"。

根因：`load_blueprint_gates` 把"预设尚未创建蓝图"这一合法空状态当作错误处理。
PresetDetailView 的前端代码已有空状态 UI（`gates().length === 0` 时显示"该
预设蓝图没有可配置的 Gate 选项"），但后端报错导致前端走 `catch` 分支显示
红色错误框，空状态 UI 永远无法触发。

**C2 合规辨析**：此修复**不是** C2 违规。C2 禁止吞掉*意外*错误以假装成功；
而"预设没有蓝图"是合法的空状态，返回空集合是其正确语义表达。类比：查询
一个空表返回空 vec 不是错误。真正的错误（JSON 损坏）仍显式报错。

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 改动仅在后端命令层 |
| C2 Zero-Fallback Errors | √ | 空状态返回空 vec 是正确语义，非吞错误；JSON 损坏仍报错 |
| C3 Responsiveness | √ | 无影响 |
| C4 AI UI Isolation | √ | 不涉及 |
| C5 Mobile Frontend Independence | √ | 不涉及前端 |
| C6 Project Cache Location | √ | 不涉及 |
| C7 PC/Android Coverage | √ | 后端命令双端共享，修复同时生效 |

## 验收记录

### 构建命令

```bash
cd src-tauri && cargo build
# 退出码 0，仅预存在的 dead_code 警告，无错误
```

### 预期效果

- 预设有蓝图且有 Gate 节点 → 正常返回 Gate 列表（不变）
- 预设有蓝图但无 Gate 节点 → 返回空 vec（不变）
- 预设无蓝图（NULL/空串）→ **返回空 vec**（原为报错），前端显示空状态提示
- 预设蓝图 JSON 损坏 → 显式报错（不变）

### 实际结果

- `cargo build` 通过（退出码 0）
- 待运行时验收：打开无蓝图的预设（如 preset 5），应看到空状态提示而非错误

## 已知限制或后续待办

1. 运行时人工验收未做：需启动应用打开 preset 5 确认显示空状态而非错误
2. `prompt_compiler.rs:584` 有一处类似的 "preset has no blueprint_graph" 报错，
   但那是编译期（生成系统提示词时）的硬要求——无蓝图无法编译提示词，报错
   合理。本次仅修复详情视图查询的空状态语义，不影响编译路径。
