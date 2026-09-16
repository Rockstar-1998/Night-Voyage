use std::collections::HashMap;
use sqlx::{Row, SqlitePool};
use tauri::{AppHandle, Emitter};

use crate::models::game_state::{DataContainer, DataContainerPatch, InventoryItem};

/// 从数据库读取指定会话的 DataContainer 状态。若尚未创建则返回默认初始状态。
pub async fn load_session_state(db: &SqlitePool, session_id: i64) -> Result<DataContainer, String> {
    let row_opt = sqlx::query("SELECT state_json FROM session_states WHERE session_id = ?")
        .bind(session_id)
        .fetch_optional(db)
        .await
        .map_err(|e| format!("查询 session_states 失败: {}", e).replace('\\', "/"))?;

    if let Some(row) = row_opt {
        let json_str: String = row.try_get("state_json").unwrap_or_default();
        let state: DataContainer = serde_json::from_str(&json_str)
            .map_err(|e| format!("解析 session_state 数据失败: {}", e).replace('\\', "/"))?;
        Ok(state)
    } else {
        Ok(DataContainer::default())
    }
}

/// 将会话的 DataContainer 状态持久化写入 SQLite
pub async fn save_session_state(
    db: &SqlitePool,
    session_id: i64,
    state: &DataContainer,
) -> Result<(), String> {
    let json_str = serde_json::to_string(state)
        .map_err(|e| format!("序列化 session_state 失败: {}", e).replace('\\', "/"))?;
    let now = crate::utils::now_ts();

    sqlx::query(
        "INSERT INTO session_states (session_id, state_json, updated_at) \
         VALUES (?, ?, ?) \
         ON CONFLICT(session_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
    )
    .bind(session_id)
    .bind(json_str)
    .bind(now)
    .execute(db)
    .await
    .map_err(|e| format!("持久化 session_state 失败: {}", e).replace('\\', "/"))?;

    Ok(())
}

/// 重置会话状态为初始状态
pub async fn reset_session_state(db: &SqlitePool, session_id: i64) -> Result<DataContainer, String> {
    let state = DataContainer::default();
    save_session_state(db, session_id, &state).await?;
    Ok(state)
}

/// 向前端常驻 HUD 广播增量更新事件 (session:hud_state_patch)
pub fn broadcast_hud_patch(
    app: &AppHandle,
    session_id: i64,
    state: &DataContainer,
    schema_patches: Option<HashMap<String, serde_json::Value>>,
) {
    let patch = DataContainerPatch {
        session_id,
        stats: Some(state.stats.clone()),
        inventory: Some(state.inventory.clone()),
        flags: Some(state.flags.clone()),
        schema_patches,
    };

    if let Err(e) = app.emit("session:hud_state_patch", patch) {
        crate::dbg_eprintln!("[agent_runtime] broadcast_hud_patch failed: {}", e);
    }
}

/// 执行大模型发起的 ToolCall 契约调用，并在完成原子修改后同步广播 HUD 增量补丁
pub async fn execute_tool_call(
    db: &SqlitePool,
    app: &AppHandle,
    session_id: i64,
    tool_name: &str,
    arguments_json: &str,
) -> Result<String, String> {
    let mut state = load_session_state(db, session_id).await?;
    let args: serde_json::Value = serde_json::from_str(arguments_json)
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()));

    let result_message = match tool_name {
        "check_inventory" => {
            if state.inventory.is_empty() {
                format!(
                    "【当前背包为空】。当前总负重: 0.0kg / 最大上限: {:.1}kg，金币: {}",
                    state.get_stat("max_weight").max(30.0),
                    state.get_stat("gold")
                )
            } else {
                let items_desc: Vec<String> = state
                    .inventory
                    .iter()
                    .map(|item| {
                        format!(
                            "• {} (ID: {}) x{} | 单重: {:.1}kg | 单价: {}G",
                            item.name, item.id, item.count, item.unit_weight, item.unit_price
                        )
                    })
                    .collect();
                format!(
                    "【玩家背包清单】(总负重: {:.1}/{:.1}kg, 金币: {}G):\n{}",
                    state.total_weight(),
                    state.get_stat("max_weight").max(30.0),
                    state.get_stat("gold"),
                    items_desc.join("\n")
                )
            }
        }
        "get_player_stats" => {
            let stats_desc: Vec<String> = state
                .stats
                .iter()
                .map(|(k, v)| format!("{}: {:.1}", k, v))
                .collect();
            format!("【玩家即时数值状态】:\n{}", stats_desc.join(", "))
        }
        "inspect_item" => {
            let item_id = args.get("item_id").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(item) = state.get_item(item_id) {
                format!(
                    "【物品详情】名称: {}, ID: {}, 持有数量: {}, 单重: {:.1}kg, 单价: {}G",
                    item.name, item.id, item.count, item.unit_weight, item.unit_price
                )
            } else {
                return Err(format!("【查看失败】：背包中未找到 ID 为 [{}] 的物品", item_id));
            }
        }
        "buy_item" => {
            let item_id = args
                .get("item_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 item_id 参数".to_string())?;
            let name = args
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or(item_id);
            let count = args.get("count").and_then(|v| v.as_i64()).unwrap_or(1);
            let unit_price = args
                .get("unit_price")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0);
            let unit_weight = args
                .get("unit_weight")
                .and_then(|v| v.as_f64())
                .unwrap_or(1.0);

            if count <= 0 {
                return Err("购买物品数量必须为正整数".to_string());
            }

            let total_cost = (count as f64) * unit_price;
            let added_weight = (count as f64) * unit_weight;
            let current_gold = state.get_stat("gold");
            let current_weight = state.total_weight();
            let max_weight = state.get_stat("max_weight").max(30.0);

            // 确定性门禁 1：金币判定
            if current_gold < total_cost {
                return Err(format!(
                    "【门禁拦截 - 金币不足】：当前金币 {:.1}G，购买所需 {:.1}G，差额 {:.1}G。购买未执行！",
                    current_gold,
                    total_cost,
                    total_cost - current_gold
                ));
            }

            // 确定性门禁 2：超重判定
            if current_weight + added_weight > max_weight {
                return Err(format!(
                    "【门禁拦截 - 背包超重】：当前负重 {:.1}kg + 新增 {:.1}kg 超过负重上限 {:.1}kg。购买未执行！",
                    current_weight, added_weight, max_weight
                ));
            }

            // 确定性运算器：扣除金币与增加道具
            state.set_stat("gold", current_gold - total_cost);
            state.add_item(InventoryItem {
                id: item_id.to_string(),
                name: name.to_string(),
                count,
                unit_weight,
                unit_price,
                icon: None,
                properties: HashMap::new(),
            });

            save_session_state(db, session_id, &state).await?;
            broadcast_hud_patch(app, session_id, &state, None);

            format!(
                "【交易成功】：成功购买 [{}] x{}，扣除金币 {:.1}G。剩余金币: {:.1}G，当前负重: {:.1}/{:.1}kg",
                name,
                count,
                total_cost,
                state.get_stat("gold"),
                state.total_weight(),
                max_weight
            )
        }
        "use_item" => {
            let item_id = args
                .get("item_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "缺少 item_id 参数".to_string())?;
            let count = args.get("count").and_then(|v| v.as_i64()).unwrap_or(1);

            state.remove_item(item_id, count)?;

            // 若使用药品等消耗品，自动触发回血
            if item_id.contains("potion") || item_id.contains("heal") || item_id.contains("hp") {
                let hp = state.get_stat("hp");
                let max_hp = state.get_stat("max_hp").max(100.0);
                let restored = 30.0 * (count as f64);
                let new_hp = (hp + restored).min(max_hp);
                state.set_stat("hp", new_hp);
            }

            save_session_state(db, session_id, &state).await?;
            broadcast_hud_patch(app, session_id, &state, None);

            format!(
                "【使用物品成功】：已消耗 [{}] x{}。当前生命值: {:.1}/{:.1}，当前负重: {:.1}kg",
                item_id,
                count,
                state.get_stat("hp"),
                state.get_stat("max_hp").max(100.0),
                state.total_weight()
            )
        }
        "read_text" => {
            let key = args.get("key").and_then(|v| v.as_str()).unwrap_or("draft");
            let text = state.scratchpad.get(key).cloned().unwrap_or_default();
            format!("【工作区变量 {} 内容】:\n{}", key, text)
        }
        "write_text" => {
            let key = args.get("key").and_then(|v| v.as_str()).unwrap_or("draft");
            let content = args
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            state.scratchpad.insert(key.to_string(), content.to_string());
            format!("【工作区变量 {} 已更新】({} 字符)", key, content.len())
        }
        unknown => {
            return Err(format!("未知的 ToolCall 契约: {}", unknown));
        }
    };

    Ok(result_message)
}
