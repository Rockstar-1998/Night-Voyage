use serde::{Deserialize, Serialize};
use crate::services::agent::{
    BannedWordsFilter, BannedWordsViolation, DiceRollResult, AgentSandbox,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSandboxStatus {
    pub conversation_id: i64,
    pub base_dir: String,
    pub plan_files: Vec<String>,
    pub scratch_files: Vec<String>,
    pub output_files: Vec<String>,
}

#[tauri::command]
pub fn agent_dice_roll(skill: String, dc: i64, modifier: i64) -> Result<DiceRollResult, String> {
    Ok(DiceRollResult::roll(&skill, dc, modifier))
}

#[tauri::command]
pub fn agent_validate_banned_words(
    text: String,
    custom_words: Option<Vec<String>>,
) -> Result<Option<BannedWordsViolation>, String> {
    let filter = match custom_words {
        Some(words) => BannedWordsFilter::new_with_custom(&words)?,
        None => BannedWordsFilter::new_default()?,
    };
    match filter.validate(&text) {
        Ok(()) => Ok(None),
        Err(violation) => Ok(Some(violation)),
    }
}

#[tauri::command]
pub fn agent_sandbox_status(conversation_id: i64) -> Result<AgentSandboxStatus, String> {
    let sandbox = AgentSandbox::new(conversation_id)?;
    let scratch_files = sandbox.list_scratch_files()?;
    let output_files = sandbox.list_output_files()?;
    
    // 读取 plan 目录文件
    let mut plan_files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(sandbox.plan_dir()) {
        for entry in entries.filter_map(Result::ok) {
            if let Ok(name) = entry.file_name().into_string() {
                plan_files.push(name);
            }
        }
        plan_files.sort();
    }

    Ok(AgentSandboxStatus {
        conversation_id,
        base_dir: sandbox.base_dir().to_string_lossy().to_string(),
        plan_files,
        scratch_files,
        output_files,
    })
}

#[tauri::command]
pub fn agent_read_sandbox_file(
    conversation_id: i64,
    folder: String,
    filename: String,
) -> Result<String, String> {
    // 严格防止目录遍历攻击 (C6 / 安全守则)
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("非法文件名，禁止目录穿越".to_string());
    }

    let sandbox = AgentSandbox::new(conversation_id)?;
    match folder.as_str() {
        "plan" => sandbox.read_plan(&filename),
        "scratch" => sandbox.read_scratch(&filename),
        "output" => sandbox.read_output(&filename),
        _ => Err("无效的沙盒目录分类，仅允许 plan, scratch, output".to_string()),
    }
}
