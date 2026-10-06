//! 单 Schema 保留层数（`retention_depth`）的倒序滑动裁剪。
//!
//! 传统模式下每轮回复都会重写整张 Schema，若把全部历史结构化输出都塞进上下文，
//! Token 会随轮次线性膨胀。这里按计划 §3.3 实现 **Reverse Sliding Pruner**：
//! 从最新一轮往前倒数，只保留最近 N 层**该 Schema 自己**的历史输出，更远的硬丢弃。
//!
//! 两个关键点（都属于 C2 零静默回退的落点）：
//! 1. `retention_depth: Some(0)` 是非法配置，必须报错而不是当成"不裁剪"或"全裁剪"；
//! 2. 计数只认**本 Schema 的输出**（按字段名签名识别），否则多 Schema 并用时
//!    会把别的 Schema 的历史也算进层数，导致误裁。

use crate::models::schema::SchemaDefinition;

/// 校验保留层数配置。`None` 表示不限制；`Some(N)` 要求 `N >= 1`。
pub fn validate_retention_depth(schema: &SchemaDefinition) -> Result<Option<u32>, String> {
    match schema.retention_depth {
        None => Ok(None),
        Some(0) => Err(format!(
            "Schema `{}`（id={}）的保留层数非法：retention_depth 必须为正整数，当前为 0",
            schema.name, schema.id
        )),
        Some(depth) => Ok(Some(depth)),
    }
}

/// 判定一段历史内容是否是**该 Schema** 的结构化输出。
///
/// 识别方式：内容必须是 JSON 对象，且至少命中该 Schema 的一个字段名。
/// 这是必要的启发式——历史消息里只存最终文本，没有记录它由哪张 Schema 产出。
pub fn is_schema_output(content: &str, field_names: &[String]) -> bool {
    if field_names.is_empty() {
        return false;
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(content) else {
        return false;
    };
    let Some(object) = value.as_object() else {
        return false;
    };
    field_names.iter().any(|name| object.contains_key(name))
}

/// 计算需要从历史中丢弃的下标集合。
///
/// - `is_assistant[i]`：第 i 块是否为 assistant 侧内容；
/// - `contents[i]`：第 i 块正文；
/// - 返回：需要丢弃的下标（升序）。
///
/// 只保留最近 `depth` 层该 Schema 的输出；更早的直接进丢弃集合。
pub fn dropped_indices(
    is_assistant: &[bool],
    contents: &[&str],
    schema: &SchemaDefinition,
) -> Result<Vec<usize>, String> {
    let Some(depth) = validate_retention_depth(schema)? else {
        return Ok(Vec::new());
    };

    let field_names: Vec<String> = schema.fields.iter().map(|f| f.name.clone()).collect();
    let mut kept = 0u32;
    let mut dropped = Vec::new();

    for (idx, (assistant, content)) in is_assistant.iter().zip(contents).enumerate().rev() {
        if !assistant {
            continue;
        }
        if !is_schema_output(content, &field_names) {
            continue;
        }
        kept += 1;
        if kept > depth {
            dropped.push(idx);
        }
    }

    dropped.sort_unstable();
    Ok(dropped)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::schema::{DisplayTarget, SchemaFieldDefinition, SchemaFieldType};

    fn schema_with(depth: Option<u32>, field_names: &[&str]) -> SchemaDefinition {
        SchemaDefinition {
            id: "s1".into(),
            preset_id: 1,
            name: "rpg_summary".into(),
            description: String::new(),
            retention_depth: depth,
            card: None,
            fields: field_names
                .iter()
                .map(|name| SchemaFieldDefinition {
                    name: (*name).to_string(),
                    field_type: SchemaFieldType::String,
                    required: true,
                    display_target: DisplayTarget::InlineMessage,
                    db_mapping: None,
                    description: String::new(),
                })
                .collect(),
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn none_depth_keeps_everything() {
        let schema = schema_with(None, &["narrative"]);
        let assistant = vec![true, true, true];
        let contents = vec![
            "{\"narrative\":\"a\"}",
            "{\"narrative\":\"b\"}",
            "{\"narrative\":\"c\"}",
        ];
        assert!(dropped_indices(&assistant, &contents, &schema)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn some_zero_is_rejected() {
        let schema = schema_with(Some(0), &["narrative"]);
        let err = dropped_indices(&[true], &["{\"narrative\":\"a\"}"], &schema).unwrap_err();
        assert!(err.contains("正整数"), "unexpected error: {err}");
    }

    #[test]
    fn keeps_latest_n_layers_of_this_schema_only() {
        let schema = schema_with(Some(2), &["narrative"]);
        let assistant = vec![true, true, true, true];
        let contents = vec![
            "{\"narrative\":\"old\"}",
            "{\"narrative\":\"mid\"}",
            "{\"other_field\":1}",
            "{\"narrative\":\"new\"}",
        ];
        // 最近 2 层是 mid 与 new；old 超出层数被丢弃；
        // 第 2 块不含本 Schema 字段，不属于本 Schema 的输出，不参与计数也不丢。
        assert_eq!(
            dropped_indices(&assistant, &contents, &schema).unwrap(),
            vec![0]
        );
    }

    #[test]
    fn user_blocks_are_never_pruned() {
        let schema = schema_with(Some(1), &["narrative"]);
        let assistant = vec![false, true];
        let contents = vec!["{\"narrative\":\"user side\"}", "{\"narrative\":\"a\"}"];
        assert!(dropped_indices(&assistant, &contents, &schema)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn signature_requires_json_object_with_known_field() {
        let names = vec!["hp".to_string()];
        assert!(is_schema_output("{\"hp\":10}", &names));
        assert!(!is_schema_output("{\"mp\":10}", &names));
        assert!(!is_schema_output("not json", &names));
        assert!(!is_schema_output("[1,2,3]", &names));
        assert!(!is_schema_output("{\"hp\":10}", &[]));
    }
}
