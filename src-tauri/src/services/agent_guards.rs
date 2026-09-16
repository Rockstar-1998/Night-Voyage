use std::collections::HashSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;
use serde::{Deserialize, Serialize};

/// 默认内置的跑团/角色扮演 AI 机械感与高频套话禁词库
pub const DEFAULT_BANNED_WORDS: &[&str] = &[
    "作为一个人工智能",
    "作为一个AI",
    "作为一个语言模型",
    "作为一名人工智能",
    "作为你的助手",
    "嘴角勾起一抹弧度",
    "嘴角勾起一抹笑意",
    "嘴角勾起一抹冷笑",
    "深吸了一口气",
    "眸中闪过一丝",
    "眼中闪过一丝",
    "目光中闪过一丝",
    "不可否认的是",
    "如释重负地松了一口气",
    "宛如一尊",
    "宛如雕塑",
    "心中暗暗想到",
    "不由得一愣",
    "神色复杂地看着你",
    "淡淡地开口说道",
    "微不可察地叹了口气",
    "微不可察地皱了皱眉",
    "空气仿佛在这一瞬间凝固",
    "时间仿佛在此刻静止",
];

/// 确定性禁词校验器
#[derive(Debug, Clone)]
pub struct BannedWordsFilter {
    patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BannedWordsViolation {
    pub matched_words: Vec<String>,
    pub feedback_instruction: String,
}

impl BannedWordsFilter {
    pub fn new_default() -> Result<Self, String> {
        Self::new_with_custom(&[])
    }

    pub fn new_with_custom(custom_words: &[String]) -> Result<Self, String> {
        let mut word_set = HashSet::new();
        for word in DEFAULT_BANNED_WORDS {
            word_set.insert(word.to_string());
        }
        for word in custom_words {
            let trimmed = word.trim();
            if !trimmed.is_empty() {
                word_set.insert(trimmed.to_string());
            }
        }

        let mut patterns: Vec<String> = word_set.into_iter().collect();
        patterns.sort();
        Ok(Self { patterns })
    }

    /// 检测文本中是否包含禁词。
    /// 若无违规返回 Ok(())；若违规返回违规词列表及针对性的重写指令。
    pub fn validate(&self, text: &str) -> Result<(), BannedWordsViolation> {
        let matches = self.find_violations(text);
        if matches.is_empty() {
            Ok(())
        } else {
            let words_joined = matches.join("、");
            let feedback = format!(
                "【严格禁词检定驳回】：检测到生成内容中包含以下机械感/违禁套话词汇：[{words_joined}]。请重构整段表达，消除上述禁词，采用更自然生动、符合角色设定的文学语言重写。"
            );
            Err(BannedWordsViolation {
                matched_words: matches,
                feedback_instruction: feedback,
            })
        }
    }

    /// 查找所有匹配到的不重复禁词
    pub fn find_violations(&self, text: &str) -> Vec<String> {
        let lower_text = text.to_lowercase();
        let mut found = Vec::new();

        for pattern in &self.patterns {
            if lower_text.contains(&pattern.to_lowercase()) {
                found.push(pattern.clone());
            }
        }

        found.sort();
        found.dedup();
        found
    }
}

static RNG_COUNTER: AtomicU64 = AtomicU64::new(1);

fn random_d20() -> i64 {
    let nanos = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(987654321);
    let seq = RNG_COUNTER.fetch_add(1, Ordering::Relaxed);
    // SplitMix64 算法产出高质量确定性随机熵
    let mut x = nanos ^ seq.wrapping_mul(0x9E3779B97F4A7C15);
    x = x.wrapping_add(0x9E3779B97F4A7C15);
    x = (x ^ (x >> 30)).wrapping_mul(0xBF58476D1CE4E5B9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94D049BB133111EB);
    x = x ^ (x >> 31);
    ((x % 20) + 1) as i64
}

/// D20 骰点检定参数规约
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiceRollSpec {
    pub skill: String,
    pub dc: i64,
    pub modifier: i64,
    pub reason: Option<String>,
}

/// 确定性 D20 检定结果
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    /// 执行确定性 CSPRNG / SplitMix64 D20 掷骰检定
    pub fn roll(skill: &str, dc: i64, modifier: i64) -> Self {
        let d20_roll = random_d20();
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
            "【检定成功】"
        } else {
            "【检定失败】"
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
}
