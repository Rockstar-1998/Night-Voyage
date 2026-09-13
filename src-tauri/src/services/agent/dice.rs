#![allow(dead_code)]

use rand::Rng;
use serde::{Deserialize, Serialize};

/// D20 骰点检定参数规约
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiceRollSpec {
    pub skill: String,
    pub dc: i64,
    pub modifier: i64,
    pub reason: Option<String>,
}

/// 确定性 D20 检定结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiceRollResult {
    pub skill: String,
    pub d20_roll: i64,
    pub modifier: i64,
    pub total: i64,
    pub dc: i64,
    pub is_success: bool,
    pub is_critical_success: bool,
    pub is_critical_failure: bool,
    pub formula: String,
    pub summary: String,
}

impl DiceRollResult {
    /// 执行确定性 D20 掷骰检定
    pub fn roll(skill: &str, dc: i64, modifier: i64) -> Self {
        let mut rng = rand::thread_rng();
        let d20_roll = rng.gen_range(1..=20);
        let total = d20_roll + modifier;

        let is_critical_success = d20_roll == 20;
        let is_critical_failure = d20_roll == 1;

        let is_success = if is_critical_success {
            true
        } else if is_critical_failure {
            false
        } else {
            total >= dc
        };

        let mod_sign = if modifier >= 0 { "+" } else { "" };
        let formula = format!("1d20{mod_sign}{modifier} (DC: {dc})");

        let outcome_str = if is_critical_success {
            "【大成功 (Natural 20)】"
        } else if is_critical_failure {
            "【大失败 (Natural 1)】"
        } else if is_success {
            "【成功】"
        } else {
            "【失败】"
        };

        let summary = format!(
            "技能检定 [{skill}]: 掷出 {d20_roll}{mod_sign}{modifier} = {total} vs DC {dc} -> {outcome_str}"
        );

        Self {
            skill: skill.to_string(),
            d20_roll,
            modifier,
            total,
            dc,
            is_success,
            is_critical_success,
            is_critical_failure,
            formula,
            summary,
        }
    }

    /// 从公式文本解析出 modifier (如 "1d20+3" -> 3, "d20-1" -> -1)
    pub fn parse_modifier(formula: &str) -> i64 {
        let clean = formula.to_lowercase().replace(' ', "");
        if let Some(pos) = clean.find('+') {
            clean[pos + 1..].parse::<i64>().unwrap_or(0)
        } else if let Some(pos) = clean.rfind('-') {
            if pos > 0 {
                -clean[pos + 1..].parse::<i64>().unwrap_or(0)
            } else {
                0
            }
        } else {
            0
        }
    }
}
