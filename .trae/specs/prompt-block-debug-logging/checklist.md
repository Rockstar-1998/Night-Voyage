# Checklist

- [x] ~~Anthropic 请求体中不包含 `top_k` 字段~~ — 撤销：Anthropic **支持** `top_k`，无需省略
- [x] ~~OpenAI 兼容请求体中保留 `top_k` 字段~~ — 撤销：同上原因
- [x] Debug 日志中 system blocks 包含 `kind`、`source`、`priority`、`required` 元数据
- [x] `cargo check` 编译通过
