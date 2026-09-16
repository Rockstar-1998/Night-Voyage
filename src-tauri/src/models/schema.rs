use serde::{Deserialize, Serialize};

/// 字段呈现行为目标
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DisplayTarget {
    /// 常驻于会话视口中（根据 UI 设计器自由排版，始终原地渲染最新数据）
    PersistentHUD,
    /// 当前轮次内联消息气泡流（如正文叙事、思维链）
    InlineMessage,
}

impl Default for DisplayTarget {
    fn default() -> Self {
        Self::InlineMessage
    }
}

/// Schema 字段数据类型
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SchemaFieldType {
    String,
    Number,
    Boolean,
    Array,
    Object,
}

impl Default for SchemaFieldType {
    fn default() -> Self {
        Self::String
    }
}

/// Schema 字段定义
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaFieldDefinition {
    pub name: String,
    pub field_type: SchemaFieldType,
    pub required: bool,
    pub display_target: DisplayTarget,
    pub db_mapping: Option<String>,
    pub description: String,
}

/// 独立 Schema 资产定义
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaDefinition {
    pub id: String,
    pub preset_id: i64,
    pub name: String,
    pub description: String,
    /// 单个 Schema 独立配置保留层数：None 表示不限制；Some(N) 表示从最新层倒数保留 N 层在上下文中，过远的历史直接丢弃
    pub retention_depth: Option<u32>,
    /// 字段列表（物理顺序由 Vec 顺序严格保证）
    pub fields: Vec<SchemaFieldDefinition>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl SchemaDefinition {
    /// 将字段定义转换为严格保持物理行排序的 JSON Schema
    pub fn to_json_schema(&self) -> serde_json::Value {
        let mut properties = serde_json::Map::new();
        let mut required_fields = Vec::new();

        for field in &self.fields {
            let mut field_schema = serde_json::Map::new();
            let type_str = match field.field_type {
                SchemaFieldType::String => "string",
                SchemaFieldType::Number => "number",
                SchemaFieldType::Boolean => "boolean",
                SchemaFieldType::Array => "array",
                SchemaFieldType::Object => "object",
            };
            field_schema.insert("type".to_string(), serde_json::json!(type_str));
            if !field.description.is_empty() {
                field_schema.insert("description".to_string(), serde_json::json!(field.description));
            }

            properties.insert(field.name.clone(), serde_json::Value::Object(field_schema));

            if field.required {
                required_fields.push(serde_json::Value::String(field.name.clone()));
            }
        }

        let mut root = serde_json::Map::new();
        root.insert("type".to_string(), serde_json::json!("object"));
        root.insert("properties".to_string(), serde_json::Value::Object(properties));
        if !required_fields.is_empty() {
            root.insert("required".to_string(), serde_json::Value::Array(required_fields));
        }

        serde_json::Value::Object(root)
    }

    /// 从 SQLite 行构造 SchemaDefinition
    pub fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self, String> {
        use sqlx::Row;
        let id: String = row.try_get("id").map_err(|e| e.to_string())?;
        let preset_id: i64 = row.try_get("preset_id").map_err(|e| e.to_string())?;
        let name: String = row.try_get("name").map_err(|e| e.to_string())?;
        let description: String = row.try_get("description").map_err(|e| e.to_string())?;
        let retention_depth_i64: Option<i64> = row.try_get("retention_depth").map_err(|e| e.to_string())?;
        let retention_depth = retention_depth_i64.map(|v| v as u32);
        let fields_json: String = row.try_get("fields_json").map_err(|e| e.to_string())?;
        let created_at: i64 = row.try_get("created_at").map_err(|e| e.to_string())?;
        let updated_at: i64 = row.try_get("updated_at").map_err(|e| e.to_string())?;

        let fields: Vec<SchemaFieldDefinition> = serde_json::from_str(&fields_json)
            .map_err(|e| format!("Failed to parse schema fields JSON: {}", e))?;

        Ok(Self {
            id,
            preset_id,
            name,
            description,
            retention_depth,
            fields,
            created_at,
            updated_at,
        })
    }
}
