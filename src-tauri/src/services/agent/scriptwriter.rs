#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use super::sandbox::AgentSandbox;

pub const MAX_HANDOFF_DEPTH: usize = 2;

/// 审阅结果状态
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CritiqueResult {
    pub passed: bool,
    pub score: u8,
    pub suggestions: Vec<String>,
    pub banned_words_detected: Vec<String>,
}

/// 剧本流水线当前步骤记录
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScriptwriterPipelineRecord {
    pub round_index: i64,
    pub depth: usize,
    pub drafter_text: String,
    pub critique: Option<CritiqueResult>,
    pub refiner_text: Option<String>,
    pub final_text: String,
    pub committed: bool,
}

impl ScriptwriterPipelineRecord {
    pub fn new(round_index: i64, drafter_text: String) -> Self {
        Self {
            round_index,
            depth: 1,
            final_text: drafter_text.clone(),
            drafter_text,
            critique: None,
            refiner_text: None,
            committed: false,
        }
    }

    /// 在沙盒中记录初稿
    pub fn save_draft_to_sandbox(&self, sandbox: &AgentSandbox) -> Result<(), String> {
        let filename = format!("draft_v{}.md", self.depth);
        sandbox.write_scratch(&filename, &self.drafter_text)?;
        Ok(())
    }

    /// 在沙盒中记录批评报告
    pub fn save_critique_to_sandbox(&self, sandbox: &AgentSandbox, critique: &CritiqueResult) -> Result<(), String> {
        let filename = format!("critique_v{}.json", self.depth);
        let content = serde_json::to_string_pretty(critique)
            .map_err(|e| format!("序列化批评报告失败: {}", e))?;
        sandbox.write_scratch(&filename, &content)?;
        Ok(())
    }

    /// 在沙盒中执行定稿提交 (workspace.commit)
    pub fn commit(&mut self, sandbox: &AgentSandbox) -> Result<String, String> {
        self.committed = true;
        let path = sandbox.commit_turn(self.round_index, &self.final_text)?;
        Ok(path.to_string_lossy().to_string())
    }
}
