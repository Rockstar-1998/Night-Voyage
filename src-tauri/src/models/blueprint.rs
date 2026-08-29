use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// 蓝图节点类型判别枚举，与 [`NodeConfig`] 变体一一对应。
///
/// 序列化为 snake_case 字符串，与蓝图 JSON 中节点的 `type` 字段值匹配
/// （`start` / `end` / `prompt` / `schema_field` / `mutex_gate` / `group_gate`
/// / `mode_switch` / `role_switch` / `sampling_params` / `constant` / `branch`）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeType {
    Start,
    End,
    Prompt,
    SchemaField,
    MutexGate,
    GroupGate,
    ModeSwitch,
    RoleSwitch,
    /// 采样参数节点（legacy，通用协议）。保留以兼容旧图，不允许新建。
    SamplingParams,
    /// 常量节点：运行时读取会话属性，输出值供下游 BranchNode 回溯查询。
    Constant,
    /// 分支节点：接收上游 ConstantNode 的值，按 cases 匹配走对应出口。
    Branch,
    /// OpenAI / chat_completions 协议专用采样参数节点。
    SamplingParamsOpenAi,
    /// Anthropic 协议专用采样参数节点。
    SamplingParamsAnthropic,
}

/// 蓝图节点配置枚举，承载节点类型判别与对应配置载荷。
///
/// 使用 `#[serde(tag = "type", content = "config")]` 内部标签模式，让单个枚举同时
/// 承载类型与配置，从结构上消除 `NodeType` 与 `NodeConfig` 变体错配的无效状态。
/// 单元变体 `Start` / `End` 序列化时不产生 `config` 字段，匹配 spec 中无配置节点
/// 的格式（`{"type":"start"}`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "config", rename_all = "snake_case")]
pub enum NodeConfig {
    Start,
    End,
    Prompt(PromptConfig),
    SchemaField(SchemaFieldConfig),
    MutexGate(MutexGateConfig),
    GroupGate(GroupGateConfig),
    ModeSwitch(ModeSwitchConfig),
    RoleSwitch(RoleSwitchConfig),
    /// 采样参数节点（legacy，通用协议）。保留以兼容旧图，不允许新建。
    SamplingParams(SamplingParamsConfig),
    /// 常量节点：运行时读取会话属性，输出值供下游 BranchNode 回溯查询。
    Constant(ConstantConfig),
    /// 分支节点：接收上游 ConstantNode 的值，按 cases 匹配走对应出口。
    Branch(BranchConfig),
    /// OpenAI / chat_completions 协议专用采样参数。
    SamplingParamsOpenAi(OpenAiSamplingParamsConfig),
    /// Anthropic 协议专用采样参数。
    SamplingParamsAnthropic(AnthropicSamplingParamsConfig),
}

impl NodeConfig {
    /// 返回该配置对应的节点类型判别值。
    pub fn node_type(&self) -> NodeType {
        match self {
            Self::Start => NodeType::Start,
            Self::End => NodeType::End,
            Self::Prompt(_) => NodeType::Prompt,
            Self::SchemaField(_) => NodeType::SchemaField,
            Self::MutexGate(_) => NodeType::MutexGate,
            Self::GroupGate(_) => NodeType::GroupGate,
            Self::ModeSwitch(_) => NodeType::ModeSwitch,
            Self::RoleSwitch(_) => NodeType::RoleSwitch,
            Self::SamplingParams(_) => NodeType::SamplingParams,
            Self::Constant(_) => NodeType::Constant,
            Self::Branch(_) => NodeType::Branch,
            Self::SamplingParamsOpenAi(_) => NodeType::SamplingParamsOpenAi,
            Self::SamplingParamsAnthropic(_) => NodeType::SamplingParamsAnthropic,
            }
            }
            }

/// 蓝图节点画布坐标。仅编辑器使用，执行器忽略。
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct Position {
    pub x: f64,
    pub y: f64,
}

/// 蓝图节点。`config` 字段通过 `flatten` 将 `type` 与 `config` 合并到节点 JSON 顶层。
///
/// 序列化结果形如：
/// `{"id":"n_role","type":"prompt","config":{...},"position":{"x":200,"y":300}}`。
///
/// `position` 带 `#[serde(default)]`：导入文件可省略坐标字段（默认为 0,0），
/// 节省便携文件体积；编辑器打开后可通过「整理节点」重新计算布局。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintNode {
    pub id: String,
    #[serde(flatten)]
    pub config: NodeConfig,
    #[serde(default)]
    pub position: Position,
}

impl BlueprintNode {
    /// 返回该节点的类型判别值。
    pub fn node_type(&self) -> NodeType {
        self.config.node_type()
    }
}

/// 蓝图连线，从源节点输出端口指向目标节点输入端口。
///
/// `order` 用于在同一源节点 + 同一出口端口连出多条边时，定义分支选取与合并遍历的
/// 稳定顺序（端口优先级优先，order 其次）。旧版蓝图（v2 早期）不含该字段，
/// 通过 `deserialize_with` 缺省为 `0`，保证向后兼容。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BlueprintEdge {
    pub id: String,
    pub source: String,
    pub source_port: String,
    pub target: String,
    pub target_port: String,
    #[serde(default)]
    pub order: i32,
}

impl<'de> Deserialize<'de> for BlueprintEdge {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Helper {
            id: String,
            source: String,
            source_port: String,
            target: String,
            target_port: String,
            #[serde(default)]
            order: i32,
        }
        let h = Helper::deserialize(deserializer)?;
        Ok(BlueprintEdge {
            id: h.id,
            source: h.source,
            source_port: h.source_port,
            target: h.target,
            target_port: h.target_port,
            order: h.order,
        })
    }
}

/// 完整蓝图图，包含版本号、节点列表与连线列表。
///
/// 反序列化时强制校验 `version == 2`（v2 运行时执行架构），缺失或非 2 均报错。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintGraph {
    #[serde(deserialize_with = "deserialize_blueprint_version")]
    pub version: i32,
    pub nodes: Vec<BlueprintNode>,
    pub edges: Vec<BlueprintEdge>,
}

/// 蓝图版本号反序列化校验：仅接受 v2 运行时执行架构。
fn deserialize_blueprint_version<'de, D>(deserializer: D) -> Result<i32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = i32::deserialize(deserializer)?;
    if value != 2 {
        return Err(serde::de::Error::custom(format!(
            "blueprint graph version must be 2 (v2 runtime execution architecture), got {value}"
        )));
    }
    Ok(value)
}

/// Prompt 节点配置，图执行器产出 [`CompiledBlock`]。
///
/// `block_type` 字符串与 `services::prompt_compiler::PromptBlockKind` 对齐
/// （`system` / `character` / `world_book` / `plot_summary` / `world_variable`
/// / `recent_history` / `current_user` / etc.）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromptConfig {
    pub identifier: String,
    pub block_type: String,
    pub content: String,
    pub priority: Option<i32>,
    pub is_locked: bool,
    pub lock_reason: Option<String>,
}

/// SchemaField 节点配置，产出 structured_output_schema 字段与可选 db_mapping。
///
/// `db_mapping` 为 `Some("world_variables")` / `Some("plot_summary")` 时，
/// AI 输出中对应字段会被 stream_processor 写入 `message_rounds` 对应列。
///
/// `required` 控制该字段是否进入 `required` 数组（JSON Schema）。`false` 时
/// LLM 可省略该字段。前端默认 `true`。
///
/// `context_included` 控制该字段值是否参与下一轮对话上下文（影响
/// `filter_structured_content` 过滤）。注意：当 `db_mapping` 不为空时，
/// 字段值会通过 `world_variable` / `plot_summary` 块自动进入下一轮上下文，
/// 此时 `context_included` 的过滤无意义（流处理已将其持久化）。前端默认
/// `true`。
///
/// `display` 控制该字段在前端消息列表中的展示偏好（默认展开 / 隐藏标签）。
/// 序列化为 JSON 对象注入 preset 的 `structured_output_display` 列，供
/// `MessageItem.parseStructuredResponse` 消费。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SchemaFieldConfig {
    pub field_name: String,
    pub field_type: String,
    pub description: String,
    pub sub_schema: Option<serde_json::Value>,
    pub db_mapping: Option<String>,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(default = "default_true")]
    pub context_included: bool,
    #[serde(default)]
    pub display: FieldDisplayConfig,
    pub is_locked: bool,
    pub lock_reason: Option<String>,
    /// 字段在结构化输出 schema 中的顺序权重。作者可在配置面板编辑以控制
    /// `properties` / `required` 的排列顺序。排序按 `(order, 遍历插入序)` 稳定排序；
    /// 缺省（旧图）视为 0。核心基线字段 thinking/text 由执行器注入负 order 以固定在前。
    #[serde(default)]
    pub order: i32,
}

/// 字段在前端消息列表的展示偏好，对应旧版 `structured_output_display` 的单字段条目。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct FieldDisplayConfig {
    #[serde(default = "default_true")]
    pub default_expanded: bool,
    #[serde(default)]
    pub hide_label: bool,
    /// 是否为「叙事正文」（消息主体）。渲染时应作为主消息体展示，与 thinking 折叠区
    /// 在视觉上明确区分。由蓝图编译器在缺少正文基线时注入。
    #[serde(default)]
    pub body: bool,
}

fn default_true() -> bool { true }

/// Gate 选项，[`MutexGateConfig`] 与 [`GroupGateConfig`] 共用。
///
/// `description` 为选项核心字段（选择 UI 中显示的选项说明），旧 JSON 缺失时
/// 反序列化为 `None`，前端加载时回退为空字符串以保持兼容。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GateOption {
    pub key: String,
    pub label: String,
    pub description: Option<String>,
}

/// MutexGate 节点配置（互斥单选）。
///
/// 运行时选中值不存于图配置，由预设级 `preset_gate_selections` 表按 `node_id` 提供。
/// 节点 ID 已唯一，不再需要 `gate_id` 字段。端口命名：`in` × 1，`out_{option_key}` × N。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutexGateConfig {
    pub label: String,
    pub options: Vec<GateOption>,
}

/// GroupGate 节点配置（普通组，多选）。
///
/// 端口命名：`in` × 1，`out_{option_key}` × N。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupGateConfig {
    pub label: String,
    pub options: Vec<GateOption>,
}

/// ModeSwitch 节点配置，运行时根据会话 `memory_mode` 走三出口之一。
///
/// 出口端口名固定：`out_legacy` / `out_mem0` / `out_stateless`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModeSwitchConfig {
    pub label: String,
}

/// RoleSwitch 节点配置，运行时根据会话 `conversation_type` 走对应出口。
///
/// 与 [`ModeSwitchConfig`] 对称——把"角色模式轴"独立成节点，与"记忆模式轴"
/// 在图中串联使用，避免单节点端口膨胀。出口端口名固定：`out_single` / `out_online`
/// （未来扩展 `out_agent`）。
///
/// **已废弃**：被 [`ConstantConfig`] + [`BranchConfig`] 替代。保留变体以向后兼容
/// 旧图，图执行器仍能处理 RoleSwitch 节点。前端节点选择器已移除 RoleSwitch 选项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoleSwitchConfig {
    pub label: String,
}

/// Constant 节点配置，运行时读取会话属性，输出值供下游 [`BranchConfig`] 回溯查询。
///
/// `source` 指定会话属性键名，当前支持：
/// - `"conversation_type"` → 输出 `context.conversation_type`（`"single"` / `"online"`）
/// - `"memory_mode"` → 输出 `context.memory_mode`（`"stateless"` / `"legacy"` / `"mem0"`）
/// - `"protocol"` → 输出 `context.protocol`（`"anthropic"` / `"chat_completions"`）
///
/// 出口端口：`out`。值不通过运行时管道传递，而是由下游 BranchNode 通过入边回溯
/// 读取 ConstantNode 的 `source` 配置，直接从 context 取值（详见 spec §3.1）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConstantConfig {
    pub label: String,
    pub source: String,
}

/// Branch 节点的单条匹配规则。
///
/// 运行时按 `cases` 顺序匹配，第一个 `match_value` 与上游 ConstantNode 输出值
/// 相等的规则生效，走其 `port` 出口。所有 case 都不匹配时走 `default_port`。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchCase {
    pub match_value: String,
    pub port: String,
}

/// Branch 节点配置，接收上游 [`ConstantConfig`] 的值，按 `cases` 匹配走对应出口。
///
/// 入口端口：`in`（必须来自 ConstantNode）。
/// 出口端口：每个 case 的 `port` + `default_port`，每个出口都必须有出边。
///
/// `default_port` 必填，避免无匹配时图执行器无路可走（C2 零回退：不静默跳过）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BranchConfig {
    pub label: String,
    pub cases: Vec<BranchCase>,
    pub default_port: String,
}

/// SamplingParams 节点配置，产出 [`CompiledSamplingParams`]。
///
/// 多个 SamplingParams 节点时，图执行器按遍历顺序后者覆盖前者。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SamplingParamsConfig {
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    pub stop: Option<Vec<String>>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget_tokens: Option<i64>,
    pub is_locked: bool,
}

/// OpenAI / chat_completions 协议专用采样参数节点配置。
///
/// 只暴露 OpenAI 兼容路径支持的字段。`frequency_penalty` /
/// `presence_penalty` 仅 OpenAI 支持（Anthropic 侧
/// `supports_frequency_penalty` / `supports_presence_penalty` 均为 false），
/// 故不出现在 Anthropic 版配置里。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct OpenAiSamplingParamsConfig {
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    pub stop: Option<Vec<String>>,
    pub is_locked: bool,
}

/// Anthropic 协议专用采样参数节点配置。
///
/// 只暴露 Anthropic 支持的字段。`thinking_enabled` /
/// `thinking_budget_tokens` 仅 Anthropic 支持（OpenAI 兼容路径遇到
/// `thinking.enabled` 会直接报错），故不出现在 OpenAI 版配置里。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnthropicSamplingParamsConfig {
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub stop: Option<Vec<String>>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget_tokens: Option<i64>,
    pub is_locked: bool,
}

/// Gate 运行时选中状态。
///
/// MutexGate：`keys` 长度为 0 或 1；GroupGate：任意长度。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GateSelection {
    pub keys: Vec<String>,
}

/// 蓝图执行上下文，承载会话级运行时状态。
///
/// `memory_mode` 取值：`"legacy"` / `"mem0"` / `"stateless"`，驱动 ModeSwitch 节点。
/// `conversation_type` 取值：`"single"` / `"online"`（未来扩展 `"agent"`），驱动 RoleSwitch 节点。
/// `protocol` 取值：`"anthropic"` / `"chat_completions"`，驱动 `protocol` 分支（Constant + Branch）。
/// `gate_selections` 键为 [`BlueprintNode::id`]（节点 ID 已唯一，gate_id 已移除）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BlueprintExecutionContext {
    pub memory_mode: String,
    pub conversation_type: String,
    pub protocol: String,
    pub gate_selections: HashMap<String, GateSelection>,
}

/// 图执行器产出的 prompt block，供 compile_prompt 注入。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CompiledBlock {
    pub identifier: String,
    pub block_type: String,
    pub content: String,
    pub priority: Option<i32>,
    pub is_locked: bool,
}

/// 图执行器产出的采样参数。
///
/// 注意：此类型与 `services::prompt_compiler::CompiledSamplingParams` 字段集不同，
/// 后者由 Task 2 执行器完成从本类型到 prompt_compiler 类型的转换。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
pub struct CompiledSamplingParams {
    pub temperature: Option<f64>,
    pub max_tokens: Option<i64>,
    pub top_p: Option<f64>,
    pub frequency_penalty: Option<f64>,
    pub presence_penalty: Option<f64>,
    pub stop: Vec<String>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget_tokens: Option<i64>,
}

/// 蓝图执行结果，包含 prompt blocks、structured_output_schema、采样参数与 db 字段映射。
///
/// `structured_output_schema` 为 JSON Schema 对象（`{"type":"object","properties":{...}}`）。
/// `db_mappings` 键为 [`SchemaFieldConfig::field_name`]，值为 `db_mapping` 字段名。
/// `context_included_keys` 键为字段名，值 `false` 表示该字段不进入下一轮上下文。
/// `display_config` 键为字段名，值为该字段的展示偏好（默认展开/隐藏标签），
/// 序列化为 JSON 对象后写入 `presets.structured_output_display`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlueprintExecutionResult {
    pub blocks: Vec<CompiledBlock>,
    pub structured_output_schema: serde_json::Value,
    pub sampling_params: CompiledSamplingParams,
    pub db_mappings: HashMap<String, String>,
    #[serde(default)]
    pub context_included_keys: HashMap<String, bool>,
    #[serde(default)]
    pub display_config: HashMap<String, FieldDisplayConfig>,
    /// 字段顺序追踪：记录每个 schema 字段的 `(field_name, order)` 与遍历插入序。
    /// 执行器据此把 `properties` / `required` 重排为「(order, 遍历序)」稳定序。
    /// 仅内部使用，不进入对外序列化合约。
    #[serde(skip)]
    pub schema_field_order: Vec<(String, i32)>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// spec 中给出的完整蓝图样例 JSON（Start + Prompt + ModeSwitch + SchemaField×2
    /// + SamplingParams + End + 8 条边）。
    const SPEC_SAMPLE_JSON: &str = r#"{
        "version": 2,
        "nodes": [
            { "id": "n_start", "type": "start", "position": {"x":0,"y":300} },
            {
                "id": "n_role", "type": "prompt", "position": {"x":200,"y":300},
                "config": {
                    "identifier": "role_definition",
                    "block_type": "system",
                    "content": "你是角色扮演故事叙述者……",
                    "priority": null,
                    "is_locked": true,
                    "lock_reason": "核心角色定义不可改"
                }
            },
            {
                "id": "n_mode", "type": "mode_switch", "position": {"x":400,"y":300},
                "config": { "label": "记忆模式分支" }
            },
            {
                "id": "n_thinking", "type": "schema_field", "position": {"x":700,"y":200},
                "config": {
                    "field_name": "thinking", "field_type": "string",
                    "description": "AI 内心思考", "sub_schema": null,
                    "db_mapping": null, "is_locked": false, "lock_reason": null
                }
            },
            {
                "id": "n_wv", "type": "schema_field", "position": {"x":900,"y":200},
                "config": {
                    "field_name": "world_variables", "field_type": "object",
                    "description": "当前世界状态",
                    "sub_schema": { "properties": {"location":{"type":"string"}, "mood":{"type":"string"}} },
                    "db_mapping": "world_variables",
                    "is_locked": false, "lock_reason": null
                }
            },
            {
                "id": "n_params", "type": "sampling_params", "position": {"x":1100,"y":300},
                "config": { "temperature": 0.8, "max_tokens": 4096, "top_p": 0.95,
                            "frequency_penalty": null, "presence_penalty": null, "stop": null,
                            "is_locked": false }
            },
            { "id": "n_end", "type": "end", "position": {"x":1300,"y":300} }
        ],
        "edges": [
            {"id":"e1","source":"n_start","source_port":"out","target":"n_role","target_port":"in"},
            {"id":"e2","source":"n_role","source_port":"out","target":"n_mode","target_port":"in"},
            {"id":"e3","source":"n_mode","source_port":"out_legacy","target":"n_thinking","target_port":"in"},
            {"id":"e4","source":"n_mode","source_port":"out_mem0","target":"n_thinking","target_port":"in"},
            {"id":"e5","source":"n_mode","source_port":"out_stateless","target":"n_thinking","target_port":"in"},
            {"id":"e6","source":"n_thinking","source_port":"out","target":"n_wv","target_port":"in"},
            {"id":"e7","source":"n_wv","source_port":"out","target":"n_params","target_port":"in"},
            {"id":"e8","source":"n_params","source_port":"out","target":"n_end","target_port":"in"}
        ]
    }"#;

    #[test]
    fn deserialize_spec_sample_succeeds() {
        let graph: BlueprintGraph = serde_json::from_str(SPEC_SAMPLE_JSON)
            .expect("spec sample JSON must deserialize into BlueprintGraph");

        assert_eq!(graph.version, 2);
        assert_eq!(graph.nodes.len(), 7, "spec sample has 7 nodes");
        assert_eq!(graph.edges.len(), 8, "spec sample has 8 edges");

        // 节点顺序与 JSON 一致，逐个验证类型判别
        let node_types: Vec<NodeType> = graph.nodes.iter().map(|n| n.node_type()).collect();
        assert_eq!(
            node_types,
            vec![
                NodeType::Start,
                NodeType::Prompt,
                NodeType::ModeSwitch,
                NodeType::SchemaField,
                NodeType::SchemaField,
                NodeType::SamplingParams,
                NodeType::End,
            ]
        );

        // Start / End 应为单元变体（无 config 字段）
        let start = &graph.nodes[0];
        assert_eq!(start.id, "n_start");
        assert_eq!(start.position.x, 0.0);
        assert_eq!(start.position.y, 300.0);
        assert!(matches!(start.config, NodeConfig::Start));

        // Prompt 节点配置字段
        let prompt = match &graph.nodes[1].config {
            NodeConfig::Prompt(cfg) => cfg,
            other => panic!("expected Prompt, got {other:?}"),
        };
        assert_eq!(prompt.identifier, "role_definition");
        assert_eq!(prompt.block_type, "system");
        assert_eq!(prompt.content, "你是角色扮演故事叙述者……");
        assert_eq!(prompt.priority, None);
        assert!(prompt.is_locked);
        assert_eq!(prompt.lock_reason.as_deref(), Some("核心角色定义不可改"));

        // ModeSwitch 节点
        let mode = match &graph.nodes[2].config {
            NodeConfig::ModeSwitch(cfg) => cfg,
            other => panic!("expected ModeSwitch, got {other:?}"),
        };
        assert_eq!(mode.label, "记忆模式分支");

        // 第二个 SchemaField 带 sub_schema 与 db_mapping
        let wv = match &graph.nodes[4].config {
            NodeConfig::SchemaField(cfg) => cfg,
            other => panic!("expected SchemaField, got {other:?}"),
        };
        assert_eq!(wv.field_name, "world_variables");
        assert_eq!(wv.field_type, "object");
        assert_eq!(wv.db_mapping.as_deref(), Some("world_variables"));
        assert!(wv.sub_schema.is_some(), "world_variables sub_schema must be present");

        // SamplingParams 节点
        let params = match &graph.nodes[5].config {
            NodeConfig::SamplingParams(cfg) => cfg,
            other => panic!("expected SamplingParams, got {other:?}"),
        };
        assert_eq!(params.temperature, Some(0.8));
        assert_eq!(params.max_tokens, Some(4096));
        assert_eq!(params.top_p, Some(0.95));
        assert_eq!(params.frequency_penalty, None);
        assert_eq!(params.presence_penalty, None);
        assert_eq!(params.stop, None);
        assert!(!params.is_locked);

        // End 节点
        let end = &graph.nodes[6];
        assert_eq!(end.id, "n_end");
        assert!(matches!(end.config, NodeConfig::End));

        // 边字段
        let e1 = &graph.edges[0];
        assert_eq!(e1.id, "e1");
        assert_eq!(e1.source, "n_start");
        assert_eq!(e1.source_port, "out");
        assert_eq!(e1.target, "n_role");
        assert_eq!(e1.target_port, "in");
    }

    #[test]
    fn serialize_then_deserialize_is_equivalent() {
        let original: BlueprintGraph = serde_json::from_str(SPEC_SAMPLE_JSON)
            .expect("spec sample must deserialize for round-trip test");

        let reserialized = serde_json::to_string(&original)
            .expect("BlueprintGraph must serialize to JSON string");

        let round_tripped: BlueprintGraph = serde_json::from_str(&reserialized)
            .expect("serialized JSON must deserialize back into BlueprintGraph");

        assert_eq!(original.version, round_tripped.version);
        assert_eq!(original.nodes.len(), round_tripped.nodes.len());
        assert_eq!(original.edges.len(), round_tripped.edges.len());

        // 逐节点对比 id 与类型判别（无法直接 PartialEq 因为 Position 不实现 Eq，f64）
        for (a, b) in original.nodes.iter().zip(round_tripped.nodes.iter()) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.node_type(), b.node_type());
            assert_eq!(a.position.x, b.position.x);
            assert_eq!(a.position.y, b.position.y);
        }
        assert_eq!(original.edges, round_tripped.edges);

        // 关键：Start/End 序列化后不应含 config 字段
        let start_json = serde_json::to_string(&original.nodes[0])
            .expect("Start node must serialize");
        assert!(
            !start_json.contains("\"config\""),
            "Start node must not emit `config` field, got: {start_json}"
        );
        assert!(
            start_json.contains("\"type\":\"start\""),
            "Start node must emit `type: \"start\"`, got: {start_json}"
        );

        let end_json = serde_json::to_string(&original.nodes[6])
            .expect("End node must serialize");
        assert!(
            !end_json.contains("\"config\""),
            "End node must not emit `config` field, got: {end_json}"
        );
        assert!(
            end_json.contains("\"type\":\"end\""),
            "End node must emit `type: \"end\"`, got: {end_json}"
        );
    }

    #[test]
    fn missing_version_field_is_rejected() {
        let json = r#"{
            "nodes": [],
            "edges": []
        }"#;

        let err = serde_json::from_str::<BlueprintGraph>(json)
            .expect_err("missing `version` field must fail deserialization");
        let msg = err.to_string();
        assert!(
            msg.contains("version"),
            "error message must mention `version`, got: {msg}"
        );
    }

    #[test]
    fn wrong_version_value_is_rejected() {
        let json = r#"{
            "version": 1,
            "nodes": [],
            "edges": []
        }"#;

        let err = serde_json::from_str::<BlueprintGraph>(json)
            .expect_err("version != 2 must fail deserialization");
        let msg = err.to_string();
        assert!(
            msg.contains("version must be 2"),
            "error message must mention version must be 2, got: {msg}"
        );
    }

    #[test]
    fn node_type_discriminant_matches_config_variant() {
        let cases = [
            (NodeConfig::Start, NodeType::Start),
            (NodeConfig::End, NodeType::End),
            (
                NodeConfig::Prompt(PromptConfig {
                    identifier: "id".to_string(),
                    block_type: "system".to_string(),
                    content: String::new(),
                    priority: None,
                    is_locked: false,
                    lock_reason: None,
                }),
                NodeType::Prompt,
            ),
            (
                NodeConfig::ModeSwitch(ModeSwitchConfig {
                    label: "label".to_string(),
                }),
                NodeType::ModeSwitch,
            ),
            (
                NodeConfig::RoleSwitch(RoleSwitchConfig {
                    label: "label".to_string(),
                }),
                NodeType::RoleSwitch,
            ),
        ];

        for (config, expected_type) in cases {
            assert_eq!(
                config.node_type(),
                expected_type,
                "NodeConfig::node_type() must match variant"
            );
        }
    }

    /// RoleSwitch 节点 + GateOption description 兼容性回归测试。
    ///
    /// 锁定 spec §4.1 的关键契约：
    /// 1. RoleSwitch 节点可序列化为 `{"type":"role_switch","config":{"label":...}}`，
    ///    反序列化后类型判别为 `NodeType::RoleSwitch`。
    /// 2. MutexGate/GroupGate 配置不含 `gate_id` 字段（serde 默认忽略旧 JSON 多余字段）。
    /// 3. GateOption 缺失 `description` 字段时反序列化为 `None`（旧 JSON 兼容）。
    /// 4. GateOption 显式 `description: null` 同样反序列化为 `None`。
    #[test]
    fn role_switch_and_gate_option_description_round_trip() {
        let json = r#"{
            "version": 2,
            "nodes": [
                { "id": "n_start", "type": "start", "position": {"x":0,"y":0} },
                {
                    "id": "n_role", "type": "role_switch", "position": {"x":100,"y":0},
                    "config": { "label": "角色模式分支" }
                },
                {
                    "id": "n_mutex", "type": "mutex_gate", "position": {"x":200,"y":0},
                    "config": {
                        "label": "叙事视角",
                        "options": [
                            { "key": "p1", "label": "第一人称", "description": "以「我」叙述" },
                            { "key": "p3", "label": "第三人称", "description": null }
                        ]
                    }
                },
                {
                    "id": "n_group", "type": "group_gate", "position": {"x":300,"y":0},
                    "config": {
                        "label": "扰动开关",
                        "options": [
                            { "key": "intrude", "label": "允许乱入" }
                        ]
                    }
                },
                { "id": "n_end", "type": "end", "position": {"x":400,"y":0} }
            ],
            "edges": [
                {"id":"e1","source":"n_start","source_port":"out","target":"n_role","target_port":"in"},
                {"id":"e2","source":"n_role","source_port":"out_single","target":"n_mutex","target_port":"in"},
                {"id":"e3","source":"n_role","source_port":"out_online","target":"n_mutex","target_port":"in"},
                {"id":"e4","source":"n_mutex","source_port":"out_p1","target":"n_group","target_port":"in"},
                {"id":"e5","source":"n_mutex","source_port":"out_p3","target":"n_group","target_port":"in"},
                {"id":"e6","source":"n_group","source_port":"out_intrude","target":"n_end","target_port":"in"}
            ]
        }"#;

        let graph: BlueprintGraph = serde_json::from_str(json)
            .expect("RoleSwitch + Gate graph must deserialize");

        // RoleSwitch 节点
        let role = match &graph.nodes[1].config {
            NodeConfig::RoleSwitch(cfg) => cfg,
            other => panic!("expected RoleSwitch, got {other:?}"),
        };
        assert_eq!(role.label, "角色模式分支");
        assert_eq!(graph.nodes[1].node_type(), NodeType::RoleSwitch);

        // MutexGate 配置不含 gate_id；GateOption description 显式有值
        let mutex = match &graph.nodes[2].config {
            NodeConfig::MutexGate(cfg) => cfg,
            other => panic!("expected MutexGate, got {other:?}"),
        };
        assert_eq!(mutex.label, "叙事视角");
        assert_eq!(mutex.options.len(), 2);
        assert_eq!(mutex.options[0].key, "p1");
        assert_eq!(mutex.options[0].description.as_deref(), Some("以「我」叙述"));
        // description: null → None
        assert_eq!(mutex.options[1].description, None);

        // GroupGate 配置不含 gate_id；GateOption 缺失 description → None
        let group = match &graph.nodes[3].config {
            NodeConfig::GroupGate(cfg) => cfg,
            other => panic!("expected GroupGate, got {other:?}"),
        };
        assert_eq!(group.options.len(), 1);
        assert_eq!(group.options[0].description, None);

        // 序列化后再反序列化，保持等价
        let reserialized = serde_json::to_string(&graph)
            .expect("graph with RoleSwitch must serialize");
        let round_tripped: BlueprintGraph = serde_json::from_str(&reserialized)
            .expect("round-trip must succeed");
        assert_eq!(graph.nodes.len(), round_tripped.nodes.len());
        for (a, b) in graph.nodes.iter().zip(round_tripped.nodes.iter()) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.node_type(), b.node_type());
        }

        // 关键：序列化后的 JSON 不应包含 gate_id 字段
        assert!(
            !reserialized.contains("gate_id"),
            "serialized graph must not contain `gate_id`, got: {reserialized}"
        );
        // 关键：RoleSwitch 节点序列化应包含 type:"role_switch"
        assert!(
            reserialized.contains("\"type\":\"role_switch\""),
            "RoleSwitch node must emit `type: \"role_switch\"`, got: {reserialized}"
        );
    }
}
