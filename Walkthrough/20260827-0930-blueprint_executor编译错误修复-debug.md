# debug：blueprint_executor 编译错误修复

- 修改类型：debug
- 时间：2026-08-27 09:30

## 1. 改动摘要

| 文件 | 改动 |
|------|------|
| `src-tauri/src/services/blueprint_executor.rs` | ① 在 `use crate::models::blueprint::{...}` 导入中补充 `BlueprintEdge`；② `ordered_outgoing_targets` 返回类型与局部变量从错误的 `Edge`/`BlueprintError` 修正为 `BlueprintEdge`；③ 对 `output_port_priority` 的调用补上缺失的 `source` 参数（该函数签名为 `(graph, source, port)` 三参）。 |

## 2. 改动动机

`build_dual_release.bat`（release 构建）失败，`cargo build --release` 报 4 个错误：

- `E0425: cannot find type BlueprintEdge in this scope` ×2（`blueprint_executor.rs:622/623`）—— `ordered_outgoing_targets` 写成了不存在的 `BlueprintError`/`Edge` 类型。
- `E0061: this function takes 3 arguments but 2 arguments were supplied` ×2（`:629/630`）—— `output_port_priority(graph, &a.source_port)` 漏传了 `source` 参数。

这是先前实现「执行顺序绑定在出口端口 + order」时引入的未完成代码，导致 release 构建无法通过。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 后端编译修复，不涉前端渲染。 |
| C2 Zero-Fallback Errors | √ | 修正类型与签名错误，无静默回退；`output_port_priority` 未命中节点时仍显式返回 `usize::MAX`。 |
| C3 Responsiveness | √ | 无阻塞操作，纯编译修复。 |
| C4 AI UI Isolation | √ | 未涉及 AI 动态 UI。 |
| C5 Mobile Frontend Independence | √ | 后端共享逻辑，不涉前端耦合。 |
| C6 Project Cache Location | √ | 未涉及缓存目录。 |
| C7 PC/Android Coverage | √ | 后端修复对双端生效。 |

## 4. 验收记录

- 构建命令：
  - `cargo build --release`（通过 `scripts/build_dual_release.bat` 注入的本地工具链 PATH）→ `Finished \`release\` profile [optimized] target(s) in 0.99s`，`EXIT=0`。
- 预期效果：4 个编译错误消除，release 构建成功。
- 实际结果：编译通过，仅剩 8 个既有 dead_code 警告（与本次改动无关）。

## 5. 已知限制 / 后续待办

- 本次仅修复编译阻断。`BlueprintError` 的 `LockedNodeOffMainPath` / `SchemaBuildError` 变体与 `conversation_gate_repository`、`preset_gate_repository` 部分函数存在 dead_code 警告，属于既有代码清理范畴，非本次范围。
