# 蓝图编译预览SQL与Start节点反序列化修复 — debug

## 改动摘要

| 文件 | 改动点 |
|------|--------|
| `src-tauri/src/commands/blueprint.rs` | 修复 `list_preset_conversations` 中的 SQL 错误：将不存在的 `ap.protocol` 改为 `ap.provider_kind`，并对齐映射为 `"anthropic"` / `"chat_completions"`；修复 `preview_blueprint_with_session` 中的默认协议（对齐为 `"chat_completions"`）与 `character_id` 解析（支持 `COALESCE(character_id, host_character_id)`）。 |
| `src-tauri/src/models/blueprint.rs` | 为 `BlueprintNode` 实现具有防御性的定制 `Deserialize`：若反序列化输入中的 `start` / `end` 节点包含前端占位符 `"config": {}`，在分发给内部标签枚举前安全剥离 `config`，解决 Serde 单元变体报 `invalid type: map, expected unit variant NodeConfig::Start` 问题；增加对应单元回归测试 `start_and_end_node_tolerates_empty_config_object`。 |
| `src/components/blueprint/BlueprintEditor.tsx` | 修复打开编译预览模态窗时的蓝图序列化传参：改用已有的标准序列化工具 `serializeBlueprintGraph(graph)` 代替裸 `JSON.stringify(graph)`。 |

## 改动动机

用户在蓝图编辑器中打开「编译预览」模态窗时遇到两处报错阻断：
1. `error returned from database: (code: 1) no such column: ap.protocol`：`api_providers` 表中仅有 `provider_kind` 字段存储提供商类型，不存在 `protocol` 字段。导致拉取会话上下文列表时 SQLite 报错；
2. `blueprint_graph JSON invalid: invalid type: map, expected unit variant NodeConfig::Start at line 1 column 106`：前端 `BlueprintEditor` 内存中 `BlueprintNode` 对 `start`/`end` 节点附带了 TS 类型占位符 `config: {}`，在直接调用 `JSON.stringify` 传入 Rust 后端时，Serde 的内部标签枚举（`NodeConfig::Start`/`End` 是单元变体）无法反序列化包含 map 的 `config` 字段。

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 数据库查询、图反序列化与真实会话编译全在 Rust 后端执行，前端仅负责渲染与传递参数。 |
| C2 Zero-Fallback Errors | √ | 错误信息显式返回并向 UI 暴露；修复后的反序列化与 SQL 查询不再产生虚假错误，真实错误仍严格向上抛出。 |
| C3 Responsiveness | √ | `list_preset_conversations` 与 `preview_blueprint_with_session` 为异步 Tauri 命令，在后台异步池执行，不阻塞 UI 线程。 |
| C4 AI UI Isolation | √ | 未修改 AI 动态 UI 隔离层。 |
| C5 Mobile Frontend Independence | √ | 改动集中于后端通用命令与 PC 侧 `BlueprintEditor`，与移动端零 UI 耦合；后端命令双端共用。 |
| C6 Project Cache Location | √ | 未引入新的临时/运行时持久化磁盘写入。 |
| C7 PC/Android Dual-Platform Coverage | √ | 后端命令 `list_preset_conversations` 与 `preview_blueprint_with_session` 双端一致可用。 |

## 验收记录

构建命令：

```powershell
cmd.exe /c "set PATH=D:\data\Night Voyage\.cache\cargo\bin;%PATH% && cargo test --manifest-path src-tauri/Cargo.toml -- models::blueprint"
cmd.exe /c "npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.mobile.json"
cmd.exe /c "scripts\build_dual_release.bat"
```

输出：

- `cargo test -- models::blueprint`：8 个单元测试全部通过（含新增的 `start_and_end_node_tolerates_empty_config_object`）。
- `npx tsc`（PC & Mobile）：通过，零类型错误。
- `scripts\build_dual_release.bat`：PC 前端与 Rust release 完整构建通过，产出二进制与双隔离实例。

验收方式：

1. 启动应用，进入预设蓝图编辑器。
2. 点击顶部工具栏「编译预览」按钮。
3. 预期效果：
   - 会话上下文下拉菜单正常展示近期会话列表，各选项展示标题与协议/类型，不再报错 `no such column: ap.protocol`；
   - 默认环境或选中任意会话后，蓝图编译预览成功渲染半透明文本容器块，鼠标悬停显示对应来源节点，点击可居中定位画布节点，不再报错 `invalid type: map, expected unit variant NodeConfig::Start`。

## 已知限制或后续待办

- 暂无。
