# 修改留痕 · blueprint 门节点 match 穷尽化

- **时间**: 2026-08-15 06:31 (GMT+8)
- **修改类型**: 修改
- **主题**: 消除 `commands/blueprint.rs` 中 `NodeConfig` 封闭枚举 `_ => None` 通配臂（模式 5）

## 1. 改动摘要
- **文件**: `src-tauri/src/commands/blueprint.rs`
- **函数/位置**: `get_blueprint_gates` 内的 `graph.nodes.iter().filter_map(...)`（旧行 144–158，新行 144–167）
- **改动内容**:
  - 旧：仅 `NodeConfig::MutexGate`/`NodeConfig::GroupGate` 两臂 + `_ => None` 通配吞掉其余 9 变体。
  - 新：移除 `_ => None`，显式列出全部 11 变体（`MutexGate`/`GroupGate` → `Some(DTO)`，其余 9 个 → `None`），match 穷尽 11/11。
- **类型决策**: `NodeConfig` 定义于 `models/blueprint.rs:36`，封闭枚举（derive Serialize/Deserialize，内部标签），共 11 变体。

## 2. 改动动机
封闭枚举上的 `_ =>` 通配臂会掩盖未来新增变体（如新增门类型时编译器不会强制在此处理），属 AGENTS.md「组合优于继承 / 类型驱动」明确反对的模式 5。改为穷尽 match 后，编译器强制任何新增变体必须显式处理，消除静默掩盖，符合 C2 零回退与 guardrails「禁 `_ =>` 吞未知变体」。

## 3. 约束合规审计表
| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 未触碰前端 |
| C2 Zero-Fallback Errors | √ | 移除静默吞变体的通配臂，改穷尽 match |
| C3 Responsiveness | √ | 无阻塞改动 |
| C4 AI UI Isolation | √ | 不涉及 |
| C5 Mobile Frontend Independence | √ | 后端共享，未开小门 |
| C6 Project Cache Location | √ | 未涉及 |
| C7 PC/Android Coverage | √ | 后端共用 |
| 组合/类型驱动原则 | √ | 穷尽 match，编译期强制未来变体显式处理 |

## 4. 验收记录
- **构建命令**: `export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build`
- **验收方式**: 真实 debug 构建（退出码 0）
- **预期效果**: 编译通过，filter_map 仅门节点产出 DTO，行为不变
- **实际结果**: `Finished dev profile ... CARGO_EXIT=0`，仅 8 条预存 dead-code 警告，无新增错误/警告

## 5. 已知限制
- `services/blueprint_executor.rs:706` 仍有同一 `NodeConfig` 枚举的 `_ => Err` 通配臂（模式 5），留待下一轮处理（本轮单点原则）。
- 双端 release 校验（`scripts/build_dual_release.bat`）本轮未跑；debug 构建已覆盖类型/借用检查，release 仅增量优化差异，风险低。
- 出网 `git push` 受环境硬性限制（前轮 TLS 握手失败），见 git 提交已知限制。
