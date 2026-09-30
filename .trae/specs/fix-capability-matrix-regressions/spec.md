# 能力矩阵重写回归修复 Spec

## Why

capability-matrix-completion 重写后引入两个回归 BUG，影响单人/无状态模式的基本可用性：
1. 消息编辑保存后文本仍为原文（编辑无效）
2. 更改会话绑定的 API 后仍使用旧 API 发送（绑定不生效，世界书与预设疑似同类问题）

这两个 BUG 阻断了核心交互流程，需立即修复。

## What Changes

### A. 修复消息编辑保存无效

**根因分析**：

前端 `handleEditMessage`（[App.tsx:1181-1192](file:///d:/data/Night%20Voyage/src/App.tsx#L1181-L1192)）存在两个问题：
1. **无错误处理**：`await messagesUpdateContent(...)` 若抛错，后续 `setMessages` 不会执行，UI 停留在旧文本，用户无感知
2. **静默早退**：若 `hostMember()` 返回 null，`memberId` 为 undefined，`if (!conversationId || !memberId || !backendId) return;` 静默返回

后端 `update_message_content`（[chat_service.rs:779](file:///d:/data/Night%20Voyage/src-tauri/src/services/chat_service.rs#L779)）在 capability_guard 通过后，仍调用 `ensure_member_is_host` 做二次校验。该函数（[conversation_repository.rs:20-38](file:///d:/data/Night%20Voyage/src-tauri/src/repositories/conversation_repository.rs#L20-L38)）要求 `conversation_members.member_role = 'host'`，在单人模式下若 `member_id` 不匹配 host 成员记录则失败。

**修复方向**：
- 前端：`handleEditMessage` 添加 try/catch，失败时向用户显示错误（不静默吞异常，符合 C2）
- 前端：`hostMember()` 为 null 时显式报错而非静默返回
- 后端：审查 `ensure_member_is_host` 在单人模式下的必要性——capability_guard 已完成模式级授权，`ensure_member_is_host` 是为 online guest 防越权设计的二次校验，单人模式下属冗余。需决定：移除单人模式下的 `ensure_member_is_host` 调用，或在 `ensure_member_is_host` 中对单人模式跳过 host 角色检查

### B. 修复会话绑定更改不生效

**根因分析**：

后端 `conversations_update_bindings`（[conversations.rs:287-397](file:///d:/data/Night%20Voyage/src-tauri/src/commands/conversations.rs#L287-L397)）使用 `COALESCE(?, field)` SQL 更新字段。`provider_id` 绑定逻辑看起来正确：前端传 `Some(new_id)` → COALESCE 使用新值，前端传 `None` → COALESCE 保留旧值。

`chat_submit_input`（[chat.rs:70-78](file:///d:/data/Night%20Voyage/src-tauri/src/commands/chat.rs#L70-L78)）调用 `submit_input` 时 `provider_id_override = None`。`submit_input`（[chat_service.rs:420-426](file:///d:/data/Night%20Voyage/src-tauri/src/services/chat_service.rs#L420-L426)）在 `auto_dispatched` 为 true 时调用 `resolve_provider_id`，后者从 DB 读取 `provider_id`（[conversation_repository.rs:61-86](file:///d:/data/Night%20Voyage/src-tauri/src/repositories/conversation_repository.rs#L61-L86)）。

**疑似故障点**（需实现期确认）：
1. `conversations_update_bindings` 的 SQL 执行成功但前端未传入新的 `providerId`（前端组件调用 `handleSaveConversationBindings` 时 payload 缺失字段）
2. `normalize_optional_positive_id` 将合法 ID 误过滤（该函数过滤 `id <= 0`，正常 ID 不受影响，但需确认）
3. 前端 `refreshConversationContext` 未完全刷新缓存状态
4. `submit_input` 的 `auto_dispatched` 分支逻辑导致 `provider_id_to_use` 为 None

**修复方向**：
- 后端：在 `conversations_update_bindings` 添加变更前后日志（旧值→新值），确认 SQL 实际写入
- 后端：在 `resolve_provider_id` 添加日志，确认读取到的是更新后的值
- 前端：追踪 `handleSaveConversationBindings` 调用链，确认 `providerId` / `worldBookId` / `presetId` 正确传入
- 前端：确认 `refreshConversationContext` 刷新了所有相关状态

### C. 验证世界书与预设绑定

用户怀疑世界书与预设也无法更改。`conversations_update_bindings` 的 SQL 对 `world_book_id` 和 `preset_id` 使用相同的 COALESCE 模式，若 Bug 2 的根因是前端未传值或 SQL 未执行，则世界书与预设受同样影响。修复 Bug 2 后需一并验证。

## Impact

- **Affected specs**: `capability-matrix-completion`（本次修复是该 spec 的回归补丁）
- **Affected code**:
  - 前端：`src/App.tsx`（handleEditMessage 错误处理）、可能涉及调用 `handleSaveConversationBindings` 的组件
  - 后端：`src-tauri/src/services/chat_service.rs`（审查 ensure_member_is_host 调用）、`src-tauri/src/commands/conversations.rs`（诊断日志）、`src-tauri/src/repositories/conversation_repository.rs`（resolve_provider_id 日志）

## ADDED Requirements

### Requirement: 编辑保存失败时向用户显式报错

系统 SHALL 在消息编辑保存失败时向用户显示错误信息，不得静默吞异常或停留在旧文本。

#### Scenario: 后端校验失败
- **GIVEN** 用户在单人/无状态模式下编辑消息并点击保存
- **WHEN** 后端 `messages_update_content` 返回错误（如 `ensure_member_is_host` 失败）
- **THEN** 前端显示错误提示（如 alert 或 toast），UI 文本可回退到旧值或保留编辑态

#### Scenario: 前端 hostMember 为空
- **GIVEN** 用户编辑消息但 `hostMember()` 返回 null
- **WHEN** 用户点击保存
- **THEN** 前端显示明确错误"未找到宿主成员，无法保存"，不静默返回

### Requirement: 单人模式不因冗余 host 校验阻断操作

系统 SHALL 在单人模式下，capability_guard 通过后不再因 `ensure_member_is_host` 阻断已授权操作。`ensure_member_is_host` 仅在 online 模式下作为 guest 防越权二次校验。

#### Scenario: 单人模式编辑消息
- **GIVEN** single/stateless 模式，capability_guard 查表 Edit=Allow
- **WHEN** 用户编辑消息并保存
- **THEN** `ensure_member_is_host` 不阻断操作（单人模式无 guest 概念），消息内容成功更新

### Requirement: 会话绑定更改立即生效

系统 SHALL 在用户更改会话绑定的 API/世界书/预设后，后续消息发送使用更新后的绑定值。

#### Scenario: 更改 API 后发送消息
- **GIVEN** 会话当前绑定 API A
- **WHEN** 用户通过 UI 将 API 改为 B，然后发送消息
- **THEN** 消息使用 API B 发送，不使用旧 API A

#### Scenario: 更改世界书后发送消息
- **GIVEN** 会话当前绑定世界书 W1
- **WHEN** 用户通过 UI 将世界书改为 W2，然后发送消息
- **THEN** prompt 编译使用世界书 W2 的条目

## MODIFIED Requirements

### Requirement: ensure_member_is_host 调用范围

`ensure_member_is_host` SHALL 仅在 online 模式下调用。单人模式下，capability_guard 的模式级授权已足够，`ensure_member_is_host` 的 host 角色检查是冗余的且可能因 member_id 不匹配而误拒。

调用 `ensure_member_is_host` 的 6 处（chat_service.rs 行 779/792/803/943/975/1039）需审查：
- 若调用上下文已通过 capability_guard 校验且为单人模式，移除或跳过 `ensure_member_is_host`
- 若调用上下文为 online 模式，保留 `ensure_member_is_host` 作为 guest 防越权校验

## REMOVED Requirements

无。本次为回归修复，不移除既有需求。
