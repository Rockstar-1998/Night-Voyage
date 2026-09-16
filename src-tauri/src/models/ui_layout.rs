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
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    #[serde(default)]
    pub style: HashMap<String, String>,
    #[serde(default)]
    pub children: Vec<LayoutNode>,
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
                        config: {
                            let mut m = HashMap::new();
                            m.insert("columns".to_string(), serde_json::json!(4));
                            m
                        },
                        style: HashMap::new(),
                    }),
                ],
            },
        }
    }
}
