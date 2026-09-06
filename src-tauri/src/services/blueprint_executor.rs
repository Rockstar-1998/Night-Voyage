//! Blueprint graph executor — runtime traversal of the preset blueprint graph.
//!
//! Produces [`BlueprintExecutionResult`] (blocks / structured_output_schema /
//! sampling_params / db_mappings) from a [`BlueprintGraph`] under a given
//! [`BlueprintExecutionContext`]. The executor is pure-memory and async-by-contract
//! (keeps the interface ready for future IO extensions per spec).

use std::collections::{HashMap, HashSet};

use crate::models::blueprint::{
    BlueprintEdge, BlueprintExecutionContext, BlueprintExecutionResult, BlueprintGraph,
    AnthropicSamplingParamsConfig, CompiledBlock, CompiledSamplingParams, FieldDisplayConfig,
    NodeConfig, OpenAiSamplingParamsConfig, SamplingParamsConfig, SchemaFieldConfig,
};

/// Graph execution error. Maps 1:1 to the failure modes enumerated in the
/// preset-blueprint-editor spec (cycle detection, missing nodes, duplicate ids,
/// gate selection gaps, etc.).
///
/// Implemented manually (no `thiserror`) to match the crate's existing error
/// style (see `services::memory_service::MemoryServiceError`).
#[derive(Debug, Clone)]
pub enum BlueprintError {
    /// Graph contains no `Start` node.
    NoStartNode,
    /// Graph contains more than one `Start` node.
    MultipleStartNodes,
    /// Graph contains no `End` node.
    NoEndNode,
    /// Graph contains more than one `End` node.
    MultipleEndNodes,
    /// A referenced node id does not exist in `graph.nodes`.
    NodeNotFound(String),
    /// The given output port of a node has no outgoing edge.
    NoOutgoingEdge { node: String, port: String },
    /// A cycle was detected during DFS traversal at the given node.
    CycleDetected(String),
    /// The context lacks a gate selection for the given node_id.
    MissingGateSelection(String),
    /// A MutexGate selection contains zero keys.
    NoMutexGateSelection(String),
    /// Two SchemaField nodes share the same field_name.
    DuplicateFieldName(String),
    /// Two Prompt nodes share the same identifier.
    DuplicateIdentifier(String),
    /// A ModeSwitch node is missing one of out_legacy/out_mem0/out_stateless.
    MissingModeSwitchPort(String, String),
    /// A RoleSwitch node is missing one of out_single/out_online.
    MissingRoleSwitchPort(String, String),
    /// End is not reachable from Start.
    UnreachableEnd,
    /// A locked node is not reachable from Start (off main path).
    LockedNodeOffMainPath(String),
    /// Schema property construction failed.
    SchemaBuildError(String),
    /// A Branch node has no incoming edge (must be preceded by a Constant node).
    BranchNoIncomingEdge(String),
    /// A Branch node's upstream is not a Constant node.
    BranchMustFollowConstant(String),
    /// A Constant node's `source` is not a recognized session attribute key.
    UnknownConstantSource(String),
    /// A Branch node is missing a required port (case port or default_port).
    MissingBranchPort(String, String),
    /// A Branch node lacks the `value` input edge that feeds its match input.
    MissingValueInput(String),
    /// The upstream of a `value` edge is not a pure value node (Constant).
    ValueSourceNotValueNode(String),
    /// Value evaluation re-entered a port already being resolved (value cycle).
    ValueCycleDetected(String, String),
    /// A pure value node (Constant) was reached by the execution flow. The graph
    /// predates the value-pin dataflow and has not been migrated.
    ConstantOnExecPath(String),
    /// `context.protocol` is neither `anthropic` nor `chat_completions`，无法裁定
    /// 采样参数节点该走哪套协议方言。
    UnknownSamplingProtocol(String),
}

impl std::fmt::Display for BlueprintError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoStartNode => write!(f, "blueprint graph has no start node"),
            Self::MultipleStartNodes => write!(f, "blueprint graph has multiple start nodes"),
            Self::NoEndNode => write!(f, "blueprint graph has no end node"),
            Self::MultipleEndNodes => write!(f, "blueprint graph has multiple end nodes"),
            Self::NodeNotFound(id) => write!(f, "node {id} not found"),
            Self::NoOutgoingEdge { node, port } => {
                write!(f, "port {port} of node {node} has no outgoing edge")
            }
            Self::CycleDetected(id) => write!(f, "cycle detected at node {id}"),
            Self::MissingGateSelection(id) => {
                write!(f, "gate node {id} has no selection in context")
            }
            Self::NoMutexGateSelection(id) => {
                write!(f, "mutex gate node {id} requires exactly one selected key")
            }
            Self::DuplicateFieldName(name) => write!(f, "duplicate field_name: {name}"),
            Self::DuplicateIdentifier(id) => write!(f, "duplicate identifier: {id}"),
            Self::MissingModeSwitchPort(node, port) => {
                write!(f, "mode_switch node {node} missing required port: {port}")
            }
            Self::MissingRoleSwitchPort(node, port) => {
                write!(f, "role_switch node {node} missing required port: {port}")
            }
            Self::UnreachableEnd => write!(f, "start node not reachable to end"),
            Self::LockedNodeOffMainPath(id) => {
                write!(f, "locked node {id} is not on main path")
            }
            Self::SchemaBuildError(msg) => write!(f, "schema build error: {msg}"),
            Self::BranchNoIncomingEdge(id) => {
                write!(f, "branch node {id} has no incoming edge (must follow a constant node)")
            }
            Self::BranchMustFollowConstant(id) => {
                write!(f, "branch node {id} must be preceded by a constant node")
            }
            Self::UnknownConstantSource(src) => {
                write!(f, "unknown constant source: {src}")
            }
            Self::MissingBranchPort(node, port) => {
                write!(f, "branch node {node} missing required port: {port}")
            }
            Self::MissingValueInput(node) => {
                write!(f, "branch node {node} has no `value` input edge")
            }
            Self::ValueSourceNotValueNode(node) => {
                write!(f, "node {node} is not a pure value node; cannot feed a `value` pin")
            }
            Self::ValueCycleDetected(node, port) => {
                write!(f, "value cycle detected at port {port} of node {node}")
            }
            Self::ConstantOnExecPath(node) => {
                write!(
                    f,
                    "constant node {node} sits on the execution flow; migrate the graph so the \
                     constant feeds the branch through the `value` pin"
                )
            }
            Self::UnknownSamplingProtocol(protocol) => {
                write!(
                    f,
                    "unknown sampling protocol: {protocol} (expected `anthropic` or \
                     `chat_completions`)"
                )
            }
        }
    }
}

/// 采样参数的协议方言。由 [`BlueprintExecutionContext::protocol`] 解析。
///
/// 用类型而非布尔标志位表达"当前该用哪套采样参数"：未知协议在解析期即报错，
/// 杜绝"默认当 OpenAI 处理"的静默回退（C2）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SamplingDialect {
    /// OpenAI / chat_completions 协议。
    OpenAi,
    /// Anthropic 协议。
    Anthropic,
}

impl SamplingDialect {
    /// 从会话协议字符串解析。未知协议显式报错。
    pub fn parse(protocol: &str) -> Result<Self, BlueprintError> {
        match protocol {
            "chat_completions" => Ok(Self::OpenAi),
            "anthropic" => Ok(Self::Anthropic),
            other => Err(BlueprintError::UnknownSamplingProtocol(other.to_string())),
        }
    }
}

impl std::error::Error for BlueprintError {}

/// 引脚端口名常量（与前端 `getInputPorts` / `getOutputPorts` 契约一致）。
pub mod port_names {
    /// exec 输入引脚端口名。
    pub const EXEC_IN: &str = "in";
    /// value 输入引脚端口名（Branch 的匹配值入口）。
    pub const VALUE_IN: &str = "value";
    /// exec / value 输出引脚端口名。
    pub const OUT: &str = "out";
}

/// 蓝图中的值。当前仅会话属性字符串一类。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BlueprintValue {
    /// 会话属性值（`conversation_type` / `memory_mode` / `protocol` 的取值）。
    Session(String),
}

impl BlueprintValue {
    /// 以字符串形式读取值。
    pub fn as_str(&self) -> &str {
        match self {
            Self::Session(value) => value.as_str(),
        }
    }
}

/// 值求值环境：缓存已求值端口，并用求值栈检测 value 依赖环。
///
/// 值沿 value 边以 UE 的 pull-based 方式求值：执行流到达 Branch 时，Branch 沿其
/// `value` 入边反向求值上游纯值节点，结果写入本环境缓存。同一纯值节点被多个
/// Branch 引用时只求值一次。
#[derive(Debug, Default)]
pub struct ValueEnvironment {
    resolved: HashMap<(String, String), BlueprintValue>,
    resolving: HashSet<(String, String)>,
}

impl ValueEnvironment {
    /// 读取已缓存的值。
    pub fn get(&self, node_id: &str, port: &str) -> Option<&BlueprintValue> {
        self.resolved.get(&(node_id.to_string(), port.to_string()))
    }

    /// 写入求值结果。
    pub fn insert(&mut self, node_id: &str, port: &str, value: BlueprintValue) {
        self.resolved.insert((node_id.to_string(), port.to_string()), value);
    }

    /// 进入求值栈。端口已在栈中说明 value 依赖成环，显式报错（C2）。
    pub fn begin_resolve(
        &mut self,
        node_id: &str,
        port: &str,
    ) -> Result<(), BlueprintError> {
        let key = (node_id.to_string(), port.to_string());
        if !self.resolving.insert(key.clone()) {
            return Err(BlueprintError::ValueCycleDetected(node_id.to_string(), port.to_string()));
        }
        Ok(())
    }

    /// 退出求值栈。
    pub fn end_resolve(&mut self, node_id: &str, port: &str) {
        self.resolving.remove(&(node_id.to_string(), port.to_string()));
    }
}

/// Execute the blueprint graph and produce compilation data for `compile_prompt`.
///
/// Pure-memory DFS traversal. Declared `async` to keep the interface ready for
/// future IO extensions (spec: preset-blueprint-editor §后端图执行器).
pub async fn execute_blueprint(
    graph: &BlueprintGraph,
    context: &BlueprintExecutionContext,
) -> Result<BlueprintExecutionResult, BlueprintError> {
    // 旧图归一化：真数据流引入后 Constant 成为纯值节点，不再串在执行流上。
    // 旧图（Constant 串在 exec 链上）改写为「上游 → Branch(in)」+「Constant →
    // Branch(value)」。归一化在副本上进行，不写回数据库；持久化由前端保存流程
    // （`normalize_blueprint_graph` 命令 + 用户保存）负责，此处只保证旧图仍能执行。
    let mut working_graph = graph.clone();
    let migrated_edges = normalize_legacy_value_edges(&mut working_graph);
    if migrated_edges > 0 {
        eprintln!(
            "[blueprint-executor] normalized {migrated_edges} legacy value edge(s); \
             save the preset to persist the migration"
        );
    }

    validate_graph(&working_graph)?;

    let mut result = BlueprintExecutionResult {
        blocks: Vec::new(),
        structured_output_schema: serde_json::json!({
            "type": "object",
            "properties": {},
            "required": [],
        }),
        sampling_params: CompiledSamplingParams {
            temperature: None,
            max_tokens: None,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            stop: Vec::new(),
            ..Default::default()
        },
        db_mappings: HashMap::new(),
        context_included_keys: HashMap::new(),
        display_config: HashMap::new(),
        schema_field_order: Vec::new(),
    };

    let start_id = working_graph
        .nodes
        .iter()
        .find(|n| matches!(n.config, NodeConfig::Start))
        .map(|n| n.id.clone())
        .ok_or(BlueprintError::NoStartNode)?;

    let mut visited: HashSet<String> = HashSet::new();
    let mut path: HashSet<String> = HashSet::new();
    let mut values = ValueEnvironment::default();

    traverse(
        &working_graph,
        &start_id,
        context,
        &mut result,
        &mut visited,
        &mut path,
        &mut values,
    )?;

    // 强制核心基线：每个蓝图预设都必须包含「叙事正文 text」（若缺失则注入）。
    // 对于内部推理 thinking：仅当蓝图完全未定义 thinking 节点且未启用原生思维链时作为旧版兜底注入。
    // 绝不覆盖或跨分支强行注入蓝图作者未激活的 thinking 字段。
    inject_core_schema_baseline(&mut result, &working_graph);

    // 按语义固定顺序重排 schema 字段（properties + required 同步）。
    // 理由：serde_json 的 Map 保留首次插入顺序，而插入顺序由 DFS 遍历（端口/order）
    // 决定，导致核心字段（text 由基线追加在末尾）位置不可控。本地模型对字段顺序敏感，
    // 且 OpenAI 严格模式（strict）要求 required 与 properties 顺序一致。固定顺序
    // 彻底消除乱序，且为未来切换 strict 模式铺路。
    order_schema_properties(&mut result);

    Ok(result)
}

/// 对结构化输出 schema 的 `properties` 与 `required` 重排。
///
/// 排序键为「(order, 遍历插入序)」稳定序：
/// - `order` 来自 [`SchemaFieldConfig::order`]，作者可在配置面板编辑；
/// - 遍历插入序来自 `result.schema_field_order` 的记录，保证同 order 的字段
///   保持蓝图遍历的相对顺序（确定性、可复现）；
/// - 核心基线字段 thinking(-2) / text(-1) 永远排在作者自定义字段之前。
///
/// `required` 与重排后的 `properties` 顺序保持一致（strict 模式硬性要求）。
fn order_schema_properties(result: &mut BlueprintExecutionResult) {
    let schema = &mut result.structured_output_schema;
    let props = match schema.get_mut("properties").and_then(|v| v.as_object_mut()) {
        Some(p) => p,
        None => return,
    };

    // 字段名 → (order, 插入序) 的查找表。缺少记录时回退到 (0, 末位)，
    // 保证任何字段都不会因记录缺失而丢失。
    let order_lookup: HashMap<&str, (i32, usize)> = result
        .schema_field_order
        .iter()
        .enumerate()
        .map(|(idx, (name, order))| (name.as_str(), (*order, idx)))
        .collect();

    let mut ordered: Vec<(String, serde_json::Value)> = props
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    ordered.sort_by(|a, b| {
        let a_key = order_lookup
            .get(a.0.as_str())
            .copied()
            .unwrap_or((0, usize::MAX));
        let b_key = order_lookup
            .get(b.0.as_str())
            .copied()
            .unwrap_or((0, usize::MAX));
        a_key.cmp(&b_key).then(a.0.cmp(&b.0))
    });

    let new_props = serde_json::Map::from_iter(ordered.iter().cloned());
    *props = new_props;

    // required 同步按重排后的字段顺序（仅保留确实存在于 properties 的字段）。
    if let Some(req) = schema.get_mut("required").and_then(|v| v.as_array_mut()) {
        let ordered_names: Vec<serde_json::Value> = ordered
            .iter()
            .filter(|(k, _)| req.iter().any(|v| v.as_str() == Some(k.as_str())))
            .map(|(k, _)| serde_json::Value::String(k.clone()))
            .collect();
        *req = ordered_names;
    }
}

/// 注入结构化输出的核心基线字段，保证每个蓝图预设都有叙事正文（body）。
///
/// 基线字段以「组合」方式叠加：仅当蓝图未显式定义该字段时才插入。这避免了让每个
/// 蓝图作者手动记得加 `text` 的脆弱约定，契合 AGENTS.md「组合优于继承」——公共基线
/// 通过编译器注入，而非要求每个节点重复声明。
fn inject_core_schema_baseline(result: &mut BlueprintExecutionResult, graph: &BlueprintGraph) {
    // 检查蓝图整张图是否显式包含了 thinking 节点。
    // 如果蓝图作者已经放置了 field_name 为 "thinking" 的 SchemaField 节点（例如在特定 Gate 分支下），
    // 则说明思维链字段的启闭完全由图分支调度，绝不跨分支强行兜底。
    let graph_has_thinking_node = graph.nodes.iter().any(|node| {
        if let NodeConfig::SchemaField(cfg) = &node.config {
            cfg.field_name == "thinking"
        } else {
            false
        }
    });

    // 检查是否启用了原生思维链通道。
    let native_thinking_enabled = result.sampling_params.thinking_enabled == Some(true);

    // 先不可变读，确定缺失的核心字段；避免与后续可变借用冲突。
    let missing: Vec<&str> = {
        let props = result
            .structured_output_schema
            .get("properties")
            .and_then(|v| v.as_object());
        let mut miss = Vec::new();

        // 仅当图完全未定义 thinking 节点，且未启用原生思维链时，才为旧版极简蓝图保底注入 thinking。
        if !native_thinking_enabled && !graph_has_thinking_node {
            if props.and_then(|p| p.get("thinking")).is_none() {
                miss.push("thinking");
            }
        }

        if props.and_then(|p| p.get("text")).is_none() {
            miss.push("text");
        }
        miss
    };
    if missing.is_empty() {
        return;
    }

    // 注入属性与 display_config（可变写）。
    for name in &missing {
        let desc = if *name == "thinking" {
            "模型的内部推理过程（角色动机、策略分析），不对外展示给玩家"
        } else {
            "对外展示的叙事正文：角色的行为、对话与环境描写，是回复的主体内容"
        };
        if let Some(props) = result
            .structured_output_schema
            .get_mut("properties")
            .and_then(|v| v.as_object_mut())
        {
            props.insert(
                (*name).to_string(),
                serde_json::json!({
                    "type": "string",
                    "description": desc,
                }),
            );
        }
        // text 标记为消息主体，渲染时与 thinking 折叠区在视觉上明确区分。
        if *name == "text" {
            result.display_config.insert(
                (*name).to_string(),
                FieldDisplayConfig {
                    default_expanded: true,
                    hide_label: true,
                    body: true,
                },
            );
        }

        // 核心基线字段固定在前：thinking(-2) / text(-1)，保证正文永远在首屏、
        // 推理永远在折叠区，不被作者自定义 order 推到后面。
        let baseline_order = if *name == "thinking" { -2 } else { -1 };
        result.schema_field_order.push(((*name).to_string(), baseline_order));
    }

    // 把缺失字段加入 required（独立的可变借用）。
    if let Some(req) = result
        .structured_output_schema
        .get_mut("required")
        .and_then(|v| v.as_array_mut())
    {
        for name in &missing {
            if !req.iter().any(|v| v.as_str() == Some(*name)) {
                req.push(serde_json::Value::String((*name).to_string()));
            }
        }
    }
}

/// Recursive DFS traversal. `path` tracks the current DFS stack (for cycle
/// detection); `visited` tracks all nodes already executed (for merge-point
/// convergence — re-visited merge nodes are skipped, not re-executed).
fn traverse(
    graph: &BlueprintGraph,
    node_id: &str,
    context: &BlueprintExecutionContext,
    result: &mut BlueprintExecutionResult,
    visited: &mut HashSet<String>,
    path: &mut HashSet<String>,
    values: &mut ValueEnvironment,
) -> Result<(), BlueprintError> {
    // Cycle check first: if the node is on the current DFS path, it's a cycle.
    if path.contains(node_id) {
        return Err(BlueprintError::CycleDetected(node_id.to_string()));
    }
    // Convergence: already executed in a prior branch — skip re-execution.
    if visited.contains(node_id) {
        return Ok(());
    }

    path.insert(node_id.to_string());
    visited.insert(node_id.to_string());

    let node = graph
        .nodes
        .iter()
        .find(|n| n.id == node_id)
        .ok_or_else(|| BlueprintError::NodeNotFound(node_id.to_string()))?;

    match &node.config {
        NodeConfig::Start => {
            let next = next_node_id(graph, node_id, "out")?;
            traverse(graph, &next, context, result, visited, path, values)?;
        }
        NodeConfig::End => {
            // Terminal — nothing to emit.
        }
        NodeConfig::Prompt(cfg) => {
            result.blocks.push(CompiledBlock {
                identifier: cfg.identifier.clone(),
                block_type: cfg.block_type.clone(),
                content: cfg.content.clone(),
                priority: cfg.priority,
                is_locked: cfg.is_locked,
            });
            let next = next_node_id(graph, node_id, "out")?;
            traverse(graph, &next, context, result, visited, path, values)?;
        }
        NodeConfig::SchemaField(cfg) => {
            apply_schema_field(cfg, result)?;
            let next = next_node_id(graph, node_id, "out")?;
            traverse(graph, &next, context, result, visited, path, values)?;
        }
        NodeConfig::MutexGate(_) => {
            eprintln!(
                "[blueprint-executor] MutexGate node={} reached; selections_present={}",
                node_id,
                context.gate_selections.contains_key(node_id)
            );
            let selection = context
                .gate_selections
                .get(node_id)
                .ok_or_else(|| BlueprintError::MissingGateSelection(node_id.to_string()))?;
            let selected_key = selection
                .keys
                .first()
                .ok_or_else(|| BlueprintError::NoMutexGateSelection(node_id.to_string()))?;
            let port = format!("out_{selected_key}");
            let branch_target = target_of(graph, node_id, &port)?;
            traverse(graph, &branch_target, context, result, visited, path, values)?;
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path, values)?;
        }
        NodeConfig::GroupGate(cfg) => {
            // GroupGate 为可选多选（如"可选增强模块"），未配置选择属合法状态：
            // 缺失 entry 或 keys 为空均表示"不启用任何模块"，不应报错。仅在
            // 实际选中的分支上继续遍历；未选任何项时直接收敛到 merge 节点（产出 0 块）。
            // 这与 MutexGate（必选单选，缺失选择仍报错）形成对照——分组多选天然允许空集。
            eprintln!(
                "[blueprint-executor] GroupGate node={} reached; selections_present={}; selected_keys={:?}",
                node_id,
                context.gate_selections.contains_key(node_id),
                context.gate_selections.get(node_id).map(|s| &s.keys)
            );
            let selected_keys: Vec<String> = context
                .gate_selections
                .get(node_id)
                .map(|sel| sel.keys.clone())
                .unwrap_or_default();
            for option in &cfg.options {
                if selected_keys.contains(&option.key) {
                    let port = format!("out_{}", option.key);
                    let branch_target = target_of(graph, node_id, &port)?;
                    traverse(graph, &branch_target, context, result, visited, path, values)?;
                }
            }
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path, values)?;
        }
        NodeConfig::ModeSwitch(_) => {
            let port = format!("out_{}", context.memory_mode);
            let branch_target = target_of(graph, node_id, &port)?;
            traverse(graph, &branch_target, context, result, visited, path, values)?;
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path, values)?;
        }
        NodeConfig::RoleSwitch(_) => {
            let port = format!("out_{}", context.conversation_type);
            let branch_target = target_of(graph, node_id, &port)?;
            traverse(graph, &branch_target, context, result, visited, path, values)?;
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path, values)?;
        }
        NodeConfig::Constant(_) => {
            // 纯值节点不参与执行流。它的值由下游 Branch 沿 `value` 边拉取求值
            // （见 `evaluate_port`）。执行流走到 Constant 说明这是未迁移的旧图，
            // 显式报错而非静默跳过（C2）。
            return Err(BlueprintError::ConstantOnExecPath(node_id.to_string()));
        }
        NodeConfig::Branch(cfg) => {
            // 沿 `value` 入边拉取上游纯值节点的求值结果（UE pull-based 数据流）
            let value = read_input_value(graph, node_id, context, values)?;
            // 按顺序匹配 cases，第一个匹配的生效；无匹配走 default_port
            let port = cfg
                .cases
                .iter()
                .find(|c| c.match_value == value.as_str())
                .map(|c| c.port.as_str())
                .unwrap_or(&cfg.default_port);
            let branch_target = target_of(graph, node_id, port)?;
            traverse(graph, &branch_target, context, result, visited, path, values)?;
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path, values)?;
        }
        NodeConfig::SamplingParams(cfg) => {
            // legacy 通用节点：按当前方言应用对该协议有效的字段子集。
            let dialect = SamplingDialect::parse(&context.protocol)?;
            merge_legacy_sampling_params(cfg, dialect, &mut result.sampling_params);
            let next = next_node_id(graph, node_id, port_names::OUT)?;
            traverse(graph, &next, context, result, visited, path, values)?;
        }
        NodeConfig::SamplingParamsOpenAi(cfg) => {
            // 仅 chat_completions 协议出参；Anthropic 会话下该节点被跳过，
            // 但仍沿 exec 流继续遍历（不截断图，也不静默套用另一套参数）。
            let dialect = SamplingDialect::parse(&context.protocol)?;
            if dialect == SamplingDialect::OpenAi {
                merge_openai_sampling_params(cfg, &mut result.sampling_params);
            }
            let next = next_node_id(graph, node_id, port_names::OUT)?;
            traverse(graph, &next, context, result, visited, path, values)?;
        }
        NodeConfig::SamplingParamsAnthropic(cfg) => {
            let dialect = SamplingDialect::parse(&context.protocol)?;
            if dialect == SamplingDialect::Anthropic {
                merge_anthropic_sampling_params(cfg, &mut result.sampling_params);
            }
            let next = next_node_id(graph, node_id, port_names::OUT)?;
            traverse(graph, &next, context, result, visited, path, values)?;
        }
    }

    path.remove(node_id);
    Ok(())
}

/// Compile-time graph validation (spec §SubTask 2.10).
fn validate_graph(graph: &BlueprintGraph) -> Result<(), BlueprintError> {
    // 1. Start unique
    let start_count = graph
        .nodes
        .iter()
        .filter(|n| matches!(n.config, NodeConfig::Start))
        .count();
    if start_count == 0 {
        return Err(BlueprintError::NoStartNode);
    }
    if start_count > 1 {
        return Err(BlueprintError::MultipleStartNodes);
    }

    // 2. End unique
    let end_count = graph
        .nodes
        .iter()
        .filter(|n| matches!(n.config, NodeConfig::End))
        .count();
    if end_count == 0 {
        return Err(BlueprintError::NoEndNode);
    }
    if end_count > 1 {
        return Err(BlueprintError::MultipleEndNodes);
    }

    // 3. field_name unique
    let mut seen_fields: HashSet<String> = HashSet::new();
    for node in &graph.nodes {
        if let NodeConfig::SchemaField(cfg) = &node.config {
            if !seen_fields.insert(cfg.field_name.clone()) {
                return Err(BlueprintError::DuplicateFieldName(cfg.field_name.clone()));
            }
        }
    }

    // 4. identifier unique
    let mut seen_identifiers: HashSet<String> = HashSet::new();
    for node in &graph.nodes {
        if let NodeConfig::Prompt(cfg) = &node.config {
            if !seen_identifiers.insert(cfg.identifier.clone()) {
                return Err(BlueprintError::DuplicateIdentifier(cfg.identifier.clone()));
            }
        }
    }

    // 5. gate_id uniqueness check removed — node_id is already unique
    // (MutexGateConfig/GroupGateConfig no longer carry gate_id; selection key
    // is the node_id, which is structurally unique by BlueprintNode.id).

    // 6. ModeSwitch three ports connected
    for node in &graph.nodes {
        if matches!(node.config, NodeConfig::ModeSwitch(_)) {
            for port in &["out_legacy", "out_mem0", "out_stateless"] {
                let has_edge = graph
                    .edges
                    .iter()
                    .any(|e| e.source == node.id && e.source_port == *port);
                if !has_edge {
                    return Err(BlueprintError::MissingModeSwitchPort(
                        node.id.clone(),
                        port.to_string(),
                    ));
                }
            }
        }
    }

    // 7. RoleSwitch two ports connected (out_single / out_online)
    for node in &graph.nodes {
        if matches!(node.config, NodeConfig::RoleSwitch(_)) {
            for port in &["out_single", "out_online"] {
                let has_edge = graph
                    .edges
                    .iter()
                    .any(|e| e.source == node.id && e.source_port == *port);
                if !has_edge {
                    return Err(BlueprintError::MissingRoleSwitchPort(
                        node.id.clone(),
                        port.to_string(),
                    ));
                }
            }
        }
    }

    // 7a. Constant 是纯值节点，必须有一条 value 出边把值喂给下游 Branch。
    for node in &graph.nodes {
        if matches!(node.config, NodeConfig::Constant(_)) {
            let has_out = graph
                .edges
                .iter()
                .any(|e| e.source == node.id && e.source_port == port_names::OUT);
            if !has_out {
                return Err(BlueprintError::NoOutgoingEdge {
                    node: node.id.clone(),
                    port: port_names::OUT.to_string(),
                });
            }
        }
    }

    // 7b. Branch node: each case port + default_port must have outgoing edge;
    // must have an incoming edge from a Constant node (structural check).
    for node in &graph.nodes {
        if let NodeConfig::Branch(cfg) = &node.config {
            // 检查每个 case 的 port
            for case in &cfg.cases {
                let has_edge = graph
                    .edges
                    .iter()
                    .any(|e| e.source == node.id && e.source_port == case.port);
                if !has_edge {
                    return Err(BlueprintError::MissingBranchPort(
                        node.id.clone(),
                        case.port.clone(),
                    ));
                }
            }
            // 检查 default_port
            let has_default = graph
                .edges
                .iter()
                .any(|e| e.source == node.id && e.source_port == cfg.default_port);
            if !has_default {
                return Err(BlueprintError::MissingBranchPort(
                    node.id.clone(),
                    cfg.default_port.clone(),
                ));
            }
            // exec 入边：Branch 必须挂在主流上，否则执行流到不了它。
            let has_exec_in = graph
                .edges
                .iter()
                .any(|e| e.target == node.id && e.target_port == port_names::EXEC_IN);
            if !has_exec_in {
                return Err(BlueprintError::BranchNoIncomingEdge(node.id.clone()));
            }
            // value 入边：必须存在，且上游必须是纯值节点（Constant）。
            let value_edge = graph
                .edges
                .iter()
                .find(|e| e.target == node.id && e.target_port == port_names::VALUE_IN)
                .ok_or_else(|| BlueprintError::MissingValueInput(node.id.clone()))?;
            let upstream = graph
                .nodes
                .iter()
                .find(|n| n.id == value_edge.source)
                .ok_or_else(|| BlueprintError::NodeNotFound(value_edge.source.clone()))?;
            if !matches!(upstream.config, NodeConfig::Constant(_)) {
                return Err(BlueprintError::BranchMustFollowConstant(
                    node.id.clone(),
                ));
            }
        }
    }

    // 8. Reachability: Start → End
    let start_id = graph
        .nodes
        .iter()
        .find(|n| matches!(n.config, NodeConfig::Start))
        .map(|n| n.id.clone())
        .ok_or(BlueprintError::NoStartNode)?;
    let end_id = graph
        .nodes
        .iter()
        .find(|n| matches!(n.config, NodeConfig::End))
        .map(|n| n.id.clone())
        .ok_or(BlueprintError::NoEndNode)?;
    let reachable_from_start = compute_reachable_set(graph, &start_id);
    if !reachable_from_start.contains(&end_id) {
        return Err(BlueprintError::UnreachableEnd);
    }

    // 9. Locked nodes: `is_locked` only marks "core, not user-editable" intent.
    // It does NOT require the node to be reachable from Start. An unreachable
    // (orphaned) locked node is simply skipped by `traverse` and must NOT abort
    // the whole graph compilation — that would block every prompt compile that
    // references a preset owning such a node (e.g. an isolated rules node).
    // Reachability of the Start→End path is already enforced by check #8 above.
    let _ = &reachable_from_start;

    Ok(())
}

/// Find the merge node for a Gate/ModeSwitch: the nearest common descendant
/// reachable from ALL outgoing branches (structural, not selection-based).
///
/// Algorithm:
/// 1. Collect branch heads (targets of all outgoing edges from `gate_node_id`).
/// 2. Compute reachable set for each branch head (including itself).
/// 3. Intersect all sets → common descendants.
/// 4. Return the first common descendant in DFS order from the first branch head.
/// 5. If no common descendant, fall back to the End node.
/// 返回从 `source` 连出的所有目标节点，按「出口端口优先级 → 边 order」稳定排序。
///
/// 出口端口优先级：由 `output_port_priority` 决定（Gate/ModeSwitch 的多选端口
/// 顺序），其余端口回退到 `out` 优先、其余按字母序，保证同端口多条边按 `order` 升序。
/// 这是「执行顺序绑定在出口端口 + order」语义的核心：一个出口连多条线时，
/// 先按端口顺序、再按 order 确定遍历/合并顺序，而非依赖 edges 数组的存储顺序。
fn ordered_outgoing_targets<'a>(
    graph: &'a BlueprintGraph,
    source: &str,
) -> Vec<&'a BlueprintEdge> {
    let mut edges: Vec<&BlueprintEdge> = graph
        .edges
        .iter()
        .filter(|e| e.source == source)
        .collect();
    edges.sort_by(|a, b| {
        output_port_priority(graph, &a.source, &a.source_port)
            .cmp(&output_port_priority(graph, &b.source, &b.source_port))
            .then(a.order.cmp(&b.order))
            .then(a.target.cmp(&b.target))
    });
    edges
}

/// 计算某出口端口的排序优先级。Gate/ModeSwitch 节点按 `options`/固定分支顺序
/// 赋予 0..N 的优先级；非多出口节点（单 `out` 端口）一律返回 0，由同端口内的
/// `order` 字段进一步区分。端口顺序未知时回退到字母序，保证确定性。
fn output_port_priority(graph: &BlueprintGraph, source: &str, port: &str) -> usize {
    let node = match graph.nodes.iter().find(|n| n.id == source) {
        Some(n) => n,
        None => return usize::MAX,
    };
    let ordered_ports: Vec<String> = match &node.config {
        NodeConfig::MutexGate(cfg) => {
            cfg.options.iter().map(|o| format!("out_{}", o.key)).collect()
        }
        NodeConfig::GroupGate(cfg) => {
            cfg.options.iter().map(|o| format!("out_{}", o.key)).collect()
        }
        NodeConfig::ModeSwitch(_) => {
            vec!["out_legacy", "out_mem0", "out_stateless"]
                .into_iter()
                .map(String::from)
                .collect()
        }
        NodeConfig::RoleSwitch(_) => {
            vec!["out_single", "out_online"]
                .into_iter()
                .map(String::from)
                .collect()
        }
        _ => return 0,
    };
    ordered_ports.iter().position(|p| p == port).unwrap_or(usize::MAX)
}

fn find_merge_node(
    graph: &BlueprintGraph,
    gate_node_id: &str,
) -> Result<String, BlueprintError> {
    let branch_heads: Vec<String> = ordered_outgoing_targets(graph, gate_node_id)
        .into_iter()
        .map(|e| e.target.clone())
        .collect();

    if branch_heads.is_empty() {
        return find_end_node_id(graph).ok_or(BlueprintError::NoEndNode);
    }

    // Fast path: all branches point to the same node (common in ModeSwitch
    // where out_legacy/out_mem0/out_stateless all connect to the same downstream).
    if branch_heads.iter().all(|h| h == &branch_heads[0]) {
        return Ok(branch_heads[0].clone());
    }

    // Compute reachable set (including self) for each branch head.
    let reachable_sets: Vec<HashSet<String>> = branch_heads
        .iter()
        .map(|head| compute_reachable_set(graph, head))
        .collect();

    // Intersect all reachable sets.
    let mut intersection = reachable_sets[0].clone();
    for set in &reachable_sets[1..] {
        intersection = intersection.intersection(set).cloned().collect();
    }

    if intersection.is_empty() {
        return find_end_node_id(graph).ok_or(BlueprintError::NoEndNode);
    }

    // Return the first node in DFS order from the first branch head that is in
    // the intersection — this is the nearest common descendant.
    let dfs_order = compute_dfs_forward_order(graph, &branch_heads[0]);
    for node_id in dfs_order {
        if intersection.contains(&node_id) {
            return Ok(node_id);
        }
    }

    // Fallback (should not reach here given non-empty intersection).
    find_end_node_id(graph).ok_or(BlueprintError::NoEndNode)
}

/// Apply a SchemaField node to the execution result: insert property into
/// structured_output_schema and optionally record db_mapping, context
/// inclusion flag, and per-field display config.
fn apply_schema_field(
    cfg: &SchemaFieldConfig,
    result: &mut BlueprintExecutionResult,
) -> Result<(), BlueprintError> {
    let property = build_property_schema(cfg)?;

    if let Some(props) = result
        .structured_output_schema
        .get_mut("properties")
        .and_then(|v| v.as_object_mut())
    {
        props.insert(cfg.field_name.clone(), property);
    }

    // Only mark `required` when the node opts in. When false, the field is
    // optional in the LLM's structured output.
    if cfg.required {
        if let Some(required) = result
            .structured_output_schema
            .get_mut("required")
            .and_then(|v| v.as_array_mut())
        {
            required.push(serde_json::Value::String(cfg.field_name.clone()));
        }
    }

    if let Some(db_mapping) = &cfg.db_mapping {
        result
            .db_mappings
            .insert(cfg.field_name.clone(), db_mapping.clone());
    }

    // Record per-field context inclusion. Prompt compiler filters structured
    // content using this map before injecting into the next turn.
    result
        .context_included_keys
        .insert(cfg.field_name.clone(), cfg.context_included);

    // Always record display config so MessageItem can render consistently.
    // The frontend defaults to default_expanded=true / hide_label=false for
    // fields missing from the map, so we only need to record non-default
    // overrides (or just always record; the JSON is small).
    result
        .display_config
        .insert(cfg.field_name.clone(), cfg.display.clone());

    // 追踪字段顺序：(field_name, order)，按遍历插入序追加。执行器据此把
    // properties / required 重排为「(order, 遍历序)」稳定序（取代硬编码的
    // thinking→text→字母序）。
    result
        .schema_field_order
        .push((cfg.field_name.clone(), cfg.order));

    Ok(())
}

/// Build a JSON Schema property object from a SchemaFieldConfig.
fn build_property_schema(
    cfg: &SchemaFieldConfig,
) -> Result<serde_json::Value, BlueprintError> {
    let mut property = serde_json::json!({
        "type": cfg.field_type,
        "description": cfg.description,
    });
    if let Some(sub_schema) = &cfg.sub_schema {
        if let Some(obj) = sub_schema.as_object() {
            for (k, v) in obj {
                property[k] = v.clone();
            }
        }
    }
    Ok(property)
}

/// 合并 legacy 通用采样参数：只应用当前方言下有效的字段子集。

/// 合并 OpenAI 版采样参数。只含 OpenAI 兼容路径支持的字段，
/// 因此 `thinking_*` 不在此出现（OpenAI 路径遇到 thinking 会直接报错）。
fn merge_openai_sampling_params(
    cfg: &OpenAiSamplingParamsConfig,
    compiled: &mut CompiledSamplingParams,
) {
    if let Some(t) = cfg.temperature {
        compiled.temperature = Some(t);
    }
    if let Some(t) = cfg.max_tokens {
        compiled.max_tokens = Some(t);
    }
    if let Some(t) = cfg.top_p {
        compiled.top_p = Some(t);
    }
    if let Some(v) = cfg.frequency_penalty {
        compiled.frequency_penalty = Some(v);
    }
    if let Some(v) = cfg.presence_penalty {
        compiled.presence_penalty = Some(v);
    }
    if let Some(stop) = &cfg.stop {
        compiled.stop = stop.clone();
    }
}

/// 合并 Anthropic 版采样参数。只含 Anthropic 支持的字段，
/// 因此 `frequency_penalty` / `presence_penalty` 不在此出现。
fn merge_anthropic_sampling_params(
    cfg: &AnthropicSamplingParamsConfig,
    compiled: &mut CompiledSamplingParams,
) {
    if let Some(t) = cfg.temperature {
        compiled.temperature = Some(t);
    }
    if let Some(t) = cfg.max_tokens {
        compiled.max_tokens = Some(t);
    }
    if let Some(t) = cfg.top_p {
        compiled.top_p = Some(t);
    }
    if let Some(stop) = &cfg.stop {
        compiled.stop = stop.clone();
    }
    if let Some(enabled) = cfg.thinking_enabled {
        compiled.thinking_enabled = Some(enabled);
    }
    if let Some(budget) = cfg.thinking_budget_tokens {
        compiled.thinking_budget_tokens = Some(budget);
    }
}

/// 合并 legacy 通用采样参数：只应用当前方言下有效的字段子集。
///
/// legacy 节点同时携带两套协议的字段，运行时按方言裁剪：
/// - OpenAI 方言：忽略 `thinking_*`（OpenAI 路径不支持 thinking）
/// - Anthropic 方言：忽略 `frequency_penalty` / `presence_penalty`（Anthropic 不支持）
fn merge_legacy_sampling_params(
    cfg: &SamplingParamsConfig,
    dialect: SamplingDialect,
    compiled: &mut CompiledSamplingParams,
) {
    if let Some(t) = cfg.temperature {
        compiled.temperature = Some(t);
    }
    if let Some(t) = cfg.max_tokens {
        compiled.max_tokens = Some(t);
    }
    if let Some(t) = cfg.top_p {
        compiled.top_p = Some(t);
    }
    if let Some(stop) = &cfg.stop {
        compiled.stop = stop.clone();
    }
    match dialect {
        SamplingDialect::OpenAi => {
            if let Some(v) = cfg.frequency_penalty {
                compiled.frequency_penalty = Some(v);
            }
            if let Some(v) = cfg.presence_penalty {
                compiled.presence_penalty = Some(v);
            }
        }
        SamplingDialect::Anthropic => {
            if let Some(enabled) = cfg.thinking_enabled {
                compiled.thinking_enabled = Some(enabled);
            }
            if let Some(budget) = cfg.thinking_budget_tokens {
                compiled.thinking_budget_tokens = Some(budget);
            }
        }
    }
}

/// Find the target node of the edge leaving `node_id` via `port`.
fn target_of(
    graph: &BlueprintGraph,
    node_id: &str,
    port: &str,
) -> Result<String, BlueprintError> {
    next_node_id(graph, node_id, port)
}

/// Find the target of the single outgoing edge from `node_id`:`port`.
fn next_node_id(
    graph: &BlueprintGraph,
    node_id: &str,
    port: &str,
) -> Result<String, BlueprintError> {
    graph
        .edges
        .iter()
        .find(|e| e.source == node_id && e.source_port == port)
        .map(|e| e.target.clone())
        .ok_or_else(|| BlueprintError::NoOutgoingEdge {
            node: node_id.to_string(),
            port: port.to_string(),
        })
}

/// Find the id of the (unique) End node.
fn find_end_node_id(graph: &BlueprintGraph) -> Option<String> {
    graph
        .nodes
        .iter()
        .find(|n| matches!(n.config, NodeConfig::End))
        .map(|n| n.id.clone())
}

/// 沿 Branch 的 `value` 入边拉取上游纯值节点的求值结果。
///
/// 这是 UE 的 pull-based 数据流：执行流到达 Branch 后，Branch 沿自己的 value
/// 输入引脚反向求值上游纯值节点（Constant），值因此"沿 value 边向下游传递"。
/// 求值结果写入 `ValueEnvironment` 缓存，同一纯值节点被多处引用只求值一次。
fn read_input_value(
    graph: &BlueprintGraph,
    branch_node_id: &str,
    context: &BlueprintExecutionContext,
    values: &mut ValueEnvironment,
) -> Result<BlueprintValue, BlueprintError> {
    let incoming = graph
        .edges
        .iter()
        .find(|e| e.target == branch_node_id && e.target_port == port_names::VALUE_IN)
        .ok_or_else(|| BlueprintError::MissingValueInput(branch_node_id.to_string()))?;

    evaluate_port(graph, &incoming.source, &incoming.source_port, context, values)
}

/// 求值某个节点的输出端口。命中缓存直接返回，否则对纯值节点求值并写回缓存。
///
/// 求值栈 `resolving` 保证 value 依赖成环时显式报错，而非无限递归（C2）。
fn evaluate_port(
    graph: &BlueprintGraph,
    node_id: &str,
    port: &str,
    context: &BlueprintExecutionContext,
    values: &mut ValueEnvironment,
) -> Result<BlueprintValue, BlueprintError> {
    if let Some(cached) = values.get(node_id, port) {
        return Ok(cached.clone());
    }

    let node = graph
        .nodes
        .iter()
        .find(|n| n.id == node_id)
        .ok_or_else(|| BlueprintError::NodeNotFound(node_id.to_string()))?;

    values.begin_resolve(node_id, port)?;

    let computed = match &node.config {
        NodeConfig::Constant(cfg) => evaluate_session_source(&cfg.source, context),
        NodeConfig::Start
        | NodeConfig::End
        | NodeConfig::Prompt(_)
        | NodeConfig::SchemaField(_)
        | NodeConfig::MutexGate(_)
        | NodeConfig::GroupGate(_)
        | NodeConfig::ModeSwitch(_)
        | NodeConfig::RoleSwitch(_)
        | NodeConfig::SamplingParams(_)
        | NodeConfig::SamplingParamsOpenAi(_)
        | NodeConfig::SamplingParamsAnthropic(_)
        | NodeConfig::Branch(_) => Err(BlueprintError::ValueSourceNotValueNode(
            node_id.to_string(),
        )),
    };

    // 无论求值成功与否都退出求值栈，避免污染后续求值。
    values.end_resolve(node_id, port);
    let value = computed?;
    values.insert(node_id, port, value.clone());
    Ok(value)
}

/// 从执行上下文读取会话属性，产出值。
///
/// `source` 必须是已登记的会话属性键，未知键显式报错（C2）。
fn evaluate_session_source(
    source: &str,
    context: &BlueprintExecutionContext,
) -> Result<BlueprintValue, BlueprintError> {
    match source {
        "conversation_type" => Ok(BlueprintValue::Session(context.conversation_type.clone())),
        "memory_mode" => Ok(BlueprintValue::Session(context.memory_mode.clone())),
        "protocol" => Ok(BlueprintValue::Session(context.protocol.clone())),
        other => Err(BlueprintError::UnknownConstantSource(other.to_string())),
    }
}

/// 旧图归一化：把「Constant --out--> Branch(in)」的 exec 链改写为
/// 「上游 --out--> Branch(in)」+「Constant --out--> Branch(value)」。
///
/// 真数据流引入后 Constant 成为无 exec 入口的纯值节点，不再串在执行流上，
/// 旧图必须改写拓扑才能满足新契约。这里在内存副本上改写，返回被修改的边数；
/// 调用方负责记日志并提示用户保存（C2：绝不静默兜底，迁移必须可见）。
pub fn normalize_legacy_value_edges(graph: &mut BlueprintGraph) -> usize {
    // 1. 识别旧式连线：源为 Constant、目标为 Branch、落在 Branch 的 exec 入口。
    let legacy_links: Vec<(String, String, String)> = graph
        .edges
        .iter()
        .filter(|e| e.target_port == port_names::EXEC_IN)
        .filter(|e| {
            let source_is_constant = graph
                .nodes
                .iter()
                .any(|n| n.id == e.source && matches!(n.config, NodeConfig::Constant(_)));
            let target_is_branch = graph
                .nodes
                .iter()
                .any(|n| n.id == e.target && matches!(n.config, NodeConfig::Branch(_)));
            source_is_constant && target_is_branch
        })
        .map(|e| (e.id.clone(), e.source.clone(), e.target.clone()))
        .collect();

    if legacy_links.is_empty() {
        return 0;
    }

    // 2. 把这些边改写到 Branch 的 value 入口。
    for (edge_id, _, _) in &legacy_links {
        if let Some(edge) = graph.edges.iter_mut().find(|e| e.id == *edge_id) {
            edge.target_port = port_names::VALUE_IN.to_string();
        }
    }

    // 3. 把原本连到 Constant 的上游 exec 边重定向到 Branch 的 exec 入口。
    let mut redirected = 0usize;
    for (_, constant_id, branch_id) in &legacy_links {
        let upstream: Vec<(String, String)> = graph
            .edges
            .iter()
            .filter(|e| e.target == *constant_id)
            .map(|e| (e.source.clone(), e.source_port.clone()))
            .collect();

        for (source, source_port) in upstream {
            let already_linked = graph.edges.iter().any(|e| {
                e.source == source
                    && e.source_port == source_port
                    && e.target == *branch_id
                    && e.target_port == port_names::EXEC_IN
            });
            if already_linked {
                continue;
            }
            if let Some(edge) = graph.edges.iter_mut().find(|e| {
                e.source == source && e.source_port == source_port && e.target == *constant_id
            }) {
                edge.target = branch_id.clone();
                edge.target_port = port_names::EXEC_IN.to_string();
                redirected += 1;
            }
        }
    }

    legacy_links.len() + redirected
}

/// Compute the set of all node ids reachable from `start` (including `start`),
/// following all outgoing edges. Cycle-safe via internal visited set.
fn compute_reachable_set(graph: &BlueprintGraph, start: &str) -> HashSet<String> {
    let mut visited: HashSet<String> = HashSet::new();
    let mut stack = vec![start.to_string()];
    while let Some(node_id) = stack.pop() {
        if !visited.insert(node_id.clone()) {
            continue;
        }
        for edge in &graph.edges {
            if edge.source == node_id && !visited.contains(&edge.target) {
                stack.push(edge.target.clone());
            }
        }
    }
    visited
}

/// Compute DFS forward traversal order starting from `start` (including
/// `start`). Cycle-safe. Used by `find_merge_node` to pick the nearest
/// common descendant in deterministic order.
fn compute_dfs_forward_order(graph: &BlueprintGraph, start: &str) -> Vec<String> {
    let mut visited: HashSet<String> = HashSet::new();
    let mut order = Vec::new();
    let mut stack = vec![start.to_string()];
    while let Some(node_id) = stack.pop() {
        if !visited.insert(node_id.clone()) {
            continue;
        }
        order.push(node_id.clone());
        // Collect outgoing edges and reverse so earlier edges are processed
        // first (stack is LIFO).
        let mut outgoing: Vec<&crate::models::blueprint::BlueprintEdge> = graph
            .edges
            .iter()
            .filter(|e| e.source == node_id && !visited.contains(&e.target))
            .collect();
        outgoing.reverse();
        for edge in outgoing {
            stack.push(edge.target.clone());
        }
    }
    order
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::blueprint::{
        BranchCase, BranchConfig, ConstantConfig, GateOption, GroupGateConfig, ModeSwitchConfig,
        MutexGateConfig, Position, PromptConfig, RoleSwitchConfig, SamplingParamsConfig,
        SchemaFieldConfig,
    };
    use crate::models::blueprint::{BlueprintEdge, BlueprintGraph, BlueprintNode, NodeConfig};

    // ---- helpers ----

    fn pos(x: f64, y: f64) -> Position {
        Position { x, y }
    }

    fn edge(id: &str, src: &str, src_port: &str, tgt: &str, tgt_port: &str) -> BlueprintEdge {
        BlueprintEdge {
            id: id.to_string(),
            source: src.to_string(),
            source_port: src_port.to_string(),
            target: tgt.to_string(),
            target_port: tgt_port.to_string(),
            order: 0,
        }
    }

    fn start(id: &str) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::Start,
            position: pos(0.0, 0.0),
        }
    }

    fn end(id: &str) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::End,
            position: pos(0.0, 0.0),
        }
    }

    fn prompt(id: &str, identifier: &str, block_type: &str, content: &str) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::Prompt(PromptConfig {
                identifier: identifier.to_string(),
                block_type: block_type.to_string(),
                content: content.to_string(),
                priority: None,
                is_locked: false,
                lock_reason: None,
            }),
            position: pos(0.0, 0.0),
        }
    }

    fn schema_field(id: &str, name: &str, ty: &str, desc: &str) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::SchemaField(SchemaFieldConfig {
                field_name: name.to_string(),
                field_type: ty.to_string(),
                description: desc.to_string(),
                sub_schema: None,
                db_mapping: None,
                required: true,
                context_included: true,
                display: Default::default(),
                is_locked: false,
                lock_reason: None,
                order: 0,
            }),
            position: pos(0.0, 0.0),
        }
    }

    fn schema_field_with_mapping(
        id: &str,
        name: &str,
        ty: &str,
        desc: &str,
        mapping: &str,
    ) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::SchemaField(SchemaFieldConfig {
                field_name: name.to_string(),
                field_type: ty.to_string(),
                description: desc.to_string(),
                sub_schema: None,
                db_mapping: Some(mapping.to_string()),
                required: true,
                context_included: true,
                display: Default::default(),
                is_locked: false,
                lock_reason: None,
                order: 0,
            }),
            position: pos(0.0, 0.0),
        }
    }

    fn sampling(id: &str, temp: f64, max_tokens: i64, top_p: f64) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::SamplingParams(SamplingParamsConfig {
                temperature: Some(temp),
                max_tokens: Some(max_tokens),
                top_p: Some(top_p),
                frequency_penalty: None,
                presence_penalty: None,
                stop: None,
                thinking_enabled: None,
                thinking_budget_tokens: None,
                is_locked: false,
            }),
            position: pos(0.0, 0.0),
        }
    }

    fn mode_switch(id: &str) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::ModeSwitch(ModeSwitchConfig {
                label: "mode".to_string(),
            }),
            position: pos(0.0, 0.0),
        }
    }

    fn role_switch(id: &str) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::RoleSwitch(RoleSwitchConfig {
                label: "role".to_string(),
            }),
            position: pos(0.0, 0.0),
        }
    }

    fn constant(id: &str, source: &str) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::Constant(ConstantConfig {
                label: "const".to_string(),
                source: source.to_string(),
            }),
            position: pos(0.0, 0.0),
        }
    }

    /// `cases` 形如 `[("match_value", "port")]`；`default_port` 为默认出口。
    fn branch(id: &str, cases: &[(&str, &str)], default_port: &str) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::Branch(BranchConfig {
                label: "branch".to_string(),
                cases: cases
                    .iter()
                    .map(|(m, p)| BranchCase {
                        match_value: m.to_string(),
                        port: p.to_string(),
                    })
                    .collect(),
                default_port: default_port.to_string(),
            }),
            position: pos(0.0, 0.0),
        }
    }

    /// `opts` 形如 `[("option_key", "option label", "option description")]`。
    /// description 传空字符串表示无说明（与生产路径 GateOption.description = None 等价的测试写法）。
    fn mutex_gate(id: &str, label: &str, opts: &[(&str, &str, &str)]) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::MutexGate(MutexGateConfig {
                label: label.to_string(),
                options: opts
                    .iter()
                    .map(|(k, l, d)| GateOption {
                        key: k.to_string(),
                        label: l.to_string(),
                        description: if d.is_empty() {
                            None
                        } else {
                            Some(d.to_string())
                        },
                    })
                    .collect(),
            }),
            position: pos(0.0, 0.0),
        }
    }

    /// `opts` 形如 `[("option_key", "option label", "option description")]`。
    fn group_gate(id: &str, label: &str, opts: &[(&str, &str, &str)]) -> BlueprintNode {
        BlueprintNode {
            id: id.to_string(),
            config: NodeConfig::GroupGate(GroupGateConfig {
                label: label.to_string(),
                options: opts
                    .iter()
                    .map(|(k, l, d)| GateOption {
                        key: k.to_string(),
                        label: l.to_string(),
                        description: if d.is_empty() {
                            None
                        } else {
                            Some(d.to_string())
                        },
                    })
                    .collect(),
            }),
            position: pos(0.0, 0.0),
        }
    }

    fn graph(nodes: Vec<BlueprintNode>, edges: Vec<BlueprintEdge>) -> BlueprintGraph {
        BlueprintGraph {
            version: 2,
            comments: Vec::new(),
            nodes,
            edges,
        }
    }

    fn ctx(memory_mode: &str) -> BlueprintExecutionContext {
        BlueprintExecutionContext {
            memory_mode: memory_mode.to_string(),
            conversation_type: "single".to_string(),
            gate_selections: HashMap::new(),
            protocol: "chat_completions".to_string(),
        }
    }

    fn ctx_with_role(memory_mode: &str, conversation_type: &str) -> BlueprintExecutionContext {
        BlueprintExecutionContext {
            memory_mode: memory_mode.to_string(),
            conversation_type: conversation_type.to_string(),
            gate_selections: HashMap::new(),
            protocol: "chat_completions".to_string(),
        }
    }

    fn ctx_with_protocol(memory_mode: &str, protocol: &str) -> BlueprintExecutionContext {
        BlueprintExecutionContext {
            memory_mode: memory_mode.to_string(),
            conversation_type: "single".to_string(),
            gate_selections: HashMap::new(),
            protocol: protocol.to_string(),
        }
    }

    fn ctx_with_gates(
        memory_mode: &str,
        gates: &[(&str, &[&str])],
    ) -> BlueprintExecutionContext {
        BlueprintExecutionContext {
            memory_mode: memory_mode.to_string(),
            conversation_type: "single".to_string(),
            protocol: "chat_completions".to_string(),
            gate_selections: gates
                .iter()
                .map(|(node_id, keys)| {
                    (
                        node_id.to_string(),
                        crate::models::blueprint::GateSelection {
                            keys: keys.iter().map(|s| s.to_string()).collect(),
                        },
                    )
                })
                .collect(),
        }
    }

    // ---- tests ----

    #[tokio::test]
    async fn test_simple_chain() {
        let g = graph(
            vec![
                start("n_start"),
                prompt("n_p1", "role", "system", "You are a narrator."),
                schema_field_with_mapping("n_s1", "world_variables", "object", "world state", "world_variables"),
                sampling("n_sp", 0.8, 4096, 0.95),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_p1", "in"),
                edge("e2", "n_p1", "out", "n_s1", "in"),
                edge("e3", "n_s1", "out", "n_sp", "in"),
                edge("e4", "n_sp", "out", "n_end", "in"),
            ],
        );

        let result = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect("simple chain must execute");

        // One block from the Prompt node
        assert_eq!(result.blocks.len(), 1, "exactly one block expected");
        assert_eq!(result.blocks[0].identifier, "role");
        assert_eq!(result.blocks[0].block_type, "system");
        assert_eq!(result.blocks[0].content, "You are a narrator.");

        // 核心基线（thinking + text）由编译器强制注入，叠加蓝图显式字段。
        let props = result.structured_output_schema["properties"]
            .as_object()
            .expect("properties must be an object");
        assert!(props.contains_key("world_variables"), "explicit field present");
        assert!(props.contains_key("thinking"), "core thinking baseline injected");
        assert!(props.contains_key("text"), "core text (body) baseline injected");
        assert_eq!(props["world_variables"]["type"], "object");
        assert_eq!(props["world_variables"]["description"], "world state");

        // required array contains the explicit field plus injected core fields
        let required = result.structured_output_schema["required"]
            .as_array()
            .expect("required must be an array");
        assert!(
            required.iter().any(|v| v == "world_variables"),
            "world_variables must be in required"
        );
        assert!(
            required.iter().any(|v| v == "text"),
            "core text baseline must be in required"
        );

        // db_mapping recorded
        assert_eq!(
            result.db_mappings.get("world_variables").map(|s| s.as_str()),
            Some("world_variables"),
            "db_mapping must be recorded"
        );

        // sampling params applied
        assert_eq!(result.sampling_params.temperature, Some(0.8));
        assert_eq!(result.sampling_params.max_tokens, Some(4096));
        assert_eq!(result.sampling_params.top_p, Some(0.95));
    }

    #[tokio::test]
    async fn test_sampling_params_carries_thinking() {
        // 验证蓝图 SamplingParams 节点能把 thinking_enabled / thinking_budget_tokens
        // 透传到执行结果的 compiled sampling params（修复"思考强度"经蓝图节点被丢弃）。
        let g = graph(
            vec![
                start("n_start"),
                sampling("n_sp_base", 0.8, 4096, 0.95),
                BlueprintNode {
                    id: "n_sp_think".to_string(),
                    config: NodeConfig::SamplingParams(SamplingParamsConfig {
                        temperature: None,
                        max_tokens: None,
                        top_p: None,
                        frequency_penalty: None,
                        presence_penalty: None,
                        stop: None,
                        thinking_enabled: Some(true),
                        thinking_budget_tokens: Some(2048),
                        is_locked: false,
                    }),
                    position: pos(0.0, 0.0),
                },
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_sp_base", "in"),
                edge("e2", "n_sp_base", "out", "n_sp_think", "in"),
                edge("e3", "n_sp_think", "out", "n_end", "in"),
            ],
        );

        let result = execute_blueprint(&g, &ctx_with_protocol("stateless", "anthropic"))
            .await
            .expect("thinking chain must execute");

        assert_eq!(result.sampling_params.temperature, Some(0.8), "base temp retained");
        assert_eq!(
            result.sampling_params.thinking_enabled,
            Some(true),
            "thinking_enabled must propagate from blueprint node"
        );
        assert_eq!(
            result.sampling_params.thinking_budget_tokens,
            Some(2048),
            "thinking_budget_tokens must propagate from blueprint node"
        );
    }

    #[tokio::test]
    async fn test_sampling_params_openai_only_under_chat_completions() {
        // OpenAI 版采样参数节点只在 chat_completions 协议下出参；
        // anthropic 会话下被跳过（不截断图，也不套用 OpenAI 字段）。
        let g = graph(
            vec![
                start("n_start"),
                BlueprintNode {
                    id: "n_sp".to_string(),
                    config: NodeConfig::SamplingParamsOpenAi(OpenAiSamplingParamsConfig {
                        temperature: Some(0.7),
                        max_tokens: Some(2048),
                        top_p: Some(0.9),
                        frequency_penalty: Some(0.1),
                        presence_penalty: Some(0.2),
                        stop: Some(vec!["</t>".to_string()]),
                        is_locked: false,
                    }),
                    position: pos(0.0, 0.0),
                },
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_sp", "in"),
                edge("e2", "n_sp", "out", "n_end", "in"),
            ],
        );

        // chat_completions：应用 OpenAI 字段
        let r_openai = execute_blueprint(&g, &ctx_with_protocol("stateless", "chat_completions"))
            .await
            .expect("openai sampling must execute");
        assert_eq!(r_openai.sampling_params.temperature, Some(0.7));
        assert_eq!(r_openai.sampling_params.frequency_penalty, Some(0.1));

        // anthropic：该节点不出参，temperature 保持 None
        let r_ant = execute_blueprint(&g, &ctx_with_protocol("stateless", "anthropic"))
            .await
            .expect("anthropic sampling must skip openai node");
        assert_eq!(r_ant.sampling_params.temperature, None);
        assert_eq!(r_ant.sampling_params.frequency_penalty, None);
    }

    #[tokio::test]
    async fn test_sampling_params_anthropic_only_under_anthropic() {
        // Anthropic 版采样参数节点只在 anthropic 协议下出参（含 thinking 配置）。
        let g = graph(
            vec![
                start("n_start"),
                BlueprintNode {
                    id: "n_sp".to_string(),
                    config: NodeConfig::SamplingParamsAnthropic(AnthropicSamplingParamsConfig {
                        temperature: Some(0.6),
                        max_tokens: Some(8192),
                        top_p: Some(0.85),
                        stop: Some(vec!["</t>".to_string()]),
                        thinking_enabled: Some(true),
                        thinking_budget_tokens: Some(2048),
                        is_locked: false,
                    }),
                    position: pos(0.0, 0.0),
                },
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_sp", "in"),
                edge("e2", "n_sp", "out", "n_end", "in"),
            ],
        );

        // anthropic：应用 Anthropic 字段 + thinking
        let r_ant = execute_blueprint(&g, &ctx_with_protocol("stateless", "anthropic"))
            .await
            .expect("anthropic sampling must execute");
        assert_eq!(r_ant.sampling_params.temperature, Some(0.6));
        assert_eq!(r_ant.sampling_params.thinking_enabled, Some(true));
        assert_eq!(r_ant.sampling_params.thinking_budget_tokens, Some(2048));

        // chat_completions：该节点不出参
        let r_openai = execute_blueprint(&g, &ctx_with_protocol("stateless", "chat_completions"))
            .await
            .expect("chat_completions must skip anthropic node");
        assert_eq!(r_openai.sampling_params.temperature, None);
        assert_eq!(r_openai.sampling_params.thinking_enabled, None);
    }

    #[tokio::test]
    async fn test_sampling_params_unknown_protocol_errors() {
        // 非 anthropic / chat_completions 的协议必须显式报错，不得静默回退（C2）。
        let g = graph(
            vec![
                start("n_start"),
                BlueprintNode {
                    id: "n_sp".to_string(),
                    config: NodeConfig::SamplingParamsOpenAi(OpenAiSamplingParamsConfig {
                        temperature: Some(0.5),
                        max_tokens: Some(1024),
                        top_p: None,
                        frequency_penalty: None,
                        presence_penalty: None,
                        stop: None,
                        is_locked: false,
                    }),
                    position: pos(0.0, 0.0),
                },
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_sp", "in"),
                edge("e2", "n_sp", "out", "n_end", "in"),
            ],
        );

        let err = execute_blueprint(&g, &ctx_with_protocol("stateless", "weird_provider"))
            .await
            .expect_err("unknown protocol must error");
        assert!(format!("{err}").contains("unknown sampling protocol"));
    }

    #[tokio::test]
    async fn test_schema_field_order_controllable() {
        // 作者通过 SchemaFieldConfig.order 控制 properties / required 顺序，
        // 不再被硬编码的 thinking→text→字母序覆盖。
        // 遍历序：zeta(默认0) → alpha(order=5) → beta(order=5) → gamma(order=-1)
        // 排序后：(order,-1)gamma < (order,0)zeta < (order,5)alpha < (order,5)beta
        // 且 alpha 在 beta 前（同 order 按遍历序）。
        let schema = |name: &str, order: i32| BlueprintNode {
            id: format!("n_{name}"),
            config: NodeConfig::SchemaField(SchemaFieldConfig {
                field_name: name.to_string(),
                field_type: "string".to_string(),
                description: name.to_string(),
                sub_schema: None,
                db_mapping: None,
                required: true,
                context_included: true,
                display: Default::default(),
                is_locked: false,
                lock_reason: None,
                order,
            }),
            position: pos(0.0, 0.0),
        };
        let g = graph(
            vec![
                start("n_start"),
                schema("zeta", 0),
                schema("alpha", 5),
                schema("beta", 5),
                schema("gamma", -1),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_zeta", "in"),
                edge("e2", "n_zeta", "out", "n_alpha", "in"),
                edge("e3", "n_alpha", "out", "n_beta", "in"),
                edge("e4", "n_beta", "out", "n_gamma", "in"),
                edge("e5", "n_gamma", "out", "n_end", "in"),
            ],
        );

        let result = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect("ordered schema must execute");

        let props = result.structured_output_schema["properties"]
            .as_object()
            .expect("properties must be object");
        let names: Vec<&String> = props.keys().collect();
        // thinking(-2) / text(-1) 在 gamma(-1 但遍历序更后) 之前？
        // 注意 baseline thinking/text 的 order 为 -2/-1，gamma 为 -1；
        // thinking(-2) < gamma(-1) < text(-1, 但遍历序在 gamma 之后) < zeta(0) < alpha(5) < beta(5)
        assert_eq!(
            names,
            vec![
                "thinking",
                "gamma",
                "text",
                "zeta",
                "alpha",
                "beta",
            ],
            "schema field order must follow (order, traversal index)"
        );

        let required = result.structured_output_schema["required"]
            .as_array()
            .expect("required must be array");
        let required_names: Vec<&str> = required.iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(
            required_names,
            vec!["thinking", "gamma", "text", "zeta", "alpha", "beta"],
            "required must mirror properties order"
        );
    }

    #[tokio::test]
    async fn test_mode_switch() {
        let g = graph(
            vec![
                start("n_start"),
                mode_switch("n_mode"),
                prompt("n_legacy", "legacy_block", "system", "legacy content"),
                prompt("n_mem0", "mem0_block", "system", "mem0 content"),
                prompt("n_stateless", "stateless_block", "system", "stateless content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_mode", "in"),
                edge("e2", "n_mode", "out_legacy", "n_legacy", "in"),
                edge("e3", "n_mode", "out_mem0", "n_mem0", "in"),
                edge("e4", "n_mode", "out_stateless", "n_stateless", "in"),
                edge("e5", "n_legacy", "out", "n_end", "in"),
                edge("e6", "n_mem0", "out", "n_end", "in"),
                edge("e7", "n_stateless", "out", "n_end", "in"),
            ],
        );

        // memory_mode = "legacy" → only legacy block should be produced
        let result = execute_blueprint(&g, &ctx("legacy"))
            .await
            .expect("mode_switch legacy must execute");

        assert_eq!(result.blocks.len(), 1, "only legacy branch should produce a block");
        assert_eq!(result.blocks[0].identifier, "legacy_block");
        assert_eq!(result.blocks[0].content, "legacy content");

        // memory_mode = "mem0" → only mem0 block
        let result = execute_blueprint(&g, &ctx("mem0"))
            .await
            .expect("mode_switch mem0 must execute");
        assert_eq!(result.blocks.len(), 1, "only mem0 branch should produce a block");
        assert_eq!(result.blocks[0].identifier, "mem0_block");
    }

    #[tokio::test]
    async fn test_mutex_gate() {
        let g = graph(
            vec![
                start("n_start"),
                mutex_gate("n_gate", "叙事视角", &[("opt_a", "A", "选项A说明"), ("opt_b", "B", "")]),
                prompt("n_pa", "block_a", "system", "content A"),
                prompt("n_pb", "block_b", "system", "content B"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_gate", "in"),
                edge("e2", "n_gate", "out_opt_a", "n_pa", "in"),
                edge("e3", "n_gate", "out_opt_b", "n_pb", "in"),
                edge("e4", "n_pa", "out", "n_end", "in"),
                edge("e5", "n_pb", "out", "n_end", "in"),
            ],
        );

        // selected = opt_a → only block_a；selection key 使用 node_id
        let result = execute_blueprint(&g, &ctx_with_gates("stateless", &[("n_gate", &["opt_a"])]))
            .await
            .expect("mutex_gate opt_a must execute");
        assert_eq!(result.blocks.len(), 1, "only opt_a branch should produce a block");
        assert_eq!(result.blocks[0].identifier, "block_a");

        // selected = opt_b → only block_b
        let result = execute_blueprint(&g, &ctx_with_gates("stateless", &[("n_gate", &["opt_b"])]))
            .await
            .expect("mutex_gate opt_b must execute");
        assert_eq!(result.blocks.len(), 1, "only opt_b branch should produce a block");
        assert_eq!(result.blocks[0].identifier, "block_b");
    }

    #[tokio::test]
    async fn test_group_gate_multi_select() {
        let g = graph(
            vec![
                start("n_start"),
                group_gate("n_gate", "扰动开关", &[("a", "A", ""), ("b", "B", "")]),
                prompt("n_pa", "block_a", "system", "content A"),
                prompt("n_pb", "block_b", "system", "content B"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_gate", "in"),
                edge("e2", "n_gate", "out_a", "n_pa", "in"),
                edge("e3", "n_gate", "out_b", "n_pb", "in"),
                edge("e4", "n_pa", "out", "n_end", "in"),
                edge("e5", "n_pb", "out", "n_end", "in"),
            ],
        );

        // both a and b selected → both blocks, in options order (a then b)
        let result = execute_blueprint(&g, &ctx_with_gates("stateless", &[("n_gate", &["a", "b"])]))
            .await
            .expect("group_gate multi must execute");
        assert_eq!(result.blocks.len(), 2, "both selected branches should produce blocks");
        assert_eq!(result.blocks[0].identifier, "block_a");
        assert_eq!(result.blocks[1].identifier, "block_b");

        // only a selected → one block
        let result = execute_blueprint(&g, &ctx_with_gates("stateless", &[("n_gate", &["a"])]))
            .await
            .expect("group_gate single must execute");
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].identifier, "block_a");
    }

    #[tokio::test]
    async fn test_cycle_detection() {
        // Graph: Start → ModeSwitch → (out_legacy) → A1 → B1 → End
        //                        → (out_mem0)   → A2 → B2 → A2 (cycle!)
        //                        → (out_stateless) → End
        // validate_graph passes (End reachable via legacy/stateless), but
        // traversing the mem0 branch hits the A2→B2→A2 cycle.
        let g = graph(
            vec![
                start("n_start"),
                mode_switch("n_mode"),
                prompt("n_a1", "legacy_a", "system", "legacy A"),
                prompt("n_b1", "legacy_b", "system", "legacy B"),
                prompt("n_a2", "mem0_a", "system", "mem0 A"),
                prompt("n_b2", "mem0_b", "system", "mem0 B"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_mode", "in"),
                edge("e2", "n_mode", "out_legacy", "n_a1", "in"),
                edge("e3", "n_mode", "out_mem0", "n_a2", "in"),
                edge("e4", "n_mode", "out_stateless", "n_end", "in"),
                edge("e5", "n_a1", "out", "n_b1", "in"),
                edge("e6", "n_b1", "out", "n_end", "in"),
                edge("e7", "n_a2", "out", "n_b2", "in"),
                edge("e8", "n_b2", "out", "n_a2", "in"), // cycle!
            ],
        );

        let err = execute_blueprint(&g, &ctx("mem0"))
            .await
            .expect_err("cycle must be detected");
        match err {
            BlueprintError::CycleDetected(id) => {
                assert!(
                    id == "n_a2" || id == "n_b2",
                    "cycle should be detected at n_a2 or n_b2, got {id}"
                );
            }
            other => panic!("expected CycleDetected, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_duplicate_field_name() {
        let g = graph(
            vec![
                start("n_start"),
                schema_field("n_s1", "thinking", "string", "desc1"),
                schema_field("n_s2", "thinking", "string", "desc2"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_s1", "in"),
                edge("e2", "n_s1", "out", "n_s2", "in"),
                edge("e3", "n_s2", "out", "n_end", "in"),
            ],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("duplicate field_name must be rejected");
        match err {
            BlueprintError::DuplicateFieldName(name) => {
                assert_eq!(name, "thinking");
            }
            other => panic!("expected DuplicateFieldName, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_duplicate_identifier() {
        let g = graph(
            vec![
                start("n_start"),
                prompt("n_p1", "role", "system", "content1"),
                prompt("n_p2", "role", "system", "content2"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_p1", "in"),
                edge("e2", "n_p1", "out", "n_p2", "in"),
                edge("e3", "n_p2", "out", "n_end", "in"),
            ],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("duplicate identifier must be rejected");
        assert!(matches!(err, BlueprintError::DuplicateIdentifier(id) if id == "role"));
    }

    #[tokio::test]
    async fn test_missing_gate_selection() {
        let g = graph(
            vec![
                start("n_start"),
                mutex_gate("n_gate", "叙事视角", &[("a", "A", ""), ("b", "B", "")]),
                prompt("n_pa", "block_a", "system", "content A"),
                prompt("n_pb", "block_b", "system", "content B"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_gate", "in"),
                edge("e2", "n_gate", "out_a", "n_pa", "in"),
                edge("e3", "n_gate", "out_b", "n_pb", "in"),
                edge("e4", "n_pa", "out", "n_end", "in"),
                edge("e5", "n_pb", "out", "n_end", "in"),
            ],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("missing gate selection must error");
        // 错误参数现在是 node_id（而非旧的 gate_id）
        assert!(matches!(err, BlueprintError::MissingGateSelection(id) if id == "n_gate"));
    }

    #[tokio::test]
    async fn test_no_start_node() {
        let g = graph(
            vec![end("n_end")],
            vec![],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("no start node must error");
        assert!(matches!(err, BlueprintError::NoStartNode));
    }

    #[tokio::test]
    async fn test_mode_switch_converge_at_intermediate_node() {
        // ModeSwitch branches converge at an intermediate Prompt node (not End).
        // Start → ModeSwitch → (out_legacy) → PromptLegacy → PromptShared → End
        //                    → (out_mem0)   → PromptMem0   → PromptShared
        //                    → (out_stateless) → PromptShared
        let g = graph(
            vec![
                start("n_start"),
                mode_switch("n_mode"),
                prompt("n_legacy", "legacy_only", "system", "legacy branch"),
                prompt("n_mem0", "mem0_only", "system", "mem0 branch"),
                prompt("n_shared", "shared", "system", "shared content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_mode", "in"),
                edge("e2", "n_mode", "out_legacy", "n_legacy", "in"),
                edge("e3", "n_mode", "out_mem0", "n_mem0", "in"),
                edge("e4", "n_mode", "out_stateless", "n_shared", "in"),
                edge("e5", "n_legacy", "out", "n_shared", "in"),
                edge("e6", "n_mem0", "out", "n_shared", "in"),
                edge("e7", "n_shared", "out", "n_end", "in"),
            ],
        );

        let result = execute_blueprint(&g, &ctx("legacy"))
            .await
            .expect("converge-at-intermediate must execute");
        // legacy branch: PromptLegacy + PromptShared
        assert_eq!(result.blocks.len(), 2, "legacy branch should produce 2 blocks");
        assert_eq!(result.blocks[0].identifier, "legacy_only");
        assert_eq!(result.blocks[1].identifier, "shared");

        let result = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect("stateless branch must execute");
        // stateless branch: PromptShared only (directly converges)
        assert_eq!(result.blocks.len(), 1, "stateless branch should produce 1 block");
        assert_eq!(result.blocks[0].identifier, "shared");
    }

    #[tokio::test]
    async fn test_role_switch_single_branch() {
        // Start → RoleSwitch → (out_single) → PromptSingle → End
        //                    → (out_online) → PromptOnline → End
        let g = graph(
            vec![
                start("n_start"),
                role_switch("n_role"),
                prompt("n_single", "single_block", "system", "single content"),
                prompt("n_online", "online_block", "system", "online content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_role", "in"),
                edge("e2", "n_role", "out_single", "n_single", "in"),
                edge("e3", "n_role", "out_online", "n_online", "in"),
                edge("e4", "n_single", "out", "n_end", "in"),
                edge("e5", "n_online", "out", "n_end", "in"),
            ],
        );

        // conversation_type = "single" → only single_block
        let result = execute_blueprint(&g, &ctx_with_role("stateless", "single"))
            .await
            .expect("role_switch single must execute");
        assert_eq!(result.blocks.len(), 1, "only single branch should produce a block");
        assert_eq!(result.blocks[0].identifier, "single_block");

        // conversation_type = "online" → only online_block
        let result = execute_blueprint(&g, &ctx_with_role("stateless", "online"))
            .await
            .expect("role_switch online must execute");
        assert_eq!(result.blocks.len(), 1, "only online branch should produce a block");
        assert_eq!(result.blocks[0].identifier, "online_block");
    }

    #[tokio::test]
    async fn test_role_switch_missing_port_rejected() {
        // RoleSwitch 缺少 out_online 端口 → validate_graph 应报错
        let g = graph(
            vec![
                start("n_start"),
                role_switch("n_role"),
                prompt("n_single", "single_block", "system", "single content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_role", "in"),
                edge("e2", "n_role", "out_single", "n_single", "in"),
                edge("e3", "n_single", "out", "n_end", "in"),
                // 缺少 out_online 边
            ],
        );

        let err = execute_blueprint(&g, &ctx_with_role("stateless", "single"))
            .await
            .expect_err("role_switch missing out_online must error");
        match err {
            BlueprintError::MissingRoleSwitchPort(node, port) => {
                assert_eq!(node, "n_role");
                assert_eq!(port, "out_online");
            }
            other => panic!("expected MissingRoleSwitchPort, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn test_role_switch_then_mode_switch_serial() {
        // 验证 RoleSwitch 与 ModeSwitch 在图中串联使用，6 种排列组合路径之一。
        // Start → RoleSwitch → (out_single) → ModeSwitch → (out_stateless) → End
        //                    → (out_online) → ModeSwitch
        //                                                              → (out_legacy) → PromptLegacy → End
        //                                                              → (out_mem0)   → PromptMem0   → End
        let g = graph(
            vec![
                start("n_start"),
                role_switch("n_role"),
                mode_switch("n_mode"),
                prompt("n_legacy", "legacy_block", "system", "legacy content"),
                prompt("n_mem0", "mem0_block", "system", "mem0 content"),
                prompt("n_stateless", "stateless_block", "system", "stateless content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_role", "in"),
                edge("e2", "n_role", "out_single", "n_mode", "in"),
                edge("e3", "n_role", "out_online", "n_mode", "in"),
                edge("e4", "n_mode", "out_legacy", "n_legacy", "in"),
                edge("e5", "n_mode", "out_mem0", "n_mem0", "in"),
                edge("e6", "n_mode", "out_stateless", "n_stateless", "in"),
                edge("e7", "n_legacy", "out", "n_end", "in"),
                edge("e8", "n_mem0", "out", "n_end", "in"),
                edge("e9", "n_stateless", "out", "n_end", "in"),
            ],
        );

        // single + stateless 路径
        let result = execute_blueprint(&g, &ctx_with_role("stateless", "single"))
            .await
            .expect("role+mode serial must execute");
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].identifier, "stateless_block");

        // online + legacy 路径
        let result = execute_blueprint(&g, &ctx_with_role("legacy", "online"))
            .await
            .expect("role+mode serial must execute");
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].identifier, "legacy_block");
    }

    // ─── Constant + Branch 节点测试（spec 里程碑 A）───

    /// 基础场景：Start → Constant(conversation_type) → Branch(cases=[
    ///   {match:"single", port:"out_single"}, {match:"online", port:"out_online"}
    /// ], default="out_single") → 两条分支各自一个 Prompt → End
    ///
    /// 验证 conversation_type=single 时走 out_single，conversation_type=online 时走 out_online。
    #[tokio::test]
    async fn test_constant_branch_single_online() {
        let g = graph(
            vec![
                start("n_start"),
                constant("n_const", "conversation_type"),
                branch(
                    "n_branch",
                    &[("single", "out_single"), ("online", "out_online")],
                    "out_single",
                ),
                prompt("n_single", "single_block", "system", "single content"),
                prompt("n_online", "online_block", "system", "online content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_const", "in"),
                edge("e2", "n_const", "out", "n_branch", "in"),
                edge("e3", "n_branch", "out_single", "n_single", "in"),
                edge("e4", "n_branch", "out_online", "n_online", "in"),
                edge("e5", "n_single", "out", "n_end", "in"),
                edge("e6", "n_online", "out", "n_end", "in"),
            ],
        );

        // conversation_type = "single" → single_block
        let result = execute_blueprint(&g, &ctx_with_role("stateless", "single"))
            .await
            .expect("constant+branch single must execute");
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].identifier, "single_block");

        // conversation_type = "online" → online_block
        let result = execute_blueprint(&g, &ctx_with_role("stateless", "online"))
            .await
            .expect("constant+branch online must execute");
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].identifier, "online_block");
    }

    /// Branch 走 default_port：source 值不匹配任何 case 时走 default。
    #[tokio::test]
    async fn test_branch_default_port() {
        let g = graph(
            vec![
                start("n_start"),
                constant("n_const", "conversation_type"),
                branch(
                    "n_branch",
                    &[("single", "out_single")],
                    "out_default", // 无 online case，online 走 default
                ),
                prompt("n_single", "single_block", "system", "single content"),
                prompt("n_default", "default_block", "system", "default content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_const", "in"),
                edge("e2", "n_const", "out", "n_branch", "in"),
                edge("e3", "n_branch", "out_single", "n_single", "in"),
                edge("e4", "n_branch", "out_default", "n_default", "in"),
                edge("e5", "n_single", "out", "n_end", "in"),
                edge("e6", "n_default", "out", "n_end", "in"),
            ],
        );

        // conversation_type = "online" 不匹配 "single" → 走 default_port
        let result = execute_blueprint(&g, &ctx_with_role("stateless", "online"))
            .await
            .expect("branch default must execute");
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].identifier, "default_block");
    }

    /// Branch 缺少 `value` 入边 → `MissingValueInput`。
    ///
    /// 真数据流下 Branch 的匹配值只能来自 value 边；没有 value 边就没有值可匹配，
    /// 必须显式报错，不允许默认走 `default_port` 静默兜底（C2）。
    #[tokio::test]
    async fn test_branch_missing_value_input_rejected() {
        let g = graph(
            vec![
                start("n_start"),
                branch(
                    "n_branch",
                    &[("single", "out_single")],
                    "out_single",
                ),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_branch", "in"),
                edge("e2", "n_branch", "out_single", "n_end", "in"),
            ],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("branch without a value edge must error");
        match err {
            BlueprintError::MissingValueInput(id) => {
                assert_eq!(id, "n_branch");
            }
            other => panic!("expected MissingValueInput, got {other:?}"),
        }
    }

    /// value 入边的上游不是纯值节点 → `BranchMustFollowConstant`。
    #[tokio::test]
    async fn test_branch_value_upstream_not_constant_rejected() {
        let g = graph(
            vec![
                start("n_start"),
                prompt("n_prompt", "p", "system", "content"),
                branch(
                    "n_branch",
                    &[("single", "out_single")],
                    "out_single",
                ),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_branch", "in"),
                edge("e2", "n_prompt", "out", "n_branch", "value"), // 上游是 Prompt，不是 Constant
                edge("e3", "n_branch", "out_single", "n_end", "in"),
            ],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("branch with non-constant value upstream must error");
        match err {
            BlueprintError::BranchMustFollowConstant(id) => {
                assert_eq!(id, "n_branch");
            }
            other => panic!("expected BranchMustFollowConstant, got {other:?}"),
        }
    }

    /// Constant 串在执行流上（且下游不是 Branch，归一化无法识别）→ `ConstantOnExecPath`。
    #[tokio::test]
    async fn test_constant_on_exec_path_rejected() {
        let g = graph(
            vec![
                start("n_start"),
                constant("n_const", "conversation_type"),
                prompt("n_prompt", "p", "system", "content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_const", "in"),
                edge("e2", "n_const", "out", "n_prompt", "in"),
                edge("e3", "n_prompt", "out", "n_end", "in"),
            ],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("constant on the execution flow must error");
        match err {
            BlueprintError::ConstantOnExecPath(id) => {
                assert_eq!(id, "n_const");
            }
            other => panic!("expected ConstantOnExecPath, got {other:?}"),
        }
    }

    /// Branch 缺少 case port 的出边 → 校验失败。
    #[tokio::test]
    async fn test_branch_missing_port_rejected() {
        let g = graph(
            vec![
                start("n_start"),
                constant("n_const", "conversation_type"),
                branch(
                    "n_branch",
                    &[("single", "out_single"), ("online", "out_online")],
                    "out_default",
                ),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_const", "in"),
                edge("e2", "n_const", "out", "n_branch", "in"),
                edge("e3", "n_branch", "out_single", "n_end", "in"),
                // 缺少 out_online 和 out_default 的出边
            ],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("branch with missing port must error");
        match err {
            BlueprintError::MissingBranchPort(node, port) => {
                assert_eq!(node, "n_branch");
                assert!(port == "out_online" || port == "out_default");
            }
            other => panic!("expected MissingBranchPort, got {other:?}"),
        }
    }

    /// Constant 的 source 不合法 → 运行时报错。
    #[tokio::test]
    async fn test_constant_unknown_source_rejected() {
        let g = graph(
            vec![
                start("n_start"),
                constant("n_const", "unknown_attribute"), // 不合法的 source
                branch(
                    "n_branch",
                    &[("single", "out_single")],
                    "out_default",
                ),
                prompt("n_single", "single_block", "system", "single content"),
                prompt("n_default", "default_block", "system", "default content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_const", "in"),
                edge("e2", "n_const", "out", "n_branch", "in"),
                edge("e3", "n_branch", "out_single", "n_single", "in"),
                edge("e4", "n_branch", "out_default", "n_default", "in"),
                edge("e5", "n_single", "out", "n_end", "in"),
                edge("e6", "n_default", "out", "n_end", "in"),
            ],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("constant with unknown source must error");
        match err {
            BlueprintError::UnknownConstantSource(src) => {
                assert_eq!(src, "unknown_attribute");
            }
            other => panic!("expected UnknownConstantSource, got {other:?}"),
        }
    }

    /// Constant + Branch + ModeSwitch 串联组合：6 种路径中验证两种。
    ///
    /// 结构：
    /// Start → Constant(conversation_type) → Branch →
    ///   (out_single) → ModeSwitch → (out_stateless) → PromptSS → End
    ///                              → (out_legacy)    → PromptSL → End
    ///                              → (out_mem0)      → PromptSM → End
    ///   (out_online) → ModeSwitch → (out_stateless) → PromptOS → End
    ///                              → (out_legacy)    → PromptOL → End
    ///                              → (out_mem0)      → PromptOM → End
    #[tokio::test]
    async fn test_constant_branch_with_mode_switch_6_paths() {
        let g = graph(
            vec![
                start("n_start"),
                constant("n_const", "conversation_type"),
                branch(
                    "n_branch",
                    &[("single", "out_single"), ("online", "out_online")],
                    "out_single",
                ),
                mode_switch("n_mode_s"),
                mode_switch("n_mode_o"),
                prompt("n_ss", "ss_block", "system", "single+stateless"),
                prompt("n_sl", "sl_block", "system", "single+legacy"),
                prompt("n_sm", "sm_block", "system", "single+mem0"),
                prompt("n_os", "os_block", "system", "online+stateless"),
                prompt("n_ol", "ol_block", "system", "online+legacy"),
                prompt("n_om", "om_block", "system", "online+mem0"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_const", "in"),
                edge("e2", "n_const", "out", "n_branch", "in"),
                edge("e3", "n_branch", "out_single", "n_mode_s", "in"),
                edge("e4", "n_branch", "out_online", "n_mode_o", "in"),
                edge("e5", "n_mode_s", "out_stateless", "n_ss", "in"),
                edge("e6", "n_mode_s", "out_legacy", "n_sl", "in"),
                edge("e7", "n_mode_s", "out_mem0", "n_sm", "in"),
                edge("e8", "n_mode_o", "out_stateless", "n_os", "in"),
                edge("e9", "n_mode_o", "out_legacy", "n_ol", "in"),
                edge("e10", "n_mode_o", "out_mem0", "n_om", "in"),
                edge("e11", "n_ss", "out", "n_end", "in"),
                edge("e12", "n_sl", "out", "n_end", "in"),
                edge("e13", "n_sm", "out", "n_end", "in"),
                edge("e14", "n_os", "out", "n_end", "in"),
                edge("e15", "n_ol", "out", "n_end", "in"),
                edge("e16", "n_om", "out", "n_end", "in"),
            ],
        );

        // single + stateless → ss_block
        let r = execute_blueprint(&g, &ctx_with_role("stateless", "single"))
            .await
            .expect("single+stateless path must execute");
        assert_eq!(r.blocks.len(), 1);
        assert_eq!(r.blocks[0].identifier, "ss_block");

        // online + mem0 → om_block
        let r = execute_blueprint(&g, &ctx_with_role("mem0", "online"))
            .await
            .expect("online+mem0 path must execute");
        assert_eq!(r.blocks.len(), 1);
        assert_eq!(r.blocks[0].identifier, "om_block");

        // single + legacy → sl_block
        let r = execute_blueprint(&g, &ctx_with_role("legacy", "single"))
            .await
            .expect("single+legacy path must execute");
        assert_eq!(r.blocks.len(), 1);
        assert_eq!(r.blocks[0].identifier, "sl_block");

        // online + stateless → os_block
        let r = execute_blueprint(&g, &ctx_with_role("stateless", "online"))
            .await
            .expect("online+stateless path must execute");
        assert_eq!(r.blocks.len(), 1);
        assert_eq!(r.blocks[0].identifier, "os_block");
    }

    /// Constant + Branch JSON 序列化/反序列化往返测试。
    #[tokio::test]
    async fn test_constant_branch_json_round_trip() {
        let json = r#"{
            "version": 2,
            "nodes": [
                { "id": "n_start", "type": "start", "position": {"x":0,"y":0} },
                {
                    "id": "n_const", "type": "constant", "position": {"x":100,"y":0},
                    "config": { "label": "会话角色", "source": "conversation_type" }
                },
                {
                    "id": "n_branch", "type": "branch", "position": {"x":300,"y":0},
                    "config": {
                        "label": "角色分支",
                        "cases": [
                            { "match_value": "single", "port": "out_single" },
                            { "match_value": "online", "port": "out_online" }
                        ],
                        "default_port": "out_single"
                    }
                },
                { "id": "n_end", "type": "end", "position": {"x":500,"y":0} }
            ],
            "edges": [
                { "id": "e1", "source": "n_start", "source_port": "out", "target": "n_const", "target_port": "in" },
                { "id": "e2", "source": "n_const", "source_port": "out", "target": "n_branch", "target_port": "in" },
                { "id": "e3", "source": "n_branch", "source_port": "out_single", "target": "n_end", "target_port": "in" },
                { "id": "e4", "source": "n_branch", "source_port": "out_online", "target": "n_end", "target_port": "in" }
            ]
        }"#;

        let graph: BlueprintGraph = serde_json::from_str(json)
            .expect("constant+branch graph must deserialize");

        // 校验 Constant 节点
        let const_node = graph.nodes.iter()
            .find(|n| n.id == "n_const")
            .expect("constant node must exist");
        match &const_node.config {
            NodeConfig::Constant(cfg) => {
                assert_eq!(cfg.label, "会话角色");
                assert_eq!(cfg.source, "conversation_type");
            }
            other => panic!("expected Constant, got {other:?}"),
        }

        // 校验 Branch 节点
        let branch_node = graph.nodes.iter()
            .find(|n| n.id == "n_branch")
            .expect("branch node must exist");
        match &branch_node.config {
            NodeConfig::Branch(cfg) => {
                assert_eq!(cfg.label, "角色分支");
                assert_eq!(cfg.cases.len(), 2);
                assert_eq!(cfg.cases[0].match_value, "single");
                assert_eq!(cfg.cases[0].port, "out_single");
                assert_eq!(cfg.cases[1].match_value, "online");
                assert_eq!(cfg.cases[1].port, "out_online");
                assert_eq!(cfg.default_port, "out_single");
            }
            other => panic!("expected Branch, got {other:?}"),
        }

        // 反序列化后再序列化，验证字段完整
        let reserialized = serde_json::to_string(&graph)
            .expect("graph must serialize");
        assert!(reserialized.contains("\"type\":\"constant\""));
        assert!(reserialized.contains("\"type\":\"branch\""));
    }

    /// 验证 `Constant(protocol)` → `Branch` 按会话实际协议分流到不同出口，
    /// 进而选中不同下游节点（此处用 prompt 验证分流正确性，真实场景为不同 sampling_params）。
    #[tokio::test]
    async fn test_constant_branch_protocol() {
        // 真数据流拓扑：Constant 挂在主流旁，只通过 value 边给 Branch 供值。
        let graph = graph(
            vec![
                start("n_start"),
                constant("n_const", "protocol"),
                branch(
                    "n_branch",
                    &[("anthropic", "out_anthropic"), ("chat_completions", "out_chat")],
                    "out_default",
                ),
                prompt("n_anthropic_p", "anthropic_block", "system", "ANTHROPIC BLOCK"),
                prompt("n_chat_p", "chat_block", "system", "CHAT BLOCK"),
                prompt("n_default_p", "default_block", "system", "DEFAULT BLOCK"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_branch", "in"),
                edge("e2", "n_const", "out", "n_branch", "value"),
                edge("e3", "n_branch", "out_anthropic", "n_anthropic_p", "in"),
                edge("e4", "n_branch", "out_chat", "n_chat_p", "in"),
                edge("e5", "n_branch", "out_default", "n_default_p", "in"),
                edge("e6", "n_anthropic_p", "out", "n_end", "in"),
                edge("e7", "n_chat_p", "out", "n_end", "in"),
                edge("e8", "n_default_p", "out", "n_end", "in"),
            ],
        );

        // protocol = anthropic → 只选中 anthropic 分支的 prompt
        let ctx_anthropic = BlueprintExecutionContext {
            memory_mode: "stateless".to_string(),
            conversation_type: "single".to_string(),
            protocol: "anthropic".to_string(),
            gate_selections: HashMap::new(),
        };
        let res_anthropic = execute_blueprint(&graph, &ctx_anthropic)
            .await
            .expect("protocol=anthropic execution must succeed");
        assert_eq!(
            res_anthropic.blocks.len(),
            1,
            "anthropic branch should produce exactly one block"
        );
        assert_eq!(res_anthropic.blocks[0].content, "ANTHROPIC BLOCK");

        // protocol = chat_completions → 只选中 chat 分支的 prompt
        let ctx_chat = BlueprintExecutionContext {
            memory_mode: "stateless".to_string(),
            conversation_type: "single".to_string(),
            protocol: "chat_completions".to_string(),
            gate_selections: HashMap::new(),
        };
        let res_chat = execute_blueprint(&graph, &ctx_chat)
            .await
            .expect("protocol=chat_completions execution must succeed");
        assert_eq!(
            res_chat.blocks.len(),
            1,
            "chat_completions branch should produce exactly one block"
        );
        assert_eq!(res_chat.blocks[0].content, "CHAT BLOCK");
    }

    /// 旧图归一化：Constant 串在 exec 链上的旧拓扑改写为
    /// 「上游 → Branch(in)」+「Constant → Branch(value)」，改写后仍能正确执行。
    #[tokio::test]
    async fn test_legacy_constant_chain_is_normalized() {
        let mut g = graph(
            vec![
                start("n_start"),
                constant("n_const", "conversation_type"),
                branch("n_branch", &[("single", "out_single")], "out_online"),
                prompt("n_single", "single_block", "system", "single content"),
                prompt("n_online", "online_block", "system", "online content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_const", "in"),
                edge("e2", "n_const", "out", "n_branch", "in"),
                edge("e3", "n_branch", "out_single", "n_single", "in"),
                edge("e4", "n_branch", "out_online", "n_online", "in"),
                edge("e5", "n_single", "out", "n_end", "in"),
                edge("e6", "n_online", "out", "n_end", "in"),
            ],
        );

        let migrated = normalize_legacy_value_edges(&mut g);
        assert_eq!(migrated, 2, "one edge retargeted + one upstream redirected");
        assert!(
            g.edges.iter().any(|e| {
                e.source == "n_const" && e.target == "n_branch" && e.target_port == "value"
            }),
            "constant must feed the branch through the value pin after migration"
        );
        assert!(
            g.edges.iter().any(|e| {
                e.source == "n_start" && e.target == "n_branch" && e.target_port == "in"
            }),
            "start must feed the branch exec pin after migration"
        );

        let result = execute_blueprint(&g, &ctx_with_role("stateless", "single"))
            .await
            .expect("migrated legacy graph must execute");
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].identifier, "single_block");
    }

    /// 归一化幂等：已迁移的图再次归一化应返回 0，不产生重复边。
    #[tokio::test]
    async fn test_normalize_is_idempotent() {
        let mut g = graph(
            vec![
                start("n_start"),
                constant("n_const", "conversation_type"),
                branch("n_branch", &[("single", "out_single")], "out_online"),
                prompt("n_single", "single_block", "system", "single content"),
                prompt("n_online", "online_block", "system", "online content"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_branch", "in"),
                edge("e2", "n_const", "out", "n_branch", "value"),
                edge("e3", "n_branch", "out_single", "n_single", "in"),
                edge("e4", "n_branch", "out_online", "n_online", "in"),
                edge("e5", "n_single", "out", "n_end", "in"),
                edge("e6", "n_online", "out", "n_end", "in"),
            ],
        );

        let edge_count_before = g.edges.len();
        assert_eq!(
            normalize_legacy_value_edges(&mut g),
            0,
            "already-migrated graph must not be rewritten"
        );
        assert_eq!(g.edges.len(), edge_count_before, "no duplicate edges");
    }

    /// 原生思维链模式下，不强行注入 thinking schema 字段，避免双重思维链。
    #[tokio::test]
    async fn test_native_thinking_suppresses_schema_thinking_injection() {
        let g = graph(
            vec![
                start("n_start"),
                prompt("n_prompt", "role", "system", "Narrate"),
                BlueprintNode {
                    id: "n_sampling".to_string(),
                    config: NodeConfig::SamplingParamsAnthropic(AnthropicSamplingParamsConfig {
                        temperature: Some(1.0),
                        max_tokens: Some(4096),
                        top_p: None,
                        stop: None,
                        thinking_enabled: Some(true),
                        thinking_budget_tokens: Some(1024),
                        is_locked: false,
                    }),
                    position: pos(0.0, 0.0),
                },
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_prompt", "in"),
                edge("e2", "n_prompt", "out", "n_sampling", "in"),
                edge("e3", "n_sampling", "out", "n_end", "in"),
            ],
        );

        let result = execute_blueprint(&g, &ctx_with_protocol("stateless", "anthropic"))
            .await
            .expect("graph with native thinking must execute");

        let props = result.structured_output_schema["properties"]
            .as_object()
            .expect("properties must be an object");

        assert!(
            !props.contains_key("thinking"),
            "thinking schema must NOT be injected when native thinking is enabled"
        );
        assert!(props.contains_key("text"), "text baseline must still be injected");
    }

    /// 蓝图在未激活分支下存在 thinking 节点时，绝不跨分支强行注入 thinking。
    #[tokio::test]
    async fn test_unvisited_branch_thinking_suppresses_injection() {
        let g = graph(
            vec![
                start("n_start"),
                mutex_gate(
                    "n_gate",
                    "思考通道",
                    &[("native", "原生", "原生描述"), ("schema", "指令", "指令描述")],
                ),
                prompt("n_native", "p_native", "system", "Native prompt"),
                prompt("n_schema", "p_schema", "system", "Schema prompt"),
                schema_field("n_thinking", "thinking", "string", "自定义指令思考"),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_gate", "in"),
                edge("e2", "n_gate", "out_native", "n_native", "in"),
                edge("e3", "n_gate", "out_schema", "n_schema", "in"),
                edge("e4", "n_schema", "out", "n_thinking", "in"),
                edge("e5", "n_native", "out", "n_end", "in"),
                edge("e6", "n_thinking", "out", "n_end", "in"),
            ],
        );

        // 选择走 native 分支，未访问 n_thinking 节点
        let result = execute_blueprint(&g, &ctx_with_gates("stateless", &[("n_gate", &["native"])]))
            .await
            .expect("graph must execute");

        let props = result.structured_output_schema["properties"]
            .as_object()
            .expect("properties must be an object");

        assert!(
            !props.contains_key("thinking"),
            "thinking schema must NOT be injected when thinking node is on unselected branch"
        );
        assert!(props.contains_key("text"), "text baseline must still be injected");
    }
}
