//! ToolCall 拓扑的**编译产物**与确定性执行器。
//!
//! 计划 §5 把 ToolCall 的规则与运算放在蓝图里：`ToolDefinition` 声明契约，
//! `Calculator` 做数值/容器运算，`ConditionGate` 做门禁，`ToolReturn` 装配回执。
//! 编译期由 `blueprint_executor` 沿该 ToolDefinition 的 `out`/`pass` 边收集出一条
//! **线性步骤链**（[`ToolPlan`]），运行期由 [`run_tool_plan`] 在真实 `DataContainer` 上执行。
//!
//! 设计要点：
//! - 门禁拦截**不是错误**，而是 [`ToolOutcome::is_blocked`] 的正常返回值——拦截理由要原样
//!   回传给大模型继续生成（计划 §5.3 的 blocked 出口）；
//! - 执行失败（操作数无法解析、扣减不存在物品等）才返回 `Err`，由上层包成
//!   `tool_result(is_error=true)` 回注，绝不静默吞掉（C2）。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::models::blueprint::{
    CalculatorConfig, ConditionGateConfig, InspectorConfig, QuerierConfig, ToolReturnConfig,
};
use crate::models::blueprint::WriterConfig;
use crate::models::game_state::{DataContainer, InventoryItem};

/// 步骤链里的一步。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "camelCase")]
pub enum ToolStep {
    /// 数值或容器运算
    Calculate(CalculatorConfig),
    /// 确定性门禁；判定不通过即整条链在此拦截
    Gate(ConditionGateConfig),
    /// 容器读原语：读取结果写入链上下文 `inspect`
    Inspect(InspectorConfig),
    /// 跨域读原语：白名单命令代理，结果写入链上下文 `query`
    Query(QuerierConfig),
    /// 工作区写原语（计划 §2.2）：模板渲染结果写入 scratchpad
    Write(WriterConfig),
}

/// 一条 ToolCall 契约的完整执行计划。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolPlan {
    pub tool_name: String,
    /// 沿 pass 路径收集到的有序步骤
    pub steps: Vec<ToolStep>,
    /// pass 路径末端的回执装配节点（可选）
    pub success_return: Option<ToolReturnConfig>,
    /// 契约的参数 JSON Schema（来自 ToolDefinition 节点），执行前用于校验入参
    #[serde(default)]
    pub parameters_schema: Option<String>,
}

/// 按契约 parameters_schema 校验入参（最小必需子集：`required` + 基本类型）。
///
/// 不引入完整 JSON Schema 实现：契约由创作者在蓝图里填写，实际用到的约束就是
/// 「哪些字段必须存在、是什么类型」。校验失败**报错**而不是放行——缺 `unit_price`
/// 还照常成交、扣 0 金币，比直接失败危害大得多（C2）。
pub fn validate_args_against_schema(
    args: &Value,
    schema_str: &str,
    tool_name: &str,
) -> Result<(), String> {
    let schema: Value = serde_json::from_str(schema_str)
        .map_err(|err| format!("契约 {} 的 parameters_schema 不是合法 JSON: {}", tool_name, err))?;
    let schema_obj = schema
        .as_object()
        .ok_or_else(|| format!("契约 {} 的 parameters_schema 必须是 JSON 对象", tool_name))?;

    let required = schema_obj
        .get("required")
        .and_then(|value| value.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let args_obj = args
        .as_object()
        .ok_or_else(|| format!("契约 {} 的参数必须是 JSON 对象", tool_name))?;

    for field in &required {
        if !args_obj.contains_key(field) {
            return Err(format!(
                "ToolCall `{}` 缺少必填参数 `{}`（契约 required: {}）",
                tool_name,
                field,
                required.join(", ")
            ));
        }
    }

    if let Some(properties) = schema_obj.get("properties").and_then(|value| value.as_object()) {
        for (field, spec) in properties {
            let Some(value) = args_obj.get(field) else {
                continue;
            };
            let Some(expected) = spec.get("type").and_then(|value| value.as_str()) else {
                continue;
            };
            let ok = match expected {
                "string" => value.is_string(),
                "number" => value.is_number(),
                "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
                "boolean" => value.is_boolean(),
                "array" => value.is_array(),
                "object" => value.is_object(),
                // 未知类型声明不猜：放行由具体工具语义兜底
                _ => true,
            };
            if !ok {
                return Err(format!(
                    "ToolCall `{}` 的参数 `{}` 类型应为 {}，实际为 {}",
                    tool_name,
                    field,
                    expected,
                    args_type_name(value)
                ));
            }
        }
    }

    Ok(())
}

/// 链内步骤上下文：Inspect / Query 的结构化结果（spec §2.0 上下文栈的链内两层）。
///
/// 同类步骤后执行者覆盖先执行者——模板引用的是最近一次读取。
#[derive(Debug, Default, Clone)]
pub struct StepContext {
    pub inspect: Option<Value>,
    pub query: Option<Value>,
}

impl StepContext {
    /// 合并为点路径求值用的 JSON：`{ args, stats, inspect, query }`。
    fn context_json(&self, args: &Value, state: &DataContainer) -> Value {
        let stats: serde_json::Map<String, Value> = state
            .stats
            .iter()
            .map(|(k, v)| (k.clone(), serde_json::json!(v)))
            .collect();
        serde_json::json!({
            "args": args,
            "stats": stats,
            "inspect": self.inspect,
            "query": self.query,
        })
    }
}

/// 点路径求值：`args.item_id` / `inspect.items.0.name` / `stats.gold` 等。
/// 逐段下钻：对象按键、数组按下标。路径不存在返回 None（调用方决定是否兜底）。
fn resolve_dotted(path: &str, ctx: &Value) -> Option<Value> {
    let mut current = ctx;
    for seg in path.split('.') {
        let seg = seg.trim();
        if seg.is_empty() {
            return None;
        }
        current = match current {
            Value::Object(map) => map.get(seg)?,
            Value::Array(arr) => arr.get(seg.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(current.clone())
}

/// 键表达式求值（Inspector 的 item / scratchpad 用）：裸点路径或 `{表达式}` 模板。
fn resolve_key_expr(
    expr: &str,
    args: &Value,
    state: &DataContainer,
    ctx: &StepContext,
) -> Result<String, String> {
    let expr = expr.trim();
    if expr.is_empty() {
        return Err("键表达式为空".to_string());
    }
    let path = expr
        .strip_prefix('{')
        .and_then(|rest| rest.strip_suffix('}'))
        .map(str::trim)
        .unwrap_or(expr);
    let ctx_json = ctx.context_json(args, state);
    resolve_dotted(path, &ctx_json)
        .and_then(|value| match value {
            Value::String(s) => Some(s),
            Value::Number(n) => Some(n.to_string()),
            _ => None,
        })
        .ok_or_else(|| format!("键表达式 `{expr}` 无法解析（支持 args / inspect / query / stats 前缀）"))
}

/// 上下文值的通用文本化：字符串原样、数字规整、数组逐行、对象 `k: v` 逐行。
/// 渲染是机制行为，不含任何业务格式化。
fn stringify_context_value(value: &Value) -> String {
    match value {
        Value::String(s) => s.clone(),
        Value::Number(n) => format_number(n.as_f64().unwrap_or(0.0)),
        Value::Bool(b) => b.to_string(),
        Value::Array(arr) => arr
            .iter()
            .map(stringify_context_value)
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => map
            .iter()
            .map(|(k, v)| format!("{k}: {}", stringify_context_value(v)))
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
    }
}

/// 字符串模板渲染：`{点路径}` 占位符逐个求值（路径必须能在上下文解析）。
fn render_string_template(template: &str, ctx_json: &Value) -> Result<String, String> {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let tail = &rest[start + 1..];
        let end = tail
            .find('}')
            .ok_or_else(|| format!("模板占位符未闭合: {template}"))?;
        let key = tail[..end].trim();
        match resolve_dotted(key, ctx_json) {
            Some(value) => out.push_str(&stringify_context_value(&value)),
            None => return Err(format!("模板占位符 `{key}` 无法解析")),
        }
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// 渲染 Querier 的命令参数模板：字符串值走 `{表达式}` 插值，其余值原样透传。
fn render_args_template(
    template: &serde_json::Map<String, Value>,
    args: &Value,
    state: &DataContainer,
    ctx: &StepContext,
) -> Result<Value, String> {
    let ctx_json = ctx.context_json(args, state);
    let mut out = serde_json::Map::with_capacity(template.len());
    for (key, value) in template {
        let rendered = match value {
            Value::String(s) => Value::String(render_string_template(s, &ctx_json)?),
            other => other.clone(),
        };
        out.insert(key.clone(), rendered);
    }
    Ok(Value::Object(out))
}
/// JSON 值的中文类型名（错误信息用）。
fn args_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "布尔",
        Value::Number(_) => "数字",
        Value::String(_) => "字符串",
        Value::Array(_) => "数组",
        Value::Object(_) => "对象",
    }
}

/// 一次工具执行的结局。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutcome {
    /// 回传给大模型的文本（成功回执或拦截理由）
    pub text: String,
    /// 是否被门禁拦截。拦截时数据容器**必须**保持未被本次调用修改。
    pub is_blocked: bool,
    /// 门禁判定轨迹（供时序泳道回放：门禁 → 表达式 → 结果）
    pub gate_trace: Vec<String>,
    /// 最近一次 d20 骰值（Some = 本链路含 d20 门禁；供不可篡改检定卡广播）
    pub dice_roll: Option<i64>,
}

impl ToolOutcome {
    pub fn success(text: impl Into<String>) -> Self {
        Self { text: text.into(), is_blocked: false, gate_trace: Vec::new(), dice_roll: None }
    }

    pub fn blocked(text: impl Into<String>) -> Self {
        Self { text: text.into(), is_blocked: true, gate_trace: Vec::new(), dice_roll: None }
    }
}

/// 解析操作数表达式。
///
/// 支持（按优先级从低到高）：
/// 1. 二元 `+` / `-`（左右递归求值）；
/// 2. 二元 `*` / `/` / `%`；
/// 3. 数值字面量；
/// 4. 变量：`args.<k>`（或裸 `<k>`，若该 key 在参数里）、`stats.<k>`、裸状态名（`gold`/`weight`/…）；
/// 5. 派生量：`count`（参数 count，缺省 1）、`total_cost` = `unit_price * count`、
///    `added_weight` = `unit_weight * count`。
///
/// 无法识别一律 `Err`——不做"未知当 0"的兜底，否则门禁会静默失效（C2）。
pub fn resolve_operand(expr: &str, args: &Value, state: &DataContainer) -> Result<f64, String> {
    let expr = expr.trim();
    if expr.is_empty() {
        return Err("操作数表达式为空".to_string());
    }
    if let Ok(value) = expr.parse::<f64>() {
        return Ok(value);
    }

    // 先低优先级（+ -），再高优先级（* / %），实现最简的两级优先级。
    let precedence: [&[char]; 2] = [&['+', '-'], &['*', '/', '%']];
    for ops in precedence {
        if let Some((left, op, right)) = split_binary(expr, ops) {
            let l = resolve_operand(left, args, state)?;
            let r = resolve_operand(right, args, state)?;
            return apply_binary(op, l, r);
        }
    }

    let arg_number = |key: &str| args.get(key).and_then(Value::as_f64);
    let required_arg = |key: &str| -> Result<f64, String> {
        arg_number(key).ok_or_else(|| {
            format!(
                "参数 `{}` 缺失或不是数值——请在契约 parameters_schema.required 中声明，并在调用时提供（C2 拒绝静默取 0/1）",
                key
            )
        })
    };
    match expr {
        "count" => required_arg("count"),
        "total_cost" => Ok(required_arg("unit_price")? * required_arg("count")?),
        "added_weight" => Ok(required_arg("unit_weight")? * required_arg("count")?),
        other => {
            let (prefix, key) = other
                .split_once('.')
                .map_or((None, other), |(p, k)| (Some(p), k));
            match prefix {
                Some("args") => arg_number(key)
                    .ok_or_else(|| format!("参数 `{}` 不存在或不是数值", key)),
                Some("stats") => Ok(state.get_stat(key)),
                Some(unknown) => Err(format!("不支持的操作数前缀 `{}`（支持 args / stats）", unknown)),
                None => arg_number(key)
                    .map(Ok)
                    .unwrap_or_else(|| Ok(state.get_stat(key))),
            }
        }
    }
}

/// 按给定运算符集合切分表达式（保留左结合，最右侧的运算符先切）。
fn split_binary<'a>(expr: &'a str, ops: &[char]) -> Option<(&'a str, char, &'a str)> {
    let bytes = expr.as_bytes();
    for idx in (1..bytes.len()).rev() {
        let ch = expr[idx..].chars().next()?;
        if !ops.contains(&ch) {
            continue;
        }
        // 跳过一元正负号：若运算符左侧不是数字/变量结尾，视为符号而非二元运算
        let left = expr[..idx].trim_end();
        if left.is_empty() {
            continue;
        }
        let prev = left.chars().last()?;
        if !(prev.is_alphanumeric() || prev == '_' || prev == ')') {
            continue;
        }
        let right = expr[idx + ch.len_utf8()..].trim();
        if right.is_empty() {
            continue;
        }
        return Some((left, ch, right));
    }
    None
}

fn apply_binary(op: char, left: f64, right: f64) -> Result<f64, String> {
    match op {
        '+' => Ok(left + right),
        '-' => Ok(left - right),
        '*' => Ok(left * right),
        '/' => {
            if right == 0.0 {
                return Err("除数不可为零".to_string());
            }
            Ok(left / right)
        }
        '%' => {
            if right == 0.0 {
                return Err("模运算除数不可为零".to_string());
            }
            Ok(left % right)
        }
        other => Err(format!("不支持的运算符: {}", other)),
    }
}

/// 把 `stats.gold` / `gold` 归一为 `DataContainer::stats` 里的键名。
fn stat_key(target: &str) -> &str {
    target.strip_prefix("stats.").unwrap_or(target)
}

/// 在真实数据容器上执行一条计划。
///
/// 执行语义：
/// - 逐步应用 `Calculate`；`Gate` 判定失败立即返回 [`ToolOutcome::blocked`]，**后续步骤不再执行**，
///   因此被拦截时容器不会被本次调用改写；
/// - `Inspect` / `Query` 产生只读的结构化结果写入步骤上下文（`inspect` / `query`），
///   供 ToolReturn 模板以点路径引用；`Query` 经 `query_exec` 回调执行——回调由
///   调用方提供（action_bridge 白名单校验 + 既有命令代理），返回 **boxed future**
///   （跨域读走 sqlx 异步池；本函数因此为 async——在 tokio worker 内禁止 block_on）；
/// - 全部步骤通过后，用 `success_return.return_template` 渲染回执（占位符支持
///   上下文点路径与既有操作数表达式）；模板为空则返回默认回执。
pub async fn run_tool_plan<Q>(
    state: &mut DataContainer,
    plan: &ToolPlan,
    args: &Value,
    mut query_exec: Q,
) -> Result<ToolOutcome, String>
where
    Q: FnMut(
        String,
        Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send>>,
{
    let mut ctx = StepContext::default();
    let mut outcome = ToolOutcome::success(String::new());
    for step in &plan.steps {
        match step {
            ToolStep::Calculate(config) => apply_calculator(state, config, args)?,
            ToolStep::Gate(config) => {
                let threshold = resolve_operand(&config.expression, args, state).map_err(|err| {
                    format!("门禁 `{}` 的判定表达式无法求值: {}", config.express_label(), err)
                })?;
                let mut dice_roll: Option<i64> = None;
                let passed = state
                    .evaluate_condition(&config.gate_type, threshold, args, &mut dice_roll)
                    .map_err(|err| {
                        format!("门禁 `{}` 判定失败: {}", config.gate_type, err)
                    })?;
                if let Some(roll) = dice_roll {
                    let modifier = args.get("modifier").and_then(Value::as_f64).unwrap_or(0.0);
                    outcome.dice_roll = Some(roll);
                    outcome.gate_trace.push(format!(
                        "D20 检定: roll={} + modifier={} vs DC {} → {}",
                        roll,
                        modifier,
                        threshold,
                        if passed { "成功" } else { "失败" }
                    ));
                }
                outcome.gate_trace.push(format!(
                    "门禁[{}] 表达式 `{}` 阈值 {} → {}",
                    config.gate_type,
                    config.expression,
                    threshold,
                    if passed { "放行" } else { "拦截" }
                ));
                if !passed {
                    let reason = if config.block_reason.trim().is_empty() {
                        format!("【门禁拦截 - {}】判定未通过（阈值 {}）", config.gate_type, threshold)
                    } else {
                        config.block_reason.clone()
                    };
                    outcome.text = reason;
                    outcome.is_blocked = true;
                    return Ok(outcome);
                }
            }
            ToolStep::Inspect(config) => {
                ctx.inspect = Some(run_inspect(state, config, args, &ctx)?);
            }
            ToolStep::Query(config) => {
                let payload = render_args_template(&config.args_template, args, state, &ctx)?;
                let value = query_exec(config.command.clone(), payload)
                    .await
                    .map_err(|err| format!("跨域读 `{}` 执行失败: {}", config.command, err))?;
                ctx.query = Some(value);
            }
            ToolStep::Write(config) => {
                let key = render_return_template(&config.key_expr, args, state, &ctx)?
                    .trim()
                    .to_string();
                if key.is_empty() {
                    return Err("Writer 节点的 key_expr 渲染结果为空，拒绝写入（C2）".to_string());
                }
                let value = render_return_template(&config.value_template, args, state, &ctx)?;
                state.scratchpad.insert(key, value);
            }
        }
    }

    if let Some(config) = &plan.success_return {
        if !config.return_template.trim().is_empty() {
            outcome.text = render_return_template(&config.return_template, args, state, &ctx)?;
            return Ok(outcome);
        }
    }
    if plan.steps.is_empty() {
        // 空链（definition-only，M2："仅校验"）：参数校验已通过，无容器变更——
        // 显式声明语义，不伪造业务成功数据（C2）。
        outcome.text = format!(
            "【{}】参数校验通过（空链契约：仅注册校验，无容器变更）",
            plan.tool_name
        );
        return Ok(outcome);
    }
    outcome.text = format!(
        "【{}】执行成功。当前金币: {}G，当前负重: {}/{}kg",
        plan.tool_name,
        state.get_stat("gold"),
        state.total_weight(),
        state.get_stat("max_weight")
    );
    Ok(outcome)
}

/// 执行容器读原语，产出结构化 JSON 片段。
fn run_inspect(
    state: &DataContainer,
    config: &InspectorConfig,
    args: &Value,
    ctx: &StepContext,
) -> Result<Value, String> {
    match config.inspect_kind.as_str() {
        "inventory" => {
            let items: Vec<Value> = state
                .inventory
                .iter()
                .map(|item| {
                    serde_json::json!({
                        "id": item.id, "name": item.name, "count": item.count,
                        "unit_weight": item.unit_weight, "unit_price": item.unit_price,
                    })
                })
                .collect();
            Ok(serde_json::json!({
                "items": items,
                "total_weight": state.total_weight(),
                "max_weight": state.get_stat("max_weight"),
                "gold": state.get_stat("gold"),
            }))
        }
        "stats" => {
            let stats: serde_json::Map<String, Value> = state
                .stats
                .iter()
                .map(|(k, v)| (k.clone(), serde_json::json!(v)))
                .collect();
            Ok(Value::Object(stats))
        }
        "item" => {
            let id = resolve_key_expr(&config.key_expr, args, state, ctx)?;
            let item = state
                .get_item(&id)
                .ok_or_else(|| format!("【查看失败】：背包中未找到 ID 为 [{id}] 的物品"))?;
            Ok(serde_json::json!({
                "id": item.id, "name": item.name, "count": item.count,
                "unit_weight": item.unit_weight, "unit_price": item.unit_price,
            }))
        }
        "scratchpad" => {
            let key = resolve_key_expr(&config.key_expr, args, state, ctx)?;
            let content = state
                .scratchpad
                .get(&key)
                .ok_or_else(|| format!("工作区变量 `{key}` 不存在"))?;
            Ok(serde_json::json!({ "key": key, "content": content }))
        }
        other => Err(format!(
            "未知的 inspect_kind `{other}`（支持 inventory / stats / item / scratchpad）"
        )),
    }
}

fn apply_calculator(
    state: &mut DataContainer,
    config: &CalculatorConfig,
    args: &Value,
) -> Result<(), String> {
    match config.op.as_str() {
        "add_item" => {
            let item = build_item_from(config, args)?;
            state.add_item(item);
            Ok(())
        }
        "remove_item" => {
            let item_id = item_id_from(config, args)?;
            let count = resolve_operand("count", args, state)?.round() as i64;
            state.remove_item(&item_id, count)
        }
        "recompute_weight" => {
            state.sync_weight();
            Ok(())
        }
        _ => {
            let operand = resolve_operand(&config.operand_a, args, state)?;
            let clamp_max = match config.operand_b.as_deref() {
                Some(expr) if !expr.trim().is_empty() => Some(resolve_operand(expr, args, state)?),
                _ => None,
            };
            state.apply_math_op(stat_key(&config.target), &config.op, operand, clamp_max)?;
            Ok(())
        }
    }
}

fn item_id_from(config: &CalculatorConfig, args: &Value) -> Result<String, String> {
    if let Some(id) = args.get("item_id").and_then(Value::as_str) {
        return Ok(id.to_string());
    }
    config
        .item_def
        .as_ref()
        .map(|item| item.id.clone())
        .filter(|id| !id.trim().is_empty())
        .ok_or_else(|| "add_item/remove_item 需要 item_id：参数里没有，节点的物品定义也为空".to_string())
}

/// 组装入库物品：**参数优先、节点物品定义为兜底**，两者都缺的字段取默认。
fn build_item_from(config: &CalculatorConfig, args: &Value) -> Result<InventoryItem, String> {
    let def = config.item_def.clone().unwrap_or(InventoryItem {
        id: String::new(),
        name: String::new(),
        count: 1,
        unit_weight: 0.0,
        unit_price: 0.0,
        icon: None,
        properties: Default::default(),
    });

    let id = item_id_from(config, args)?;
    let name = args
        .get("name")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| if def.name.trim().is_empty() { id.clone() } else { def.name.clone() });

    let number = |key: &str, fallback: f64| -> Result<f64, String> {
        match args.get(key) {
            Some(value) if value.is_number() => Ok(value.as_f64().unwrap_or(fallback)),
            _ => Ok(fallback),
        }
    };

    let count = number("count", if def.count > 0 { def.count as f64 } else { 1.0 })?.round() as i64;
    if count <= 0 {
        return Err("物品数量必须为正整数".to_string());
    }
    let unit_price = number("unit_price", def.unit_price)?;
    let unit_weight = number("unit_weight", def.unit_weight)?;

    Ok(InventoryItem {
        id,
        name,
        count,
        unit_weight,
        unit_price,
        icon: def.icon,
        properties: def.properties,
    })
}

/// 渲染回执模版：`{点路径}` 占位符逐个求值——先在上下文栈（args / stats /
/// inspect / query）里按点路径解析；解析不到再回退到既有操作数表达式
/// （`total_cost` 等派生量），保证旧模板向后兼容。
fn render_return_template(
    template: &str,
    args: &Value,
    state: &DataContainer,
    ctx: &StepContext,
) -> Result<String, String> {
    let ctx_json = ctx.context_json(args, state);
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let tail = &rest[start + 1..];
        let end = tail
            .find('}')
            .ok_or_else(|| format!("回执模版里的占位符未闭合: {}", template))?;
        let key = tail[..end].trim();
        let value = match resolve_dotted(key, &ctx_json) {
            Some(value) => stringify_context_value(&value),
            None => format_number(resolve_operand(key, args, state)?),
        };
        out.push_str(&value);
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

/// 数值转文本：整数不带小数点，便于回执阅读。
fn format_number(value: f64) -> String {
    if (value.fract()).abs() < f64::EPSILON {
        format!("{}", value as i64)
    } else {
        format!("{}", value)
    }
}

impl ConditionGateConfig {
    /// 报错文案用的门禁标识。
    fn express_label(&self) -> String {
        format!("{} {}", self.gate_type, self.expression)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn state_with_gold(gold: f64) -> DataContainer {
        let mut state = DataContainer::default();
        state.set_stat("gold", gold);
        state
    }

    #[test]
    fn resolves_literals_args_and_stats() {
        let state = state_with_gold(100.0);
        let args = json!({"count": 4, "unit_price": 50, "unit_weight": 1.5});
        assert_eq!(resolve_operand("12", &args, &state).unwrap(), 12.0);
        assert_eq!(resolve_operand("args.count", &args, &state).unwrap(), 4.0);
        assert_eq!(resolve_operand("count", &args, &state).unwrap(), 4.0);
        assert_eq!(resolve_operand("gold", &args, &state).unwrap(), 100.0);
        assert_eq!(resolve_operand("stats.gold", &args, &state).unwrap(), 100.0);
        assert_eq!(resolve_operand("total_cost", &args, &state).unwrap(), 200.0);
        assert_eq!(resolve_operand("added_weight", &args, &state).unwrap(), 6.0);
        assert_eq!(resolve_operand("unit_price * count", &args, &state).unwrap(), 200.0);
    }

    #[test]
    fn unknown_operand_is_an_error_not_zero() {
        let state = DataContainer::default();
        let err = resolve_operand("args.missing", &json!({}), &state).unwrap_err();
        assert!(err.contains("不存在"), "unexpected: {err}");
    }

    /// 测试用跨域读回调：未注册命令一律报错（Query 语义由 action_bridge 提供）。
    fn no_query(
        command: String,
        _args: Value,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send>> {
        Box::pin(async move { Err(format!("测试未注册跨域读命令: {command}")) })
    }

    /// 测试内驱动 async 执行器（无外部 runtime 上下文，安全）。
    fn run_plan_sync<Q>(
        state: &mut DataContainer,
        plan: &ToolPlan,
        args: &Value,
        mut query_exec: Q,
    ) -> Result<ToolOutcome, String>
    where
        Q: FnMut(
            String,
            Value,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send>>,
    {
        tauri::async_runtime::block_on(run_tool_plan(state, plan, args, &mut query_exec))
    }

    #[test]
    fn gate_blocks_without_touching_container() {
        let mut state = state_with_gold(100.0);
        let plan = ToolPlan {
            tool_name: "buy_item".into(),
            steps: vec![
                ToolStep::Gate(ConditionGateConfig {
                    gate_type: "gold".into(),
                    expression: "total_cost".into(),
                    pass_label: "放行".into(),
                    blocked_label: "拦截".into(),
                    block_reason: "金币不足".into(),
                    is_locked: false,
                }),
                ToolStep::Calculate(CalculatorConfig {
                    calc_mode: "math".into(),
                    target: "stats.gold".into(),
                    op: "-".into(),
                    operand_a: "total_cost".into(),
                    operand_b: None,
                    item_def: None,
                    is_locked: false,
                }),
            ],
            success_return: None,
            parameters_schema: None,
        };
        let args = json!({"count": 4, "unit_price": 50});
        let outcome = run_plan_sync(&mut state, &plan, &args, &no_query).unwrap();
        assert!(outcome.is_blocked);
        assert_eq!(state.get_stat("gold"), 100.0, "被拦截时不得扣款");
    }

    #[test]
    fn passes_and_applies_deduction() {
        let mut state = state_with_gold(100.0);
        let plan = ToolPlan {
            tool_name: "buy_item".into(),
            steps: vec![
                ToolStep::Gate(ConditionGateConfig {
                    gate_type: "gold".into(),
                    expression: "total_cost".into(),
                    pass_label: "放行".into(),
                    blocked_label: "拦截".into(),
                    block_reason: String::new(),
                    is_locked: false,
                }),
                ToolStep::Calculate(CalculatorConfig {
                    calc_mode: "math".into(),
                    target: "stats.gold".into(),
                    op: "-".into(),
                    operand_a: "total_cost".into(),
                    operand_b: None,
                    item_def: None,
                    is_locked: false,
                }),
            ],
            success_return: Some(ToolReturnConfig {
                return_template: "购买成功，剩余金币 {stats.gold}".into(),
                is_blocked: false,
                is_locked: false,
            }),
            parameters_schema: None,
        };
        let args = json!({"count": 1, "unit_price": 60});
        let outcome = run_plan_sync(&mut state, &plan, &args, &no_query).unwrap();
        assert!(!outcome.is_blocked);
        assert_eq!(state.get_stat("gold"), 40.0);
        assert_eq!(outcome.text, "购买成功，剩余金币 40");
    }

    #[test]
    fn inspect_feeds_template_via_context() {
        let mut state = state_with_gold(100.0);
        state.add_item(InventoryItem {
            id: "potion".into(),
            name: "治疗药剂".into(),
            count: 2,
            unit_weight: 0.5,
            unit_price: 25.0,
            icon: None,
            properties: Default::default(),
        });
        let plan = ToolPlan {
            tool_name: "check_inventory".into(),
            steps: vec![ToolStep::Inspect(InspectorConfig {
                inspect_kind: "inventory".into(),
                key_expr: String::new(),
                is_locked: false,
            })],
            success_return: Some(ToolReturnConfig {
                return_template: "金币 {stats.gold}，负重 {inspect.total_weight}，物品数 {inspect.items.0.count}"
                    .into(),
                is_blocked: false,
                is_locked: false,
            }),
            parameters_schema: None,
        };
        let outcome = run_plan_sync(&mut state, &plan, &serde_json::json!({}), &no_query).unwrap();
        assert!(!outcome.is_blocked);
        assert_eq!(outcome.text, "金币 100，负重 1，物品数 2");
    }

    #[test]
    fn query_step_invokes_executor_and_feeds_template() {
        let mut state = state_with_gold(100.0);
        let plan = ToolPlan {
            tool_name: "search_world_book".into(),
            steps: vec![ToolStep::Query(QuerierConfig {
                command: "query_world_book_entries".into(),
                args_template: serde_json::json!({"keyword": "{args.keyword}"})
                    .as_object()
                    .expect("args_template must be an object")
                    .clone(),
                is_locked: false,
            })],
            success_return: Some(ToolReturnConfig {
                return_template: "检索到：{query.0.title}".into(),
                is_blocked: false,
                is_locked: false,
            }),
            parameters_schema: None,
        };
        let exec = |command: String, args: Value| {
            assert_eq!(command, "query_world_book_entries");
            assert_eq!(args["keyword"], "下水道");
            Box::pin(async move {
                Ok(json!([{"title": "旧城区下水道"}]))
            }) as std::pin::Pin<Box<dyn std::future::Future<Output = Result<Value, String>> + Send>>
        };
        let args = json!({"keyword": "下水道"});
        let outcome = run_plan_sync(&mut state, &plan, &args, exec).unwrap();
        assert_eq!(outcome.text, "检索到：旧城区下水道");
    }

    #[test]
    fn scratchpad_inspect_missing_key_is_error() {
        let state = DataContainer::default();
        let plan = ToolPlan {
            tool_name: "file_read".into(),
            steps: vec![ToolStep::Inspect(InspectorConfig {
                inspect_kind: "scratchpad".into(),
                key_expr: "args.key".into(),
                is_locked: false,
            })],
            success_return: Some(ToolReturnConfig {
                return_template: "{inspect.content}".into(),
                is_blocked: false,
                is_locked: false,
            }),
            parameters_schema: None,
        };
        let args = json!({"key": "draft"});
        let err = run_plan_sync(&mut state.clone(), &plan, &args, no_query).unwrap_err();
        assert!(err.contains("不存在"), "unexpected: {err}");
    }
}
