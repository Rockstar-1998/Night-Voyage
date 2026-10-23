use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// 常驻 HUD 挂载视口锚点类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LayoutMountType {
    /// PC 侧边仪表盘
    RightDock,
    /// PC 顶部折叠吸顶栏
    TopSticky,
    /// PC 自由浮动画中画
    FloatingHUD,
    /// 移动端吸顶抽屉
    MobileDrawer,
    /// 移动端底部微型条
    MobileBottomSticky,
}

impl Default for LayoutMountType {
    fn default() -> Self {
        Self::RightDock
    }
}

/// 容器类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ContainerKind {
    RootCanvas,
    Panel,
    Tabs,
    Grid,
}

/// 控件类型
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum WidgetType {
    StatBar,
    InventorySlotGrid,
    DataLabel,
    Badge,
    AvatarFrame,
    /// 动作按钮：点击时经 action_bridge 白名单代理调用既有命令（spec §2.3，M4）
    ActionButton,
}

/// 单个数值属性契约要求
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StatRequirement {
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<f64>,
}

/// UI 布局导出的形式化数据契约规格 (RequiredDataInterface)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct RequiredDataInterface {
    pub required_stats: HashMap<String, StatRequirement>,
    pub required_flags: Vec<String>,
    pub required_inventory: bool,
}

/// 原子交互与展示控件
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WidgetDefinition {
    pub id: String,
    pub widget_type: WidgetType,
    pub label: String,
    /// 数据绑定路径 (例如 "stats.hp", "stats.gold", "inventory", "schema.hp")
    pub data_binding: String,
    /// x/y 坐标（absolute 排版模式下生效，计划 §4.1）
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    /// 宽高（0 = 自适应内容）
    #[serde(default)]
    pub width: f64,
    #[serde(default)]
    pub height: f64,
    #[serde(default)]
    pub config: HashMap<String, serde_json::Value>,
    #[serde(default)]
    pub style: HashMap<String, String>,
}

/// 树形布局节点：容器或控件
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "nodeType", rename_all = "camelCase")]
pub enum LayoutNode {
    Container(LayoutContainer),
    Widget(WidgetDefinition),
}

/// 布局容器
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LayoutContainer {
    pub id: String,
    pub kind: ContainerKind,
    /// 排版模式（计划 §4.1 RootCanvas）：`absolute`（子元素按 x/y 自由坐标）/
    /// `flex`（纵向流式，缺省）/ `grid`（网格，列数取 style.columns）
    #[serde(default = "default_layout_mode")]
    pub layout_mode: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub style: HashMap<String, String>,
    #[serde(default)]
    pub children: Vec<LayoutNode>,
}

fn default_layout_mode() -> String {
    "flex".to_string()
}

/// 完整 UI 模板定义
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UILayoutDefinition {
    pub id: String,
    pub preset_id: i64,
    pub name: String,
    pub mount_type: LayoutMountType,
    /// 内置预设主题名，仅默认玄青色 "xuanqing"
    pub theme: String,
    /// 自定义 CSS 样式代码，仅在 Shadow DOM 内部隔离注入
    pub custom_css: String,
    pub root_container: LayoutContainer,
    /// 自动提取导出的数据契约接口
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub required_data_interface: Option<RequiredDataInterface>,
}

impl Default for UILayoutDefinition {
    fn default() -> Self {
        Self {
            id: "default_hud_layout".to_string(),
            preset_id: 0,
            name: "默认常驻 HUD 模板".to_string(),
            mount_type: LayoutMountType::RightDock,
            theme: "xuanqing".to_string(),
            custom_css: String::new(),
            root_container: LayoutContainer {
                id: "root_canvas".to_string(),
                kind: ContainerKind::RootCanvas,
                layout_mode: "flex".to_string(),
                x: 0.0,
                y: 0.0,
                width: 320.0,
                height: 600.0,
                style: HashMap::new(),
                children: vec![
                    LayoutNode::Widget(WidgetDefinition {
                        id: "stat_hp".to_string(),
                        widget_type: WidgetType::StatBar,
                        label: "生命值 (HP)".to_string(),
                        data_binding: "stats.hp".to_string(),
                        x: 0.0, y: 0.0, width: 0.0, height: 0.0,
                        config: {
                            let mut m = HashMap::new();
                            m.insert("max_stat".to_string(), serde_json::json!("stats.max_hp"));
                            m.insert("bar_color".to_string(), serde_json::json!("#ef4444"));
                            m
                        },
                        style: HashMap::new(),
                    }),
                    LayoutNode::Widget(WidgetDefinition {
                        id: "stat_gold".to_string(),
                        widget_type: WidgetType::DataLabel,
                        label: "金币 (Gold)".to_string(),
                        data_binding: "stats.gold".to_string(),
                        x: 0.0, y: 0.0, width: 0.0, height: 0.0,
                        config: {
                            let mut m = HashMap::new();
                            m.insert("icon".to_string(), serde_json::json!("coin"));
                            m
                        },
                        style: HashMap::new(),
                    }),
                    LayoutNode::Widget(WidgetDefinition {
                        id: "inventory_grid".to_string(),
                        widget_type: WidgetType::InventorySlotGrid,
                        label: "背包槽位".to_string(),
                        data_binding: "inventory".to_string(),
                        x: 0.0, y: 0.0, width: 0.0, height: 0.0,
                        config: {
                            let mut m = HashMap::new();
                            m.insert("columns".to_string(), serde_json::json!(4));
                            m
                        },
                        style: HashMap::new(),
                    }),
                ],
            },
            required_data_interface: None,
        }
    }
}

impl LayoutContainer {
    pub fn collect_data_interface(&self, interface: &mut RequiredDataInterface) {
        for child in &self.children {
            match child {
                LayoutNode::Container(c) => c.collect_data_interface(interface),
                LayoutNode::Widget(w) => w.collect_data_interface(interface),
            }
        }
    }
}

impl WidgetDefinition {
    pub fn collect_data_interface(&self, interface: &mut RequiredDataInterface) {
        if self.widget_type == WidgetType::InventorySlotGrid {
            interface.required_inventory = true;
        }

        let db = self.data_binding.trim();
        if db == "inventory" {
            interface.required_inventory = true;
        } else if let Some(stat_key) = db.strip_prefix("stats.") {
            let key = stat_key.trim();
            if !key.is_empty() {
                let min_val = self.config.get("min").and_then(|v| v.as_f64());
                let max_val = self.config.get("max").and_then(|v| v.as_f64());
                interface.required_stats.entry(key.to_string()).or_insert_with(|| StatRequirement {
                    field_type: "number".to_string(),
                    min: min_val,
                    max: max_val,
                });
            }
        } else if let Some(flag_key) = db.strip_prefix("flags.") {
            let key = flag_key.trim();
            if !key.is_empty() && !interface.required_flags.contains(&key.to_string()) {
                interface.required_flags.push(key.to_string());
            }
        }

        for (_k, v) in &self.config {
            if let Some(s) = v.as_str() {
                let s = s.trim();
                if let Some(stat_key) = s.strip_prefix("stats.") {
                    let key = stat_key.trim();
                    if !key.is_empty() {
                        interface.required_stats.entry(key.to_string()).or_insert_with(|| StatRequirement {
                            field_type: "number".to_string(),
                            min: None,
                            max: None,
                        });
                    }
                } else if let Some(flag_key) = s.strip_prefix("flags.") {
                    let key = flag_key.trim();
                    if !key.is_empty() && !interface.required_flags.contains(&key.to_string()) {
                        interface.required_flags.push(key.to_string());
                    }
                }
            }
        }
    }
}

impl UILayoutDefinition {
    pub fn extract_required_data_interface(&self) -> RequiredDataInterface {
        let mut interface = RequiredDataInterface::default();
        self.root_container.collect_data_interface(&mut interface);
        interface.required_flags.sort();
        interface
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_required_data_interface_from_default_layout() {
        let layout = UILayoutDefinition::default();
        let interface = layout.extract_required_data_interface();
        assert!(interface.required_stats.contains_key("hp"));
        assert!(interface.required_stats.contains_key("max_hp"));
        assert!(interface.required_stats.contains_key("gold"));
        assert!(interface.required_inventory);
    }
}
