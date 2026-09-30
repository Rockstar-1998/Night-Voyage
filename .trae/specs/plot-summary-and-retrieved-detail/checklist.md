# Checklist

- [ ] `summaries` 表结构设计完成（id, conversation_id, round_start, round_end, summary_text, created_at, is_manual）
- [ ] `retrieval_fragments` 表结构设计完成（id, conversation_id, round_id, content_hash, content, embedding_id, created_at）
- [ ] 数据库迁移脚本创建
- [ ] Rust struct 和 repository 创建
- [ ] `load_plot_summary_blocks()` 函数实现
- [ ] `load_retrieved_detail_blocks()` 函数框架实现
- [ ] `compile_prompt()` 中按顺序调用 WorldBookMatch → PlotSummary → RetrievedDetail
- [ ] 预算裁剪逻辑正确（PlotSummary 先于 RetrievedDetail 裁剪）
- [ ] `system_blocks_metadata` 日志包含 PlotSummary 和 RetrievedDetail 元数据
- [ ] `cargo check` 编译通过
- [ ] 测试对话请求验证日志输出
