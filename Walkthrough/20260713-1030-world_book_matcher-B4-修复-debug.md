# Walkthrough: world_book_matcher B4 修复

- 文件: `src-tauri/src/services/world_book_matcher.rs`
- 修改类型: debug
- 日期: 2026-07-13 10:30

## 1. 改动摘要

| 位置 | 改动前 | 改动后 |
|------|--------|--------|
| `src-tauri/src/services/world_book_matcher.rs:90` | `.filter_map(\|(kind, _)\| Some(*kind))` | `.map(\|(kind, _)\| *kind)` |

同时把上方注释从单行扩展为两行，补充一句"Pick the highest-priority source kind (if any) to tag the entry for sorting"以说明该分支意图。仅此一处改动，未触碰其他逻辑。

## 2. 改动动机

修复 clippy `unnecessary_filter_map` 警告（B4）。原代码：

```rust
.filter_map(|(kind, _)| Some(*kind))
```

闭包永远返回 `Some`，`filter_map` 退化为 `map`，clippy 据此报警。

### 原意核验结论

`load_triggered_world_book_entries` 的常量条目分支（`is_constant == true`，即 `trigger_mode == "always"`）：

- 注释明确写："Always entries are unconditionally included regardless of trigger sources."（常量条目无条件包含）
- 该分支的目的是从所有 `normalized_sources` 的 kind 中选 `priority()` 最小者，作为该条目的 `trigger_source_kind` 标签，供后续 `results.sort_by` 排序使用（见同函数行 123-128）。
- 这里**没有过滤意图**：所有 normalized_sources 的 kind 都参与 priority 比较，无任何一个需要被剔除。
- 对照非常量分支（同函数 else 块）才使用真正的过滤条件 `world_book_entry_matches(...)`，那里用 `filter_map` 是合理的。

因此采用 B4 修复策略的第二种：改用 `.map(|(kind, _)| *kind)`。两种写法在 `normalized_sources` 为空时都返回 `None`（被 `unwrap_or(CurrentUser)` 兜底），非空时选 priority 最小者，行为完全等价，零行为变化。

## 3. 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 改动仅限 Rust 后端 world_book_matcher，前端无影响 |
| C2 Zero-Fallback Errors | √ | 未引入 `.ok()` / 静默吞错；`filter_map` → `map` 是等价改写，错误处理路径未变 |
| C3 Responsiveness | √ | 单行迭代器组合子调整，无阻塞、无新增热路径信号 |
| C4 AI UI Isolation | √ | 与 AI 沙盒 UI 无关 |
| C5 Mobile Frontend Independence | √ | 后端共享逻辑，PC/移动端均不涉及 UI 代码耦合 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 后端函数双端共享，修复对两端同时生效，未单开某端后门 |

## 4. 验收记录

### 构建命令

```powershell
cd "d:\data\Night Voyage\src-tauri"
cargo clippy --all-targets
```

### 实际输出（截选关键行）

```
warning: `night-voyage` (lib) generated 46 warnings (run `cargo clippy --fix --lib -p night-voyage --` to apply 10 suggestions)
warning: `night-voyage` (lib test) generated 43 warnings (41 duplicates) (run `cargo clippy --fix --lib -p night-voyage --tests --` to apply 1 suggestion)
```

退出码：`0`（构建通过）。

### B4 警告核对

- 修复前：`world_book_matcher.rs:90` 报 `unnecessary_filter_map`
- 修复后：在 `cargo clippy --all-targets` 输出中过滤 `world_book_matcher|unnecessary_filter_map` 关键字，**无任何匹配**。B4 警告已消失，且未引入新的 clippy 警告。

### 行为等价性核对

- `normalized_sources` 为空 → `.map(...).min_by_key(...)` 返回 `None` → `unwrap_or(WorldBookTriggerSourceKind::CurrentUser)` → `CurrentUser`（与原逻辑一致）
- `normalized_sources` 非空 → 选 `priority()` 最小者（与原逻辑一致）

## 5. 已知限制或后续待办

- 本次仅修复 B4，未处理 clippy 报告的 D7/D8/D9/D11 四个未使用函数（`compile_chat_messages`、`compile_preset_preview_data`、`build_preview_template_render_context`、`adapt_prompt_compile_result_to_openai_messages`）。这四个函数的删除决策由主 agent 基于并行调研报告决定。
- 未触碰 world_book_matcher.rs 中其他 `filter_map` 用法（如行 52、98、147），那些 `filter_map` 都有真实过滤条件，不属于 B4 范畴。
