# Tasks

- [x] Task 1: 修改原始迁移文件中的 CHECK 约束
  - [x] SubTask 1.1: 在 `src-tauri/migrations/0003_feature_foundation.sql` 第 143 行，将 `CHECK (trigger_mode IN ('any', 'all'))` 改为 `CHECK (trigger_mode IN ('any', 'all', 'always'))`
- [x] Task 2: 删除旧数据库文件并验证
  - [x] SubTask 2.1: 用户手动删除旧数据库文件，让应用重建
  - [x] SubTask 2.2: `cargo check` 通过

# Task Dependencies

- Task 2 依赖于 Task 1
