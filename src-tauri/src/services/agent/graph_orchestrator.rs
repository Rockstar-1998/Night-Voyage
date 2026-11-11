//! 图语义多智能体编排（工单 03）：计划编译器 + 拓扑执行器。
//!
//! 取代旧的硬编码动态流水线函数：蓝图资产先被**编译**为显式编排计划
//! [`OrchestrationPlan`]——节点（子智能体任务）、Exec 出边（`on_success` 串联）、
//! 质量门禁回边（[`BackEdge`]：打回目标 + 局部循环上限），再由本模块的拓扑
//! 执行器按图游走执行。执行器不认识任何业务流水线名称：阶段数量、门禁位置、
//! 打回目标全部来自计划数据（AGENTS.md C11）。
//!
//! 计划 IR 目前有两个编译器（Adapter），共用同一个执行器与阶段调用 seam：
//! - [`compile_scriptwriter_plan`]：`ScriptwriterPipelineConfig` → 线性接力计划；
//! - [`compile_director_plan`]：`DirectorConfig` + `ActorDefinition` 资产 →
//!   导演节点产出分镜集 → [`PlanNodeKind::FanOutActors`] 节点在运行时按分镜数
//!   实例化演员节点 → 汇聚节点收尾（工单 03 第 1 项，FanOut 入图）。
//!
//! 语义与旧实现逐项对齐（由移植的单元测试锁定）：
//! - 入口节点吃用户输入，产出写入 `draft`；
//! - 接力节点吃前序产出；门禁节点解析裁决，打回时沿回边重跑目标节点并注入
//! `{feedback}`（Scratchpad `feedback` 键 + `{stage}.critique` 键），局部计数器
//! 超过 `max_loop_count` 触发熔断：记录熔断批注后沿 Exec 出边走终结路径；
//! - 终结节点（无 Exec 出边）执行 Layer 1 锚点涂黑装配（尾锚 + 累积批注）；
//! - 门禁节点若无后继终结路径且循环耗尽 → `BudgetExceeded` 显式熔断报错（C2）。
//!
//! 入口/终结节点上声明的 `reject_target` 在旧实现中从不生效，编译器同样忽略
//! （保持预设兼容）；回边目标在编译期解析，目标不存在 = 编译错误，绝不运行时
//! 才发现（C2 零静默回退）。

use std::future::Future;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::blueprint::{
ActorDefinition, DirectorConfig, RejectionLoopState, ScriptwriterPipelineConfig,
ScriptwriterStage,
};

use super::orchestrator::ReviewVerdict;
use super::scratchpad::Scratchpad;

/// 导演分镜扇出上限（显式命名常量）。
///
/// 来源：`DirectorConfig` 资产没有分镜数上限字段，本上限是执行器的熔断
/// 常量——防止导演产出异常分镜集时无界扇出耗尽 API 余额（spec 用户故事 5
/// 的熔断精神）。32 远高于正常分镜规模（个位数到十余镜）；超限**显式报错**
/// 而非截断续跑（C2 零静默回退）。
pub const MAX_DIRECTOR_BEATS: usize = 32;

/// 节点输入装配方式（由拓扑位置在编译期决定）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NodeInput {
/// 入口节点：玩家输入原文。
UserInput,
/// 接力/门禁节点：前序节点的产出。
PreviousOutput,
/// 终结节点：Layer 1 锚点涂黑装配（涂黑标记 + 初稿尾锚 + 累积批注）。
AnchorBlackout,
/// FanOut 节点：不吃单一前序产出，运行时按导演分镜集逐镜实例化演员节点。
FanOutBeats,
/// 汇聚节点：消费 FanOut 汇聚结果（按分镜序收集的演员产出装配）。
FanOutAssembly,
}

/// 计划节点种类：节点在执行器中的运行时语义。
///
/// 普通接力节点是 [`PlanNodeKind::Standard`]；导演-演员计划额外使用
/// [`PlanNodeKind::DirectorPlan`]（产出须解析为分镜集）与
/// [`PlanNodeKind::FanOutActors`]（携带演员资产，运行时实例化）。
#[derive(Debug, Clone)]
pub enum PlanNodeKind {
/// 标准接力节点（剧本流水线全部节点、导演计划的汇聚节点）。
Standard,
/// 导演分镜节点：产出必须是合法分镜计划 JSON，执行器解析后写入
/// Scratchpad `director:beats` 供 FanOut 节点消费；分镜数超过
/// `max_beats` 显式报错。
DirectorPlan {
/// 本计划允许的最大分镜数（编译期由 [`MAX_DIRECTOR_BEATS`] 盖章）。
max_beats: usize,
},
/// FanOut 扇出节点：按导演分镜集逐镜实例化演员节点。演员 persona /
/// 工具 / 权限来自 `actors` 资产（按分镜 `character` 字段命中）；未命中
/// 资产的镜头以空 persona 实例化——该降级不静默：执行器显式日志，并经
/// Scratchpad `fanout:actor_def_missed` 信号明示，视界裁剪由阶段调用方
/// 按旧路径处理、未命中设定块时以时间线 Info 事件呈现（C2）。
FanOutActors {
/// 演员定义资产全集（编译自蓝图 `ActorDefinition` 节点）。
actors: Vec<ActorDefinition>,
/// 本计划允许的最大分镜数（与导演节点一致，执行期双重校验）。
max_beats: usize,
},
}

/// 质量门禁回边：裁决打回时回到哪个节点重跑、最多循环几次。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackEdge {
/// 目标节点下标（编译期由 `reject_target` 名称解析）。
pub target_node: usize,
/// 本回边的局部循环上限（该门禁节点独立计数）。
pub max_loop_count: u32,
}

/// 编排计划节点 = 一个子智能体任务节点 + 其拓扑连接。
#[derive(Debug, Clone)]
pub struct PlanNode {
/// 阶段资产（提示词 / 工具 / 权限 / 工作区键）。
pub stage: ScriptwriterStage,
/// Exec 出边：成功后串联的下一节点；`None` = 终结节点。
pub on_success: Option<usize>,
/// 质量门禁回边（仅接力节点可有；入口/终结节点的声明按旧语义忽略）。
pub back_edge: Option<BackEdge>,
/// 输入装配方式。
pub input: NodeInput,
/// 节点运行时语义（标准接力 / 导演分镜 / FanOut 扇出）。
pub kind: PlanNodeKind,
}

/// 编排计划：由蓝图资产编译出的显式图拓扑。
#[derive(Debug, Clone)]
pub struct OrchestrationPlan {
pub nodes: Vec<PlanNode>,
/// 入口节点下标。
pub entry: usize,
/// 终结节点的尾锚保留字数（Layer 1 锚点涂黑）。
pub anchor_tail_chars: u32,
/// 终结节点的涂黑标记。
pub blackout_marker: String,
}

/// 把剧本流水线蓝图资产编译为编排计划。
///
/// 校验（任一失败即编译错误，C2 显式报错）：
/// - 阶段数 < 2 → 接力语义无法成立；
/// - 接力节点声明的 `reject_target` 在阶段列表中不存在。
pub fn compile_scriptwriter_plan(
config: &ScriptwriterPipelineConfig,
) -> Result<OrchestrationPlan, String> {
let stages = &config.stages;
if stages.is_empty() {
return Err(
"ScriptwriterPipeline.stages 未配置阶段资产（至少需要 2 个阶段，如 draft 与 refiner，C2/C11 严禁代码硬编码兜底）"
.to_string(),
);
}
if stages.len() < 2 {
return Err(format!(
"ScriptwriterPipeline.stages 至少需要 2 个阶段（当前 {} 个）：接力流水线语义无法成立",
stages.len()
));
}

let last = stages.len() - 1;
let mut nodes = Vec::with_capacity(stages.len());
for (index, stage) in stages.iter().enumerate() {
let input = if index == 0 {
NodeInput::UserInput
} else if index == last {
NodeInput::AnchorBlackout
} else {
NodeInput::PreviousOutput
};
// 回边仅对接力节点编译；入口/终结节点上的 reject_target 旧实现从不
// 生效，编译器同样忽略以保持既有预设行为不变。
let back_edge = if index == 0 || index == last {
None
} else if let Some(target_name) = stage.reject_target.as_deref() {
let target_node = stages
.iter()
.position(|s| s.stage == target_name || s.workspace_key == target_name)
.ok_or_else(|| {
format!(
"阶段 {} 配置的打回目标 reject_target '{}' 不存在于流水线阶段列表中（图编译期校验）",
stage.stage, target_name
)
})?;
Some(BackEdge {
target_node,
max_loop_count: stage.max_loop_count.unwrap_or(2),
})
} else {
None
};
nodes.push(PlanNode {
stage: stage.clone(),
on_success: if index == last { None} else { Some(index + 1)},
back_edge,
input,
kind: PlanNodeKind::Standard,
});
}

Ok(OrchestrationPlan {
nodes,
entry: 0,
anchor_tail_chars: config.anchor_tail_chars,
blackout_marker: config.blackout_marker.clone(),
})
}

/// 导演产出的一个分镜槽位。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorBeat {
pub slot_id: String,
/// 该镜头由哪个角色出演（用于视界裁剪）
pub character: Option<String>,
/// 这一镜要发生什么
pub focus: String,
}

/// 导演分镜计划。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectorPlan {
pub beats: Vec<DirectorBeat>,
}

/// 返回导演分镜计划（DirectorPlan）的标准 JSON Schema 定义。
///
/// 遵循 `InvokeSchema` 规范，用于强制约束模型以标准 JSON 产出分镜槽位。
pub fn director_plan_schema() -> serde_json::Value {
serde_json::json!({
"type": "object",
"properties": {
"beats": {
"type": "array",
"items": {
"type": "object",
"properties": {
"slot_id": { "type": "string" },
"character": { "type": "string" },
"focus": { "type": "string" }
},
"required": ["slot_id", "focus"]
}
}
},
"required": ["beats"]
})
}

/// 解析导演计划：必须是 JSON 对象且含非空 `beats` 数组。
///
/// 允许模型把 JSON 包在 ```json 代码块里；除此之外任何偏差都报错——
/// 解析失败就改写或降级，等于让导演"什么都没说"也照演。
pub fn parse_director_plan(raw: &str) -> Result<DirectorPlan, String> {
let cleaned = raw.trim().trim_start_matches("```json").trim_end_matches("```").trim();
let value: Value = serde_json::from_str(cleaned)
.map_err(|err| format!("导演计划不是合法 JSON: {}（原文前 200 字：{}）", err, cleaned.chars().take(200).collect::<String>()))?;
let object = value
.as_object()
.ok_or_else(|| "导演计划必须是 JSON 对象".to_string())?;
let beats_value = object
.get("beats")
.ok_or_else(|| "导演计划缺少 beats 数组".to_string())?;
let beats_raw = beats_value
.as_array()
.ok_or_else(|| "导演计划的 beats 必须是数组".to_string())?;
if beats_raw.is_empty() {
return Err("导演计划的 beats 为空：本轮没有可演的镜头".to_string());
}

let mut beats = Vec::with_capacity(beats_raw.len());
for (index, raw_beat) in beats_raw.iter().enumerate() {
let beat_object = raw_beat
.as_object()
.ok_or_else(|| format!("分镜 #{} 不是 JSON 对象", index + 1))?;
let slot_id = beat_object
.get("slot_id")
.and_then(|value| value.as_str())
.map(str::trim)
.filter(|value| !value.is_empty())
.ok_or_else(|| format!("分镜 #{} 缺少 slot_id", index + 1))?
.to_string();
let focus = beat_object
.get("focus")
.and_then(|value| value.as_str())
.map(str::trim)
.filter(|value| !value.is_empty())
.ok_or_else(|| format!("分镜 `{}` 缺少 focus", slot_id))?
.to_string();
let character = beat_object
.get("character")
.and_then(|value| value.as_str())
.map(str::to_string);
beats.push(DirectorBeat { slot_id, character, focus });
}

Ok(DirectorPlan { beats })
}

/// 把导演-演员蓝图资产编译为编排计划（计划 IR 的第二个 Adapter）。
///
/// 拓扑：导演节点（[`PlanNodeKind::DirectorPlan`]，吃玩家输入、产出分镜集）
/// → FanOut 节点（[`PlanNodeKind::FanOutActors`]，运行时按分镜数实例化演员
/// 节点）→ 汇聚节点（标准节点，吃 FanOut 汇聚结果、缝合定稿）。
///
/// 校验（任一失败即编译错误，C2 显式报错）：
/// - 演员 `actor_name` 为空或重复（分镜 `character` 引用将歧义）。
pub fn compile_director_plan(
director: &DirectorConfig,
actors: &[ActorDefinition],
) -> Result<OrchestrationPlan, String> {
let mut seen_names: Vec<&str> = Vec::with_capacity(actors.len());
for actor in actors {
let name = actor.actor_name.trim();
if name.is_empty() {
return Err(
"ActorDefinition 存在 actor_name 为空的演员定义（图编译期校验）".to_string(),
);
}
if seen_names.contains(&name) {
return Err(format!(
"ActorDefinition actor_name 重复 `{name}`：每个演员必须唯一（图编译期校验）"
));
}
seen_names.push(name);
}

let director_stage = ScriptwriterStage {
stage: "director:plan".to_string(),
workspace_key: "director:plan".to_string(),
prompt: director.director_prompt.clone(),
tools: director.tools.clone(),
tool_permissions: director.tool_permissions.clone(),
reject_target: None,
max_loop_count: None,
};
let fanout_template = ScriptwriterStage {
stage: "actor".to_string(),
workspace_key: "fanout:actors".to_string(),
prompt: String::new(),
tools: vec![],
tool_permissions: None,
reject_target: None,
max_loop_count: None,
};
let assembly_stage = ScriptwriterStage {
stage: "director:assembly".to_string(),
workspace_key: "final".to_string(),
prompt: "你是导演，负责把分镜成品缝合成最终正文。只输出正文。".to_string(),
tools: vec![],
tool_permissions: None,
reject_target: None,
max_loop_count: None,
};

Ok(OrchestrationPlan {
nodes: vec![
PlanNode {
stage: director_stage,
on_success: Some(1),
back_edge: None,
input: NodeInput::UserInput,
kind: PlanNodeKind::DirectorPlan {
max_beats: MAX_DIRECTOR_BEATS,
},
},
PlanNode {
stage: fanout_template,
on_success: Some(2),
back_edge: None,
input: NodeInput::FanOutBeats,
kind: PlanNodeKind::FanOutActors {
actors: actors.to_vec(),
max_beats: MAX_DIRECTOR_BEATS,
},
},
PlanNode {
stage: assembly_stage,
on_success: None,
back_edge: None,
input: NodeInput::FanOutAssembly,
kind: PlanNodeKind::Standard,
},
],
entry: 0,
// 导演计划不走锚点涂黑装配，这两个字段不参与执行（汇聚节点以
// FanOutAssembly 输入装配定稿）。
anchor_tail_chars: 0,
blackout_marker: String::new(),
})
}

fn stage_workspace_key(stage: &ScriptwriterStage) -> &str {
if!stage.workspace_key.trim().is_empty() {
stage.workspace_key.trim()
} else {
stage.stage.trim()
}
}

/// 按编排计划拓扑执行多智能体编排，返回终结节点定稿正文。
///
/// `call_stage` 是阶段调用接缝（生产实现走 `stage_call_with_scratchpad`，
/// 测试以脚本化闭包注入）；`on_rejection` 在每次打回时收到循环状态快照。
/// 全程纯内存 Scratchpad 流转（零磁盘 I/O，spec §1）。
pub async fn execute_orchestration_plan<F, Fut, H>(
plan: &OrchestrationPlan,
user_input: &str,
scratchpad: &Scratchpad,
mut call_stage: F,
mut on_rejection: H,
) -> Result<String, String>
where
F: FnMut(&ScriptwriterStage, String, String, String, Scratchpad) -> Fut,
Fut: Future<Output = Result<String, String>>,
H: FnMut(&RejectionLoopState),
{
if plan.nodes.len() < 2 {
return Err(format!(
"编排计划至少需要 2 个节点（当前 {} 个）：接力拓扑无法成立",
plan.nodes.len()
));
}

let mut prev_output = String::new();
let mut accumulated_critiques: Vec<(String, String)> = Vec::new();
let mut director_beats: Vec<DirectorBeat> = Vec::new();
let mut fanout_results: Vec<(String, String)> = Vec::new();
let mut cursor = plan.entry;

loop {
let node = &plan.nodes[cursor];
let stage_cfg = &node.stage;
let stage_label = format!("阶段 {}", stage_cfg.stage);
let stage_key = stage_workspace_key(stage_cfg);

match node.input {
NodeInput::UserInput => {
let output = call_stage(
stage_cfg,
stage_label,
stage_cfg.prompt.clone(),
user_input.to_string(),
scratchpad.clone(),
)
.await?;
scratchpad.write_text("draft", &output);
scratchpad.write_text(stage_key, &output);
scratchpad.write_text(&stage_cfg.stage, &output);
if let PlanNodeKind::DirectorPlan { max_beats } = node.kind {
// 导演节点：产出必须解析为分镜集并写入 Scratchpad 供 FanOut
// 节点消费；解析失败 / 空分镜 / 超限一律显式报错（C2）。
let parsed = parse_director_plan(&output)?;
if parsed.beats.len() > max_beats {
return Err(format!(
"FanOut 扇出超限：导演产出 {} 个分镜，超过上限 {}（MAX_DIRECTOR_BEATS，显式报错不截断）",
parsed.beats.len(),
max_beats
));
}
let beats_json = serde_json::to_string(&parsed.beats).map_err(|e| {
format!("序列化导演分镜集失败: {e}").replace('\\', "/")
})?;
scratchpad.write_text("director:beats", &beats_json);
director_beats = parsed.beats;
}
prev_output = output;
}
NodeInput::FanOutBeats => {
// FanOut 节点：分镜数由导演节点输出在运行时决定，逐镜串行实例化
// 演员节点（串行保序且每位演员可见前序演出，与旧实现一致）。
let (fanout_actors, max_beats) = match &node.kind {
PlanNodeKind::FanOutActors { actors, max_beats } => (actors, *max_beats),
PlanNodeKind::Standard => {
return Err(
"编排计划拓扑损坏：FanOut 节点缺少 FanOutActors 节点种类数据"
.to_string(),
)
}
PlanNodeKind::DirectorPlan { .. } => {
return Err(
"编排计划拓扑损坏：FanOut 节点缺少 FanOutActors 节点种类数据"
.to_string(),
)
}
};
if director_beats.is_empty() {
return Err(
"FanOut 节点执行时分镜集为空：导演节点未产出任何分镜（C2 显式报错，不以空扇出静默续跑）"
.to_string(),
);
}
if director_beats.len() > max_beats {
return Err(format!(
"FanOut 扇出超限：分镜集含 {} 个分镜，超过上限 {}（MAX_DIRECTOR_BEATS，显式报错不截断）",
director_beats.len(),
max_beats
));
}
let total = director_beats.len();
for (index, beat) in director_beats.iter().enumerate() {
let actor_def = beat
.character
.as_deref()
.and_then(|name| fanout_actors.iter().find(|a| a.actor_name == name));
// C2 可见性（code-review 第二轮 Standards 轴硬违规修正）：未命中
// ActorDefinition 时以空 persona / 空 tools 实例化，是与旧实现一致的
// 降级演出（旧路径裁剪在阶段调用方），但降级决定不得静默——命中与否
// 在此处穷尽分流：未命中显式日志，并经 Scratchpad
// `fanout:actor_def_missed` 信号交给阶段调用方按旧路径裁剪、以时间线
// Info 事件明示；不再让调用方靠空 prompt 反推未命中（命中但 persona
// 为空的演员会被误判进旧路径，与旧实现按 def 命中与否分流不符）。
let actor_def_missed = actor_def.is_none();
let (persona, tools, tool_permissions) = match actor_def {
Some(def) => (
def.persona.clone(),
def.tools.clone(),
def.tool_permissions.clone(),
),
None => {
crate::dbg_eprintln!(
"[graph-orchestrator] FanOut 分镜 {}/{}（slot_id={}）character={} 未命中任何 ActorDefinition 资产：以空 persona / 空 tools 降级实例化，视界裁剪由阶段调用方走旧路径（按角色名裁剪共享设定块，未命中设定块时以时间线 Info 事件明示）",
index + 1,
total,
beat.slot_id,
beat.character.as_deref().unwrap_or("<未指定>")
);
(String::new(), Vec::new(), None)
}
};
let actor_stage = ScriptwriterStage {
stage: format!("actor:{}", beat.slot_id),
workspace_key: format!("actor:{}", beat.slot_id),
prompt: persona,
tools,
tool_permissions,
reject_target: None,
max_loop_count: None,
};
// 当前镜头上下文写入 Scratchpad：阶段调用方据此做视界裁剪、
// 时间线定位（第几镜 / 共几镜）。
let beat_json = serde_json::to_string(beat).map_err(|e| {
format!("序列化当前分镜失败: {e}").replace('\\', "/")
})?;
scratchpad.write_text("fanout:current_beat", &beat_json);
scratchpad.write_text("fanout:beat_index", &(index + 1).to_string());
scratchpad.write_text("fanout:beat_total", &total.to_string());
// 未命中信号逐镜刷新（与日志同分支产出）：阶段调用方据此显式分流
// 命中 persona 与旧路径裁剪，不靠空 prompt 反推。
scratchpad.write_text(
"fanout:actor_def_missed",
if actor_def_missed { "true" } else { "false" },
);

let mut actor_user_prompt = String::new();
if !fanout_results.is_empty() {
actor_user_prompt.push_str("【本轮前序分镜演出】\n");
for (prev_slot, prev_text) in &fanout_results {
actor_user_prompt.push_str(&format!(
"分镜 {}:\n{}\n\n", prev_slot, prev_text
));
}
}
actor_user_prompt.push_str(&format!(
"【当前分镜任务（台词纸条）】\n{}\n\n【玩家输入】\n{}",
beat.focus, user_input
));
let instruction = format!(
"你现在只出演这一镜：{}。只写这一镜的表演，不要替其他角色写戏，不要写总结。",
beat.focus
);
let text = call_stage(
&actor_stage,
format!("演员 {}", beat.slot_id),
instruction,
actor_user_prompt,
scratchpad.clone(),
)
.await
.map_err(|err| {
format!(
"FanOut 演员执行失败（分镜 {}/{}，slot_id={}，character={}）：{}",
index + 1,
total,
beat.slot_id,
beat.character.as_deref().unwrap_or("<未指定>"),
err
)
})?;
scratchpad.write_text(format!("actor:{}", beat.slot_id), &text);
fanout_results.push((beat.slot_id.clone(), text));
}
// 汇聚：各演员产出按分镜序收集，写入 Scratchpad 供汇聚节点消费。
let aggregated: Vec<Value> = fanout_results
.iter()
.map(|(slot_id, text)| {
serde_json::json!({ "slot_id": slot_id, "text": text })
})
.collect();
let aggregated_json = serde_json::to_string(&aggregated).map_err(|e| {
format!("序列化 FanOut 汇聚结果失败: {e}").replace('\\', "/")
})?;
scratchpad.write_text("fanout:results", &aggregated_json);
prev_output = fanout_results
.last()
.map(|(_, text)| text.clone())
.unwrap_or_default();
}
NodeInput::FanOutAssembly => {
// 汇聚节点：把各槽位按分镜序交给装配阶段缝合（与旧导演装配
// 输入格式逐字一致），定稿写入 Scratchpad `final`。
if fanout_results.is_empty() {
return Err(
"汇聚节点执行时 FanOut 结果为空：没有可装配的演员产出（C2 显式报错）"
.to_string(),
);
}
let mut assembly_input =
String::from("以下各镜头的演出成品（按 slot_id 顺序）：\n\n");
for (slot_id, text) in &fanout_results {
assembly_input.push_str(&format!("【{}】\n{}\n\n", slot_id, text));
}
assembly_input.push_str(
"请把以上镜头缝合成一整段顺畅的正文。保持每个镜头已发生的事实不变，不要新增事实。",
);
let final_text = call_stage(
stage_cfg,
stage_label,
stage_cfg.prompt.clone(),
assembly_input,
scratchpad.clone(),
)
.await?;
scratchpad.write_text("final", &final_text);
scratchpad.write_text(stage_key, &final_text);
scratchpad.write_text(&stage_cfg.stage, &final_text);
return Ok(final_text);
}
NodeInput::PreviousOutput => {
let mut output = call_stage(
stage_cfg,
stage_label.clone(),
stage_cfg.prompt.clone(),
prev_output.clone(),
scratchpad.clone(),
)
.await?;

if let Some(back_edge) = &node.back_edge {
// 质量门禁节点：裁决解析 + 回边打回循环（局部计数器）。
let max_loops = back_edge.max_loop_count;
let mut loop_count = 0u32;
let mut verdict = ReviewVerdict::parse(&output)?;
while verdict.is_rejected() {
let target_stage = &plan.nodes[back_edge.target_node].stage;
loop_count += 1;
let loop_state = RejectionLoopState {
loop_id: format!("{}_{}", stage_cfg.stage, target_stage.stage),
current_iteration: loop_count,
max_iterations: max_loops,
last_critique: Some(output.clone()),
};
let loop_state_json = serde_json::to_string(&loop_state).map_err(|e| {
format!("序列化 rejection_loop_state 失败: {e}").replace('\\', "/")
})?;
scratchpad.write_text("rejection_loop_state", &loop_state_json);
scratchpad.write_text(
&format!("{}.rejection_loop_state", stage_cfg.stage),
&loop_state_json,
);
on_rejection(&loop_state);

if loop_count > max_loops {
// 熔断：沿 Exec 出边走终结路径；无后继 = 无路可走，
// 显式 BudgetExceeded 报错（工单 03 第 4 项，C2）。
if node.on_success.is_none() {
return Err(format!(
"BudgetExceeded：质量门禁节点 {} 的打回循环已达上限 {} 次且计划未定义终结路径，编排熔断终止",
stage_cfg.stage, max_loops
));
}
scratchpad.write_text("circuit_breaker_tripped", "true");
scratchpad.write_text(
&format!("{}.circuit_breaker_tripped", stage_cfg.stage),
"true",
);
crate::dbg_eprintln!(
"[graph-orchestrator] 节点 {} 打回循环触发熔断（已达上限 {} 次），沿 Exec 出边安全推进",
stage_cfg.stage,
max_loops
);
accumulated_critiques.push((
stage_cfg.stage.clone(),
format!(
"【熔断保护生效】已达最大打回次数 {} 次，强制推进至润色阶段。\n最后审阅意见：{}",
max_loops, output
),
));
break;
}

// 反馈注入协议：{feedback} 与 {stage_id.critique}
scratchpad.write_text("feedback", &output);
scratchpad.write_text(&format!("{}.critique", stage_cfg.stage), &output);

// 沿回边重跑目标节点（Data 引脚：反馈 + 原始输入）
let target_label =
format!("阶段 {} (打回重写 #{})", target_stage.stage, loop_count);
let revision_input = format!(
"{}\n\n【审阅打回意见 · 第 {} 次打回】\n{}\n\n请严格依据上述打回意见对草稿进行全面修正重写。",
user_input, loop_count, output
);
let revised_draft = call_stage(
target_stage,
target_label,
target_stage.prompt.clone(),
revision_input,
scratchpad.clone(),
)
.await?;
scratchpad.write_text("draft", &revised_draft);
scratchpad.write_text(&target_stage.stage, &revised_draft);
if!target_stage.workspace_key.trim().is_empty() {
scratchpad
.write_text(target_stage.workspace_key.trim(), &revised_draft);
}
prev_output = revised_draft;

// 回到门禁节点复审
output = call_stage(
stage_cfg,
format!("{} (复审 #{})", stage_label, loop_count),
stage_cfg.prompt.clone(),
prev_output.clone(),
scratchpad.clone(),
)
.await?;
verdict = ReviewVerdict::parse(&output)?;
}

if verdict == ReviewVerdict::Approved {
scratchpad.write_text("feedback", "");
accumulated_critiques.push((stage_cfg.stage.clone(), output.clone()));
}
} else {
// 无回边的接力节点：产出含打回标记却无处可回 = 配置与裁决
// 矛盾，当场报错，禁止静默吞没（C2 零静默回退）。
if ReviewVerdict::is_rejected_text(&output) {
return Err(format!(
"阶段 {} 判定打回重写，但未配置 reject_target（C2 严禁隐式回退）",
stage_cfg.stage
));
}
accumulated_critiques.push((stage_cfg.stage.clone(), output.clone()));
prev_output = output.clone();
}

scratchpad.write_text(stage_key, &output);
scratchpad.write_text(&stage_cfg.stage, &output);
}
NodeInput::AnchorBlackout => {
// 恰好 1 个中间产出时写 "critique" 别名（向后兼容旧读取方）。
if accumulated_critiques.len() == 1 {
scratchpad.write_text("critique", &accumulated_critiques[0].1);
}

// 尾锚：只保留初稿末尾 N 字，头部用涂黑标记，避免重写既有事实。
// 工作区初稿是唯一真相源：读取失败（初稿未产出 / 锁中毒）一律显性
// 报错，禁止回退到本地缓存或空串静默续跑（C2 零静默回退；code-review
// 2026-11-11 Standards 轴硬违规修正）。
let draft_content = scratchpad.read_text("draft").map_err(|err| {
format!(
"尾锚节点读取工作区初稿失败（stage={}）：{err}",
stage_cfg.stage
)
})?;
let tail_anchor: String = {
let chars: Vec<char> = draft_content.chars().collect();
let start = chars.len().saturating_sub(plan.anchor_tail_chars as usize);
chars[start..].iter().collect()
};

let mut refine_user = format!("{}\n{tail_anchor}\n\n", plan.blackout_marker);
if!accumulated_critiques.is_empty() {
if accumulated_critiques.len() == 1 {
refine_user.push_str(&format!(
"\n{}\n\n",
accumulated_critiques[0].1
));
} else {
for (stage_name, critique_text) in &accumulated_critiques {
refine_user.push_str(&format!(
"【批注意见 · {}】\n{}\n\n", stage_name, critique_text
));
}
}
refine_user.push_str(
"请依据批注重写这一段，保持剧情走向与已完成的事实不变，只输出重写后的正文。",
);
} else {
refine_user.push_str(
"请依据要求润色这一段，保持剧情走向与已完成的事实不变，只输出重写后的正文。",
);
}

let final_text = call_stage(
stage_cfg,
stage_label,
stage_cfg.prompt.clone(),
refine_user,
scratchpad.clone(),
)
.await?;
scratchpad.write_text("final", &final_text);
scratchpad.write_text(stage_key, &final_text);
scratchpad.write_text(&stage_cfg.stage, &final_text);
return Ok(final_text);
}
}

// 沿 Exec 出边推进；非终结节点在编译期保证有后继。
cursor = node.on_success.ok_or_else(|| {
format!(
"编排计划拓扑损坏：节点 {} 无 Exec 出边且不是终结节点",
stage_cfg.stage
)
})?;
}
}

#[cfg(test)]
mod tests {
use super::*;

fn stage(name: &str, key: &str) -> ScriptwriterStage {
ScriptwriterStage {
stage: name.to_string(),
workspace_key: key.to_string(),
prompt: format!("{name} 提示词"),
tools: vec![],
tool_permissions: None,
reject_target: None,
max_loop_count: None,
}
}

fn config(stages: Vec<ScriptwriterStage>) -> ScriptwriterPipelineConfig {
ScriptwriterPipelineConfig {
anchor_tail_chars: 20,
blackout_marker: "【背景锁定】".to_string(),
stages,
is_locked: false,
}
}

#[test]
fn test_compile_builds_edges_and_back_edge() {
let mut critic = stage("critic", "critique");
critic.reject_target = Some("draft".to_string());
critic.max_loop_count = Some(3);
let plan = compile_scriptwriter_plan(&config(vec![
stage("draft", "draft"),
critic,
stage("polish", "final"),
]))
.expect("compile");

assert_eq!(plan.nodes.len(), 3);
assert_eq!(plan.entry, 0);
assert_eq!(plan.nodes[0].input, NodeInput::UserInput);
assert_eq!(plan.nodes[0].on_success, Some(1));
assert!(plan.nodes[0].back_edge.is_none());
assert_eq!(plan.nodes[1].input, NodeInput::PreviousOutput);
assert_eq!(plan.nodes[1].on_success, Some(2));
let back = plan.nodes[1].back_edge.as_ref().expect("gate back edge");
assert_eq!(back.target_node, 0);
assert_eq!(back.max_loop_count, 3);
assert_eq!(plan.nodes[2].input, NodeInput::AnchorBlackout);
assert_eq!(plan.nodes[2].on_success, None);
}

#[test]
fn test_compile_rejects_insufficient_stages() {
let err = compile_scriptwriter_plan(&config(vec![])).expect_err("empty must fail");
assert!(err.contains("未配置阶段资产"));
let err = compile_scriptwriter_plan(&config(vec![stage("draft", "draft")]))
.expect_err("single stage must fail");
assert!(err.contains("至少需要 2 个阶段"));
}

#[test]
fn test_compile_rejects_unknown_reject_target() {
let mut critic = stage("critic", "critique");
critic.reject_target = Some("non_existent_stage".to_string());
critic.max_loop_count = Some(2);
let err = compile_scriptwriter_plan(&config(vec![
stage("draft", "draft"),
critic,
stage("polish", "final"),
]))
.expect_err("unknown reject target must fail at compile time");
assert!(err.contains("不存在于流水线阶段列表中"));
}

#[tokio::test]
async fn test_plan_two_stages_topology() {
let plan = compile_scriptwriter_plan(&config(vec![
stage("draft", "draft"),
stage("refiner", "final"),
]))
.expect("compile");
let scratchpad = Scratchpad::new();
let executed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
let executed_clone = executed.clone();

let final_result = execute_orchestration_plan(
&plan,
"玩家探索走廊",
&scratchpad,
move |_cfg, label, _instruction, payload, pad| {
let executed = executed_clone.clone();
async move {
executed.lock().unwrap().push(label.clone());
if label.contains("draft") {
Ok("幽暗的走廊里有微弱的灯光".to_string())
} else {
assert!(payload.contains("【背景锁定】"));
assert!(payload.contains("幽暗的走廊里有微弱的灯光"));
assert!(!payload.contains("【批注意见】"));
let prev_draft = pad.read_text("draft").expect("read draft in final");
assert_eq!(prev_draft, "幽暗的走廊里有微弱的灯光");
Ok("幽暗的走廊深处，微弱灯光若隐若现。".to_string())
}
}
},
|_state| {},
)
.await
.expect("plan execution success");

assert_eq!(final_result, "幽暗的走廊深处，微弱灯光若隐若现。");
assert_eq!(executed.lock().unwrap().len(), 2);
assert_eq!(scratchpad.read_text("draft").unwrap(), "幽暗的走廊里有微弱的灯光");
assert_eq!(scratchpad.read_text("final").unwrap(), "幽暗的走廊深处，微弱灯光若隐若现。");
}

#[tokio::test]
async fn test_anchor_blackout_without_draft_errors() {
    // C2 回归（code-review 2026-11-11）：尾锚节点执行时工作区中没有
    // 初稿，必须显性报错，禁止回退到空串/本地缓存静默续跑。
    // 手工构造计划：入口为接力节点（不写入 draft），终结为尾锚节点。
    let plan = OrchestrationPlan {
        nodes: vec![
            PlanNode {
                stage: stage("relay", "relay_out"),
                on_success: Some(1),
                back_edge: None,
                input: NodeInput::PreviousOutput,
                kind: PlanNodeKind::Standard,
            },
            PlanNode {
                stage: stage("refiner", "final"),
                on_success: None,
                back_edge: None,
                input: NodeInput::AnchorBlackout,
                kind: PlanNodeKind::Standard,
            },
        ],
        entry: 0,
        anchor_tail_chars: 10,
        blackout_marker: "【背景锁定】".to_string(),
    };
    let scratchpad = Scratchpad::new();
    let err = execute_orchestration_plan(
        &plan,
        "玩家探索走廊",
        &scratchpad,
        |_cfg, _label, _instruction, _payload, _pad| async move {
            Ok("接力产出正文".to_string())
        },
        |_state| {},
    )
    .await
    .expect_err("anchor blackout without draft must fail explicitly");
    assert!(err.contains("读取工作区初稿失败"), "实际: {err}");
    assert!(scratchpad.read_text("final").is_err());
}

    #[tokio::test]
    async fn test_plan_four_stage_relay_topology() {
        // 纯图拓扑示例（工单 03 第 5 项）：大纲 → 初稿 → 批注 → 定稿四节点串联，
        // 中间产出经 Data 引脚（Scratchpad + prev_output）逐级传递，终结节点收到
        // 尾锚装配与累积批注。
        let plan = compile_scriptwriter_plan(&ScriptwriterPipelineConfig {
            anchor_tail_chars: 30,
            blackout_marker: "【前情锁定】".to_string(),
            is_locked: false,
            stages: vec![
                stage("outline", "outline"),
                stage("draft", "draft_content"),
                stage("critique", "critique_notes"),
                stage("polish", "final"),
            ],
        })
        .expect("compile");
        let scratchpad = Scratchpad::new();
        let executed = std::sync::Arc::new(std::sync::Mutex::new(0usize));
        let executed_clone = executed.clone();

        let final_result = execute_orchestration_plan(
            &plan,
            "调查失窃的秘宝",
            &scratchpad,
            move |_cfg, label, _instruction, payload, pad| {
                let executed = executed_clone.clone();
                async move {
                    *executed.lock().unwrap() += 1;
                    if label.contains("outline") {
                        assert_eq!(payload, "调查失窃的秘宝");
                        Ok("大纲：密室现场、窗户破损、神秘足迹".to_string())
                    } else if label.contains("draft") {
                        assert_eq!(payload, "大纲：密室现场、窗户破损、神秘足迹");
                        Ok("探长推开沉重的木门，密室内一片狼藉，窗框上残留着神秘的灰烬。".to_string())
                    } else if label.contains("critique") {
                        assert!(payload.contains("探长推开沉重的木门"));
                        Ok("批注：增加对足迹走向的描写。".to_string())
                    } else {
                        assert!(payload.contains("【前情锁定】"));
                        assert!(
                            payload.contains("【批注意见 · draft】")
                                || payload.contains("【批注意见 · critique】")
                        );
                        assert!(payload.contains("增加对足迹走向的描写。"));
                        assert!(pad.read_text("outline").is_ok());
                        assert!(pad.read_text("draft_content").is_ok());
                        assert!(pad.read_text("critique_notes").is_ok());
                        Ok("探长推开沉重的橡木门，密室内一片狼藉，一行灰白足迹直指破碎的窗棂。".to_string())
                    }
                }
            },
            |_state| {},
        )
        .await
        .expect("execute 4 stages");

        assert_eq!(
            final_result,
            "探长推开沉重的橡木门，密室内一片狼藉，一行灰白足迹直指破碎的窗棂。"
        );
        assert_eq!(*executed.lock().unwrap(), 4);
        assert_eq!(scratchpad.read_text("outline").unwrap(), "大纲：密室现场、窗户破损、神秘足迹");
        assert_eq!(
            scratchpad.read_text("draft_content").unwrap(),
            "探长推开沉重的木门，密室内一片狼藉，窗框上残留着神秘的灰烬。"
        );
        assert_eq!(scratchpad.read_text("critique_notes").unwrap(), "批注：增加对足迹走向的描写。");
        assert_eq!(scratchpad.read_text("final").unwrap(), final_result);
    }

    #[tokio::test]
    async fn test_plan_rejection_loop_and_circuit_breaker() {
let mut critic = stage("critic", "critique");
critic.reject_target = Some("draft".to_string());
critic.max_loop_count = Some(2);
let plan = compile_scriptwriter_plan(&config(vec![
stage("draft", "draft"),
critic,
stage("polish", "final"),
]))
.expect("compile");

let scratchpad = Scratchpad::new();
let draft_invocations = std::sync::Arc::new(std::sync::Mutex::new(0usize));
let critic_invocations = std::sync::Arc::new(std::sync::Mutex::new(0usize));
let received_feedbacks = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
let d_clone = draft_invocations.clone();
let c_clone = critic_invocations.clone();
let f_clone = received_feedbacks.clone();

let final_result = execute_orchestration_plan(
&plan,
"探索古代遗迹",
&scratchpad,
move |_cfg, label, _instruction, _payload, pad| {
let d = d_clone.clone();
let c = c_clone.clone();
let f = f_clone.clone();
async move {
if label.contains("draft") {
let mut count = d.lock().unwrap();
*count += 1;
if let Ok(fb) = pad.read_text("feedback") {
if!fb.is_empty() {
f.lock().unwrap().push(fb);
}
}
Ok(format!("遗迹初稿版本 #{}", *count))
} else if label.contains("critic") {
let mut count = c.lock().unwrap();
*count += 1;
Ok(format!("[REJECT] 审核不通过 #{}: 描写不够生动", *count))
} else {
assert!(pad.read_text("circuit_breaker_tripped").is_ok());
Ok("遗迹终稿定案".to_string())
}
}
},
|_state| {},
)
.await
.expect("plan with circuit breaker must complete via termination path");

assert_eq!(final_result, "遗迹终稿定案");
assert_eq!(*draft_invocations.lock().unwrap(), 3);
assert_eq!(*critic_invocations.lock().unwrap(), 3);
let feedbacks = received_feedbacks.lock().unwrap();
assert_eq!(feedbacks.len(), 2);
assert!(feedbacks[0].contains("[REJECT] 审核不通过 #1"));
assert!(feedbacks[1].contains("[REJECT] 审核不通过 #2"));
assert_eq!(scratchpad.read_text("circuit_breaker_tripped").unwrap(), "true");
assert_eq!(scratchpad.read_text("critic.circuit_breaker_tripped").unwrap(), "true");
let loop_state_raw = scratchpad
.read_text("rejection_loop_state")
.expect("rejection_loop_state in scratchpad");
let loop_state: RejectionLoopState =
serde_json::from_str(&loop_state_raw).expect("valid RejectionLoopState JSON");
assert_eq!(loop_state.loop_id, "critic_draft");
assert_eq!(loop_state.max_iterations, 2);
assert!(loop_state.current_iteration > 0);
assert!(loop_state.last_critique.is_some());
}

#[tokio::test]
async fn test_plan_rejection_success_after_revision() {
let mut critic = stage("critic", "critique");
critic.reject_target = Some("draft".to_string());
critic.max_loop_count = Some(2);
let plan = compile_scriptwriter_plan(&config(vec![
stage("draft", "draft"),
critic,
stage("polish", "final"),
]))
.expect("compile");

let scratchpad = Scratchpad::new();
let critic_count = std::sync::Arc::new(std::sync::Mutex::new(0usize));
let c_clone = critic_count.clone();

let final_result = execute_orchestration_plan(
&plan,
"调查现场",
&scratchpad,
move |_cfg, label, _instruction, payload, _pad| {
let c = c_clone.clone();
async move {
if label.contains("draft") {
if payload.contains("【审阅打回意见") {
Ok("修正后的初稿：包含更多细节".to_string())
} else {
Ok("初始初稿".to_string())
}
} else if label.contains("critic") {
let mut count = c.lock().unwrap();
*count += 1;
if *count == 1 {
Ok("[REJECT] 细节不足，打回修正".to_string())
} else {
Ok("[APPROVE] 合格通过，细节描写充分".to_string())
}
} else {
Ok("最终定稿".to_string())
}
}
},
|_state| {},
)
.await
.expect("plan should succeed after revision");

assert_eq!(*critic_count.lock().unwrap(), 2);
assert!(scratchpad.read_text("circuit_breaker_tripped").is_err());
assert_eq!(final_result, "最终定稿");
}

#[tokio::test]
async fn test_plan_reject_without_back_edge_fails() {
// critic 未配置 reject_target（编译为无回边接力节点），却输出打回裁决
let plan = compile_scriptwriter_plan(&config(vec![
stage("draft", "draft"),
stage("critic", "critique"),
stage("polish", "final"),
]))
.expect("compile");
let scratchpad = Scratchpad::new();
let err = execute_orchestration_plan(
&plan,
"测试未配置打回目标",
&scratchpad,
|_cfg, label, _i, _p, _pad| async move {
if label.contains("critic") {
Ok("[REJECT] 驳回未配置目标".to_string())
} else {
Ok("稿件内容".to_string())
}
},
|_state| {},
)
.await
.expect_err("reject without back edge must fail (C2)");
assert!(err.contains("未配置 reject_target（C2 严禁隐式回退）"));
}

#[tokio::test]
async fn test_plan_rejection_hook_receives_loop_state() {
let mut critic = stage("critic", "critique");
critic.reject_target = Some("draft".to_string());
critic.max_loop_count = Some(1);
let plan = compile_scriptwriter_plan(&config(vec![
stage("draft", "draft"),
critic,
stage("polish", "final"),
]))
.expect("compile");
let scratchpad = Scratchpad::new();
let hook_calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
let h_clone = hook_calls.clone();

let _ = execute_orchestration_plan(
&plan,
"测试钩子",
&scratchpad,
|_cfg, label, _i, _p, _pad| async move {
if label.contains("critic") {
Ok("[REJECT] 不及格".to_string())
} else {
Ok("稿件内容".to_string())
}
},
move |loop_state: &RejectionLoopState| {
h_clone.lock().unwrap().push(loop_state.clone());
},
)
.await;

let calls = hook_calls.lock().unwrap();
assert!(!calls.is_empty());
assert_eq!(calls[0].loop_id, "critic_draft");
assert_eq!(calls[0].current_iteration, 1);
assert_eq!(calls[0].max_iterations, 1);
assert!(calls[0].last_critique.as_deref().unwrap().contains("[REJECT]"));
}

#[tokio::test]
async fn test_plan_terminal_gate_budget_exceeded() {
// 手工构造非法拓扑：终结节点同时是门禁（编译器不会产出这种计划，
// 执行器必须以 BudgetExceeded 显式熔断而非死循环）。
let mut gate = stage("critic", "critique");
gate.reject_target = Some("draft".to_string());
let plan = OrchestrationPlan {
nodes: vec![
PlanNode {
stage: stage("draft", "draft"),
on_success: Some(1),
back_edge: None,
input: NodeInput::UserInput,
kind: PlanNodeKind::Standard,
},
PlanNode {
stage: gate,
on_success: None,
back_edge: Some(BackEdge {
target_node: 0,
max_loop_count: 1,
}),
input: NodeInput::PreviousOutput,
kind: PlanNodeKind::Standard,
},
],
entry: 0,
anchor_tail_chars: 20,
blackout_marker: "【背景锁定】".to_string(),
};
let scratchpad = Scratchpad::new();
let err = execute_orchestration_plan(
&plan,
"无终结路径",
&scratchpad,
|_cfg, label, _i, _p, _pad| async move {
if label.contains("critic") {
Ok("[REJECT] 永远不合格".to_string())
} else {
Ok("初稿".to_string())
}
},
|_state| {},
)
.await
.expect_err("terminal gate with exhausted loop must raise BudgetExceeded");
assert!(err.contains("BudgetExceeded"), "实际错误: {err}");
}

fn director_cfg() -> DirectorConfig {
DirectorConfig {
director_prompt: "把剧情拆成分镜 JSON".to_string(),
tools: vec![],
tool_permissions: None,
is_locked: false,
}
}

fn actor(name: &str, persona: &str) -> ActorDefinition {
ActorDefinition {
actor_name: name.to_string(),
persona: persona.to_string(),
tools: vec![],
tool_permissions: None,
is_locked: false,
}
}

#[test]
fn test_compile_director_plan_builds_fanout_topology() {
let plan = compile_director_plan(
&director_cfg(),
&[actor("侦探", "冷静的侦探"), actor("助手", "活泼的助手")],
)
.expect("compile director plan");

assert_eq!(plan.nodes.len(), 3);
assert_eq!(plan.entry, 0);
assert_eq!(plan.nodes[0].input, NodeInput::UserInput);
assert_eq!(plan.nodes[0].on_success, Some(1));
assert_eq!(plan.nodes[0].stage.prompt, "把剧情拆成分镜 JSON");
match &plan.nodes[0].kind {
PlanNodeKind::DirectorPlan { max_beats } => {
assert_eq!(*max_beats, MAX_DIRECTOR_BEATS)
}
other => panic!("导演节点种类错误: {other:?}"),
}
assert_eq!(plan.nodes[1].input, NodeInput::FanOutBeats);
assert_eq!(plan.nodes[1].on_success, Some(2));
match &plan.nodes[1].kind {
PlanNodeKind::FanOutActors { actors, max_beats } => {
assert_eq!(actors.len(), 2);
assert_eq!(*max_beats, MAX_DIRECTOR_BEATS);
}
other => panic!("FanOut 节点种类错误: {other:?}"),
}
assert_eq!(plan.nodes[2].input, NodeInput::FanOutAssembly);
assert_eq!(plan.nodes[2].on_success, None);
}

#[test]
fn test_compile_director_plan_rejects_duplicate_actor_names() {
let err = compile_director_plan(
&director_cfg(),
&[actor("侦探", "甲"), actor("侦探", "乙")],
)
.expect_err("duplicate actor names must fail at compile time");
assert!(err.contains("actor_name 重复"), "实际: {err}");
let err = compile_director_plan(&director_cfg(), &[actor("  ", "甲")])
.expect_err("empty actor name must fail at compile time");
assert!(err.contains("actor_name 为空"), "实际: {err}");
}

#[tokio::test]
async fn test_fanout_single_beat_path() {
let plan = compile_director_plan(&director_cfg(), &[actor("侦探", "冷静的侦探")])
.expect("compile");
let scratchpad = Scratchpad::new();
let calls = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
let calls_clone = calls.clone();

let final_result = execute_orchestration_plan(
&plan,
"调查密室",
&scratchpad,
move |cfg, label, _instruction, _payload, _pad| {
let calls = calls_clone.clone();
let stage_name = cfg.stage.clone();
let stage_prompt = cfg.prompt.clone();
async move {
calls.lock().unwrap().push(label.clone());
if stage_name == "director:plan" {
Ok(r#"{"beats":[{"slot_id":"b1","character":"侦探","focus":"观察现场"}]}"#
.to_string())
} else if stage_name.starts_with("actor:") {
assert_eq!(stage_prompt, "冷静的侦探");
Ok("侦探蹲下身，端详着窗框上的灰烬。".to_string())
} else {
Ok("定稿：侦探端详灰烬，心中有数。".to_string())
}
}
},
|_state| {},
)
.await
.expect("fanout single beat must succeed");

assert_eq!(final_result, "定稿：侦探端详灰烬，心中有数。");
let labels = calls.lock().unwrap();
assert_eq!(labels.len(), 3);
assert_eq!(labels[1], "演员 b1");
assert_eq!(
scratchpad.read_text("actor:b1").unwrap(),
"侦探蹲下身，端详着窗框上的灰烬。"
);
let results: Vec<Value> =
serde_json::from_str(&scratchpad.read_text("fanout:results").unwrap())
.expect("fanout results json");
assert_eq!(results.len(), 1);
assert_eq!(results[0]["slot_id"], "b1");
assert_eq!(scratchpad.read_text("final").unwrap(), final_result);
}

#[tokio::test]
async fn test_fanout_multiple_beats_order_and_aggregation() {
let plan = compile_director_plan(
&director_cfg(),
&[actor("侦探", "冷静的侦探"), actor("助手", "活泼的助手")],
)
.expect("compile");
let scratchpad = Scratchpad::new();

let final_result = execute_orchestration_plan(
&plan,
"调查密室",
&scratchpad,
|cfg, _label, _instruction, payload, _pad| {
let stage_name = cfg.stage.clone();
let stage_prompt = cfg.prompt.clone();
async move {
if stage_name == "director:plan" {
Ok(r#"{"beats":[
{"slot_id":"s2","character":"助手","focus":"惊呼出声"},
{"slot_id":"s1","character":"侦探","focus":"观察现场"},
{"slot_id":"s3","focus":"门外脚步声"}
]}"#
.to_string())
} else if stage_name == "actor:s2" {
assert!(!payload.contains("【本轮前序分镜演出】"));
Ok("助手惊呼：窗户是开着的！".to_string())
} else if stage_name == "actor:s1" {
assert!(payload.contains("【本轮前序分镜演出】"));
assert!(payload.contains("分镜 s2:"));
assert!(payload.contains("助手惊呼：窗户是开着的！"));
Ok("侦探观察现场后微微点头。".to_string())
} else if stage_name == "actor:s3" {
assert_eq!(stage_prompt, "");
Ok("门外传来渐近的脚步声。".to_string())
} else {
// 汇聚节点：装配输入按分镜序（s2 → s1 → s3）排列
let s2 = payload.find("助手惊呼").expect("s2 text in assembly");
let s1 = payload.find("侦探观察").expect("s1 text in assembly");
let s3 = payload.find("门外传来").expect("s3 text in assembly");
assert!(s2 < s1 && s1 < s3, "汇聚输入必须按分镜序: {payload}");
Ok("汇聚定稿".to_string())
}
}
},
|_state| {},
)
.await
.expect("fanout multiple beats must succeed");

assert_eq!(final_result, "汇聚定稿");
let results: Vec<Value> =
serde_json::from_str(&scratchpad.read_text("fanout:results").unwrap())
.expect("fanout results json");
assert_eq!(results.len(), 3);
let order: Vec<&str> = results
.iter()
.map(|r| r["slot_id"].as_str().expect("slot_id"))
.collect();
assert_eq!(order, vec!["s2", "s1", "s3"]);
assert_eq!(results[0]["text"], "助手惊呼：窗户是开着的！");
assert_eq!(results[2]["text"], "门外传来渐近的脚步声。");
}

#[tokio::test]
async fn test_fanout_unmatched_character_signals_visible_degradation() {
// 回归（code-review 第二轮 Standards 轴硬违规）：分镜 character 未命中
// 任何 ActorDefinition 时，降级演出不得静默——执行器须经 Scratchpad
// `fanout:actor_def_missed` 显式信号明示（该信号与 dbg_eprintln! 日志
// 在同一未命中分支产出，断言信号即证明日志钩子路径被执行）；降级不
// 丢镜、不打死整个计划，命中镜的信号与 persona 保持原样。
let plan = compile_director_plan(&director_cfg(), &[actor("侦探", "冷静的侦探")])
.expect("compile");
let scratchpad = Scratchpad::new();
let observed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
let observed_clone = observed.clone();

let final_result = execute_orchestration_plan(
&plan,
"调查密室",
&scratchpad,
move |cfg, _label, _instruction, _payload, pad| {
let observed = observed_clone.clone();
let stage_name = cfg.stage.clone();
let stage_prompt = cfg.prompt.clone();
async move {
if stage_name == "director:plan" {
Ok(r#"{"beats":[
{"slot_id":"b1","character":"侦探","focus":"观察现场"},
{"slot_id":"b2","character":"管家","focus":"端茶入场"}
]}"#
.to_string())
} else if stage_name.starts_with("actor:") {
let missed = pad.read_text("fanout:actor_def_missed").unwrap();
observed
.lock()
.unwrap()
.push((stage_name.clone(), stage_prompt, missed));
Ok(format!("{stage_name} 演出"))
} else {
Ok("汇聚定稿".to_string())
}
}
},
|_state| {},
)
.await
.expect("unmatched character must degrade visibly, not fail the plan");

assert_eq!(final_result, "汇聚定稿");
let observed = observed.lock().unwrap();
assert_eq!(observed.len(), 2);
// 命中镜：信号 false，persona 原样下发
assert_eq!(observed[0].0, "actor:b1");
assert_eq!(observed[0].1, "冷静的侦探");
assert_eq!(observed[0].2, "false");
// 未命中镜：信号 true（显式降级），演出输入为降级形状（空 persona）
assert_eq!(observed[1].0, "actor:b2");
assert_eq!(observed[1].1, "");
assert_eq!(observed[1].2, "true");
drop(observed);
// 降级镜产出照常进入汇聚结果（降级 ≠ 丢弃）
let results: Vec<Value> =
serde_json::from_str(&scratchpad.read_text("fanout:results").unwrap())
.expect("fanout results json");
assert_eq!(results.len(), 2);
assert_eq!(results[1]["slot_id"], "b2");
}

#[tokio::test]
async fn test_fanout_actor_failure_errors_with_location() {
let plan = compile_director_plan(
&director_cfg(),
&[actor("侦探", "冷静的侦探"), actor("助手", "活泼的助手")],
)
.expect("compile");
let scratchpad = Scratchpad::new();

let err = execute_orchestration_plan(
&plan,
"调查密室",
&scratchpad,
|cfg, _label, _i, _p, _pad| {
let stage_name = cfg.stage.clone();
async move {
if stage_name == "director:plan" {
Ok(r#"{"beats":[
{"slot_id":"b1","character":"侦探","focus":"观察现场"},
{"slot_id":"b2","character":"助手","focus":"汇报发现"},
{"slot_id":"b3","character":"侦探","focus":"作出推理"}
]}"#
.to_string())
} else if stage_name == "actor:b2" {
Err("模型调用超时".to_string())
} else {
Ok("演出文本".to_string())
}
}
},
|_state| {},
)
.await
.expect_err("actor failure must fail the whole plan (C2)");

assert!(err.contains("FanOut 演员执行失败"), "实际: {err}");
assert!(err.contains("分镜 2/3"), "实际: {err}");
assert!(err.contains("slot_id=b2"), "实际: {err}");
assert!(err.contains("character=助手"), "实际: {err}");
assert!(err.contains("模型调用超时"), "实际: {err}");
// 失败镜之前的产出保留在 Scratchpad，失败镜与之后不得有产出
assert_eq!(scratchpad.read_text("actor:b1").unwrap(), "演出文本");
assert!(scratchpad.read_text("actor:b2").is_err());
assert!(scratchpad.read_text("fanout:results").is_err());
}

#[tokio::test]
async fn test_fanout_empty_beats_errors() {
let plan = compile_director_plan(&director_cfg(), &[]).expect("compile");
let scratchpad = Scratchpad::new();
let err = execute_orchestration_plan(
&plan,
"调查密室",
&scratchpad,
|cfg, _label, _i, _p, _pad| {
let stage_name = cfg.stage.clone();
async move {
if stage_name == "director:plan" {
Ok(r#"{"beats": []}"#.to_string())
} else {
Ok("不应被调用".to_string())
}
}
},
|_state| {},
)
.await
.expect_err("empty beats must fail explicitly (C2)");
assert!(err.contains("beats 为空"), "实际: {err}");
assert!(scratchpad.read_text("fanout:results").is_err());
}

#[tokio::test]
async fn test_fanout_without_director_beats_errors() {
// 手工构造计划：FanOut 节点直接作入口（无导演节点供数），执行器必须
// 以「分镜集为空」显式报错，不得以空扇出静默续跑到汇聚节点。
let plan = OrchestrationPlan {
nodes: vec![
PlanNode {
stage: stage("actor", "fanout:actors"),
on_success: Some(1),
back_edge: None,
input: NodeInput::FanOutBeats,
kind: PlanNodeKind::FanOutActors {
actors: vec![],
max_beats: MAX_DIRECTOR_BEATS,
},
},
PlanNode {
stage: stage("director:assembly", "final"),
on_success: None,
back_edge: None,
input: NodeInput::FanOutAssembly,
kind: PlanNodeKind::Standard,
},
],
entry: 0,
anchor_tail_chars: 0,
blackout_marker: String::new(),
};
let scratchpad = Scratchpad::new();
let err = execute_orchestration_plan(
&plan,
"调查密室",
&scratchpad,
|_cfg, _label, _i, _p, _pad| async move { Ok("不应被调用".to_string()) },
|_state| {},
)
.await
.expect_err("fanout without beats must fail explicitly (C2)");
assert!(err.contains("分镜集为空"), "实际: {err}");
}

#[tokio::test]
async fn test_fanout_beats_over_limit_errors() {
let plan = compile_director_plan(&director_cfg(), &[]).expect("compile");
let scratchpad = Scratchpad::new();
let beats_json = {
let mut beats = String::from(r#"{"beats":["#);
for i in 0..(MAX_DIRECTOR_BEATS + 1) {
if i > 0 {
beats.push(',');
}
beats.push_str(&format!(
r#"{{"slot_id":"b{}","focus":"镜头{}"}}"#,
i + 1,
i + 1
));
}
beats.push_str("]}");
beats
};

let err = execute_orchestration_plan(
&plan,
"调查密室",
&scratchpad,
move |cfg, _label, _i, _p, _pad| {
let beats_json = beats_json.clone();
let stage_name = cfg.stage.clone();
async move {
if stage_name == "director:plan" {
Ok(beats_json)
} else {
Ok("演出文本".to_string())
}
}
},
|_state| {},
)
.await
.expect_err("beats over limit must fail explicitly (C2)");
assert!(err.contains("FanOut 扇出超限"), "实际: {err}");
assert!(err.contains(&MAX_DIRECTOR_BEATS.to_string()), "实际: {err}");
}
}
