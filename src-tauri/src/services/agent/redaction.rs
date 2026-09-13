#![allow(dead_code)]

/// Layer 1 Redaction 局部涂黑防自抄袭算法
/// 吸收 aisandboxgame 跑团精髓：防止大模型在续写或审阅接力时逐字抄袭前序段落开头（ABA 复读）。

pub const DEFAULT_MIN_REDACT_CHARS: usize = 80;
pub const DEFAULT_TRAILING_ANCHOR_CHARS: usize = 50;

#[derive(Debug, Clone)]
pub struct RedactedText {
    /// 涂黑处理后的遮蔽文本（发送给 LLM）
    pub masked_text: String,
    /// 原始完整文本（用于生成结束后内存还原）
    pub original_text: String,
    /// 是否实际触发了遮蔽
    pub is_redacted: bool,
}

impl RedactedText {
    /// 对叙事正文进行腹部掏空遮蔽处理
    pub fn apply(text: &str, min_chars: usize, anchor_chars: usize) -> Self {
        let char_count = text.chars().count();
        if char_count <= min_chars {
            return Self {
                masked_text: text.to_string(),
                original_text: text.to_string(),
                is_redacted: false,
            };
        }

        let keep_anchor_len = anchor_chars.min(char_count);
        let chars: Vec<char> = text.chars().collect();
        let anchor_start = char_count - keep_anchor_len;
        let anchor_slice: String = chars[anchor_start..].iter().collect();

        let masked = format!(
            "【此段前序叙事已被运行时遮蔽（原文 {} 字，玩家已阅读）。末尾承接锚点（{}字）如下】：\n\
             \"...{}\"\n\
             【硬性要求】：请紧承上述锚点自然推进后续剧情，严禁重述、严禁复读上述已遮蔽文字！",
            char_count,
            keep_anchor_len,
            anchor_slice.trim()
        );

        Self {
            masked_text: masked,
            original_text: text.to_string(),
            is_redacted: true,
        }
    }

    /// 还原文本
    pub fn restore(&self) -> &str {
        &self.original_text
    }
}
