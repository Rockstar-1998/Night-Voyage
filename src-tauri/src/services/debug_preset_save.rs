// ============================================================================
// ISOLATED DEBUG LOG MODULE FOR PRESET SAVE — SCHEDULED FOR FUTURE REMOVAL
// ============================================================================
//
// 本文件专门用于 `presets_update` 保存链路的调试日志。所有日志调用集中在
// 这里，业务代码只调用这些函数，不直接写 `dbg_eprintln!`。
//
// ## 清除步骤（未来）
// 1. 删除本文件。
// 2. 从 `services/mod.rs` 移除 `pub mod debug_preset_save;`。
// 3. 全局搜索 `debug_preset_save::` 调用点并删除。
//
// ## 约定
// - 每个函数对应保存链路的一个关键步骤。
// - 日志前缀统一为 `[preset-save]`，方便 grep 过滤。
// - 参数使用 `&str` / `&[u8]` / 数值，不持有所有权。
// ============================================================================

use crate::dbg_eprintln;

/// 保存入口：记录 preset id、name、blueprint_graph 长度。
pub fn entry(id: i64, name: &str, blueprint_graph: Option<&str>) {
    let graph_len = blueprint_graph.map(|s| s.len()).unwrap_or(0);
    dbg_eprintln!("[preset-save] entry: id={}, name='{}', blueprint_graph_len={}", id, name, graph_len);
}

/// 参数校验通过。
pub fn validation_ok() {
    dbg_eprintln!("[preset-save] validation: ok");
}

/// 参数校验失败。
pub fn validation_failed(err: &str) {
    dbg_eprintln!("[preset-save] validation: FAILED — {}", err);
}

/// blueprint_graph JSON 校验通过。
pub fn graph_validation_ok() {
    dbg_eprintln!("[preset-save] graph_validation: ok");
}

/// blueprint_graph JSON 校验失败。
pub fn graph_validation_failed(err: &str) {
    dbg_eprintln!("[preset-save] graph_validation: FAILED — {}", err);
}

/// 事务已开始。
pub fn tx_begun() {
    dbg_eprintln!("[preset-save] tx: begun");
}

/// 预设存在性检查。
pub fn preset_exists(exists: bool) {
    dbg_eprintln!("[preset-save] preset_exists: {}", exists);
}

/// blocks 已加载。
pub fn blocks_loaded(count: usize) {
    dbg_eprintln!("[preset-save] blocks_loaded: count={}", count);
}

/// 锁定块检查通过。
pub fn locked_blocks_ok() {
    dbg_eprintln!("[preset-save] locked_blocks: ok");
}

/// 锁定块检查失败。
pub fn locked_blocks_failed(err: &str) {
    dbg_eprintln!("[preset-save] locked_blocks: FAILED — {}", err);
}

/// 仓库 update 已执行。
pub fn repo_updated() {
    dbg_eprintln!("[preset-save] repo: updated");
}

/// blocks 已替换。
pub fn blocks_replaced(count: usize) {
    dbg_eprintln!("[preset-save] blocks_replaced: count={}", count);
}

/// 事务已提交。
pub fn tx_committed() {
    dbg_eprintln!("[preset-save] tx: committed");
}

/// 事务提交失败。
pub fn tx_commit_failed(err: &str) {
    dbg_eprintln!("[preset-save] tx: COMMIT FAILED — {}", err);
}

/// 保存成功，返回结果已构建。
pub fn success() {
    dbg_eprintln!("[preset-save] success");
}

/// 保存失败（任意步骤的 Err 传播到顶层）。
pub fn error(err: &str) {
    dbg_eprintln!("[preset-save] error: {}", err);
}

// ─── 加载链路日志（用于对比保存/读取内容是否一致）───

/// presets_get 入口：记录请求的 preset id。
pub fn load_entry(id: i64) {
    dbg_eprintln!("[preset-load] entry: id={}", id);
}

/// presets_get 成功：记录读取到的 blueprint_graph 长度和内容前缀（前 300 字符）。
pub fn load_ok(id: i64, blueprint_graph: Option<&str>) {
    match blueprint_graph {
        Some(g) => {
            let len = g.len();
            let prefix: String = g.chars().take(300).collect();
            dbg_eprintln!("[preset-load] ok: id={}, blueprint_graph_len={}, prefix={}", id, len, prefix);
        }
        None => {
            dbg_eprintln!("[preset-load] ok: id={}, blueprint_graph=None", id);
        }
    }
}

/// presets_get 失败。
pub fn load_failed(id: i64, err: &str) {
    dbg_eprintln!("[preset-load] FAILED: id={}, err={}", id, err);
}
