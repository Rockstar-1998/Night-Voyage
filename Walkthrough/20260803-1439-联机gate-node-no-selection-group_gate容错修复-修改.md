# 修改摘要

## 问题现象
联机（online）模式下，所有玩家发送消息触发模型调用时报错：
`gate node n_mod_group has no selection in context`

## 根因定位
错误字符串 `"gate node X has no selection in context"` 仅由
`BlueprintError::MissingGateSelection` 产生，而该错误在 `src-tauri/src/services/blueprint_executor.rs`
的 `traverse` 中**两处**都可能触发：

- `MutexGate` 分支（本就要求必选单选，缺失选择报错——符合其契约）；
- `GroupGate` 分支——**但提交的源码里 GroupGate 分支写成了和 MutexGate 一样
  强制要求 selection**：
  ```rust
  NodeConfig::GroupGate(cfg) => {
      let selection = context
          .gate_selections
          .get(node_id)
          .ok_or_else(|| BlueprintError::MissingGateSelection(node_id.to_string()))?;
      ...
  }
  ```

默认预设 `Night Voyage 默认预设.nvpreset.json` 中 `n_mod_group` 是
`type: "group_gate"`（"可选增强模块"，天然可选多选取向）。当用户**未启用任何增强模块**
时，`preset_gate_selections` 表中没有 `n_mod_group` 的选中行（`load_preset_gate_selections`
返回空），于是 `gate_selections` 里没有该 node 的 entry。此时 GroupGate 分支命中
`ok_or_else(MissingGateSelection)`，抛出与用户完全一致的报错。

核实提交的源码即存在此 GroupGate 强制报错的逻辑缺陷——无需任何数据损坏即可复现：
只要 group_gate 节点无选中记录就会报错。这与 GroupGate 的设计语义（可选多选，缺失/空集为合法状态）直接冲突。

## 修复内容
文件：`src-tauri/src/services/blueprint_executor.rs`，`traverse` 函数 GroupGate 分支：

- 将强制 `.ok_or_else(MissingGateSelection)` 改为
  `.map(|sel| sel.keys.clone()).unwrap_or_default()`，使缺失/空集时 `selected_keys`
  为空，仅遍历实际选中的分支；未选任何项时直接收敛到 merge 节点（产出 0 块），不再报错。
- 同步修正了注释，澄清 GroupGate 与 MutexGate 的契约差异（C2 零回退：空集是合法语义，
  不是错误）。
- 在 MutexGate 与 GroupGate 两个分支入口各加一条 `eprintln!` 诊断日志（原误用
  `dbg_eprintln!`，该宏不在本模块作用域，导致编译失败 `cannot find macro dbg_eprintln
  in this scope`；已改为标准库 `eprintln!`），记录 `node_id` 与 `selections_present` /
  `selected_keys`，便于运行时确认到底走的是哪个分支、以及 `n_mod_group` 实际是否带选中数据。

修复后：联机（及单人）发送消息执行蓝图时，未配置增强模块的 GroupGate 节点不再抛错，
直接走到 merge；若用户后续在预设里勾选增强模块，`preset_gate_selections` 有对应行，
则照常展开所选分支。

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅修改后端 Rust 执行器，不动前端渲染 |
| C2 Zero-Fallback Errors | √ | 空集改为合法语义（不报错、不静默替换）；诊断日志显式打印，未吞异常 |
| C3 Responsiveness | √ | 纯内存 DFS，无阻塞；仅在 gate 节点加两行日志 |
| C4 AI UI Isolation | √ | 不涉及 AI 沙箱 |
| C5 Mobile Frontend Independence | √ | 后端共享逻辑，未改动任何前端代码；双端均经同一 Tauri 命令调用 |
| C6 Project Cache Location | √ | 无新增缓存写入 |
| C7 PC/Android Coverage | √ | 后端命令双端共用，本次为后端修复，自动覆盖 PC 与 Android |

## 验收记录
- 构建命令（本环境 cargo 位于 `.cache/cargo/bin/cargo.exe`，需先设 `CARGO_HOME`）：
  ```
  cd /d "d:/data/Night Voyage" && set "CARGO_HOME=D:\data\Night Voyage\.cache\.cargo" && set "PATH=%PATH%;D:\data\Night Voyage\.cache\cargo\bin" && "D:\data\Night Voyage\.cache\cargo\bin\cargo.exe" build --manifest-path src-tauri/Cargo.toml --offline
  ```
- 构建实际执行结果：**`Finished \`dev\` profile [optimized + debuginfo] target(s) in 0.88s`**，
  无 `error`（仅存在若干与本次无关的既有 dead_code warning，如 `NodeType`/`node_type`/
  `ConversationGateRepository` 等，非本次引入）。
- 关键修正过程：首次本地编译在 `night-voyage` crate 报
  `error: cannot find macro dbg_eprintln in this scope`（2 处）。根因是该宏仅存在于
  `prompt_compiler.rs` 的 `#[macro_use]`/crate 级导入，未在本模块 `blueprint_executor.rs`
  作用域。已将两处 `dbg_eprintln!` 替换为标准库 `eprintln!`（始终在作用域）后重新编译通过，
  调试产物 `src-tauri/target/debug/night-voyage.exe` 时间戳刷新为 `2026-08-04 00:29:23`，
  确认构建产物为最新。
- **Release 构建（`scripts/build_dual_release.bat`）验证**：
  - 先发现该 bat 自身存在独立缺陷：它仅设置 `CARGO_HOME=%CACHE_DIR%\.cargo`，但从未把
    工具链 bin 目录 `%CACHE_DIR%\cargo\bin`（注意**无前导点**）加入 `PATH`。`tauri build`
    内部通过普通 PATH 查找来派生 `cargo metadata`，而 `cargo.exe` 实际位于
    `.cache\cargo\bin`，不在系统 PATH 上，故首跑报
    `failed to run 'cargo metadata' ... program not found`——此失败发生在预检阶段，
    **早于任何 Rust 代码编译**，与本次 gate 修复无关。
  - 已在 `build_dual_release.bat` 第 15 行后追加
    `set "PATH=%CACHE_DIR%\cargo\bin;%PATH%"`（在 `setlocal` 作用域内，不污染全局环境）。
  - 修复后重跑 `build_dual_release.bat`（日志落盘 `.cache/build_release.log`）结果：
    `Finished \`release\` profile [optimized] target(s) in 4m 32s`、
    `Built application at: ...\target\release\night-voyage.exe`、
    `[Night Voyage] Release build succeeded.`，并将产物同步至 instance-a / instance-b。
    发布产物时间戳 `2026-08-04 07:42:36`，确认本次 gate 修复已包含进 release 可执行文件。
  - 该 bat PATH 修复属于构建支撑性改动，随本次一起提交（同样仅改 `scripts/build_dual_release.bat`，
    不影响任何业务/前端逻辑，C1–C7 不受影响）。
- 静态一致性核对：
  - 仅做分支内局部逻辑替换：`let selection = context.gate_selections.get(node_id).ok_or_else(MissingGateSelection)?`
    → `let selected_keys = context.gate_selections.get(node_id).map(|s| s.keys.clone()).unwrap_or_default()` + 诊断日志；
  - 所用符号均已在同文件既有代码验证存在且类型正确：`GateSelection { keys: Vec<String> }`
    （`models/blueprint.rs:303`）、`target_of` / `find_merge_node` / `context.gate_selections` /
    `cfg.options` 均为原分支已用变量。
  - 全仓搜索确认 `MissingGateSelection` 仅剩 `MutexGate` 分支（line 221）一处构造，GroupGate 分支已不再引用。
  - 既有测试（`blueprint_executor.rs:1283` 期望 mutex gate 报 `MissingGateSelection`）仍成立。
- 验收方式（运行时）：
  1. 联机房间使用默认预设、不勾选任何"可选增强模块" → 发送消息不再报
     `gate node n_mod_group has no selection in context`；
  2. 查看后端 stderr 是否出现 `[blueprint-executor] GroupGate node=n_mod_group reached;
     selections_present=false; selected_keys=None`（确认走的是 GroupGate 分支且空集被正常接受）；
  3. 在预设里勾选若干增强模块后，日志应显示 `selected_keys=Some([...])` 且对应模块 block 正常产出。
- 预期效果：联机/单人发送消息在 GroupGate 无选中时正常通过，模型调用不再中断。
- 实际结果（编译）：`cargo build --offline`（debug）已通过，无 error；release 构建由
  `scripts/build_dual_release.bat` 完成（`Finished \`release\` profile [optimized] target(s)
  in 4m 32s`，产物时间戳 `2026-08-04 07:42:36`，同步至 instance-a/instance-b）。
  运行时联机复现验证（stderr 出现 `[blueprint-executor] GroupGate node=n_mod_group reached;
  selections_present=false; selected_keys=None`）建议用户在本机用发布包实测确认。

## 已知限制或后续待办
- 本次一并修复了 `scripts/build_dual_release.bat` 缺 PATH 的构建支撑缺陷（加
  `set "PATH=%CACHE_DIR%\cargo\bin;%PATH%"`），使该 bat 在本环境可真正跑通 release 构建。
- 若后续要把 GroupGate 的"缺失选中"与 MutexGate 的"缺失选中"做更明确的错误区分，
  可考虑在 `validate_graph` 阶段对未配置选中的 MutexGate 给出更友好的预设级校验提示
  （非本次范围）。
