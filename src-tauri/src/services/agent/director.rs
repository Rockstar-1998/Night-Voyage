#![allow(dead_code)]

use serde::{Deserialize, Serialize};

use super::dice::DiceRollResult;

/// 导演向演员 Subagent 派发任务规格单（agent.delegate 协议）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentDelegateTaskSpec {
    pub subagent_id: String,
    pub character_name: String,
    pub scoped_character_card: ScopedCharacterCard,
    pub director_notes: String,
    pub recent_dialogue_slice: Vec<String>,
    pub dice_result: Option<DiceRollResult>,
    pub required_return_schema: Vec<String>,
}

/// 裁剪后的角色卡片（严格心智隔离，剔除全局世界观与全知设定）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScopedCharacterCard {
    pub name: String,
    pub persona: String,
    pub known_information: Option<String>,
}

/// 演员交付结果载荷（task.return 协议）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActorReturnPayload {
    pub inner_thought: Option<String>,
    pub action: String,
    pub dialogue: String,
}

impl ActorReturnPayload {
    /// 格式化为呈递给前端或整合进叙事的文学正文
    pub fn format_narrative(&self) -> String {
        let mut parts = Vec::new();
        if let Some(ref thought) = self.inner_thought {
            if !thought.trim().is_empty() {
                parts.push(format!("（心理独白：{}）", thought.trim()));
            }
        }
        if !self.action.trim().is_empty() {
            parts.push(self.action.trim().to_string());
        }
        if !self.dialogue.trim().is_empty() {
            parts.push(format!("“{}”", self.dialogue.trim()));
        }
        parts.join("\n\n")
    }
}

/// 导演裁决综合输出
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DirectorTurnOutput {
    pub scene_context: String,
    pub dice_result: Option<DiceRollResult>,
    pub actor_returns: Vec<ActorReturnPayload>,
    pub final_narrative: String,
}
