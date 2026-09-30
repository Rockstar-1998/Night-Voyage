# Tasks

- [x] Task 1: 创建便携预设 JSON 文件骨架
  - [x] 1.1: 创建 PortablePresetFile 结构（schema_version, format, preset 元数据）
  - [x] 1.2: 设置预设参数（response_mode: structured_json, temperature, top_p 等）
  - [x] 1.3: 填入 structured_output_schema JSON Schema
  - [x] 1.4: 设置默认停止序列

- [x] Task 2: 创建核心提示块（direct blocks）
  - [x] 2.1: 创建主系统提示块（jailbreak），整合原 jailbreak identifier 的阶段一/二内容
  - [x] 2.2: 创建阅读引导块
  - [x] 2.3: 创建用户偏好读取/结束块
  - [x] 2.4: 创建输出前准备块（阶段二注入强调要求）
  - [x] 2.5: 创建 prefill 块，引导模型输出 JSON 结构
  - [x] 2.6: 创建破限 few-shot 示例块
  - [x] 2.7: 创建叙事中立块（作为常驻 direct block）

- [x] Task 3: 创建单选语义组（17 组）
  - [x] 3.1: paraphrase 转述模式组（3 选项）
  - [x] 3.2: user_control 抢话控制组（4 选项）
  - [x] 3.3: nsfw_arousal NSFW发情组（3 选项）
  - [x] 3.4: nsfw_style NSFW风格组（5 选项）
  - [x] 3.5: writing_style 文风组（8 选项）
  - [x] 3.6: dialogue_amount 对白量组（4 选项）
  - [x] 3.7: pacing 推进速度组（3 选项）
  - [x] 3.8: pov 人称视角组（4 选项）
  - [x] 3.9: profanity 粗鄙之语组（3 选项）
  - [x] 3.10: system_role 系统扮演组（3 选项）
  - [x] 3.11: inner_voice 内心OS组（4 选项）
  - [x] 3.12: thinking_chain 思维链组（4 选项）
  - [x] 3.13: reasoning_effort 思考强度组（4 选项）
  - [x] 3.14: output_format 正文格式组（4 选项）
  - [x] 3.15: word_count 字数组（6 选项）
  - [x] 3.16: anti_cliche 杀八股组（2 选项）
  - [x] 3.17: language 语言组（3 选项）

- [x] Task 4: 创建多选语义组（2 组）
  - [x] 4.1: extras 额外设定组（8 选项）
  - [x] 4.2: output_extras 输出附加组（7 选项）

- [x] Task 5: 内容重写与适配
  - [x] 5.1: 将所有提示词中的 XML 标签引用改为 JSON 字段引用
  - [x] 5.2: 将所有 {{setvar::}}/{{getvar::}} 语法移除
  - [x] 5.3: 将 SillyTavern 模板变量替换
  - [x] 5.4: 确保思维链提示词引导模型在 JSON 的 thinking 字段中输出
  - [x] 5.5: 确保正文提示词引导模型在 JSON 的 content 字段中输出
  - [x] 5.6: 确保行动选项提示词引导模型在 JSON 的 choices 字段中输出

- [x] Task 6: 验证与测试
  - [x] 6.1: 验证 JSON 文件格式正确，可被解析
  - [x] 6.2: 验证所有语义组选项的 blocks 内容完整且无 SillyTavern 残留语法
  - [x] 6.3: 验证 structured_output_schema 符合 OpenAI Structured Outputs 要求
  - [x] 6.4: 修复 output_extras 缺失选项，将禁止机械词语/禁止滥用比喻/用户指令优先从 direct blocks 移至 output_extras 组

# Task Dependencies
- Task 2 depends on Task 1
- Task 3 depends on Task 1
- Task 4 depends on Task 1
- Task 5 depends on Task 2, Task 3, Task 4
- Task 6 depends on Task 5
