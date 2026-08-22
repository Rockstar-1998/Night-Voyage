//! Blueprint graph executor — runtime traversal of the preset blueprint graph.
//!
//! Produces [`BlueprintExecutionResult`] (blocks / structured_output_schema /
//! sampling_params / db_mappings) from a [`BlueprintGraph`] under a given
//! [`BlueprintExecutionContext`]. The executor is pure-memory and async-by-contract
//! (keeps the interface ready for future IO extensions per spec).

use std::collections::{HashMap, HashSet};

use crate::models::blueprint::{
    BlueprintExecutionContext, BlueprintExecutionResult, BlueprintGraph, CompiledBlock,
    CompiledSamplingParams, ConstantConfig, FieldDisplayConfig, NodeConfig, SchemaFieldConfig,
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
        }
    }
}

impl std::error::Error for BlueprintError {}

/// Execute the blueprint graph and produce compilation data for `compile_prompt`.
///
/// Pure-memory DFS traversal. Declared `async` to keep the interface ready for
/// future IO extensions (spec: preset-blueprint-editor §后端图执行器).
pub async fn execute_blueprint(
    graph: &BlueprintGraph,
    context: &BlueprintExecutionContext,
) -> Result<BlueprintExecutionResult, BlueprintError> {
    validate_graph(graph)?;

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
    };

    let start_id = graph
        .nodes
        .iter()
        .find(|n| matches!(n.config, NodeConfig::Start))
        .map(|n| n.id.clone())
        .ok_or(BlueprintError::NoStartNode)?;

    let mut visited: HashSet<String> = HashSet::new();
    let mut path: HashSet<String> = HashSet::new();

    traverse(graph, &start_id, context, &mut result, &mut visited, &mut path)?;

    // 强制核心基线：每个蓝图预设都必须包含「内部推理 thinking」与「叙事正文 text」。
    // 否则模型只能把正文塞进某个 string 字段（如 thinking），导致回复无可读正文。
    // 仅当字段缺失时插入，绝不覆盖蓝图作者显式定义的字段——是「组合」而非「继承」。
    inject_core_schema_baseline(&mut result);

    Ok(result)
}

/// 注入结构化输出的核心基线字段，保证每个蓝图预设都有叙事正文（body）。
///
/// 基线字段以「组合」方式叠加：仅当蓝图未显式定义该字段时才插入。这避免了让每个
/// 蓝图作者手动记得加 `text` 的脆弱约定，契合 AGENTS.md「组合优于继承」——公共基线
/// 通过编译器注入，而非要求每个节点重复声明。
fn inject_core_schema_baseline(result: &mut BlueprintExecutionResult) {
    // 先不可变读，确定缺失的核心字段；避免与后续可变借用冲突。
    let missing: Vec<&str> = {
        let props = result
            .structured_output_schema
            .get("properties")
            .and_then(|v| v.as_object());
        let mut miss = Vec::new();
        for name in ["thinking", "text"] {
            if props.and_then(|p| p.get(name)).is_none() {
                miss.push(name);
            }
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
            traverse(graph, &next, context, result, visited, path)?;
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
            traverse(graph, &next, context, result, visited, path)?;
        }
        NodeConfig::SchemaField(cfg) => {
            apply_schema_field(cfg, result)?;
            let next = next_node_id(graph, node_id, "out")?;
            traverse(graph, &next, context, result, visited, path)?;
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
            traverse(graph, &branch_target, context, result, visited, path)?;
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path)?;
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
                    traverse(graph, &branch_target, context, result, visited, path)?;
                }
            }
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path)?;
        }
        NodeConfig::ModeSwitch(_) => {
            let port = format!("out_{}", context.memory_mode);
            let branch_target = target_of(graph, node_id, &port)?;
            traverse(graph, &branch_target, context, result, visited, path)?;
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path)?;
        }
        NodeConfig::RoleSwitch(_) => {
            let port = format!("out_{}", context.conversation_type);
            let branch_target = target_of(graph, node_id, &port)?;
            traverse(graph, &branch_target, context, result, visited, path)?;
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path)?;
        }
        NodeConfig::Constant(_) => {
            // 常量节点不直接产出值传递——值由下游 BranchNode 通过入边回溯查询。
            // 直接继续到 out 端口的下游节点（通常是 BranchNode）。
            let next = next_node_id(graph, node_id, "out")?;
            traverse(graph, &next, context, result, visited, path)?;
        }
        NodeConfig::Branch(cfg) => {
            // 回溯查找上游 ConstantNode，读取 source 配置，从 context 取值
            let source_value = resolve_constant_source(graph, node_id, context)?;
            // 按顺序匹配 cases，第一个匹配的生效；无匹配走 default_port
            let port = cfg
                .cases
                .iter()
                .find(|c| c.match_value == source_value)
                .map(|c| c.port.as_str())
                .unwrap_or(&cfg.default_port);
            let branch_target = target_of(graph, node_id, port)?;
            traverse(graph, &branch_target, context, result, visited, path)?;
            let merge_node = find_merge_node(graph, node_id)?;
            traverse(graph, &merge_node, context, result, visited, path)?;
        }
        NodeConfig::SamplingParams(cfg) => {
            merge_sampling_params(cfg, &mut result.sampling_params);
            let next = next_node_id(graph, node_id, "out")?;
            traverse(graph, &next, context, result, visited, path)?;
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

    // 7a. Constant node must have outgoing edge on "out" port
    for node in &graph.nodes {
        if matches!(node.config, NodeConfig::Constant(_)) {
            let has_out = graph
                .edges
                .iter()
                .any(|e| e.source == node.id && e.source_port == "out");
            if !has_out {
                return Err(BlueprintError::NoOutgoingEdge {
                    node: node.id.clone(),
                    port: "out".to_string(),
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
            // 检查入边存在（结构校验；上游是否为 Constant 在运行时 resolve_constant_source 再验）
            let has_incoming = graph.edges.iter().any(|e| e.target == node.id);
            if !has_incoming {
                return Err(BlueprintError::BranchNoIncomingEdge(node.id.clone()));
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
fn find_merge_node(
    graph: &BlueprintGraph,
    gate_node_id: &str,
) -> Result<String, BlueprintError> {
    let branch_heads: Vec<String> = graph
        .edges
        .iter()
        .filter(|e| e.source == gate_node_id)
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

/// Merge a SamplingParamsConfig into the compiled sampling params. Only
/// `Some` fields overwrite; `None` fields leave the existing value intact.
fn merge_sampling_params(
    cfg: &crate::models::blueprint::SamplingParamsConfig,
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
    if let Some(t) = cfg.frequency_penalty {
        compiled.frequency_penalty = Some(t);
    }
    if let Some(t) = cfg.presence_penalty {
        compiled.presence_penalty = Some(t);
    }
    if let Some(stop) = &cfg.stop {
        compiled.stop = stop.clone();
    }
    // 思考强度：蓝图节点可覆盖预设/provider override 的 thinking 配置。
    if let Some(enabled) = cfg.thinking_enabled {
        compiled.thinking_enabled = Some(enabled);
    }
    if let Some(budget) = cfg.thinking_budget_tokens {
        compiled.thinking_budget_tokens = Some(budget);
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

/// 回溯查找 Branch 节点上游的 Constant 节点，读取其 `source` 配置，
/// 从 `context` 中取对应属性值。
///
/// 设计决策（spec §3.1）：不引入运行时值传递管道。BranchNode 通过入边回溯
/// 找到上游 ConstantNode，读取其 `source` 配置，直接从 context 取值。
/// 这样避免修改 `traverse` 的签名（不需要传 `value: Option<String>`）。
///
/// 错误处理（C2 零回退）：
/// - Branch 无入边 → `BranchNoIncomingEdge`
/// - 上游不是 Constant → `BranchMustFollowConstant`
/// - `source` 不是合法会话属性键 → `UnknownConstantSource`
fn resolve_constant_source(
    graph: &BlueprintGraph,
    branch_node_id: &str,
    context: &BlueprintExecutionContext,
) -> Result<String, BlueprintError> {
    let incoming_edge = graph
        .edges
        .iter()
        .find(|e| e.target == branch_node_id)
        .ok_or_else(|| BlueprintError::BranchNoIncomingEdge(branch_node_id.to_string()))?;

    let source_node = graph
        .nodes
        .iter()
        .find(|n| n.id == incoming_edge.source)
        .ok_or_else(|| BlueprintError::NodeNotFound(incoming_edge.source.clone()))?;

    match &source_node.config {
        NodeConfig::Constant(ConstantConfig { source, .. }) => match source.as_str() {
            "conversation_type" => Ok(context.conversation_type.clone()),
            "memory_mode" => Ok(context.memory_mode.clone()),
            "protocol" => Ok(context.protocol.clone()),
            _ => Err(BlueprintError::UnknownConstantSource(source.clone())),
        },
        NodeConfig::Start
        | NodeConfig::End
        | NodeConfig::Prompt(_)
        | NodeConfig::SchemaField(_)
        | NodeConfig::MutexGate(_)
        | NodeConfig::GroupGate(_)
        | NodeConfig::ModeSwitch(_)
        | NodeConfig::RoleSwitch(_)
        | NodeConfig::SamplingParams(_)
        | NodeConfig::Branch(_) => Err(BlueprintError::BranchMustFollowConstant(
            branch_node_id.to_string(),
        )),
    }
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
        BranchCase, BranchConfig, GateOption, GroupGateConfig, ModeSwitchConfig,
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

        let result = execute_blueprint(&g, &ctx("stateless"))
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

    /// Branch 无入边 → 校验失败。
    #[tokio::test]
    async fn test_branch_no_incoming_edge_rejected() {
        let g = graph(
            vec![
                start("n_start"),
                branch(
                    "n_branch",
                    &[("single", "out_single")],
                    "out_default",
                ),
                end("n_end"),
            ],
            vec![
                edge("e1", "n_start", "out", "n_branch", "in"), // 有入边但来自 Start，不是 Constant
                edge("e2", "n_branch", "out_single", "n_end", "in"),
                edge("e3", "n_branch", "out_default", "n_end", "in"),
            ],
        );

        let err = execute_blueprint(&g, &ctx("stateless"))
            .await
            .expect_err("branch with non-constant upstream must error");
        match err {
            BlueprintError::BranchMustFollowConstant(id) => {
                assert_eq!(id, "n_branch");
            }
            other => panic!("expected BranchMustFollowConstant, got {other:?}"),
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
            ],
            vec![
                edge("e1", "n_start", "out", "n_const", "in"),
                edge("e2", "n_const", "out", "n_branch", "in"),
                edge("e3", "n_branch", "out_anthropic", "n_anthropic_p", "in"),
                edge("e4", "n_branch", "out_chat", "n_chat_p", "in"),
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
}
