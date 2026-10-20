use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// 角色背包中的单项物品定义
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    #[serde(alias = "quantity")]
    pub count: i64,
    #[serde(default)]
    pub unit_weight: f64,
    #[serde(default)]
    pub unit_price: f64,
    pub icon: Option<String>,
    #[serde(default)]
    pub properties: HashMap<String, String>,
}

/// 纯内存与持久化结构化数据容器 (GameState)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataContainer {
    /// 基础数值字典 (如 credits, sanity, fuel 等，不再内置任何特定流派的硬编码默认值)
    #[serde(default)]
    pub stats: HashMap<String, f64>,
    /// 玩家物品清单
    #[serde(default)]
    pub inventory: Vec<InventoryItem>,
    /// 剧情标志位 / 进度状态字典
    #[serde(default)]
    pub flags: HashMap<String, String>,
    /// 纯内存文本工作区变量 (如 draft, critique, final)，仅用于生命周期流转，不持久化落盘
    #[serde(default, skip_serializing)]
    pub scratchpad: HashMap<String, String>,
}

impl Default for DataContainer {
    fn default() -> Self {
        Self {
            stats: HashMap::new(),
            inventory: Vec::new(),
            flags: HashMap::new(),
            scratchpad: HashMap::new(),
        }
    }
}

impl DataContainer {
    pub fn new() -> Self {
        Self::default()
    }

    /// 计算当前背包所有物品总重量
    pub fn total_weight(&self) -> f64 {
        self.inventory
            .iter()
            .map(|item| (item.count as f64) * item.unit_weight)
            .sum()
    }

    /// 重新同步 weight 数值到 stats["weight"]（仅当持有物品产生实际重量或已显式追踪 weight 时同步，避免无负重设定的场景被强制注入）
    pub fn sync_weight(&mut self) -> f64 {
        let w = self.total_weight();
        if w > 0.0 || self.stats.contains_key("weight") {
            self.stats.insert("weight".to_string(), w);
        }
        w
    }

    pub fn get_stat(&self, name: &str) -> f64 {
        self.stats.get(name).copied().unwrap_or(0.0)
    }

    pub fn set_stat(&mut self, name: &str, val: f64) {
        self.stats.insert(name.to_string(), val);
    }

    pub fn get_item(&self, item_id: &str) -> Option<&InventoryItem> {
        self.inventory.iter().find(|i| i.id == item_id)
    }

    pub fn get_item_mut(&mut self, item_id: &str) -> Option<&mut InventoryItem> {
        self.inventory.iter_mut().find(|i| i.id == item_id)
    }

    /// 向容器中添加物品。若存在同 ID 物品则累加 count
    pub fn add_item(&mut self, item: InventoryItem) {
        if let Some(existing) = self.get_item_mut(&item.id) {
            existing.count += item.count;
        } else {
            self.inventory.push(item);
        }
        self.sync_weight();
    }

    /// 从容器中扣减物品。若数量不足返回 Err，扣减至 0 则清除条目
    pub fn remove_item(&mut self, item_id: &str, count: i64) -> Result<(), String> {
        if count <= 0 {
            return Err("扣减物品数量必须为正整数".to_string());
        }

        let index = self
            .inventory
            .iter()
            .position(|i| i.id == item_id)
            .ok_or_else(|| format!("背包中不存在物品 ID: {}", item_id))?;

        if self.inventory[index].count < count {
            return Err(format!(
                "物品 [{}] 数量不足！当前持有: {}，尝试扣减: {}",
                self.inventory[index].name, self.inventory[index].count, count
            ));
        }

        self.inventory[index].count -= count;
        if self.inventory[index].count == 0 {
            self.inventory.remove(index);
        }

        self.sync_weight();
        Ok(())
    }

    /// 确定性算术执行器
    pub fn apply_math_op(
        &mut self,
        target_stat: &str,
        op: &str,
        operand: f64,
        clamp_max: Option<f64>,
    ) -> Result<f64, String> {
        let current = self.get_stat(target_stat);
        let new_val = match op {
            "+" | "add" => current + operand,
            "-" | "sub" => current - operand,
            "*" | "mul" => current * operand,
            "/" | "div" => {
                if operand == 0.0 {
                    return Err("除数不可为零".to_string());
                }
                current / operand
            }
            "%" | "mod" => {
                if operand == 0.0 {
                    return Err("模运算除数不可为零".to_string());
                }
                current % operand
            }
            "set" => operand,
            "min" => current.min(operand),
            "max" => current.max(operand),
            "clamp" => {
                let max_bound = clamp_max.ok_or_else(|| "clamp 运算需要提供最大值上限".to_string())?;
                current.clamp(operand, max_bound)
            }
            unknown => return Err(format!("不支持的运算操作符: {}", unknown)),
        };

        self.set_stat(target_stat, new_val);
        Ok(new_val)
    }

    /// 确定性门禁判定
    ///
    /// 支持：
    /// 1. 关系表达式判定（gate_type 包含 `>=, <=, ==, !=, >, <`）；
    /// 2. 纯关系运算符判定（gate_type 为 `>=, <=, ==, !=, >, <`，左操作数由 args.stat 或 args.left 给出）；
    /// 3. D20 检定（`gate_type == "d20"` 或 d20 表达式，roll + modifier >= target_value，roll 回传至 roll_out）；
    /// 4. 命名/流派通用门禁（如 `credits`, `fuel`, `radiation` 或已废除硬编码的 `gold`, `weight`, `slots`）：
    ///    - 缺少必需属性时抛出显式 Err（C2 零静默兜底，严禁 max(10.0) 或缺省 0.0 放行）。
    pub fn evaluate_condition(
        &self,
        gate_type: &str,
        target_value: f64,
        args: &serde_json::Value,
        roll_out: &mut Option<i64>,
    ) -> Result<bool, String> {
        let trimmed_gate = gate_type.trim();

        // 1. 若 gate_type 包含关系运算符，直接作为关系表达式求值
        if crate::models::tool_plan::has_relational_op(trimmed_gate) {
            return self.evaluate_expression(trimmed_gate, args, roll_out);
        }

        // 2. 若 gate_type 为纯关系运算符（如 ">=", "<=", "==", "!=", ">", "<"）
        if crate::models::tool_plan::is_relational_op(trimmed_gate) {
            let left_val = if let Some(stat_key) = args.get("stat").and_then(serde_json::Value::as_str) {
                if !self.stats.contains_key(stat_key) {
                    return Err(format!("门禁判定缺少必需属性 `{}`", stat_key));
                }
                self.stats[stat_key]
            } else if let Some(left_str) = args.get("left").and_then(serde_json::Value::as_str) {
                crate::models::tool_plan::resolve_operand_with_dice(left_str, args, self, roll_out)?
            } else if let Some(left_num) = args.get("left").and_then(serde_json::Value::as_f64) {
                left_num
            } else {
                return Err(format!(
                    "操作符门禁 `{}` 缺少左操作数（需在 args 提供 stat 或 left）",
                    trimmed_gate
                ));
            };

            let right_val = if let Some(right_str) = args.get("right").and_then(serde_json::Value::as_str) {
                crate::models::tool_plan::resolve_operand_with_dice(right_str, args, self, roll_out)?
            } else if let Some(right_num) = args.get("right").and_then(serde_json::Value::as_f64) {
                right_num
            } else {
                target_value
            };

            return crate::models::tool_plan::compare_relational(trimmed_gate, left_val, right_val);
        }

        // 3. 命名门禁与已知类型
        match trimmed_gate {
            "gold" => {
                if !self.stats.contains_key("gold") {
                    return Err("门禁判定缺少必需属性 `gold`".to_string());
                }
                let current_gold = *self.stats.get("gold").unwrap();
                Ok(current_gold >= target_value)
            }
            "weight" => {
                if !self.stats.contains_key("max_weight") {
                    return Err("门禁判定缺少必需属性 `max_weight`".to_string());
                }
                let current_w = self.total_weight();
                let max_w = *self.stats.get("max_weight").unwrap();
                Ok(current_w + target_value <= max_w)
            }
            "slots" => {
                let current_slots = self.inventory.len() as f64;
                Ok(current_slots < target_value)
            }
            "d20" => {
                let roll = crate::services::agent_guards::random_d20()?;
                let modifier = args.get("modifier").and_then(serde_json::Value::as_f64).unwrap_or(0.0);
                *roll_out = Some(roll);
                Ok((roll as f64 + modifier) >= target_value)
            }
            "custom" => {
                if let Some(expr) = args.get("expression").and_then(serde_json::Value::as_str) {
                    self.evaluate_expression(expr, args, roll_out)
                } else if let Some(stat_key) = args.get("stat").and_then(serde_json::Value::as_str) {
                    if !self.stats.contains_key(stat_key) {
                        return Err(format!("门禁判定缺少必需属性 `{}`", stat_key));
                    }
                    let val = self.stats[stat_key];
                    let op = args.get("op").and_then(serde_json::Value::as_str).unwrap_or(">=");
                    crate::models::tool_plan::compare_relational(op, val, target_value)
                } else {
                    Ok(target_value > 0.0)
                }
            }
            stat if self.stats.contains_key(stat) => {
                Ok(self.stats[stat] >= target_value)
            }
            stat if is_valid_stat_identifier(stat) => {
                Err(format!("门禁判定缺少必需属性 `{}`", stat))
            }
            other => Err(format!("未知的门禁判定类型: {}", other)),
        }
    }

    /// 评估通用关系表达式（如 "credits >= 100", "fuel > 20", "inventory.len < max_slots", "d20 + modifier >= 15"）
    pub fn evaluate_expression(
        &self,
        expr: &str,
        args: &serde_json::Value,
        roll_out: &mut Option<i64>,
    ) -> Result<bool, String> {
        crate::models::tool_plan::evaluate_relational_expression(expr, args, self, roll_out)
    }
}

fn is_valid_stat_identifier(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.')
}

/// 发送给前端常驻 HUD 局部刷新的增量补丁载荷
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DataContainerPatch {
    pub session_id: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stats: Option<HashMap<String, f64>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inventory: Option<Vec<InventoryItem>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flags: Option<HashMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub schema_patches: Option<HashMap<String, serde_json::Value>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_datacontainer_default_starts_with_empty_stats() {
        let dc = DataContainer::default();
        assert!(dc.stats.is_empty(), "DataContainer::default() 必须为空 stats，严禁硬编码任何特定流派数值");
        assert!(dc.inventory.is_empty(), "DataContainer::default() 背包必须为空");
        assert!(dc.flags.is_empty(), "DataContainer::default() 标志位必须为空");
        assert_eq!(dc.get_stat("hp"), 0.0, "未定义属性应当返回 0.0，而非硬编码默认值");
        assert_eq!(dc.get_stat("credits"), 0.0);
    }

    #[test]
    fn test_datacontainer_custom_genre_stats() {
        let mut dc = DataContainer::default();
        dc.set_stat("sanity", 80.0);
        dc.set_stat("credits", 2500.0);
        dc.set_stat("fuel", 45.5);

        assert_eq!(dc.get_stat("sanity"), 80.0);
        assert_eq!(dc.get_stat("credits"), 2500.0);
        assert_eq!(dc.get_stat("fuel"), 45.5);

        // 验证数学运算
        let res = dc.apply_math_op("credits", "-", 500.0, None).unwrap();
        assert_eq!(res, 2000.0);
        assert_eq!(dc.get_stat("credits"), 2000.0);
    }

    #[test]
    fn test_datacontainer_inventory_operations() {
        let mut dc = DataContainer::default();
        let item = InventoryItem {
            id: "medkit".to_string(),
            name: "急救包".to_string(),
            count: 3,
            unit_weight: 0.8,
            unit_price: 150.0,
            icon: None,
            properties: HashMap::new(),
        };

        dc.add_item(item);
        assert_eq!(dc.inventory.len(), 1);
        assert_eq!(dc.get_item("medkit").unwrap().count, 3);
        assert!((dc.total_weight() - 2.4).abs() < 1e-6);
        assert!((dc.get_stat("weight") - 2.4).abs() < 1e-6);

        // 扣减物品
        dc.remove_item("medkit", 1).unwrap();
        assert_eq!(dc.get_item("medkit").unwrap().count, 2);
        assert!((dc.total_weight() - 1.6).abs() < 1e-6);
    }

    #[test]
    fn test_relational_condition_gates_on_custom_stats() {
        let mut dc = DataContainer::default();
        dc.set_stat("credits", 150.0);
        dc.set_stat("radiation", 30.0);
        dc.set_stat("fuel", 50.0);
        dc.set_stat("max_slots", 10.0);

        let args = serde_json::json!({});
        let mut roll_out = None;

        // >=
        assert!(dc.evaluate_condition("credits >= 100", 0.0, &args, &mut roll_out).unwrap());
        assert!(!dc.evaluate_condition("credits >= 200", 0.0, &args, &mut roll_out).unwrap());

        // <=
        assert!(dc.evaluate_condition("radiation <= 30", 0.0, &args, &mut roll_out).unwrap());
        assert!(!dc.evaluate_condition("radiation <= 20", 0.0, &args, &mut roll_out).unwrap());

        // >
        assert!(dc.evaluate_condition("fuel > 20", 0.0, &args, &mut roll_out).unwrap());
        assert!(!dc.evaluate_condition("fuel > 50", 0.0, &args, &mut roll_out).unwrap());

        // <
        assert!(dc.evaluate_condition("radiation < 50", 0.0, &args, &mut roll_out).unwrap());
        assert!(!dc.evaluate_condition("radiation < 30", 0.0, &args, &mut roll_out).unwrap());

        // ==
        assert!(dc.evaluate_condition("fuel == 50", 0.0, &args, &mut roll_out).unwrap());
        assert!(!dc.evaluate_condition("fuel == 40", 0.0, &args, &mut roll_out).unwrap());

        // !=
        assert!(dc.evaluate_condition("fuel != 0", 0.0, &args, &mut roll_out).unwrap());
        assert!(!dc.evaluate_condition("fuel != 50", 0.0, &args, &mut roll_out).unwrap());

        // inventory.len < max_slots
        assert!(dc.evaluate_condition("inventory.len < max_slots", 0.0, &args, &mut roll_out).unwrap());
    }

    #[test]
    fn test_missing_required_attribute_produces_explicit_err_per_c2() {
        let dc = DataContainer::default(); // 空 stats
        let args = serde_json::json!({});
        let mut roll_out = None;

        // weight 门禁缺少 max_weight 绝无 max(10.0) 兜底，必须硬错
        let err_weight = dc.evaluate_condition("weight", 5.0, &args, &mut roll_out).unwrap_err();
        assert!(err_weight.contains("门禁判定缺少必需属性 `max_weight`"), "实际报错: {}", err_weight);

        // gold 门禁缺少 gold 必须硬错
        let err_gold = dc.evaluate_condition("gold", 50.0, &args, &mut roll_out).unwrap_err();
        assert!(err_gold.contains("门禁判定缺少必需属性 `gold`"), "实际报错: {}", err_gold);

        // 自定义属性门禁缺少属性必须硬错
        let err_credits = dc.evaluate_condition("credits", 100.0, &args, &mut roll_out).unwrap_err();
        assert!(err_credits.contains("门禁判定缺少必需属性 `credits`"), "实际报错: {}", err_credits);

        // 关系表达式中缺少操作数/属性必须硬错
        let err_expr = dc.evaluate_condition("fuel > 20", 0.0, &args, &mut roll_out).unwrap_err();
        assert!(err_expr.contains("未定义"), "实际报错: {}", err_expr);
    }

    #[test]
    fn test_d20_gate_check_with_csprng_and_threshold() {
        let dc = DataContainer::default();
        let mut roll_out = None;
        let args = serde_json::json!({"modifier": 5.0});

        // DC 1 必然通过 (1 + 5 = 6 >= 1)
        let passed = dc.evaluate_condition("d20", 1.0, &args, &mut roll_out).unwrap();
        assert!(passed);
        assert!(roll_out.is_some());
        let roll = roll_out.unwrap();
        assert!((1..=20).contains(&roll));

        // 通过表达式执行 d20 + modifier >= DC
        let mut roll_expr = None;
        let passed_expr = dc.evaluate_condition("d20 + modifier >= 1", 0.0, &args, &mut roll_expr).unwrap();
        assert!(passed_expr);
        assert!(roll_expr.is_some());
        let r2 = roll_expr.unwrap();
        assert!((1..=20).contains(&r2));
    }
}
