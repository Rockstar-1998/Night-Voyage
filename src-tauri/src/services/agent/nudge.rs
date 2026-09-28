//! 禁词命中的 Nudge 自纠状态机（计划 §6.3）。
//!
//! 与"重试整个回合"的区别：Nudge 是**同回合内**的定向纠偏——把命中的词与重写指令
//! 作为最高优先级指令注入下一次生成，而不是让用户重发。
//!
//! 这里只负责"还能不能retry、该怎么措辞"这一确定性决策；实际的重新生成由调用方
//! （`stream_processor` 的终稿流程）执行。
//!
//! **参数来源**：重试上限与纠偏指令模板来自蓝图的 `BannedWordsConfig` 节点
//! （spec §2A.3，去硬化 D-1）——机制只携带状态，措辞与额度是资产语义。

use crate::services::agent_guards::BannedWordsViolation;

/// 一次禁词命中的处理决策。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NudgeDecision {
    /// 允许重试：携带要注入的高优先级纠偏指令。
    Retry { attempt: u8, instruction: String },
    /// 已用尽重试：硬错，调用方必须把本轮内容作废、不写库。
    GiveUp { attempts: u8, message: String },
}

/// 同回合内的 Nudge 计数器。
#[derive(Debug, Clone)]
pub struct NudgeGuard {
    attempts: u8,
    max_retries: u8,
    instruction_template: String,
}

impl NudgeGuard {
    /// `max_retries` 与 `instruction_template` 来自 `BannedWordsConfig` 节点资产
    /// （serde 缺省值保持计划 §6.3 行为：2 次；模板含 `{hits}` / `{remaining}` 占位符）。
    pub fn new(max_retries: u8, instruction_template: String) -> Self {
        Self {
            attempts: 0,
            max_retries,
            instruction_template,
        }
    }

    pub fn attempts(&self) -> u8 {
        self.attempts
    }

    pub fn max_retries(&self) -> u8 {
        self.max_retries
    }

    /// 处理一次命中：要么给出重试指令，要么判定放弃。
    ///
    /// 全部重试额度用尽后**不再放行**——继续放行等于让违规文本进入历史。
    pub fn on_violation(&mut self, violation: &BannedWordsViolation) -> NudgeDecision {
        if self.attempts >= self.max_retries {
            return NudgeDecision::GiveUp {
                attempts: self.attempts,
                message: format!(
                    "禁词校验连续 {} 次未通过（命中: {}），本轮内容已作废且不写入会话。{}",
                    self.attempts + 1,
                    violation.matched_words.join("、"),
                    violation.feedback_instruction
                ),
            };
        }

        self.attempts += 1;
        let remaining = self.max_retries - self.attempts;
        let hits = violation.matched_words.join("、");
        let rendered = self
            .instruction_template
            .replace("{hits}", &hits)
            .replace("{remaining}", &remaining.to_string());
        NudgeDecision::Retry {
            attempt: self.attempts,
            instruction: format!(
                "【系统纠偏指令 · 第 {}/{} 次】{}\n{}",
                self.attempts, self.max_retries, rendered, violation.feedback_instruction
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn violation() -> BannedWordsViolation {
        BannedWordsViolation {
            matched_words: vec!["嘴角勾起一抹弧度".to_string()],
            feedback_instruction: "请重构整段表达。".to_string(),
        }
    }

    fn guard() -> NudgeGuard {
        NudgeGuard::new(
            2,
            "以下词语违反内容约束：{hits}。剩余自纠机会 {remaining} 次。".to_string(),
        )
    }

    #[test]
    fn retries_per_configured_budget_then_gives_up() {
        let mut g = guard();
        assert!(matches!(g.on_violation(&violation()), NudgeDecision::Retry { attempt: 1, .. }));
        assert!(matches!(g.on_violation(&violation()), NudgeDecision::Retry { attempt: 2, .. }));
        match g.on_violation(&violation()) {
            NudgeDecision::GiveUp { attempts, message } => {
                assert_eq!(attempts, 2);
                assert!(message.contains("不写入会话"));
            }
            other => panic!("expected GiveUp, got {other:?}"),
        }
    }

    #[test]
    fn template_placeholders_are_rendered() {
        let mut g = guard();
        match g.on_violation(&violation()) {
            NudgeDecision::Retry { attempt, instruction } => {
                assert_eq!(attempt, 1);
                assert!(instruction.contains("第 1/2 次"), "unexpected: {instruction}");
                assert!(instruction.contains("剩余自纠机会 1 次"), "unexpected: {instruction}");
                assert!(instruction.contains("嘴角勾起一抹弧度"), "命中词必须进指令");
                assert!(!instruction.contains("{hits}"), "占位符必须已渲染");
                assert!(!instruction.contains("{remaining}"), "占位符必须已渲染");
            }
            other => panic!("expected Retry, got {other:?}"),
        }
    }

    #[test]
    fn budget_zero_means_immediate_give_up() {
        let mut g = NudgeGuard::new(0, "模板 {hits}".to_string());
        match g.on_violation(&violation()) {
            NudgeDecision::GiveUp { .. } => {}
            other => panic!("expected immediate GiveUp, got {other:?}"),
        }
    }
}
