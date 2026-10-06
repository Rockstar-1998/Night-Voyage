//! MCP 工具层。
//!
//! 每个工具只做参数解包与结果序列化，业务语义一律调用既有 `services` / `repositories`
//! 函数：不重写门禁、不重算负重、不自己拼 DataContainer。因此这些工具与前端走的是
//! 同一条后端路径，不存在第二套实现。
//!
//! 错误语义遵循 C2：处理器返回 `Result<String, String>`，禁止 `unwrap_or` 默认成功、
//! 禁止 `.ok()` 吞错。坏数据（如 `missing field unitWeight`）必须原样上抛给调用方。

use async_trait::async_trait;
use serde_json::{json, Value};
use sqlx::{FromRow, SqlitePool};
use tauri::AppHandle;

use crate::models::game_state::DataContainer;
use crate::services::agent_runtime::{
    broadcast_hud_patch, execute_tool_call, load_session_state, reset_session_state,
};

/// 工具执行上下文：真实运行中的应用句柄与真实连接池。
#[derive(Clone)]
pub struct ToolContext {
    /// 运行中应用的句柄。工具由此访问真实事件总线（HUD 增量广播）。
    pub app: AppHandle,
    /// 与应用同一来源、同一路径的 SQLite 连接池。
    pub db: SqlitePool,
}

/// MCP 工具契约。实现者为无状态单元结构体，多态由 trait 分发承担。
#[async_trait]
pub trait McpTool: Send + Sync {
    /// 工具名（MCP 侧唯一标识）。
    fn name(&self) -> &'static str;
    /// 工具说明，供代理侧判断调用时机。
    fn description(&self) -> &'static str;
    /// 入参 JSON Schema。
    fn input_schema(&self) -> Value;
    /// 执行工具。`args` 已保证是 JSON 对象。
    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String>;
}

/// 取出必需的整数参数。
fn require_i64(args: &Value, key: &str) -> Result<i64, String> {
    args.get(key)
        .and_then(Value::as_i64)
        .ok_or_else(|| format!("缺少必需的整数参数: {}", key))
}

/// 取出必需的字符串参数。
fn require_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("缺少必需的字符串参数: {}", key))
}

/// 取出可选整数参数；缺省时返回调用方给出的默认值（可选参数语义，非错误兜底）。
fn optional_i64(args: &Value, key: &str, default: i64) -> i64 {
    args.get(key).and_then(Value::as_i64).unwrap_or(default)
}

/// 关键表行数快照。
#[derive(FromRow)]
struct TableCounts {
    conversation_count: i64,
    message_count: i64,
    session_state_count: i64,
}

/// 会话一行。
#[derive(FromRow)]
struct ConversationRow {
    id: i64,
    character_id: Option<i64>,
    title: Option<String>,
    created_at: i64,
    updated_at: i64,
}

/// 会话状态原始行。
#[derive(FromRow)]
struct SessionStateRawRow {
    state_json: String,
    updated_at: i64,
}

/// 消息一行。
#[derive(FromRow)]
struct MessageRow {
    id: i64,
    role: String,
    created_at: i64,
    content_length: i64,
    is_swipe: i64,
    swipe_index: i64,
}

/// 报告端点实际生效的库路径与关键表行数。
///
/// 用于确认代理侧与应用侧操作的是同一个库——库路径存在三种解析来源
/// （环境变量、exe 同目录、应用数据目录），不做这一步容易改错库。
pub struct NvDbInfo;

#[async_trait]
impl McpTool for NvDbInfo {
    fn name(&self) -> &'static str {
        "nv_db_info"
    }

    fn description(&self) -> &'static str {
        "报告本端点连接的 SQLite 库路径与 conversations / messages / session_states 行数，用于确认代理侧与应用侧操作同一个库。"
    }

    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {}, "additionalProperties": false })
    }

    async fn call(&self, ctx: &ToolContext, _args: &Value) -> Result<String, String> {
        let db_path = crate::db::resolve_db_path(&ctx.app)
            .map_err(|err| format!("解析数据库路径失败: {}", err))?
            .to_string_lossy()
            .replace('\\', "/");

        let counts: TableCounts = sqlx::query_as(
            "SELECT (SELECT count(*) FROM conversations) AS conversation_count, \
                    (SELECT count(*) FROM messages) AS message_count, \
                    (SELECT count(*) FROM session_states) AS session_state_count",
        )
        .fetch_one(&ctx.db)
        .await
        .map_err(|err| format!("统计表行数失败: {}", err))?;

        Ok(format!(
            "数据库路径: {}\nconversations={}\nmessages={}\nsession_states={}",
            db_path, counts.conversation_count, counts.message_count, counts.session_state_count
        ))
    }
}

/// 列出全部会话。
pub struct NvConversationsList;

#[async_trait]
impl McpTool for NvConversationsList {
    fn name(&self) -> &'static str {
        "nv_conversations_list"
    }

    fn description(&self) -> &'static str {
        "列出库中全部会话（id、绑定的角色卡、标题、创建与更新时间戳）。"
    }

    fn input_schema(&self) -> Value {
        json!({ "type": "object", "properties": {}, "additionalProperties": false })
    }

    async fn call(&self, ctx: &ToolContext, _args: &Value) -> Result<String, String> {
        let rows: Vec<ConversationRow> = sqlx::query_as(
            "SELECT id, character_id, title, created_at, updated_at FROM conversations ORDER BY id",
        )
        .fetch_all(&ctx.db)
        .await
        .map_err(|err| format!("查询 conversations 失败: {}", err))?;

        if rows.is_empty() {
            return Ok("(库中没有任何会话)".to_string());
        }

        Ok(rows
            .iter()
            .map(|row| {
                format!(
                    "#{} | character={} | title={} | created_at={} | updated_at={}",
                    row.id,
                    row.character_id.map_or_else(|| "(未绑定)".to_string(), |v| v.to_string()),
                    row.title.clone().unwrap_or_else(|| "(无标题)".to_string()),
                    row.created_at,
                    row.updated_at
                )
            })
            .collect::<Vec<String>>()
            .join("\n"))
    }
}

/// 读取会话状态的原始 JSON 字符串，不做任何解析或修补。
pub struct NvSessionStateRaw;

#[async_trait]
impl McpTool for NvSessionStateRaw {
    fn name(&self) -> &'static str {
        "nv_session_state_raw"
    }

    fn description(&self) -> &'static str {
        "读取 session_states.state_json 的原始字符串与长度，不做解析、不做修补。用于区分「库里的数据坏了」与「界面渲染坏了」。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" } },
            "required": ["sessionId"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;

        let row: Option<SessionStateRawRow> =
            sqlx::query_as("SELECT state_json, updated_at FROM session_states WHERE session_id = ?")
                .bind(session_id)
                .fetch_optional(&ctx.db)
                .await
                .map_err(|err| format!("查询 session_states 失败: {}", err))?;

        let Some(row) = row else {
            return Ok(format!(
                "session_id={} 在 session_states 中没有行（该会话从未建立过游戏状态）",
                session_id
            ));
        };

        Ok(format!(
            "session_id={}\nupdated_at={}\nlength={}\nraw:\n{}",
            session_id,
            row.updated_at,
            row.state_json.len(),
            row.state_json
        ))
    }
}

/// 经真实 service 解析会话状态（与前端 `session_game_state_get` 同一条路径）。
pub struct NvSessionStateGet;

#[async_trait]
impl McpTool for NvSessionStateGet {
    fn name(&self) -> &'static str {
        "nv_session_state_get"
    }

    fn description(&self) -> &'static str {
        "调用后端 load_session_state 解析会话状态，与前端 session_game_state_get 完全同一条路径（含 serde 契约校验）。解析失败会原样报错，不做任何降级。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" } },
            "required": ["sessionId"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;
        let state: DataContainer = load_session_state(&ctx.db, session_id).await?;
        let pretty = serde_json::to_string_pretty(&state)
            .map_err(|err| format!("序列化 DataContainer 失败: {}", err))?;

        Ok(format!(
            "session_id={}\n条目数: stats={} inventory={} flags={} scratchpad={}\n当前负重={:.2} 负重上限={:.2} 金币={:.2}\n解析结果:\n{}",
            session_id,
            state.stats.len(),
            state.inventory.len(),
            state.flags.len(),
            state.scratchpad.len(),
            state.total_weight(),
            state.get_stat("max_weight"),
            state.get_stat("gold"),
            pretty
        ))
    }
}

/// 执行 ToolCall 契约：真实门禁判定 + 真实持久化 + 真实 HUD 广播。
pub struct NvToolCallExecute;

#[async_trait]
impl McpTool for NvToolCallExecute {
    fn name(&self) -> &'static str {
        "nv_tool_call_execute"
    }

    fn description(&self) -> &'static str {
        "调用后端 execute_tool_call 执行会话蓝图当前激活的 ToolCall 契约。可用契约由预设蓝图的 ToolDefinition 链编译决定（以编译预览或调试抽屉展示为准），未定义的契约显式报错。含确定性门禁、状态持久化与 HUD 增量广播，结果会实时反映到运行中的界面。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" },
                "toolName": { "type": "string", "description": "ToolCall 契约名" },
                "argumentsJson": { "type": "string", "description": "参数对象序列化后的 JSON 字符串，例如 {\"item_id\":\"health_potion\",\"count\":1}" }
            },
            "required": ["sessionId", "toolName", "argumentsJson"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;
        let tool_name = require_str(args, "toolName")?;
        let arguments_json = require_str(args, "argumentsJson")?;

        execute_tool_call(&ctx.db, &ctx.app, session_id, tool_name, arguments_json).await
    }
}

/// 设置预设 Gate 节点的选择（与预设详情页的 Gate 面板同一条后端命令）。
///
/// 用途：蓝图里的工具链（如 buy_item 的 ToolDefinition→Gate→Calculator→ToolReturn）
/// 挂在 group_gate 的某个选项后方，只有选中该选项时这条链才参与编译、才产生工具执行计划。
/// 因此它是"用蓝图驱动功能"的开关，而不是任何硬编码开关。
pub struct NvPresetGateSelect;

#[async_trait]
impl McpTool for NvPresetGateSelect {
    fn name(&self) -> &'static str {
        "nv_preset_gate_select"
    }

    fn description(&self) -> &'static str {
        "设置某预设下 Gate 节点选中的键（等价于在预设详情页 Gate 面板里勾选）。决定蓝图中该分支后方的节点链是否参与编译——例如选中 inventory_trade 才会生成 buy_item 的工具执行计划。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "presetId": { "type": "integer", "description": "预设 id" },
                "nodeId": { "type": "string", "description": "蓝图 Gate 节点 id，例如 n_rpg_engine_gate" },
                "keys": { "type": "array", "items": { "type": "string" }, "description": "选中的键；空数组表示取消选择" }
            },
            "required": ["presetId", "nodeId", "keys"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let preset_id = require_i64(args, "presetId")?;
        let node_id = require_str(args, "nodeId")?.to_string();
        let keys_value = args
            .get("keys")
            .and_then(|value| value.as_array())
            .ok_or_else(|| "keys 必须是字符串数组".to_string())?;
        let selected_keys = keys_value
            .iter()
            .map(|item| {
                item.as_str()
                    .map(str::to_string)
                    .ok_or_else(|| "keys 元素必须是字符串".to_string())
            })
            .collect::<Result<Vec<String>, String>>()?;

        crate::repositories::preset_gate_repository::PresetGateRepository::upsert(
            &ctx.db, preset_id, &node_id, &selected_keys,
        )
        .await
        .map_err(|err| err.replace('\\', "/"))?;

        Ok(format!(
            "预设 {} 的 Gate 节点 `{}` 已选中: [{}]",
            preset_id,
            node_id,
            selected_keys.join(", ")
        ))
    }
}

/// 把会话状态重置为默认初始状态。
///
/// 存量数据可能由历史脚本写入、字段名不符合当前 serde 契约（例如 snake_case 的
/// `unit_weight`），此时任何以 `load_session_state` 为入口的工具都会在解析阶段失败。
/// 本工具调用后端 `reset_session_state`，由 serde 序列化生成字段名必然合法的状态，
/// 是修复此类数据的唯一合规路径——不手写 JSON 塞库。
pub struct NvSessionStateReset;

#[async_trait]
impl McpTool for NvSessionStateReset {
    fn name(&self) -> &'static str {
        "nv_session_state_reset"
    }

    fn description(&self) -> &'static str {
        "调用后端 reset_session_state 把会话状态重置为默认初始状态（由 serde 序列化生成，字段名必然符合 camelCase 契约），并广播 HUD 增量。用于把不符合当前契约的存量数据恢复到合法状态。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" } },
            "required": ["sessionId"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;
        let state = reset_session_state(&ctx.db, session_id).await?;
        broadcast_hud_patch(&ctx.app, session_id, &state, None);

        let pretty = serde_json::to_string_pretty(&state)
            .map_err(|err| format!("序列化 DataContainer 失败: {}", err))?;

        Ok(format!(
            "session_id={} 已重置为默认状态并广播 HUD 增量:\n{}",
            session_id, pretty
        ))
    }
}

/// 列出会话的消息。
pub struct NvMessagesList;

#[async_trait]
impl McpTool for NvMessagesList {
    fn name(&self) -> &'static str {
        "nv_messages_list"
    }

    fn description(&self) -> &'static str {
        "列出指定会话的消息（id、角色、时间戳、正文长度、swipe 状态）。默认最多 50 条。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "sessionId": { "type": "integer", "description": "会话 id（等于 conversations.id）" },
                "limit": { "type": "integer", "description": "最多返回条数，默认 50" }
            },
            "required": ["sessionId"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let session_id = require_i64(args, "sessionId")?;
        let limit = optional_i64(args, "limit", 50);
        if limit <= 0 {
            return Err("limit 必须为正整数".to_string());
        }

        let rows: Vec<MessageRow> = sqlx::query_as(
            "SELECT id, role, created_at, length(content) AS content_length, is_swipe, swipe_index \
             FROM messages WHERE conversation_id = ? ORDER BY id LIMIT ?",
        )
        .bind(session_id)
        .bind(limit)
        .fetch_all(&ctx.db)
        .await
        .map_err(|err| format!("查询 messages 失败: {}", err))?;

        if rows.is_empty() {
            return Ok(format!("conversation_id={} 没有任何消息", session_id));
        }

        let lines = rows
            .iter()
            .map(|row| {
                format!(
                    "#{} | {} | {} 字 | created_at={} | is_swipe={} swipe_index={}",
                    row.id, row.role, row.content_length, row.created_at, row.is_swipe, row.swipe_index
                )
            })
            .collect::<Vec<String>>()
            .join("\n");

        Ok(format!(
            "conversation_id={} 共返回 {}\n{}",
            session_id,
            rows.len(),
            lines
        ))
    }
}

/// 抓取运行中客户端窗口的真实像素并存为 PNG（Windows 专用）。
///
/// 这是**对真实窗口的屏幕实抓**，不是渲染合成：`BitBlt` 取自屏幕 DC 的窗口矩形区域，
/// 因此 WebView2 的 GPU 合成内容也能正确成像（走窗口 DC 的那条路径对这类内容常得到黑图）。
/// 用途是让代理侧肉眼确认 HUD 增量广播是否真的刷新了界面。
#[cfg(windows)]
pub struct NvScreenshot;

#[cfg(windows)]
#[async_trait]
impl McpTool for NvScreenshot {
    fn name(&self) -> &'static str {
        "nv_screenshot"
    }

    fn description(&self) -> &'static str {
        "抓取运行中客户端窗口的真实像素并存为 PNG，返回文件路径与尺寸。用于确认 HUD 增量广播是否真的刷新了界面（屏幕实抓，非渲染合成）。窗口最小化时会先还原并置前。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "outputPath": {
                    "type": "string",
                    "description": "PNG 输出路径；缺省写到 D:\\software_cache\\nv-screenshot-<时间戳>.png（C6 缓存盘）"
                }
            },
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let output = match args.get("outputPath").and_then(Value::as_str) {
            Some(value) if !value.trim().is_empty() => value.trim().to_string(),
            _ => format!(
                "D:\\software_cache\\nv-screenshot-{}.png",
                chrono::Local::now().format("%Y%m%d-%H%M%S")
            ),
        };

        // 抓屏是同步阻塞操作，刻意放在普通函数里：句柄类型非 Send，
        // 不进 async 状态机就不会跨 await 点持有。
        let (label, width, height, bytes) = capture_app_window_png(&ctx.app, &output)?;

        Ok(format!(
            "已实抓窗口 '{}' 的像素\n文件: {}\n尺寸: {}x{}\n字节: {}",
            label, output, width, height, bytes
        ))
    }
}

/// 抓取应用窗口矩形区域并编码为 PNG，返回 (窗口标签, 宽, 高, 文件字节数)。
#[cfg(windows)]
fn capture_app_window_png(
    app: &AppHandle,
    output: &str,
) -> Result<(String, u32, u32, u64), String> {
    use std::ffi::c_void;
    use tauri::Manager;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::Graphics::Gdi::{
        BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
        ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, DIB_RGB_COLORS, SRCCOPY,
    };
    use windows::Win32::Storage::Xps::{PRINT_WINDOW_FLAGS, PrintWindow};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowRect, IsIconic, SetForegroundWindow, ShowWindow, PW_RENDERFULLCONTENT, SW_RESTORE,
    };

    let window = app
        .get_webview_window("main")
        .or_else(|| app.webview_windows().into_values().next())
        .ok_or_else(|| "找不到任何应用窗口，无法截图".to_string())?;
    let label = window.label().to_string();

    let hwnd = window
        .hwnd()
        .map_err(|err| format!("取窗口句柄失败: {}", err))?;

    // 最小化的窗口没有可抓取的像素，先还原；置前是为了避免被其它窗口遮挡。
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindow(hwnd, SW_RESTORE);
        }
        let _ = SetForegroundWindow(hwnd);
    }
    // 等系统把这一帧合成到桌面，否则可能抓到上一帧。
    std::thread::sleep(std::time::Duration::from_millis(250));

    let mut rect = RECT::default();
    unsafe { GetWindowRect(hwnd, &mut rect) }.map_err(|err| format!("取窗口矩形失败: {}", err))?;
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return Err(format!("窗口尺寸非法: {}x{}", width, height));
    }

    let mut pixels = vec![0u8; width as usize * height as usize * 4];

    unsafe {
        let screen_dc = GetDC(None);
        if screen_dc.0.is_null() {
            return Err("获取屏幕 DC 失败".to_string());
        }
        let mem_dc = CreateCompatibleDC(Some(screen_dc));
        if mem_dc.0.is_null() {
            ReleaseDC(None, screen_dc);
            return Err("创建兼容 DC 失败".to_string());
        }
        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.0.is_null() {
            let _ = DeleteDC(mem_dc);
            ReleaseDC(None, screen_dc);
            return Err("创建兼容位图失败".to_string());
        }

        let captured = (|| -> Result<(), String> {
            let previous = SelectObject(mem_dc, bitmap.into());
            if previous.0.is_null() {
                return Err("SelectObject 到内存 DC 失败".to_string());
            }
            // 优先 PrintWindow(PW_RENDERFULLCONTENT)：窗口被其它应用遮挡时也能抓到自身内容。
            // 此前用"屏幕 DC BitBlt + SetForegroundWindow"，但置前会被系统拒绝（禁止抢焦点），
            // 抓到的是压在上面的别的应用窗口——多任务环境下截图张冠李戴。
            let printed = PrintWindow(hwnd, mem_dc, PRINT_WINDOW_FLAGS(PW_RENDERFULLCONTENT));
            if !printed.as_bool() {
                // 退化路径：窗口自身允许屏幕拷贝时再走 BitBlt（此时窗口必须在前台）。
                BitBlt(
                    mem_dc,
                    0,
                    0,
                    width,
                    height,
                    Some(screen_dc),
                    rect.left,
                    rect.top,
                    SRCCOPY,
                )
                .map_err(|err| format!("PrintWindow 与 BitBlt 均失败: {}", err))?;
            }

            let mut info = BITMAPINFO::default();
            info.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                // 正数高度 = 自下而上的 DIB，转换时统一翻正。
                biHeight: height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: 0, // BI_RGB
                ..Default::default()
            };
            let copied = GetDIBits(
                mem_dc,
                bitmap,
                0,
                height as u32,
                Some(pixels.as_mut_ptr() as *mut c_void),
                &mut info,
                DIB_RGB_COLORS,
            );
            if copied == 0 {
                return Err("GetDIBits 未取到任何扫描行".to_string());
            }
            Ok(())
        })();

        let _ = DeleteObject(bitmap.into());
        let _ = DeleteDC(mem_dc);
        ReleaseDC(None, screen_dc);
        captured?;
    }

    // BGRA/自下而上 -> RGBA/自上而下。BitBlt 产物的 alpha 不可信，一律当不透明。
    let stride = width as usize * 4;
    let mut rgba = vec![0u8; pixels.len()];
    for row in 0..height as usize {
        let src = (height as usize - 1 - row) * stride;
        let dst = row * stride;
        for col in 0..width as usize {
            let s = src + col * 4;
            let d = dst + col * 4;
            rgba[d] = pixels[s + 2];
            rgba[d + 1] = pixels[s + 1];
            rgba[d + 2] = pixels[s];
            rgba[d + 3] = 255;
        }
    }

    let path = std::path::Path::new(output);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("创建输出目录失败 {}: {}", parent.display(), err))?;
    }
    let file = std::fs::File::create(path).map_err(|err| format!("创建 PNG 文件失败: {}", err))?;
    let mut encoder = png::Encoder::new(
        std::io::BufWriter::new(file),
        width as u32,
        height as u32,
    );
    encoder.set_color(png::ColorType::Rgba);
    encoder.set_depth(png::BitDepth::Eight);
    let mut writer = encoder
        .write_header()
        .map_err(|err| format!("写 PNG 文件头失败: {}", err))?;
    writer
        .write_image_data(&rgba)
        .map_err(|err| format!("写 PNG 像素数据失败: {}", err))?;
    drop(writer);

    let bytes = std::fs::metadata(path)
        .map_err(|err| format!("读取 PNG 文件信息失败: {}", err))?
        .len();

    Ok((label, width as u32, height as u32, bytes))
}

/// 全部已注册工具。
/// 读取预设的蓝图图（节点 + 连线）。
///
/// 与蓝图编辑器打开预设时用的是同一份数据，因此可以据此增量改写工具链，
/// 而不是在代码里硬编码工具行为。
pub struct NvBlueprintGet;

#[async_trait]
impl McpTool for NvBlueprintGet {
    fn name(&self) -> &'static str {
        "nv_blueprint_get"
    }

    fn description(&self) -> &'static str {
        "读取预设的蓝图图 JSON（nodes + edges），与蓝图编辑器打开该预设时使用的是同一份数据。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "presetId": { "type": "integer", "description": "预设 id" } },
            "required": ["presetId"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let preset_id = require_i64(args, "presetId")?;
        let row: Option<(Option<String>,)> = sqlx::query_as(
            "SELECT blueprint_graph FROM presets WHERE id = ? LIMIT 1",
        )
        .bind(preset_id)
        .fetch_optional(&ctx.db)
        .await
        .map_err(|err| format!("读取预设蓝图失败: {}", err))?;
        let Some((graph_json,)) = row else {
            return Err(format!("预设 {} 不存在", preset_id));
        };
        let graph_json = graph_json.ok_or_else(|| format!("预设 {} 尚未保存蓝图图", preset_id))?;
        let graph: serde_json::Value = serde_json::from_str(&graph_json)
            .map_err(|err| format!("蓝图图不是合法 JSON: {}", err))?;
        Ok(format!(
            "preset_id={}\n节点数={} 连线数={}\n{}",
            preset_id,
            graph.get("nodes").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
            graph.get("edges").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0),
            serde_json::to_string_pretty(&graph).unwrap_or(graph_json)
        ))
    }
}

/// 保存预设的蓝图图（走与编辑器同一个 `PresetService::update` 路径）。
pub struct NvBlueprintSave;

#[async_trait]
impl McpTool for NvBlueprintSave {
    fn name(&self) -> &'static str {
        "nv_blueprint_save"
    }

    fn description(&self) -> &'static str {
        "写回预设的蓝图图 JSON（先经 normalize_blueprint_graph 归一化校验），保存路径与蓝图编辑器点击保存完全一致。"
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "presetId": { "type": "integer", "description": "预设 id" },
                "graphJson": { "type": "string", "description": "完整蓝图图 JSON（nodes + edges）" }
            },
            "required": ["presetId", "graphJson"],
            "additionalProperties": false
        })
    }

    async fn call(&self, ctx: &ToolContext, args: &Value) -> Result<String, String> {
        let preset_id = require_i64(args, "presetId")?;
        let graph_json = require_str(args, "graphJson")?;

        // 归一化：与编辑器保存前同样的校验，非法图在这里被拒绝，不落库。
        let normalized =
            crate::commands::blueprint::normalize_blueprint_graph(graph_json.to_string())
                .await
                .map_err(|err| err.replace('\\', "/"))?;

        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|err| format!("取当前时间失败: {}", err))?
            .as_millis() as i64;

        let rows = sqlx::query("UPDATE presets SET blueprint_graph = ?, updated_at = ? WHERE id = ?")
            .bind(normalized.graph_json.clone())
            .bind(now_ms)
            .bind(preset_id)
            .execute(&ctx.db)
            .await
            .map_err(|err| format!("保存蓝图图失败: {}", format!("{err}").replace('\\', "/")))?;
        if rows.rows_affected() == 0 {
            return Err(format!("预设 {} 不存在，蓝图图未保存", preset_id));
        }

        Ok(format!(
            "已保存预设 {} 的蓝图图（{} 字节，拓扑迁移={}）。运行期工具链按新图重新编译生效。",
            preset_id,
            normalized.graph_json.len(),
            normalized.migrated
        ))
    }
}
/// 全部已注册工具。
pub fn all_tools() -> Vec<Box<dyn McpTool>> {
    let mut tools: Vec<Box<dyn McpTool>> = vec![
        Box::new(NvDbInfo),
        Box::new(NvConversationsList),
        Box::new(NvSessionStateRaw),
        Box::new(NvSessionStateGet),
        Box::new(NvToolCallExecute),
        Box::new(NvPresetGateSelect),
        Box::new(NvSessionStateReset),
        Box::new(NvMessagesList),
        Box::new(NvBlueprintGet),
        Box::new(NvBlueprintSave),
    ];
    #[cfg(windows)]
    tools.push(Box::new(NvScreenshot));
    tools
}

/// 按名字查找工具。
pub fn find_tool(name: &str) -> Option<Box<dyn McpTool>> {
    all_tools().into_iter().find(|tool| tool.name() == name)
}

/// 构造 `tools/list` 所需的工具描述列表。
pub fn tool_listing() -> Vec<Value> {
    all_tools()
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name(),
                "description": tool.description(),
                "inputSchema": tool.input_schema(),
            })
        })
        .collect()
}

/// 供错误提示使用的工具名清单。
pub fn tool_names() -> String {
    all_tools()
        .iter()
        .map(|tool| tool.name())
        .collect::<Vec<&str>>()
        .join(", ")
}

/// MCP 工具清单（调试台展示用，C10：面板可选值来自真实数据源）。
#[tauri::command]
pub fn mcp_tool_names() -> Vec<serde_json::Value> {
    all_tools()
        .iter()
        .map(|tool| {
            serde_json::json!({
                "name": tool.name(),
                "description": tool.description(),
            })
        })
        .collect()
}
