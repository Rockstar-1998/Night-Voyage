# Tasks

- [ ] Task 1: 审查并确认所有冗余字段的扫描结果
  - [ ] SubTask 1.1: 验证 `character_cards` 表的 5 个废弃字段（personality, system_prompt, example_messages, creator_notes, 以及旧字段 first_message/description/tags 的双写状态）
  - [ ] SubTask 1.2: 验证 `presets` 表的 2 个废弃字段（system_prompt_template, jailbreak_prompt）
  - [ ] SubTask 1.3: 验证 `conversations.character_id` 和 `rooms.character_id` 的废弃状态
  - [ ] SubTask 1.4: 验证 3 张只写不读的表（agent_runs, agent_drafts, api_provider_models）和 1 张完全未使用的表（agent_bindings）
  - [ ] SubTask 1.5: 验证 Schema 不一致问题（message_tool_calls.status CHECK 约束、update_content_parts_text 死代码）
  - [ ] SubTask 1.6: 验证冗余索引（idx_messages_created_at）

# Task Dependencies
- 无依赖，所有子任务可并行验证
