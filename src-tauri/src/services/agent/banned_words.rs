use std::collections::HashSet;
use aho_corasick::{AhoCorasick, AhoCorasickBuilder};
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

/// 基于 Aho-Corasick 自动机的确定性禁词校验器
#[derive(Debug, Clone)]
pub struct BannedWordsFilter {
    automaton: AhoCorasick,
    patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BannedWordsViolation {
    pub matched_words: Vec<String>,
    pub feedback_instruction: String,
}

impl BannedWordsFilter {
    /// 使用默认禁词库初始化
    pub fn new_default() -> Result<Self, String> {
        Self::new_with_custom(&[])
    }

    /// 使用默认禁词库并合并外部自定义禁词
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

        let patterns: Vec<String> = word_set.into_iter().collect();
        let automaton = AhoCorasickBuilder::new()
            .ascii_case_insensitive(true)
            .build(&patterns)
            .map_err(|e| format!("构建 Aho-Corasick 禁词自动机失败: {}", e))?;

        Ok(Self {
            automaton,
            patterns,
        })
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
        let mut found = HashSet::new();
        for mat in self.automaton.find_iter(text) {
            if let Some(word) = self.patterns.get(mat.pattern().as_usize()) {
                found.insert(word.clone());
            }
        }
        let mut list: Vec<String> = found.into_iter().collect();
        list.sort();
        list
    }
}
