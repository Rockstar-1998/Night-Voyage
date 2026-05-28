use serde_json::{Map, Value};

#[derive(Debug, PartialEq)]
pub enum StructuredOutputEvent {
    StringFieldDelta {
        key: String,
        delta: String,
    },
    ObjectFieldComplete {
        key: String,
        value: Map<String, Value>,
    },
    ParseError(String),
}

#[derive(Debug, PartialEq)]
pub struct StructuredOutputResult {
    pub fields: Map<String, Value>,
}

#[derive(Debug, Clone, PartialEq)]
enum Phase {
    BeforeObject,
    ExpectKeyOrEnd,
    InKey,
    ExpectColon,
    ExpectValue,
    InStringValue,
    InObjectValue,
    ExpectCommaOrEnd,
    Complete,
}

pub struct StructuredOutputParser {
    buffer: String,
    pos: usize,
    phase: Phase,
    current_key: Option<String>,
    escape_next: bool,
    unicode_escape: Option<String>,
    current_string: String,
    fields: Map<String, Value>,
    object_raw: String,
    object_depth: i32,
    object_in_string: bool,
    object_escape_next: bool,
    last_emitted_len: usize,
    active_string_key: Option<String>,
}

impl StructuredOutputParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
            pos: 0,
            phase: Phase::BeforeObject,
            current_key: None,
            escape_next: false,
            unicode_escape: None,
            current_string: String::new(),
            fields: Map::new(),
            object_raw: String::new(),
            object_depth: 0,
            object_in_string: false,
            object_escape_next: false,
            last_emitted_len: 0,
            active_string_key: None,
        }
    }

    pub fn feed(&mut self, delta: &str) -> Vec<StructuredOutputEvent> {
        self.buffer.push_str(delta);
        self.process()
    }

    fn flush_string_delta(&mut self) -> Option<StructuredOutputEvent> {
        if self.current_string.len() > self.last_emitted_len {
            let start = self.last_emitted_len;
            let delta = self.current_string[start..].to_string();
            self.last_emitted_len = self.current_string.len();
            Some(StructuredOutputEvent::StringFieldDelta {
                key: self.active_string_key.clone()?,
                delta,
            })
        } else {
            None
        }
    }

    fn decode_simple_escape(ch: char) -> char {
        match ch {
            '"' => '"',
            '\\' => '\\',
            '/' => '/',
            'n' => '\n',
            't' => '\t',
            'r' => '\r',
            'b' => '\u{08}',
            'f' => '\u{0c}',
            _ => ch,
        }
    }

    fn process(&mut self) -> Vec<StructuredOutputEvent> {
        let mut events = Vec::new();

        while self.pos < self.buffer.len() {
            let ch = match self.buffer[self.pos..].chars().next() {
                Some(c) => c,
                None => break,
            };
            let ch_len = ch.len_utf8();

            match self.phase {
                Phase::BeforeObject => {
                    match ch {
                        '{' => {
                            self.phase = Phase::ExpectKeyOrEnd;
                        }
                        _ => {}
                    }
                    self.pos += ch_len;
                }

                Phase::ExpectKeyOrEnd => {
                    match ch {
                        '"' => {
                            self.phase = Phase::InKey;
                            self.current_string.clear();
                        }
                        '}' => {
                            self.phase = Phase::Complete;
                        }
                        _ if ch.is_whitespace() => {}
                        _ => {
                            events.push(StructuredOutputEvent::ParseError(format!(
                                "expected key or '}}' but found '{}'",
                                ch
                            )));
                            return events;
                        }
                    }
                    self.pos += ch_len;
                }

                Phase::InKey => {
                    if self.escape_next {
                        self.current_string.push(ch);
                        self.escape_next = false;
                    } else if let Some(ref mut hex) = self.unicode_escape {
                        hex.push(ch);
                        if hex.len() == 4 {
                            if let Ok(cp) = u32::from_str_radix(hex, 16) {
                                if let Some(c) = char::from_u32(cp) {
                                    self.current_string.push(c);
                                }
                            }
                            self.unicode_escape = None;
                        }
                    } else if ch == '\\' {
                        self.escape_next = true;
                    } else if ch == '"' {
                        self.current_key = Some(self.current_string.clone());
                        self.current_string.clear();
                        self.phase = Phase::ExpectColon;
                    } else {
                        self.current_string.push(ch);
                    }
                    self.pos += ch_len;
                }

                Phase::ExpectColon => {
                    match ch {
                        ':' => {
                            self.phase = Phase::ExpectValue;
                        }
                        _ if ch.is_whitespace() => {}
                        _ => {
                            events.push(StructuredOutputEvent::ParseError(format!(
                                "expected ':' but found '{}'",
                                ch
                            )));
                            return events;
                        }
                    }
                    self.pos += ch_len;
                }

                Phase::ExpectValue => {
                    match ch {
                        '"' => {
                            self.phase = Phase::InStringValue;
                            self.current_string.clear();
                            self.escape_next = false;
                            self.unicode_escape = None;
                            self.last_emitted_len = 0;
                            self.active_string_key = self.current_key.clone();
                        }
                        '{' => {
                            self.phase = Phase::InObjectValue;
                            self.object_depth = 1;
                            self.object_raw.clear();
                            self.object_raw.push(ch);
                            self.object_in_string = false;
                            self.object_escape_next = false;
                        }
                        _ if ch.is_whitespace() => {}
                        _ => {
                            events.push(StructuredOutputEvent::ParseError(format!(
                                "unexpected value character '{}' for key '{:?}'",
                                ch, self.current_key
                            )));
                            return events;
                        }
                    }
                    self.pos += ch_len;
                }

                Phase::InStringValue => {
                    if self.escape_next {
                        if ch == 'u' {
                            self.unicode_escape = Some(String::new());
                        } else {
                            self.current_string.push(Self::decode_simple_escape(ch));
                        }
                        self.escape_next = false;
                    } else if let Some(ref mut hex) = self.unicode_escape {
                        hex.push(ch);
                        if hex.len() == 4 {
                            if let Ok(cp) = u32::from_str_radix(hex, 16) {
                                if let Some(c) = char::from_u32(cp) {
                                    self.current_string.push(c);
                                }
                            }
                            self.unicode_escape = None;
                        }
                    } else if ch == '\\' {
                        self.escape_next = true;
                    } else if ch == '"' {
                        if let Some(delta) = self.flush_string_delta() {
                            events.push(delta);
                        }
                        let value = self.current_string.clone();
                        if let Some(key) = self.current_key.take() {
                            self.fields.insert(key, Value::String(value));
                        }
                        self.current_string.clear();
                        self.active_string_key = None;
                        self.phase = Phase::ExpectCommaOrEnd;
                    } else if ch == '\n' {
                        eprintln!("[structured_output] raw newline in string value for key {:?}, treating as \\n escape", self.active_string_key);
                        self.current_string.push('\n');
                    } else if ch == '\r' {
                        eprintln!("[structured_output] raw carriage return in string value for key {:?}, treating as \\r escape", self.active_string_key);
                        self.current_string.push('\r');
                    } else if ch == '\t' {
                        self.current_string.push('\t');
                    } else {
                        self.current_string.push(ch);
                    }
                    self.pos += ch_len;
                }

                Phase::InObjectValue => {
                    self.object_raw.push(ch);
                    if self.object_in_string {
                        if self.object_escape_next {
                            self.object_escape_next = false;
                        } else if ch == '\\' {
                            self.object_escape_next = true;
                        } else if ch == '"' {
                            self.object_in_string = false;
                        }
                    } else {
                        match ch {
                            '"' => {
                                self.object_in_string = true;
                            }
                            '{' => {
                                self.object_depth += 1;
                            }
                            '}' => {
                                self.object_depth -= 1;
                                if self.object_depth == 0 {
                                    match serde_json::from_str::<Map<String, Value>>(
                                        &self.object_raw,
                                    ) {
                                        Ok(map) => {
                                            if let Some(key) = self.current_key.take() {
                                                events.push(StructuredOutputEvent::ObjectFieldComplete {
                                                    key: key.clone(),
                                                    value: map.clone(),
                                                });
                                                self.fields.insert(key, Value::Object(map));
                                            }
                                        }
                                        Err(e) => {
                                            events.push(StructuredOutputEvent::ParseError(
                                                format!(
                                                    "failed to parse object for key '{:?}': {}",
                                                    self.current_key, e
                                                ),
                                            ));
                                            return events;
                                        }
                                    }
                                    self.object_raw.clear();
                                    self.phase = Phase::ExpectCommaOrEnd;
                                }
                            }
                            _ => {}
                        }
                    }
                    self.pos += ch_len;
                }

                Phase::ExpectCommaOrEnd => {
                    match ch {
                        ',' => {
                            self.phase = Phase::ExpectKeyOrEnd;
                        }
                        '}' => {
                            self.phase = Phase::Complete;
                        }
                        _ if ch.is_whitespace() => {}
                        _ => {
                            events.push(StructuredOutputEvent::ParseError(format!(
                                "expected ',' or '}}' but found '{}'",
                                ch
                            )));
                            return events;
                        }
                    }
                    self.pos += ch_len;
                }

                Phase::Complete => {
                    break;
                }
            }
        }

        if self.phase == Phase::InStringValue {
            if let Some(delta) = self.flush_string_delta() {
                events.push(delta);
            }
        }

        events
    }

    pub fn finish(self) -> Result<StructuredOutputResult, String> {
        if self.phase == Phase::Complete {
            Ok(StructuredOutputResult {
                fields: self.fields,
            })
        } else {
            let mut details = String::from("incomplete JSON: ");
            details.push_str(&format!("parser stopped at phase {:?}, ", self.phase));
            details.push_str(&format!("parsed {} bytes, ", self.pos));
            let parsed_keys: Vec<&String> = self.fields.keys().collect();
            if parsed_keys.is_empty() {
                details.push_str("no fields were fully parsed, ");
            } else {
                details.push_str(&format!(
                    "fully parsed fields: [{}], ",
                    parsed_keys.iter().map(|k| k.as_str()).collect::<Vec<_>>().join(", ")
                ));
            }
            if !self.current_string.is_empty() {
                details.push_str(&format!(
                    "partial value for key '{:?}': \"{}\", ",
                    self.active_string_key, self.current_string
                ));
            }
            if !self.object_raw.is_empty() {
                details.push_str(&format!(
                    "partial object for key '{:?}': {} bytes, ",
                    self.current_key, self.object_raw.len()
                ));
            }
            if self.pos < self.buffer.len() {
                details.push_str(&format!(
                    "unprocessed buffer: {:?}",
                    &self.buffer[self.pos..]
                ));
            }
            Err(details)
        }
    }
}

impl Default for StructuredOutputParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collect_string_deltas(events: &[StructuredOutputEvent], key: &str) -> String {
        events
            .iter()
            .filter_map(|e| match e {
                StructuredOutputEvent::StringFieldDelta { key: k, delta } if k == key => {
                    Some(delta.clone())
                }
                _ => None,
            })
            .collect()
    }

    fn find_object_complete(events: &[StructuredOutputEvent], key: &str) -> Option<Map<String, Value>> {
        events.iter().find_map(|e| match e {
            StructuredOutputEvent::ObjectFieldComplete { key: k, value } if k == key => {
                Some(value.clone())
            }
            _ => None,
        })
    }

    #[test]
    fn test_generic_string_fields() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(r#"{"思考": "你好", "正文": "世界"}"#);

        assert_eq!(collect_string_deltas(&events, "思考"), "你好");
        assert_eq!(collect_string_deltas(&events, "正文"), "世界");

        let result = parser.finish().unwrap();
        assert_eq!(result.fields.get("思考").unwrap().as_str(), Some("你好"));
        assert_eq!(result.fields.get("正文").unwrap().as_str(), Some("世界"));
    }

    #[test]
    fn test_object_field() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(r#"{"选项": {"A": "回去", "B": "继续"}}"#);

        let map = find_object_complete(&events, "选项").unwrap();
        assert_eq!(map.get("A").unwrap().as_str(), Some("回去"));
        assert_eq!(map.get("B").unwrap().as_str(), Some("继续"));

        let result = parser.finish().unwrap();
        let obj = result.fields.get("选项").unwrap().as_object().unwrap();
        assert_eq!(obj.get("A").unwrap().as_str(), Some("回去"));
    }

    #[test]
    fn test_mixed_string_and_object_fields() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(
            r#"{"思考": "嗯", "正文": "故事", "选项": {"X": "是", "Y": "否"}}"#,
        );

        assert_eq!(collect_string_deltas(&events, "思考"), "嗯");
        assert_eq!(collect_string_deltas(&events, "正文"), "故事");

        let map = find_object_complete(&events, "选项").unwrap();
        assert_eq!(map.get("X").unwrap().as_str(), Some("是"));

        let result = parser.finish().unwrap();
        assert_eq!(result.fields.len(), 3);
    }

    #[test]
    fn test_incremental_feed() {
        let mut parser = StructuredOutputParser::new();

        let e1 = parser.feed(r#"{"思考": "部"#);
        let e2 = parser.feed(r#"分", "正文": "内"#);
        let e3 = parser.feed(r#"容"}"#);

        assert_eq!(collect_string_deltas(&e1, "思考"), "部");
        assert_eq!(collect_string_deltas(&e2, "思考"), "分");
        assert_eq!(collect_string_deltas(&e2, "正文"), "内");
        assert_eq!(collect_string_deltas(&e3, "正文"), "容");

        let result = parser.finish().unwrap();
        assert_eq!(result.fields.get("思考").unwrap().as_str(), Some("部分"));
        assert_eq!(result.fields.get("正文").unwrap().as_str(), Some("内容"));
    }

    #[test]
    fn test_char_by_char_feed() {
        let mut parser = StructuredOutputParser::new();
        let json = r#"{"thinking": "hello", "text": "world"}"#;

        let mut all_events = Vec::new();
        for ch in json.chars() {
            all_events.extend(parser.feed(&ch.to_string()));
        }

        assert_eq!(collect_string_deltas(&all_events, "thinking"), "hello");
        assert_eq!(collect_string_deltas(&all_events, "text"), "world");
    }

    #[test]
    fn test_json_escape_sequences() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(r#"{"正文": "换行\n制表\t!\"引号\\"}"#);

        assert_eq!(collect_string_deltas(&events, "正文"), "换行\n制表\t!\"引号\\");
    }

    #[test]
    fn test_unicode_escape() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(r#"{"正文": "hello\u0020world"}"#);

        assert_eq!(collect_string_deltas(&events, "正文"), "hello world");
    }

    #[test]
    fn test_empty_string_field() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(r#"{"思考": "", "正文": ""}"#);

        assert_eq!(collect_string_deltas(&events, "思考"), "");
        assert_eq!(collect_string_deltas(&events, "正文"), "");

        let result = parser.finish().unwrap();
        assert_eq!(result.fields.get("思考").unwrap().as_str(), Some(""));
    }

    #[test]
    fn test_empty_object() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed("{}");

        assert!(events.is_empty());

        let result = parser.finish().unwrap();
        assert!(result.fields.is_empty());
    }

    #[test]
    fn test_incomplete_json() {
        let mut parser = StructuredOutputParser::new();
        parser.feed(r#"{"思考": "部"#);

        let result = parser.finish();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("incomplete JSON"));
    }

    #[test]
    fn test_incomplete_json_reports_parsed_fields() {
        let mut parser = StructuredOutputParser::new();
        parser.feed(r#"{"思考": "完成", "正文": "未完"#);

        let result = parser.finish();
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.contains("思考"));
    }

    #[test]
    fn test_object_incremental_feed() {
        let mut parser = StructuredOutputParser::new();

        let e1 = parser.feed(r#"{"选项": {"A": "#);
        let e2 = parser.feed(r#""去", "B": "停"}}"#);

        assert!(!e1.iter().any(|e| matches!(e, StructuredOutputEvent::ObjectFieldComplete { .. })));
        assert!(e2.iter().any(|e| matches!(e, StructuredOutputEvent::ObjectFieldComplete { .. })));

        let result = parser.finish().unwrap();
        let obj = result.fields.get("选项").unwrap().as_object().unwrap();
        assert_eq!(obj.get("A").unwrap().as_str(), Some("去"));
    }

    #[test]
    fn test_nested_object() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(r#"{"data": {"inner": {"deep": "value"}}}"#);

        let map = find_object_complete(&events, "data").unwrap();
        assert!(map.get("inner").unwrap().is_object());

        let result = parser.finish().unwrap();
        assert!(result.fields.get("data").unwrap().is_object());
    }

    #[test]
    fn test_any_key_names() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(r#"{"内心独白": "我在想", "故事": "从前有座山", "行动": {"战斗": "拔剑", "逃跑": "转身"}}"#);

        assert_eq!(collect_string_deltas(&events, "内心独白"), "我在想");
        assert_eq!(collect_string_deltas(&events, "故事"), "从前有座山");

        let map = find_object_complete(&events, "行动").unwrap();
        assert_eq!(map.get("战斗").unwrap().as_str(), Some("拔剑"));
        assert_eq!(map.get("逃跑").unwrap().as_str(), Some("转身"));
    }

    #[test]
    fn test_default_trait() {
        let parser = StructuredOutputParser::default();
        assert_eq!(parser.pos, 0);
        assert_eq!(parser.phase, Phase::BeforeObject);
    }

    #[test]
    fn test_skips_prefix_before_json() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(r#"```json{"思考": "你好", "正文": "世界"}```"#);

        assert_eq!(collect_string_deltas(&events, "思考"), "你好");
        assert_eq!(collect_string_deltas(&events, "正文"), "世界");

        let result = parser.finish().unwrap();
        assert_eq!(result.fields.get("思考").unwrap().as_str(), Some("你好"));
        assert_eq!(result.fields.get("正文").unwrap().as_str(), Some("世界"));
    }

    #[test]
    fn test_skips_text_prefix_before_json() {
        let mut parser = StructuredOutputParser::new();
        let events = parser.feed(r#"Here is the JSON: {"key": "value"}"#);

        assert_eq!(collect_string_deltas(&events, "key"), "value");

        let result = parser.finish().unwrap();
        assert_eq!(result.fields.get("key").unwrap().as_str(), Some("value"));
    }
}
