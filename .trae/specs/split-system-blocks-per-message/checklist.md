# Checklist

- [x] `flatten_request_to_legacy_chat_messages` 中每个 `request.system` 条目生成独立的 `role: "system"` 消息
- [x] 不再使用 `\n\n` 合并系统提示词
- [x] 空 `request.system` 不生成任何 system 消息
- [x] 测试 `adapter_keeps_history_outside_system` 更新为验证多 system 消息结构
- [x] 新增测试验证空 system 场景
- [x] `cargo check` 编译通过
- [x] `cargo test` 通过
