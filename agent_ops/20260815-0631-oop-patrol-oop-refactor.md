# OOP→组合 重构巡逻 · 单轮记录

- **时间**: 2026-08-15 06:31 (GMT+8)
- **agent_id**: oop-patrol
- **自动化任务**: automation-1786727854312（OOP→组合 重构巡逻，无人值守）
- **本轮重构点编号**: 单点（本轮只处理一个 OOP 违规点）

## 命中的 OOP 模式类型
- **模式 5**：`match` 用 `_ =>` 吞掉封闭枚举的未知变体（破坏穷尽性，掩盖未处理状态）。

## 证据（文件 + 行号 + 真实代码）
- **改动文件**: `src-tauri/src/commands/blueprint.rs`
- **旧写法（blueprint.rs:157）**: `match &node.config` 在 `NodeConfig`（封闭枚举，定义于 `models/blueprint.rs:36`，共 11 变体）上，仅列出 `MutexGate`/`GroupGate` 两臂，再以 `_ => None` 通配臂静默吞掉其余 9 个非门变体（Start/End/Prompt/SchemaField/ModeSwitch/RoleSwitch/SamplingParams/Constant/Branch + 任何未来新增变体）。新增门类型时编译器不会在此处报错，静默无门输出，掩盖真实状态，违背 guardrails「禁 `_ =>` 吞未知变体」。
- **新写法（blueprint.rs:151-167）**: 移除 `_ => None` 通配臂，显式列出全部 11 个变体：
  - `MutexGate`/`GroupGate` → `Some(BlueprintGateDto {...})`
  - `Start`/`End`/`Prompt`/`SchemaField`/`ModeSwitch`/`RoleSwitch`/`SamplingParams`/`Constant`/`Branch` → `None`
  - match 现穷尽 11/11 变体，编译器强制未来新增变体必须在此显式处理。

## 行为不变性论证
- `filter_map` 语义不变：仍是仅门节点（MutexGate/GroupGate）产出 `BlueprintGateDto`，其余节点输出 `None` 被过滤。
- DTO 字段（node_id/kind/label/options）构造逻辑零改动。
- 对外 IPC 协议、存储格式、前端契约未触碰（本任务纯结构重构）。

## 真实构建验收
- 命令: `export PATH="/d/data/Night Voyage/.cache/cargo/bin:$PATH" && cd src-tauri && CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_RUSTFLAGS="" cargo build`
- 结果: `Finished dev profile ... CARGO_EXIT=0`
- 仅 8 条预存 dead-code 警告（preset_gate_repository.rs / blueprint_executor.rs 未构造变体），无新增错误、无新增警告。

## 零信任重扫结论（本轮开头实际重扫）
- P1 深层 trait 继承：无 genuine（`memory_service.rs:81` 仅 `Send + Sync` marker bound）。
- P2 downcast：零命中。
- P3 `enum Kind + bool`：无（3 个 `*Kind` 枚举均纯数据 + 穷尽 match）。
- P4 bool 标志位：无 genuine（全部为 DB 模型 / IPC 参数 / 协议载荷持久化状态，受「禁改存储/IPC」铁律排除）。
- P5 `_ =>` 吞变体：本轮消除 `commands/blueprint.rs:157`。**剩余 genuine 1 处**：`services/blueprint_executor.rs:706`（同一 `NodeConfig` 枚举 `_ => Err(BranchMustFollowConstant(...))`，吞掉其余 10 变体）。其余约 30 处 `_ =>` 经核查均为开放集边界（`&str`/外部反序列化/第三方枚举递归），符合 guardrails 例外，判定非违规。

## 待下一轮
- 处理 `services/blueprint_executor.rs:706`（`NodeConfig` `_ => Err`）→ 显式列出 10 个非 Constant 变体臂 `=> Err(BranchMustFollowConstant(...))`，使 match 穷尽。
- 该处清零且末轮 build 通过 → 停止自主循环，向人类提交最终报告（不阻塞）。

## 约束合规
- C1 前端只渲染：√（未触碰前端）
- C2 零回退：√（移除静默掩盖，改穷尽 match）
- C3 响应性：√（无阻塞改动）
- C4 AI UI 隔离：√（不涉及）
- C5 移动端独立：√（后端共享，未开小门）
- C6 缓存位置：√（未涉及）
- C7 双端覆盖：√（后端共用）
- 组合/类型驱动原则：√（穷尽 match，编译期强制）
