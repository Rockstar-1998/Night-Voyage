use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// 角色背包中的单项物品定义
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub count: i64,
    pub unit_weight: f64,
    pub unit_price: f64,
    pub icon: Option<String>,
    #[serde(default)]
    pub properties: HashMap<String, String>,
}

/// 纯内存与持久化结构化数据容器 (GameState)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DataContainer {
    /// 基础数值字典 (如 hp, max_hp, mp, gold, weight, max_weight, level 等)
    #[serde(default)]
    pub stats: HashMap<String, f64>,
    /// 玩家物品清单
    #[serde(default)]
    pub inventory: Vec<InventoryItem>,
    /// 剧情标志位 / 进度状态字典
    #[serde(default)]
    pub flags: HashMap<String, String>,
    /// 纯内存文本工作区变量 (如 draft, critique, final)，仅用于生命周期流转
    #[serde(default)]
    pub scratchpad: HashMap<String, String>,
}

impl Default for DataContainer {
    fn default() -> Self {
        let mut stats = HashMap::new();
        stats.insert("hp".to_string(), 100.0);
        stats.insert("max_hp".to_string(), 100.0);
        stats.insert("mp".to_string(), 50.0);
        stats.insert("max_mp".to_string(), 50.0);
        stats.insert("gold".to_string(), 100.0);
        stats.insert("weight".to_string(), 0.0);
        stats.insert("max_weight".to_string(), 50.0);

        Self {
            stats,
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

    /// 重新同步 weight 数值到 stats["weight"]
    pub fn sync_weight(&mut self) -> f64 {
        let w = self.total_weight();
        self.stats.insert("weight".to_string(), w);
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
    pub fn evaluate_condition(&self, gate_type: &str, target_value: f64) -> Result<bool, String> {
        match gate_type {
            "gold" => {
                let current_gold = self.get_stat("gold");
                Ok(current_gold >= target_value)
            }
            "weight" => {
                let current_w = self.total_weight();
                let max_w = self.get_stat("max_weight").max(10.0);
                Ok(current_w + target_value <= max_w)
            }
            "slots" => {
                let current_slots = self.inventory.len() as f64;
                Ok(current_slots < target_value)
            }
            other => Err(format!("未知的门禁判定类型: {}", other)),
        }
    }
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
