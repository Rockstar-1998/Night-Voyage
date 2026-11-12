//! `.nv.ts` 双向无损编译器（工单 05）：SQLite 蓝图图 ↔ TypeScript DSL。
//!
//! SQLite 仍是唯一物理存储权威；`.nv.ts` 是外部分发与 AI 交互载体。语法
//! 子集（`@night-voyage/blueprint`）：
//!
//! ```ts
//! import { definePreset, Macro, Tools, flow } from "@night-voyage/blueprint";
//!
//! export default definePreset({
//!   name: "预设名", version: 2,
//!   state: { /* InitialStateConfig */ },
//!   __stateNodeId: "node-id", __statePosition: { x: 0, y: 0 },
//! });
//! Tools.define({ "tool_name": { description, parameters, is_locked, __nodeId, __position } });
//! Macro.define("宏名", { __id, description, category, inputs, outputs, nodes, edges });
//! flow.branch({ /* BranchConfig */, __nodeId, __position });
//! flow.prompt({ /* PromptConfig */, __nodeId, __position });
//! flow.mutexGate({ /* MutexGateConfig */, __nodeId, __position });
//! // …其余节点种类同理，均为 flow.<种类>({ ...config, __nodeId, __position })
//! export const nvFragment = { nodes: [...], edges: [...], comments: [...] };
//! ```
//!
//! 无损策略（分区互斥）：
//! - DSL 覆盖的节点只以 DSL 调用形式出现：初始状态走 `definePreset.state`、
//!   工具定义走 `Tools.define`、其余全部已知节点种类走 `flow.<种类>` 类型化
//!   形式（映射表 [`FLOW_NODE_DSL`]，config 对象逐字往返），节点信封
//!   （id / position）经 `__nodeId` / `__position` 保留键往返；
//! - 只有真正异类节点进入 `nvFragment`：无名/重名工具（无法以键唯一表达）、
//!   第二个及以后的初始状态节点（`definePreset.state` 只能承载一个）；全部
//!   连线与评论也原样进入 `nvFragment`，逐字往返；
//! - 宏以 `Macro.define` 往返（内部子图为不透明 JSON）；
//! - 唯一归一化点：`parameters_schema` 在代码侧以对象呈现，导入时压回紧凑
//!   JSON 字符串——语义等价，空白格式不保留（成文于工单 05 Walkthrough）。
//!
//! 前向编译基于 `oxc_parser` 纯 Rust 解析（零 Node 依赖）；只接受字面量
//! 表达式（对象/数组/字符串/数字/布尔/null/无插值模板字符串），其余一律
//! 显式报错（C2）。导入后为缺少坐标的 DSL 节点做分层排版（Dagre 式分层
//! 思想：最长路径分层 + 层内顺序展开）。

use std::collections::{HashMap, HashSet};

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_parser::Parser;
use oxc_span::{GetSpan, SourceType};
use serde_json::{json, Map, Value};

use crate::models::blueprint::BlueprintGraph;

/// `flow.<种类>` 类型化 DSL 形式与节点 `type` 的映射表（工单 05 深化）。
///
/// 覆盖除 `initial_state_config`（`definePreset.state`）、`tool_definition`
/// （`Tools.define`）、`branch`（`flow.branch`，历史形式保留）之外的全部
/// 已知节点种类。每种形式均为同一模式：`flow.<名>({ ...config, __nodeId,
/// __position })`，config 对象逐字往返——调用方只需学这一个模式，覆盖面
/// 扩大不增加 Interface 负担（深 Module：Leverage 在调用方，Locality 在
/// 本表与装配逻辑）。表中没有的种类即「异类」，导出时进入 `nvFragment`。
const FLOW_NODE_DSL: &[(&str, &str)] = &[
    ("start", "start"),
    ("end", "end"),
    ("prompt", "prompt"),
    ("schema_field", "schemaField"),
    ("mutex_gate", "mutexGate"),
    ("group_gate", "groupGate"),
    ("mode_switch", "modeSwitch"),
    ("role_switch", "roleSwitch"),
    ("constant", "constant"),
    ("step_budget", "stepBudget"),
    ("sampling_params", "sampling"),
    ("sampling_params_openai", "samplingOpenAi"),
    ("sampling_params_anthropic", "samplingAnthropic"),
    ("invoke_schema", "invokeSchema"),
    ("calculator", "calculator"),
    ("condition_gate", "conditionGate"),
    ("tool_return", "toolReturn"),
    ("inspector", "inspector"),
    ("writer", "writer"),
    ("querier", "querier"),
    ("banned_words_config", "bannedWords"),
    ("scriptwriter_pipeline", "scriptwriterPipeline"),
    ("agent_mode_switch", "agentModeSwitch"),
    ("director_config", "director"),
    ("actor_definition", "actor"),
    ("ui_layout_config", "uiLayout"),
    ("macro_instance", "macroInstance"),
    ("macro_inputs", "macroInputs"),
    ("macro_outputs", "macroOutputs"),
];

/// 导出方向：节点 `type` → `flow.<名>` 的 DSL 名（不在表中返回 None）。
fn flow_dsl_name(node_type: &str) -> Option<&'static str> {
    FLOW_NODE_DSL
        .iter()
        .find(|(t, _)| *t == node_type)
        .map(|(_, name)| *name)
}

/// 导入方向：`flow.<名>` 的 DSL 名 → 节点 `type`（不在表中返回 None）。
fn flow_node_type(dsl_name: &str) -> Option<&'static str> {
    FLOW_NODE_DSL
        .iter()
        .find(|(_, name)| *name == dsl_name)
        .map(|(t, _)| *t)
}

// ───────────────────────── 导出：Graph -> .nv.ts ─────────────────────────

/// 把蓝图图编译为 `.nv.ts` 源码。
pub fn export_graph_to_code(graph: &BlueprintGraph, preset_name: &str) -> Result<String, String> {
    let root = serde_json::to_value(graph)
        .map_err(|e| format!("蓝图图序列化失败: {}", e).replace('\\', "/"))?;
    let nodes = root
        .get("nodes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let edges = root
        .get("edges")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let comments = root
        .get("comments")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let macros = root
        .get("macros")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let version = root.get("version").cloned().unwrap_or(json!(1));

    let mut fragment_nodes: Vec<Value> = Vec::new();
    let mut state_node: Option<Value> = None;
    let mut tool_entries: Vec<(String, Value)> = Vec::new();
    let mut seen_tools: HashSet<String> = HashSet::new();
    let mut branch_nodes: Vec<Value> = Vec::new();
    let mut typed_nodes: Vec<Value> = Vec::new();

    for node in nodes {
        let node_type = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match node_type {
            "initial_state_config" if state_node.is_none() => state_node = Some(node),
            "tool_definition" => {
                let tool_name = node
                    .get("config")
                    .and_then(|c| c.get("tool_name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if tool_name.is_empty() || !seen_tools.insert(tool_name.clone()) {
                    // 无名或重名工具无法用键唯一表达，放回碎片保证无损。
                    fragment_nodes.push(node);
                } else {
                    tool_entries.push((tool_name, node));
                }
            }
            "branch" => branch_nodes.push(node),
            _ if flow_dsl_name(node_type).is_some() => typed_nodes.push(node),
            _ => fragment_nodes.push(node),
        }
    }

    let mut out = String::new();
    out.push_str("// 由 Night Voyage 蓝图编译器生成的 .nv.ts（工单 05）。\n");
    out.push_str("// 已知节点种类以 DSL 调用形式呈现；异类节点与全部连线在 nvFragment 中逐字保留。\n");
    out.push_str("import { definePreset, Macro, Tools, flow } from \"@night-voyage/blueprint\";\n\n");

    // definePreset（承载预设名、图版本与初始状态）
    let mut preset_obj = Map::new();
    preset_obj.insert("name".to_string(), json!(preset_name));
    preset_obj.insert("version".to_string(), version);
    if let Some(state) = &state_node {
        if let Some(config) = state.get("config") {
            preset_obj.insert("state".to_string(), config.clone());
        }
        if let Some(id) = state.get("id") {
            preset_obj.insert("__stateNodeId".to_string(), id.clone());
        }
        if let Some(pos) = state.get("position") {
            preset_obj.insert("__statePosition".to_string(), pos.clone());
        }
    }
    out.push_str("export default definePreset(");
    out.push_str(&pretty_json(&Value::Object(preset_obj)));
    out.push_str(");\n\n");

    // Tools.define
    if !tool_entries.is_empty() {
        let mut tools_obj = Map::new();
        for (tool_name, node) in &tool_entries {
            let config = node.get("config").cloned().unwrap_or(json!({}));
            let mut entry = Map::new();
            if let Some(desc) = config.get("description") {
                entry.insert("description".to_string(), desc.clone());
            }
            if let Some(schema_raw) = config.get("parameters_schema").and_then(|v| v.as_str()) {
                // parameters_schema 必须是合法 JSON：解析失败即导出失败，
                // 禁止把损坏的 schema 伪装成字符串参数静默导出（C2；
                // code-review 2026-11-11 Standards 轴硬违规修正）。
                let parameters = serde_json::from_str::<Value>(schema_raw).map_err(|err| {
                    format!(
                        "工具 {tool_name} 的 parameters_schema 不是合法 JSON，无法导出为 .nv.ts：{err}"
                    )
                })?;
                entry.insert("parameters".to_string(), parameters);
            }
            if let Some(locked) = config.get("is_locked") {
                entry.insert("is_locked".to_string(), locked.clone());
            }
            // 工具暴露类别（spec §7）：Some 时以 "settlement" / "query" 往返，
            // None 时键缺席（未分类，旧代码兼容）。
            if let Some(kind) = config.get("tool_kind") {
                entry.insert("tool_kind".to_string(), kind.clone());
            }
            if let Some(id) = node.get("id") {
                entry.insert("__nodeId".to_string(), id.clone());
            }
            if let Some(pos) = node.get("position") {
                entry.insert("__position".to_string(), pos.clone());
            }
            tools_obj.insert(tool_name.clone(), Value::Object(entry));
        }
        out.push_str("Tools.define(");
        out.push_str(&pretty_json(&Value::Object(tools_obj)));
        out.push_str(");\n\n");
    }

    // Macro.define
    for mac in &macros {
        let name = mac.get("name").and_then(|v| v.as_str()).unwrap_or("");
        let mut body = match mac.clone() {
            Value::Object(mut m) => {
                m.remove("name");
                // 把 id 提升为保留键，排在首位便于阅读
                let mut ordered = Map::new();
                if let Some(id) = m.remove("id") {
                    ordered.insert("__id".to_string(), id);
                }
                for (k, v) in m {
                    ordered.insert(k, v);
                }
                ordered
            }
            // 宏节点数据不是对象 = 图数据损坏：显性报错，禁止以空对象
            // 静默顶替丢失宏内容（C2；提交前自检循环 2026-11-11 修正）。
            _ => {
                return Err(format!(
                    "宏 {} 的节点数据不是对象，无法导出为 Macro.define",
                    name
                ))
            }
        };
        if body.is_empty() {
            body.insert("__id".to_string(), json!(""));
        }
        out.push_str(&format!(
            "Macro.define({}, {});\n\n",
            serde_json::to_string(name).unwrap_or_else(|_| "\"\"".to_string()),
            pretty_json(&Value::Object(body))
        ));
    }

    // flow.branch
    for node in &branch_nodes {
        // config 缺失 = 无配置（空对象，恒等）；config 存在但不是对象 =
        // 图数据损坏：显性报错，禁止以空对象静默顶替丢失配置（C2；
        // 提交前自检循环 2026-11-11 修正）。
        let mut body = match node.get("config") {
            None => Map::new(),
            Some(Value::Object(m)) => m.clone(),
            Some(_) => {
                return Err(format!(
                    "flow.branch 节点（id={}）的 config 不是对象，无法导出",
                    node.get("id").and_then(|v| v.as_str()).unwrap_or("")
                ))
            }
        };
        if let Some(id) = node.get("id") {
            body.insert("__nodeId".to_string(), id.clone());
        }
        if let Some(pos) = node.get("position") {
            body.insert("__position".to_string(), pos.clone());
        }
        out.push_str("flow.branch(");
        out.push_str(&pretty_json(&Value::Object(body)));
        out.push_str(");\n\n");
    }

    // flow.<种类> 类型化形式（FLOW_NODE_DSL 覆盖的全部其余节点种类）
    for node in &typed_nodes {
        let node_type = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let dsl_name = flow_dsl_name(node_type).ok_or_else(|| {
            format!("节点类型 {} 不在 flow DSL 映射表中，无法导出", node_type)
        })?;
        // 与 flow.branch 同一纪律：config 缺失 = 无配置（空对象）；config
        // 存在但不是对象 = 图数据损坏，显性报错（C2）。
        let mut body = match node.get("config") {
            None => Map::new(),
            Some(Value::Object(m)) => m.clone(),
            Some(_) => {
                return Err(format!(
                    "flow.{} 节点（id={}）的 config 不是对象，无法导出",
                    dsl_name,
                    node.get("id").and_then(|v| v.as_str()).unwrap_or("")
                ))
            }
        };
        if let Some(id) = node.get("id") {
            body.insert("__nodeId".to_string(), id.clone());
        }
        if let Some(pos) = node.get("position") {
            body.insert("__position".to_string(), pos.clone());
        }
        out.push_str(&format!("flow.{}(", dsl_name));
        out.push_str(&pretty_json(&Value::Object(body)));
        out.push_str(");\n\n");
    }

    // nvFragment（逐字保留区）：nodeOrder 记录原图全部节点的顺序，
    // 导入时据此重组节点数组，保证顺序也无损往返。
    let mut fragment = Map::new();
    fragment.insert(
        "nodeOrder".to_string(),
        Value::Array(
            root
                .get("nodes")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|n| n.get("id").cloned())
                        .collect::<Vec<Value>>()
                })
                .unwrap_or_default(),
        ),
    );
    fragment.insert("nodes".to_string(), Value::Array(fragment_nodes));
    fragment.insert("edges".to_string(), Value::Array(edges));
    if !comments.is_empty() {
        fragment.insert("comments".to_string(), Value::Array(comments));
    }
    out.push_str("export const nvFragment = ");
    out.push_str(&pretty_json(&Value::Object(fragment)));
    out.push_str(";\n");

    Ok(out)
}

fn pretty_json(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| "{}".to_string())
}

// ───────────────────────── 导入：.nv.ts -> Graph ─────────────────────────

/// 把 `.nv.ts` 源码前向编译为蓝图图（经真实模型反序列化校验合法性）。
pub fn import_code_to_graph(code: &str) -> Result<BlueprintGraph, String> {
    let graph_value = import_code_to_value(code)?;
    serde_json::from_value::<BlueprintGraph>(graph_value)
        .map_err(|e| format!(".nv.ts 编译出的图数据未通过蓝图模型校验: {}", e).replace('\\', "/"))
}

/// 导入的中间形态（JSON 图），供转换器/测试复用，不做模型校验。
pub fn import_code_to_value(code: &str) -> Result<Value, String> {
    let allocator = Allocator::default();
    let ret = Parser::new(&allocator, code, SourceType::ts()).parse();
    if !ret.errors.is_empty() {
        let first = &ret.errors[0];
        return Err(format!(".nv.ts 语法错误: {}", first).replace('\\', "/"));
    }
    if ret.panicked {
        return Err(".nv.ts 解析失败（解析器 panic 已恢复，源码可能严重损坏）".to_string());
    }

    let mut preset_obj: Option<Map<String, Value>> = None;
    let mut macros: Vec<Value> = Vec::new();
    let mut tool_nodes: Vec<Value> = Vec::new();
    let mut branch_nodes: Vec<Value> = Vec::new();
    let mut typed_nodes: Vec<Value> = Vec::new();
    let mut layout_candidates: Vec<String> = Vec::new();
    let mut fragment: Option<Map<String, Value>> = None;

    for stmt in &ret.program.body {
        match stmt {
            Statement::ImportDeclaration(import) => {
                let source = import.source.value.as_str();
                if source != "@night-voyage/blueprint" {
                    return Err(format!(
                        ".nv.ts 只允许从 @night-voyage/blueprint 导入，实际为: {}",
                        source
                    ));
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                let obj = match &export.declaration {
                    ExportDefaultDeclarationKind::CallExpression(call) => {
                        let callee = match &call.callee {
                            Expression::Identifier(id) if id.name.as_str() == "definePreset" => {}
                            _ => {
                                return Err(
                                    "export default 必须是 definePreset({...}) 调用".to_string()
                                )
                            }
                        };
                        let _ = callee;
                        let arg = call
                            .arguments
                            .first()
                            .ok_or_else(|| "definePreset 缺少参数对象".to_string())?;
                        expr_to_json(arg.as_expression().ok_or_else(|| {
                            "definePreset 参数必须是对象字面量".to_string()
                        })?)?
                    }
                    _ => return Err("export default 必须是 definePreset({...}) 调用".to_string()),
                };
                preset_obj = Some(as_object(obj, "definePreset 参数")?);
            }
            Statement::ExportNamedDeclaration(export) => {
                if let Some(Declaration::VariableDeclaration(var_decl)) = &export.declaration {
                    read_fragment_var(var_decl, &mut fragment)?;
                } else {
                    return Err("不支持的 export 命名声明（仅允许 export const nvFragment）".to_string());
                }
            }
            Statement::VariableDeclaration(var_decl) => {
                read_fragment_var(var_decl, &mut fragment)?;
            }
            Statement::ExpressionStatement(expr_stmt) => {
                read_top_level_call(
                    &expr_stmt.expression,
                    &mut macros,
                    &mut tool_nodes,
                    &mut branch_nodes,
                    &mut typed_nodes,
                    &mut layout_candidates,
                )?;
            }
            _ => {
                return Err(format!(
                    ".nv.ts 顶层包含不支持的语句类型: {:?}",
                    stmt.span()
                ));
            }
        }
    }

    let preset = preset_obj.ok_or_else(|| ".nv.ts 缺少 export default definePreset({...})".to_string())?;
    let fragment = fragment.unwrap_or_default();

    // 组装节点：状态节点 + 工具节点 + 分支节点 + 类型化节点 + 碎片节点
    let mut nodes: Vec<Value> = Vec::new();

    if let Some(state) = preset.get("state") {
        let id = preset
            .get("__stateNodeId")
            .and_then(|v| v.as_str())
            .unwrap_or("initial_state")
            .to_string();
        let (position, needs_layout) = take_position(&preset, "__statePosition");
        if needs_layout {
            layout_candidates.push(id.clone());
        }
        nodes.push(json!({
            "id": id,
            "type": "initial_state_config",
            "config": state,
            "position": position,
        }));
    }
    nodes.extend(tool_nodes.iter().cloned());
    nodes.extend(branch_nodes.iter().cloned());
    nodes.extend(typed_nodes.iter().cloned());
    if let Some(fragment_nodes) = fragment.get("nodes").and_then(|v| v.as_array()) {
        nodes.extend(fragment_nodes.iter().cloned());
    }
    // 布局候选已在解析期显式记录：只有 DSL 节点缺失 __position（或状态
    // 节点缺失 __statePosition）才入选。显式写出的坐标——包括恰为原点
    // (0,0) 的真实坐标——一律逐字保留，不按坐标值猜测（工单 05 深化修正：
    // 此前按「原点即待排版」扫描会把 (0,0) 处的真实节点误移位）。

    // 若碎片带有 nodeOrder（导出时写入），按原始顺序重组节点数组
    let nodes = match fragment.get("nodeOrder").and_then(|v| v.as_array()) {
        Some(order) if !order.is_empty() => {
            let mut by_id: HashMap<String, Value> = HashMap::new();
            for node in nodes {
                if let Some(id) = node.get("id").and_then(|v| v.as_str()) {
                    by_id.insert(id.to_string(), node);
                }
            }
            let mut ordered: Vec<Value> = Vec::new();
            for id_value in order {
                if let Some(id) = id_value.as_str() {
                    if let Some(node) = by_id.remove(id) {
                        ordered.push(node);
                    }
                }
            }
            ordered.extend(by_id.into_values());
            ordered
        }
        _ => nodes,
    };

    let edges = fragment
        .get("edges")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let comments = fragment
        .get("comments")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    // 版本：definePreset.version 优先，其次碎片（旧代码）携带，最后默认 1
    let version = preset
        .get("version")
        .cloned()
        .or_else(|| fragment.get("version").cloned())
        .unwrap_or(json!(1));

    let mut graph = Map::new();
    graph.insert("version".to_string(), version);
    graph.insert("nodes".to_string(), Value::Array(nodes));
    graph.insert("edges".to_string(), Value::Array(edges));
    if !comments.is_empty() {
        graph.insert("comments".to_string(), Value::Array(comments));
    }
    if !macros.is_empty() {
        graph.insert("macros".to_string(), Value::Array(macros));
    }

    let mut graph = Value::Object(graph);
    apply_layered_layout(&mut graph, &layout_candidates);
    Ok(graph)
}

/// 读取 `const nvFragment = {...}` 变量声明（导出/非导出两种形态）。
fn read_fragment_var(
    var_decl: &VariableDeclaration,
    fragment: &mut Option<Map<String, Value>>,
) -> Result<(), String> {
    for declarator in &var_decl.declarations {
        let name = match &declarator.id {
            BindingPattern::BindingIdentifier(id) => id.name.as_str().to_string(),
            _ => return Err("nvFragment 声明必须是简单标识符".to_string()),
        };
        if name != "nvFragment" {
            return Err(format!(
                ".nv.ts 顶层只允许 nvFragment 变量声明，发现: {}",
                name
            ));
        }
        let init = declarator
            .init
            .as_ref()
            .ok_or_else(|| "nvFragment 缺少对象字面量初值".to_string())?;
        *fragment = Some(as_object(expr_to_json(init)?, "nvFragment")?);
    }
    Ok(())
}

/// 解析顶层 DSL 调用：Macro.define / Tools.define / flow.branch /
/// flow.<种类>（[`FLOW_NODE_DSL`] 类型化形式）。
fn read_top_level_call(
    expr: &Expression,
    macros: &mut Vec<Value>,
    tool_nodes: &mut Vec<Value>,
    branch_nodes: &mut Vec<Value>,
    typed_nodes: &mut Vec<Value>,
    layout_candidates: &mut Vec<String>,
) -> Result<(), String> {
    let Expression::CallExpression(call) = expr else {
        return Err(
            ".nv.ts 顶层只允许 Macro.define / Tools.define / flow.* 调用语句".to_string(),
        );
    };
    let Expression::StaticMemberExpression(member) = &call.callee else {
        return Err(
            ".nv.ts 顶层调用必须是 Macro.define / Tools.define / flow.*".to_string(),
        );
    };
    let Expression::Identifier(object) = &member.object else {
        return Err(".nv.ts 顶层调用对象必须是 Macro / Tools / flow".to_string());
    };
    let callee = format!("{}.{}", object.name.as_str(), member.property.name.as_str());

    let arg_json = |index: usize, what: &str| -> Result<Value, String> {
        let arg = call
            .arguments
            .get(index)
            .ok_or_else(|| format!("{} 缺少第 {} 个参数", callee, index + 1))?;
        expr_to_json(
            arg.as_expression()
                .ok_or_else(|| format!("{} 的参数必须是字面量", what))?,
        )
    };

    match callee.as_str() {
        "Macro.define" => {
            let name = match arg_json(0, "宏名")? {
                Value::String(s) => s,
                _ => return Err("Macro.define 第一参数必须是宏名字符串".to_string()),
            };
            let mut body = as_object(arg_json(1, "宏定义")?, "Macro.define 第二参数")?;
            let id = body
                .remove("__id")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| format!("macro_{}", name));
            let mut mac = Map::new();
            mac.insert("id".to_string(), json!(id));
            mac.insert("name".to_string(), json!(name));
            for (k, v) in body {
                mac.insert(k, v);
            }
            macros.push(Value::Object(mac));
            Ok(())
        }
        "Tools.define" => {
            let tools = as_object(arg_json(0, "工具定义")?, "Tools.define 参数")?;
            for (tool_name, entry) in tools {
                let mut entry = as_object(entry, "Tools.define 条目")?;
                let node_id = entry
                    .remove("__nodeId")
                    .and_then(|v| v.as_str().map(|s| s.to_string()))
                    .unwrap_or_else(|| format!("tool_{}", tool_name));
                let (position, needs_layout) = take_position(&entry, "__position");
                if needs_layout {
                    layout_candidates.push(node_id.clone());
                }
                let description = entry
                    .get("description")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                let parameters_schema = match entry.get("parameters") {
                    Some(Value::String(s)) => s.clone(),
                    Some(other) => serde_json::to_string(other)
                        .map_err(|e| format!("工具 parameters 序列化失败: {}", e).replace('\\', "/"))?,
                    None => "{}".to_string(),
                };
                let is_locked = entry
                    .get("is_locked")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let mut tool_config = json!({
                    "tool_name": tool_name,
                    "description": description,
                    "parameters_schema": parameters_schema,
                    "is_locked": is_locked,
                });
                // 工具暴露类别（spec §7）：键缺席 = 未分类；非法取值在图的
                // NodeConfig 反序列化层显式报错（C2），不在 codec 侧静默丢字段。
                if let Some(kind) = entry.get("tool_kind") {
                    if let Some(obj) = tool_config.as_object_mut() {
                        obj.insert("tool_kind".to_string(), kind.clone());
                    }
                }
                tool_nodes.push(json!({
                    "id": node_id,
                    "type": "tool_definition",
                    "config": tool_config,
                    "position": position,
                }));
            }
            Ok(())
        }
        "flow.branch" => {
            let mut body = as_object(arg_json(0, "分支定义")?, "flow.branch 参数")?;
            let node_id = body
                .remove("__nodeId")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| "branch".to_string());
            let (position, needs_layout) = take_position(&body, "__position");
            if needs_layout {
                layout_candidates.push(node_id.clone());
            }
            branch_nodes.push(json!({
                "id": node_id,
                "type": "branch",
                "config": Value::Object(body),
                "position": position,
            }));
            Ok(())
        }
        _ if flow_node_type(callee.strip_prefix("flow.").unwrap_or("")).is_some() => {
            // flow.<种类> 类型化形式：body 即该种类的 config 对象逐字，
            // 信封经 __nodeId / __position 保留键还原。无配置种类
            // （start / end）不产生 config 字段，与图模型序列化一致。
            let node_type = flow_node_type(callee.strip_prefix("flow.").unwrap_or(""))
                .ok_or_else(|| format!(".nv.ts 顶层包含不支持的调用: {}", callee))?;
            let mut body = as_object(arg_json(0, "节点定义")?, "flow.* 参数")?;
            let node_id = body
                .remove("__nodeId")
                .and_then(|v| v.as_str().map(|s| s.to_string()))
                .unwrap_or_else(|| format!("{}_node", node_type));
            let (position, needs_layout) = take_position(&body, "__position");
            if needs_layout {
                layout_candidates.push(node_id.clone());
            }
            body.remove("__position");
            let node = if node_type == "start" || node_type == "end" {
                if !body.is_empty() {
                    return Err(format!(
                        "{} 节点无配置，不接受 config 字段: {}",
                        callee, node_id
                    ));
                }
                json!({
                    "id": node_id,
                    "type": node_type,
                    "position": position,
                })
            } else {
                json!({
                    "id": node_id,
                    "type": node_type,
                    "config": Value::Object(body),
                    "position": position,
                })
            };
            typed_nodes.push(node);
            Ok(())
        }
        _ => Err(format!(".nv.ts 顶层包含不支持的调用: {}", callee)),
    }
}

fn as_object(value: Value, what: &str) -> Result<Map<String, Value>, String> {
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(format!("{} 必须是对象字面量", what)),
    }
}

/// 「占位原点」判定：无 `position`，或坐标恰为 (0, 0)。
///
/// 历史用途是导入后扫描「待排版」节点；工单 05 深化起，排版候选改为
/// 解析期按 `__position` 缺失显式记录（见 `read_top_level_call`），本判定
/// 不再驱动排版——显式写出的 (0, 0) 是合法真实坐标，必须逐字保留。本函
/// 数作为该语义的命名定义保留，由其回归测试固定（C2；
/// code-review 2026-11-11 Standards 轴硬违规修正引入）。
#[allow(dead_code)]
fn is_default_origin_position(pos: Option<&Value>) -> bool {
    match pos {
        None => true,
        Some(p) => {
            p.get("x").and_then(|v| v.as_f64()) == Some(0.0)
                && p.get("y").and_then(|v| v.as_f64()) == Some(0.0)
        }
    }
}

fn take_position(map: &Map<String, Value>, key: &str) -> (Value, bool) {
    match map.get(key) {
        Some(pos) => (pos.clone(), false),
        None => (json!({ "x": 0.0, "y": 0.0 }), true),
    }
}

/// 分层排版（Dagre 式分层思想，本仓库自研实现，未引入 Dagre 布局引擎）：
/// 对候选节点按与全图连线的最长路径分层，x = 层 * 300，y = 层内序号
/// * 170；非候选节点坐标不动。
fn apply_layered_layout(graph: &mut Value, candidates: &[String]) {
    if candidates.is_empty() {
        return;
    }
    let candidate_set: HashSet<&str> = candidates.iter().map(|s| s.as_str()).collect();
    let edges: Vec<(String, String)> = graph
        .get("edges")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|e| {
                    Some((
                        e.get("source")?.as_str()?.to_string(),
                        e.get("target")?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();

    // 最长路径分层（迭代松弛，节点数有限，足够收敛）
    let mut layer: HashMap<String, usize> = HashMap::new();
    for id in candidates {
        layer.insert(id.clone(), 0);
    }
    for _ in 0..candidates.len() + 1 {
        let mut changed = false;
        for (source, target) in &edges {
            if candidate_set.contains(target.as_str()) {
                let source_layer = layer.get(source).copied().unwrap_or(0);
                let entry = layer.entry(target.clone()).or_insert(0);
                if *entry < source_layer + 1 {
                    *entry = source_layer + 1;
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }

    let mut per_layer_count: HashMap<usize, usize> = HashMap::new();
    if let Some(nodes) = graph.get_mut("nodes").and_then(|v| v.as_array_mut()) {
        for node in nodes.iter_mut() {
            let id = node.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
            if let Some(l) = layer.get(&id) {
                let index_in_layer = {
                    let counter = per_layer_count.entry(*l).or_insert(0);
                    let v = *counter;
                    *counter += 1;
                    v
                };
                node["position"] = json!({
                    "x": (*l as f64) * 300.0,
                    "y": (index_in_layer as f64) * 170.0,
                });
            }
        }
    }
}

/// 把 oxc 字面量表达式转换为 JSON 值；非字面量一律显式报错（C2）。
fn expr_to_json(expr: &Expression) -> Result<Value, String> {
    match expr {
        Expression::ObjectExpression(obj) => {
            let mut map = Map::new();
            for prop in &obj.properties {
                match prop {
                    ObjectPropertyKind::ObjectProperty(property) => {
                        if property.computed {
                            return Err(".nv.ts 不支持计算属性名".to_string());
                        }
                        let key = match &property.key {
                            PropertyKey::StaticIdentifier(id) => id.name.as_str().to_string(),
                            PropertyKey::StringLiteral(lit) => lit.value.as_str().to_string(),
                            PropertyKey::NumericLiteral(lit) => lit
                                .raw
                                .map(|a| a.as_str().to_string())
                                .unwrap_or_else(|| lit.value.to_string()),
                            _ => return Err(".nv.ts 包含不支持的属性键类型".to_string()),
                        };
                        map.insert(key, expr_to_json(&property.value)?);
                    }
                    ObjectPropertyKind::SpreadProperty(_) => {
                        return Err(".nv.ts 不支持对象展开（...）".to_string());
                    }
                }
            }
            Ok(Value::Object(map))
        }
        Expression::ArrayExpression(array) => {
            let mut values = Vec::new();
            for element in &array.elements {
                match element {
                    ArrayExpressionElement::SpreadElement(_) => {
                        return Err(".nv.ts 不支持数组展开（...）".to_string());
                    }
                    ArrayExpressionElement::Elision(_) => {
                        return Err(".nv.ts 不支持数组空位".to_string());
                    }
                    expr => values.push(expr_to_json(expr.as_expression().ok_or_else(|| {
                        ".nv.ts 数组元素必须是字面量".to_string()
                    })?)?),
                }
            }
            Ok(Value::Array(values))
        }
        Expression::StringLiteral(lit) => Ok(json!(lit.value.as_str())),
        Expression::NumericLiteral(lit) => {
            let raw = lit
                .raw
                .map(|a| a.as_str().to_string())
                .unwrap_or_else(|| lit.value.to_string());
            if let Ok(i) = raw.parse::<i64>() {
                Ok(json!(i))
            } else if let Ok(u) = raw.parse::<u64>() {
                Ok(json!(u))
            } else if let Some(n) = serde_json::Number::from_f64(lit.value) {
                Ok(Value::Number(n))
            } else {
                Err(format!(".nv.ts 数字字面量超出可表示范围: {}", raw))
            }
        }
        Expression::BooleanLiteral(lit) => Ok(json!(lit.value)),
        Expression::NullLiteral(_) => Ok(Value::Null),
        Expression::TemplateLiteral(template) => {
            if !template.expressions.is_empty() {
                return Err(".nv.ts 不支持带插值的模板字符串".to_string());
            }
            let mut text = String::new();
            for quasi in &template.quasis {
                let cooked = quasi
                    .value
                    .cooked
                    .ok_or_else(|| ".nv.ts 模板字符串包含非法转义".to_string())?;
                text.push_str(cooked.as_str());
            }
            Ok(json!(text))
        }
        Expression::UnaryExpression(unary) => {
            if matches!(
                unary.operator,
                UnaryOperator::UnaryNegation | UnaryOperator::UnaryPlus
            ) {
                let inner = expr_to_json(&unary.argument)?;
                match (unary.operator, inner) {
                    (UnaryOperator::UnaryNegation, Value::Number(n)) => {
                        if let Some(i) = n.as_i64() {
                            Ok(json!(-i))
                        } else if let Some(f) = n.as_f64() {
                            Ok(json!(-f))
                        } else {
                            Err(".nv.ts 一元负号作用于不可取负的数字".to_string())
                        }
                    }
                    (_, other) => Ok(other),
                }
            } else {
                Err(".nv.ts 不支持该一元表达式".to_string())
            }
        }
        other => Err(format!(
            ".nv.ts 只允许字面量表达式，发现不支持的表达式: {:?}",
            other.span()
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE_CODE: &str = r#"
import { definePreset, Macro, Tools, flow } from "@night-voyage/blueprint";

export default definePreset({
  name: "测试预设",
  version: 2,
  state: {
    stats: { gold: { initial: 100, min: 0, max: 9999 } },
    inventory: [],
    flags: { met_npc: "false" },
    is_locked: false
  }
});

Tools.define({
  "deduct_gold": {
    description: "扣除金币",
    parameters: { "type": "object", "properties": { "amount": { "type": "number" } } },
    is_locked: false
  }
});

Macro.define("greeting", {
  __id: "macro_greeting",
  description: "问候宏",
  category: "test",
  inputs: [],
  outputs: [],
  nodes: [],
  edges: []
});

flow.branch({
  label: "金币检查",
  cases: [{ match_value: "rich", port: "rich" }],
  default_port: "poor"
});
"#;

    #[test]
    fn test_import_sample_code_builds_graph() {
        let graph = import_code_to_graph(SAMPLE_CODE).expect("import sample");
        let value = serde_json::to_value(&graph).expect("graph to value");
        let nodes = value["nodes"].as_array().expect("nodes");
        assert_eq!(nodes.len(), 3, "状态 + 工具 + 分支三类 DSL 节点");
        let types: Vec<&str> = nodes
            .iter()
            .map(|n| n["type"].as_str().unwrap_or(""))
            .collect();
        assert!(types.contains(&"initial_state_config"));
        assert!(types.contains(&"tool_definition"));
        assert!(types.contains(&"branch"));
        let tool = nodes
            .iter()
            .find(|n| n["type"] == "tool_definition")
            .expect("tool node");
        assert_eq!(tool["config"]["tool_name"], "deduct_gold");
        // parameters 对象被压回紧凑 JSON 字符串
        let schema: Value =
            serde_json::from_str(tool["config"]["parameters_schema"].as_str().expect("schema str"))
                .expect("schema parses back");
        assert_eq!(schema["properties"]["amount"]["type"], "number");
        let macros = value["macros"].as_array().expect("macros");
        assert_eq!(macros.len(), 1);
        assert_eq!(macros[0]["name"], "greeting");
        assert_eq!(macros[0]["id"], "macro_greeting");
    }

    #[test]
    fn test_round_trip_code_graph_code_is_lossless() {
        // 代码 -> 图 -> 代码 -> 图：两次图必须逐值相等（100% 无损往返）
        let graph1 = import_code_to_graph(SAMPLE_CODE).expect("import 1");
        let code2 = export_graph_to_code(&graph1, "测试预设").expect("export");
        let graph2 = import_code_to_graph(&code2).expect("import 2");
        assert_eq!(
            serde_json::to_value(&graph1).expect("g1 value"),
            serde_json::to_value(&graph2).expect("g2 value"),
            "round-trip 后图数据必须完全一致"
        );
        // 再导出一次，代码应进入不动点
        let code3 = export_graph_to_code(&graph2, "测试预设").expect("export 2");
        assert_eq!(code2, code3, "二次导出代码必须与一次导出一致");
    }

    #[test]
    fn test_round_trip_graph_with_fragment_nodes() {
        // 含 DSL 之外节点（prompt）的图：经碎片逐字往返
        let graph_json = json!({
            "version": 2,
            "nodes": [
                { "id": "start1", "type": "start", "position": { "x": 0.0, "y": 0.0 } },
                { "id": "prompt1", "type": "prompt", "config": { "identifier": "sys", "block_type": "system", "content": "你是助手", "priority": null, "is_locked": false, "lock_reason": null }, "position": { "x": 300.0, "y": 0.0 } },
                { "id": "state1", "type": "initial_state_config", "config": { "stats": {}, "inventory": [], "flags": {}, "is_locked": false }, "position": { "x": 600.0, "y": 0.0 } }
            ],
            "edges": [
                { "id": "e1", "source": "start1", "source_port": "out", "target": "prompt1", "target_port": "in", "order": 0 }
            ]
        });
        let graph: BlueprintGraph =
            serde_json::from_value(graph_json.clone()).expect("fixture graph");
        let code = export_graph_to_code(&graph, "碎片测试").expect("export");
        assert!(code.contains("nvFragment"), "DSL 之外节点必须进入碎片: {}", code);
        let back = import_code_to_graph(&code).expect("re-import");
        let back_value = serde_json::to_value(&back).expect("value");
        assert_eq!(back_value["nodes"], graph_json["nodes"]);
        assert_eq!(back_value["edges"], graph_json["edges"]);
        assert_eq!(back_value["version"], graph_json["version"]);
    }

    #[test]
    fn test_export_rejects_corrupt_parameters_schema() {
        // C2 回归（code-review 2026-11-11）：parameters_schema 损坏时
        // 导出必须显性失败，禁止把原始字符串伪装成 parameters 静默导出。
        let graph_json = json!({
            "version": 2,
            "nodes": [
                { "id": "tool1", "type": "tool_definition", "config": { "tool_name": "deduct_gold", "description": "扣除金币", "parameters_schema": "{not valid json", "is_locked": false }, "position": { "x": 0.0, "y": 0.0 } }
            ],
            "edges": []
        });
        let graph: BlueprintGraph = serde_json::from_value(graph_json).expect("fixture graph");
        let err = export_graph_to_code(&graph, "损坏测试")
            .expect_err("corrupt parameters_schema must fail export");
        assert!(err.contains("parameters_schema"), "实际: {}", err);
        assert!(err.contains("deduct_gold"), "实际: {}", err);
    }

    #[test]
    fn test_is_default_origin_position_semantics() {
        // C2 回归（code-review 2026-11-11）：「未定位」默认显式命名并由
        // 测试固定——无 position 与占位原点 (0,0) 均为未定位（待布局），
        // 任一轴非零的真实坐标不是。
        assert!(is_default_origin_position(None));
        assert!(is_default_origin_position(Some(&json!({ "x": 0.0, "y": 0.0 }))));
        assert!(!is_default_origin_position(Some(&json!({ "x": 120.0, "y": 0.0 }))));
        assert!(!is_default_origin_position(Some(&json!({ "x": 0.0, "y": 45.0 }))));
    }

    #[test]
    fn test_import_rejects_unknown_constructs() {
        // 未知顶层调用
        let err = import_code_to_value(
            "import { definePreset, Evil } from \"@night-voyage/blueprint\";\nexport default definePreset({ version: 1 });\nEvil.run({});",
        )
        .expect_err("unknown call must fail");
        assert!(err.contains("不支持"), "实际: {}", err);

        // 非字面量表达式
        let err = import_code_to_value(
            "import { definePreset } from \"@night-voyage/blueprint\";\nexport default definePreset({ version: 1, state: externalState });",
        )
        .expect_err("non-literal must fail");
        assert!(err.contains("字面量"), "实际: {}", err);

        // 语法错误
        let err = import_code_to_value("export default definePreset({")
            .expect_err("syntax error must fail");
        assert!(err.contains("语法错误"), "实际: {}", err);
    }

    /// 全部节点种类各一的夹具图（位置均为非原点，避免触发导入自动排版）。
    fn all_node_kinds_graph_json() -> Value {
        json!({
            "version": 2,
            "nodes": [
                { "id": "n_start", "type": "start", "position": { "x": 10.0, "y": 10.0 } },
                { "id": "n_end", "type": "end", "position": { "x": 20.0, "y": 10.0 } },
                { "id": "n_prompt", "type": "prompt", "config": { "identifier": "sys", "block_type": "system", "content": "你是助手", "priority": 5, "is_locked": true, "lock_reason": "核心" }, "position": { "x": 30.0, "y": 10.0 } },
                { "id": "n_schema", "type": "schema_field", "config": { "field_name": "gold", "field_type": "number", "description": "金币", "sub_schema": null, "db_mapping": null, "required": true, "context_included": false, "display": { "default_expanded": true, "hide_label": false, "body": false, "hidden": false }, "is_locked": false, "lock_reason": null, "order": 3 }, "position": { "x": 40.0, "y": 10.0 } },
                { "id": "n_mutex", "type": "mutex_gate", "config": { "label": "难度", "options": [{ "key": "easy", "label": "简单", "description": null }] }, "position": { "x": 50.0, "y": 10.0 } },
                { "id": "n_group", "type": "group_gate", "config": { "label": "模块", "options": [{ "key": "a", "label": "A", "description": "甲" }] }, "position": { "x": 60.0, "y": 10.0 } },
                { "id": "n_mode", "type": "mode_switch", "config": { "label": "记忆模式" }, "position": { "x": 70.0, "y": 10.0 } },
                { "id": "n_role", "type": "role_switch", "config": { "label": "角色模式" }, "position": { "x": 80.0, "y": 10.0 } },
                { "id": "n_const", "type": "constant", "config": { "label": "协议", "source": "protocol" }, "position": { "x": 90.0, "y": 10.0 } },
                { "id": "n_branch", "type": "branch", "config": { "label": "协议分支", "cases": [{ "match_value": "anthropic", "port": "p_anth" }], "default_port": "p_default" }, "position": { "x": 100.0, "y": 10.0 } },
                { "id": "n_budget", "type": "step_budget", "config": { "max_steps": 1, "short_circuit_on_tools": true, "tool_policy": "all", "is_locked": false }, "position": { "x": 110.0, "y": 10.0 } },
                { "id": "n_sampling", "type": "sampling_params", "config": { "temperature": 0.7, "max_tokens": 1024, "top_p": null, "frequency_penalty": null, "presence_penalty": null, "stop": null, "thinking_enabled": null, "thinking_budget_tokens": null, "is_locked": false }, "position": { "x": 120.0, "y": 10.0 } },
                { "id": "n_sampling_oai", "type": "sampling_params_openai", "config": { "temperature": null, "max_tokens": null, "top_p": 0.9, "frequency_penalty": 0.1, "presence_penalty": null, "stop": ["END"], "is_locked": false }, "position": { "x": 130.0, "y": 10.0 } },
                { "id": "n_sampling_ant", "type": "sampling_params_anthropic", "config": { "temperature": null, "max_tokens": 2048, "top_p": null, "stop": null, "thinking_enabled": true, "thinking_budget_tokens": 512, "is_locked": false }, "position": { "x": 140.0, "y": 10.0 } },
                { "id": "n_invoke", "type": "invoke_schema", "config": { "schema_id": "schema_main" }, "position": { "x": 150.0, "y": 10.0 } },
                { "id": "n_tool", "type": "tool_definition", "config": { "tool_name": "deduct_gold", "description": "扣除金币", "parameters_schema": "{\"type\":\"object\"}", "is_locked": false }, "position": { "x": 160.0, "y": 10.0 } },
                { "id": "n_calc", "type": "calculator", "config": { "calc_mode": "math", "target": "stats.gold", "op": "-", "operand_a": "10", "operand_b": null, "item_def": null, "is_locked": false }, "position": { "x": 170.0, "y": 10.0 } },
                { "id": "n_gate", "type": "condition_gate", "config": { "gate_type": "gold", "expression": "stats.gold >= 10", "pass_label": "放行", "blocked_label": "拦截", "block_reason": "金币不足", "is_locked": false }, "position": { "x": 180.0, "y": 10.0 } },
                { "id": "n_return", "type": "tool_return", "config": { "return_template": "已扣除 {args.amount}", "is_blocked": false, "is_locked": false }, "position": { "x": 190.0, "y": 10.0 } },
                { "id": "n_inspector", "type": "inspector", "config": { "inspect_kind": "inventory", "key_expr": "", "is_locked": false }, "position": { "x": 200.0, "y": 10.0 } },
                { "id": "n_writer", "type": "writer", "config": { "key_expr": "memo", "value_template": "值", "is_locked": false }, "position": { "x": 210.0, "y": 10.0 } },
                { "id": "n_querier", "type": "querier", "config": { "command": "get_world_book", "args_template": { "id": "{args.id}" }, "is_locked": false }, "position": { "x": 220.0, "y": 10.0 } },
                { "id": "n_banned", "type": "banned_words_config", "config": { "words": ["禁词甲"], "max_nudge_retries": 2, "nudge_instruction_template": "重写 {hits}", "is_locked": false }, "position": { "x": 230.0, "y": 10.0 } },
                { "id": "n_pipeline", "type": "scriptwriter_pipeline", "config": { "stages": [{ "stage": "drafter", "workspace_key": "draft", "prompt": "起草", "tools": [] }], "anchor_tail_chars": 50, "blackout_marker": "【锁定】", "is_locked": false }, "position": { "x": 240.0, "y": 10.0 } },
                { "id": "n_agent_mode", "type": "agent_mode_switch", "config": { "default_mode": "single", "max_tool_rounds": 5, "is_locked": false }, "position": { "x": 250.0, "y": 10.0 } },
                { "id": "n_director", "type": "director_config", "config": { "director_prompt": "分镜", "tools": ["deduct_gold"], "is_locked": false }, "position": { "x": 260.0, "y": 10.0 } },
                { "id": "n_actor", "type": "actor_definition", "config": { "actor_name": "店主", "persona": "精明的店主", "tools": [], "is_locked": false }, "position": { "x": 270.0, "y": 10.0 } },
                { "id": "n_ui", "type": "ui_layout_config", "config": { "layout_id": "hud_main", "mount_type": "RightDock", "is_locked": false }, "position": { "x": 280.0, "y": 10.0 } },
                { "id": "n_state", "type": "initial_state_config", "config": { "stats": { "gold": { "initial": 100.0, "min": 0.0, "max": 9999.0 } }, "inventory": [], "flags": {}, "is_locked": false }, "position": { "x": 290.0, "y": 10.0 } },
                { "id": "n_macro_inst", "type": "macro_instance", "config": { "macro_id": "macro_buy", "name": null }, "position": { "x": 300.0, "y": 10.0 } },
                { "id": "n_macro_in", "type": "macro_inputs", "config": { "pins": [{ "id": "pin1", "name": "amount", "pin_type": "number" }] }, "position": { "x": 310.0, "y": 10.0 } },
                { "id": "n_macro_out", "type": "macro_outputs", "config": { "pins": [] }, "position": { "x": 320.0, "y": 10.0 } }
            ],
            "edges": [
                { "id": "e1", "source": "n_start", "source_port": "out", "target": "n_prompt", "target_port": "in", "order": 0 }
            ]
        })
    }

    #[test]
    fn test_round_trip_all_typed_flow_nodes() {
        // 全部 32 种 NodeConfig 各一：导出必须全部走 DSL 形式（fragment
        // 节点为空），导入逐值无损，二次导出代码不动点。
        let graph_json = all_node_kinds_graph_json();
        let graph: BlueprintGraph =
            serde_json::from_value(graph_json.clone()).expect("fixture graph");
        let code = export_graph_to_code(&graph, "全种类").expect("export");
        for (_, dsl_name) in FLOW_NODE_DSL {
            assert!(
                code.contains(&format!("flow.{}(", dsl_name)),
                "导出代码缺少 flow.{} 形式: {}",
                dsl_name,
                code
            );
        }
        let fragment_tail = code.split("export const nvFragment").nth(1).expect("fragment section");
        assert!(
            fragment_tail.contains("\"nodes\": []"),
            "全种类图导出后 fragment 节点必须为空: {}",
            fragment_tail
        );
        let back = import_code_to_graph(&code).expect("re-import");
        let back_value = serde_json::to_value(&back).expect("value");
        assert_eq!(back_value["nodes"], graph_json["nodes"]);
        assert_eq!(back_value["edges"], graph_json["edges"]);
        assert_eq!(back_value["version"], graph_json["version"]);
        let code2 = export_graph_to_code(&back, "全种类").expect("export 2");
        assert_eq!(code, code2, "二次导出代码必须与一次导出一致");
    }

    #[test]
    fn test_typical_preset_fragment_is_empty() {
        // 「典型预设」级用例：拓扑与节点分布仿内置默认预设（prompt 主导 +
        // mutex/group/schema/constant/branch/mode/sampling/tool/state）。
        let graph_json = json!({
            "version": 2,
            "nodes": [
                { "id": "s", "type": "start", "position": { "x": 10.0, "y": 10.0 } },
                { "id": "p1", "type": "prompt", "config": { "identifier": "a", "block_type": "system", "content": "甲", "priority": null, "is_locked": false, "lock_reason": null }, "position": { "x": 20.0, "y": 10.0 } },
                { "id": "p2", "type": "prompt", "config": { "identifier": "b", "block_type": "character", "content": "乙", "priority": null, "is_locked": false, "lock_reason": null }, "position": { "x": 30.0, "y": 10.0 } },
                { "id": "p3", "type": "prompt", "config": { "identifier": "c", "block_type": "world_book", "content": "丙", "priority": null, "is_locked": false, "lock_reason": null }, "position": { "x": 40.0, "y": 10.0 } },
                { "id": "mx", "type": "mutex_gate", "config": { "label": "风格", "options": [{ "key": "k", "label": "K", "description": null }] }, "position": { "x": 50.0, "y": 10.0 } },
                { "id": "gr", "type": "group_gate", "config": { "label": "模块", "options": [] }, "position": { "x": 60.0, "y": 10.0 } },
                { "id": "sf", "type": "schema_field", "config": { "field_name": "hp", "field_type": "number", "description": "生命", "sub_schema": null, "db_mapping": null, "required": true, "context_included": true, "display": { "default_expanded": false, "hide_label": false, "body": false, "hidden": false }, "is_locked": false, "lock_reason": null, "order": 0 }, "position": { "x": 70.0, "y": 10.0 } },
                { "id": "ct", "type": "constant", "config": { "label": "类型", "source": "conversation_type" }, "position": { "x": 80.0, "y": 10.0 } },
                { "id": "br", "type": "branch", "config": { "label": "分支", "cases": [], "default_port": "out" }, "position": { "x": 90.0, "y": 10.0 } },
                { "id": "ms", "type": "mode_switch", "config": { "label": "记忆" }, "position": { "x": 100.0, "y": 10.0 } },
                { "id": "sp", "type": "sampling_params", "config": { "temperature": null, "max_tokens": null, "top_p": null, "frequency_penalty": null, "presence_penalty": null, "stop": null, "thinking_enabled": null, "thinking_budget_tokens": null, "is_locked": false }, "position": { "x": 110.0, "y": 10.0 } },
                { "id": "td", "type": "tool_definition", "config": { "tool_name": "t", "description": "d", "parameters_schema": "{}", "is_locked": false }, "position": { "x": 120.0, "y": 10.0 } },
                { "id": "st", "type": "initial_state_config", "config": { "stats": {}, "inventory": [], "flags": {}, "is_locked": false }, "position": { "x": 130.0, "y": 10.0 } },
                { "id": "e", "type": "end", "position": { "x": 140.0, "y": 10.0 } }
            ],
            "edges": []
        });
        let graph: BlueprintGraph =
            serde_json::from_value(graph_json.clone()).expect("fixture graph");
        let code = export_graph_to_code(&graph, "典型预设").expect("export");
        let fragment_tail = code.split("export const nvFragment").nth(1).expect("fragment section");
        assert!(
            fragment_tail.contains("\"nodes\": []"),
            "典型预设导出后 fragment 必须无节点: {}",
            fragment_tail
        );
        let back = import_code_to_graph(&code).expect("re-import");
        let back_value = serde_json::to_value(&back).expect("value");
        assert_eq!(back_value["nodes"], graph_json["nodes"]);
    }

    #[test]
    fn test_anomalous_nodes_stay_in_fragment() {
        // 真异类仍走 fragment 且无损：第二个 initial_state_config（state
        // 只能承载一个）与重名 tool_definition（无法以键唯一表达）。
        let graph_json = json!({
            "version": 2,
            "nodes": [
                { "id": "st1", "type": "initial_state_config", "config": { "stats": {}, "inventory": [], "flags": {}, "is_locked": false }, "position": { "x": 10.0, "y": 10.0 } },
                { "id": "st2", "type": "initial_state_config", "config": { "stats": {}, "inventory": [], "flags": { "x": "1" }, "is_locked": false }, "position": { "x": 20.0, "y": 10.0 } },
                { "id": "t1", "type": "tool_definition", "config": { "tool_name": "dup", "description": "一", "parameters_schema": "{}", "is_locked": false }, "position": { "x": 30.0, "y": 10.0 } },
                { "id": "t2", "type": "tool_definition", "config": { "tool_name": "dup", "description": "二", "parameters_schema": "{}", "is_locked": false }, "position": { "x": 40.0, "y": 10.0 } }
            ],
            "edges": []
        });
        let graph: BlueprintGraph =
            serde_json::from_value(graph_json.clone()).expect("fixture graph");
        let code = export_graph_to_code(&graph, "异类测试").expect("export");
        let fragment_tail = code.split("export const nvFragment").nth(1).expect("fragment section");
        assert!(fragment_tail.contains("st2"), "第二个状态节点应进 fragment");
        assert!(fragment_tail.contains("t2"), "重名工具应进 fragment");
        let back = import_code_to_graph(&code).expect("re-import");
        let back_value = serde_json::to_value(&back).expect("value");
        assert_eq!(back_value["nodes"], graph_json["nodes"]);
    }

    #[test]
    fn test_typed_node_at_origin_keeps_position() {
        // 回归（工单 05 深化）：显式 (0,0) 是合法真实坐标，类型化节点
        // 位于原点时不得被自动排版误移位，往返逐字保留。
        let graph_json = json!({
            "version": 2,
            "nodes": [
                { "id": "p0", "type": "prompt", "config": { "identifier": "core", "block_type": "system", "content": "核心", "priority": null, "is_locked": false, "lock_reason": null }, "position": { "x": 0.0, "y": 0.0 } },
                { "id": "p1", "type": "prompt", "config": { "identifier": "next", "block_type": "system", "content": "次", "priority": null, "is_locked": false, "lock_reason": null }, "position": { "x": 300.0, "y": 0.0 } }
            ],
            "edges": [
                { "id": "e1", "source": "p0", "source_port": "out", "target": "p1", "target_port": "in", "order": 0 }
            ]
        });
        let graph: BlueprintGraph =
            serde_json::from_value(graph_json.clone()).expect("fixture graph");
        let code = export_graph_to_code(&graph, "原点测试").expect("export");
        let back = import_code_to_graph(&code).expect("re-import");
        let back_value = serde_json::to_value(&back).expect("value");
        assert_eq!(back_value["nodes"], graph_json["nodes"]);
    }

    #[test]
    fn test_import_rejects_flow_node_with_config_on_start() {
        // start 无配置：手写代码给它塞 config 必须显式报错（C2）。
        let err = import_code_to_value(
            "import { definePreset, flow } from \"@night-voyage/blueprint\";\nexport default definePreset({ version: 2 });\nflow.start({ label: \"x\" });",
        )
        .expect_err("start with config must fail");
        assert!(err.contains("无配置"), "实际: {}", err);
        // 未知 flow 种类同样显式报错
        let err = import_code_to_value(
            "import { definePreset, flow } from \"@night-voyage/blueprint\";\nexport default definePreset({ version: 2 });\nflow.unknownKind({});",
        )
        .expect_err("unknown flow kind must fail");
        assert!(err.contains("不支持"), "实际: {}", err);
    }

    #[test]
    fn test_import_assigns_layered_positions_when_missing() {
        // DSL 节点无 __position 且由碎片连线相连时，按分层排版赋坐标
        let code = r#"
import { definePreset, Tools, flow } from "@night-voyage/blueprint";
export default definePreset({ name: "排版", version: 1, state: { stats: {}, inventory: [], flags: {}, is_locked: false } });
Tools.define({ "t1": { description: "d", parameters: {}, is_locked: false } });
export const nvFragment = { nodes: [], edges: [
  { "id": "e1", "source": "initial_state", "source_port": "out", "target": "tool_t1", "target_port": "in", "order": 0 }
] };
"#;
        let value = import_code_to_value(code).expect("import");
        let nodes = value["nodes"].as_array().expect("nodes");
        let state = nodes.iter().find(|n| n["id"] == "initial_state").expect("state");
        let tool = nodes.iter().find(|n| n["id"] == "tool_t1").expect("tool");
        assert_eq!(state["position"]["x"], 0.0);
        assert_eq!(tool["position"]["x"], 300.0, "下游节点应被排到下一层");
    }
}
