# Night Voyage 版可待预设迁移准备

## 文档目标

本文用于在真正移植可待预设前，先冻结 Night Voyage 预设系统的 canonical schema、兼容边界与迁移原则，避免边迁移边改协议导致结构漂移。

本文重点回答：

1. Night Voyage 预设的最终真相是什么
2. 旧版平铺预设与新版语义树预设如何兼容
3. 哪些能力应当固定为一级语义组
4. 可待预设迁移时，哪些内容优先落语义组，哪些内容应落自由 block

---

## 一、Canonical Schema 结论

Night Voyage 预设系统应明确分成两层：

### 1. 运行时真相层

运行时 Prompt Compiler 只应消费已经物化好的结构化结果，也就是：

- [`preset_prompt_blocks`](src-tauri/migrations/0005_preset_system_phase1.sql:17)
- [`preset_examples`](src-tauri/migrations/0006_preset_examples_phase2.sql:1)
- `presets` 参数字段
- `preset_stop_sequences`
- `preset_provider_overrides`

对应运行时装配入口仍是：

- [`load_preset_compiler_data()`](src-tauri/src/services/prompt_compiler.rs:831)
- [`compile_prompt()`](src-tauri/src/services/prompt_compiler.rs:384)

**结论：运行时 canonical schema = 物化后的 blocks / examples / params。**

### 2. 编辑时真相层

编辑时允许存在语义树，以承载父项 / 子项结构，也就是：

- [`preset_semantic_groups`](src-tauri/migrations/0014_preset_semantic_groups_phase11.sql:1)
- [`preset_semantic_options`](src-tauri/migrations/0014_preset_semantic_groups_phase11.sql:15)
- [`preset_semantic_option_blocks`](src-tauri/migrations/0016_preset_semantic_option_materials_phase12.sql:1)
- [`preset_semantic_option_examples`](src-tauri/migrations/0016_preset_semantic_option_materials_phase12.sql:21)

对应后端读写入口是：

- [`PresetSemanticGroupRecord`](src-tauri/src/models/mod.rs:291)
- [`PresetSemanticOptionRecord`](src-tauri/src/models/mod.rs:270)
- [`presets_create()`](src-tauri/src/commands/presets.rs:253)
- [`presets_update()`](src-tauri/src/commands/presets.rs:323)
- [`load_preset_detail()`](src-tauri/src/commands/presets.rs:451)

**结论：编辑时 canonical schema = 语义树 + 自由条目编辑能力。**

### 3. 两层之间的关系

Night Voyage 必须坚持：

- 语义树负责编辑体验
- 保存期后端负责展开与物化
- 运行时编译器只读物化结果

一句话说：

**语义树是编辑真相，物化结果是运行真相。**

---

## 二、兼容边界

### 1. 旧版预设

旧版预设如果只有：

- `blocks`
- `examples`
- `params`

而没有语义树，仍然是合法预设。

### 2. 新版预设

新版预设可以同时拥有：

- 语义树
- 物化后的 blocks / examples / params

其中：

- 语义树用于编辑
- 物化结果用于运行

### 3. 兼容性结论

**旧版预设与新版预设在运行时是兼容的。**

差别只在于：

- 旧版只有运行模型
- 新版多了一层编辑模型

因此在移植可待预设前，不应继续改动运行时编译协议，只应在编辑层补充能力。

---

## 三、应冻结的一级语义组

以下能力建议正式冻结为一级语义组，并使用稳定机器键：

### 1. 会话类型组

- group key: `conversation-mode`
- options:
  - `single`
  - `group`

语义：

- 这套预设主要用于单人会话还是多人会话
- 组内单选

### 2. 内容类型组

- group key: `content-rating`
- options:
  - `sfw`
  - `nsfw`

语义：

- 这套预设主要属于 SFW 还是 NSFW
- 组内单选

### 3. 其他高频组

后续可继续冻结，但在可待迁移前建议至少先稳定以下机器键：

- `narrative-perspective`
- `reply-length`
- `retelling-policy`
- `story-pace`
- `thought-mode`

这些组适合承载可待中最常见、最稳定、最容易冲突的部分。

---

## 四、安全区 / 自由区的正式定义

`安全区 / 自由区` 应当被定义为：

- 展示层分区
- 编辑器分区
- 作者心智模型分区

而**不应新增为运行时编译语义**。

### 1. 安全区

建议放：

- 条目锁条目
- 互斥条目
- 一级语义组
- 主提示词骨架
- 高频基础规则

### 2. 自由区

建议放：

- 作者自定义 block
- 实验性补丁
- 个性化风格条目
- 临时增强条目

### 3. 架构约束

无论条目显示在安全区还是自由区，运行时最终都只落入：

- [`PresetPromptBlockRecord`](src-tauri/src/models/mod.rs:173)
- [`PresetExampleRecord`](src-tauri/src/models/mod.rs:194)
- 参数层

**结论：安全区 / 自由区是 UI 分类，不是运行时 schema 字段。**

---

## 五、可待预设迁移原则

Night Voyage 版可待预设迁移时，应采用：

**语义组优先，剩余内容落自由 block。**

### 1. 优先迁入语义组的内容

可待里下列内容最适合优先迁入语义组：

- 单人 / 多人
- SFW / NSFW
- 第一人称 / 第二人称 / 第三人称
- 字数长度
- 转述方式
- 剧情推进方式
- 思考方式
- 文风大类

原因：

- 这些内容高频
- 强互斥
- 语义稳定
- 用户更容易理解

### 2. 优先落自由 block 的内容

可待里下列内容更适合落自由 block：

- 个性化风格补丁
- 特殊剧情规则
- 作者自定义禁词库
- 实验性补充说明
- 不适合归入固定语义组的特殊要求

### 3. few-shot 的处理

如果可待中存在示例对话内容，应优先迁入：

- [`PresetExampleRecord`](src-tauri/src/models/mod.rs:194)

而不是重新揉回规则块文本里。

### 4. 参数的处理

如果可待中存在明显的采样参数偏好，应落入参数层，而不是写成普通提示词说明。

---

## 六、迁移时不应做的事

在真正迁移可待预设前，明确以下非目标：

- 不把 ST 宏系统 1:1 搬入 Night Voyage 运行时
- 不把“前后夹文本块”重新引入 Night Voyage 的预设编辑体验
- 不为了兼容可待而改写 [`load_preset_compiler_data()`](src-tauri/src/services/prompt_compiler.rs:831) 的运行时真相模型
- 不把安全区 / 自由区、标签、来源说明做成运行时编译字段
- 不让迁移规则依赖显示名，必须依赖稳定机器键

---

## 七、迁移前冻结清单

在正式开始 Night Voyage 版可待预设前，建议视为必须冻结：

1. 一级语义组机器键
2. 语义树 -> 物化结果的展开规则
3. 安全区 / 自由区只作为展示分区
4. 旧版 / 新版预设的兼容边界
5. 可待条目落语义组还是落自由 block 的分类标准

只要这 5 项冻结，后续可待迁移就不会边迁移边漂移。

---

## 八、最短总结

Night Voyage 版可待预设的正确准备方式不是“直接把可待整包塞进一个 system”，而是：

- 先冻结 Night Voyage 的 canonical schema
- 再把可待中稳定、通用、互斥明显的内容优先映射为语义组
- 剩余个性化内容落入自由 block
- 最终仍由保存期后端展开为运行时物化结果

一句话说：

**先冻结盒子，再把可待零件按盒子分类放进去。**
