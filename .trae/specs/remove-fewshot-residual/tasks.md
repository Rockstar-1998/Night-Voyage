# Tasks

- [x] Task 1: 新建 migration 0032 删除 preset_examples 表
  - [x] SubTask 1.1: 创建 `src-tauri/migrations/0032_drop_preset_examples.sql`，内容为 `DROP TABLE IF EXISTS preset_examples;`
- [x] Task 2: 删除 PresetExampleRecord 结构体
  - [x] SubTask 2.1: 从 `src-tauri/src/models/mod.rs` 删除 `PresetExampleRecord` 结构体（203-213行）
  - [x] SubTask 2.2: 从 `src/lib/backend.ts` 删除 `PresetExampleRecord` 接口（164行附近）
- [x] Task 3: 更新文档
  - [x] SubTask 3.1: 从 `docs/preset-system-architecture.md` 移除第3节"Few-shot 示例层"
  - [x] SubTask 3.2: 从第5节编译顺序移除第7项"预设 Few-shot 示例"
  - [x] SubTask 3.3: 从第9节实现顺序移除第2阶段中 few-shot 相关项
- [x] Task 4: 编译验证
  - [x] SubTask 4.1: `cargo check` 确认无编译错误
  - [x] SubTask 4.2: `npm run build` 确认前端无引用错误

# Task Dependencies

- Task 1、2、3 可并行执行（互不依赖）
- Task 4 依赖所有其他任务完成
