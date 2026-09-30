# Tasks

- [x] Task 1: 后端匹配逻辑支持 `"always"` 模式
  - [x] SubTask 1.1: 在 `world_book_matcher.rs` 的 `world_book_entry_matches` 函数中，新增 `"always"` 早期返回 `true`
- [x] Task 2: 前端类型定义扩展
  - [x] SubTask 2.1: 在 `App.tsx` 中将 `triggerMode` 扩展为 `'any' | 'all' | 'always'`（两处）
  - [x] SubTask 2.2: 在 `WorldBookEntryArea.tsx` 中将 `triggerMode` 扩展为 `'any' | 'all' | 'always'`
  - [x] SubTask 2.3: 在 `backend.ts` 中将 `WorldBookTriggerMode` 扩展为 `'any' | 'all' | 'always'`
- [x] Task 3: 前端 UI 新增"永远触发"选项
  - [x] SubTask 3.1: 触发方式选择器新增 `{ label: "永远触发", value: "always" }`
  - [x] SubTask 3.2: 说明文字增加"永远触发 = 无需关键词，始终注入"
  - [x] SubTask 3.3: 条目卡片标签 `always` 显示"永远触发"
  - [x] SubTask 3.4: `onChange` 回调支持 `'always'` 值
  - [x] SubTask 3.5: `toUpdateParams` 中 triggerMode 转换支持 `'always'`
- [x] Task 4: 构建验证
  - [x] SubTask 4.1: `cargo check` 通过
  - [x] SubTask 4.2: `npx tsc --noEmit` 相关文件无新增错误

# Task Dependencies

- Task 2 和 Task 3 可并行
- Task 4 依赖于 Task 1、2、3
