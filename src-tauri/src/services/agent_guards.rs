use std::collections::HashSet;

use aho_corasick::AhoCorasick;
use serde::{Deserialize, Serialize};

/// 确定性禁词校验器。
///
/// 匹配用 **Aho-Corasick 自动机**（计划 §6.3）：一遍扫描同时命中全部词条，
/// 词库规模与扫描耗时解耦。
///
/// **词库完全来自调用方**（蓝图 `BannedWordsConfig` 节点资产，spec §2A.3）：
/// 代码不携带内置默认词库（不可知化 I1，去硬化 D-6）——未配置词库的预设
/// 禁词过滤为空，这是显式的资产决策而非代码默认。
#[derive(Debug, Clone)]
pub struct BannedWordsFilter {
    automaton: AhoCorasick,
    /// 与自动机内 pattern 下标一一对应（小写形式，用于大小写不敏感匹配）。
    patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BannedWordsViolation {
    pub matched_words: Vec<String>,
    pub feedback_instruction: String,
}

fn build_automaton(patterns: &[String]) -> Result<AhoCorasick, String> {
    AhoCorasick::builder()
        .ascii_case_insensitive(true)
        .build(patterns)
        .map_err(|err| format!("构建禁词自动机失败: {}", err))
}

/// 把词库归一为「已排序去重的小写词条」。
fn normalize_words(words: &[String]) -> Vec<String> {
    let mut word_set = HashSet::new();
    for word in words {
        let trimmed = word.trim();
        if !trimmed.is_empty() {
            word_set.insert(trimmed.to_lowercase());
        }
    }
    let mut patterns: Vec<String> = word_set.into_iter().collect();
    patterns.sort();
    patterns
}

impl BannedWordsFilter {
    /// 从蓝图 `BannedWordsConfig.words` 构建过滤器（词库即过滤全集，spec §2A.3）。
    pub fn from_words(words: &[String]) -> Result<Self, String> {
        let patterns = normalize_words(words);
        let automaton = build_automaton(&patterns)?;
        Ok(Self { automaton, patterns })
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

    /// 查找所有匹配到的不重复禁词（单遍扫描，命中即收）。
    pub fn find_violations(&self, text: &str) -> Vec<String> {
        let mut found: Vec<String> = self
            .automaton
            .find_iter(text)
            .map(|mat| self.patterns[mat.pattern().as_usize()].clone())
            .collect();

        found.sort();
        found.dedup();
        found
    }
}

/// 密码学安全随机源产出的 d20（1..=20）。
///
/// 用 `getrandom`（OS CSPRNG）而不是"时间戳 ^ 计数器 + SplitMix64"：
/// 骰点是"不可篡改检定"的信任基础，可预测的伪随机让玩家/模型有机会操纵结果。
/// 取随机数失败时**报错**而不是回退到弱随机（C2）。
pub fn random_d20() -> Result<i64, String> {
    let mut buf = [0u8; 8];
    getrandom::getrandom(&mut buf).map_err(|err| format!("获取安全随机数失败: {}", err))?;
    let value = u64::from_le_bytes(buf);
    Ok(((value % 20) + 1) as i64)
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
    /// 执行 D20 掷骰检定（随机源为 OS CSPRNG，见 [`random_d20`]）。
    ///
    /// 取随机数失败时返回 `Err`：宁可让本次检定失败可见，也不用弱随机顶替——
    /// 骰点是"不可篡改"的信任基础。
    pub fn roll(skill: &str, dc: i64, modifier: i64) -> Result<Self, String> {
        let d20_roll = random_d20()?;
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

        Ok(Self {
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
        })
    }
}
