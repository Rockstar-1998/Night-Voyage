# Night Voyage 预设系统架构说明

## 文档目标

本文用于定义 Night Voyage 的预设系统实现方向，确保它能够与：

- 角色卡
- 世界书
- 历史总结
- 向量检索
- 多 provider 模型适配
- 未来 agent 化编排

稳定协同工作。

本文重点回答：

1. 预设系统到底负责什么
2. 预设系统应当如何建模
3. 它是否必须是固定模板
4. 它如何被 Prompt Compiler 编译
5. 它如何与角色卡、世界书、历史层协作

---

## 核心原则

Night Voyage 的预设系统不应该是：

- 一个大号 system prompt 文本框
- 一个完全固定、不可扩展的死模板
- 一个和角色卡、世界书职责重叠的“万能配置箱”

最推荐的形态是：

**底层编译协议固定，上层内容模块自由组合。**

也就是说：

- 固定的是：预设如何被存储、排序、裁剪、编译
- 灵活的是：用户可以放哪些 block、few-shot、参数与覆盖规则

换句话说：

**预设不是死模板，而是一组可排序、可开关、可继承、可覆盖、可编译的生成策略模块。**

---

## 一、预设系统的职责边界

预设系统只负责“怎么写”，不负责“谁来写”，也不负责“世界里有什么”。

### 预设系统应该负责

- 生成风格
- 叙事节奏
- 输出格式
- 长度偏好
- 结构化输出模式
- few-shot 示例
- 采样参数归属
- provider 兼容覆盖
- Prompt Compiler 的部分运行策略

### 预设系统不应该负责

- 角色是谁
- 角色的基础人格底座
- 世界里有哪些设定
- 当前剧情发生了什么
- 当前角色后来成长成什么样

这些分别属于：

- 角色卡
- 世界书
- 剧情总结层
- 角色状态覆盖层

---

## 二、推荐的预设系统结构：4 + 1 层

## 1. 预设元信息层

用于管理，不直接注入 prompt。

建议字段：

- `id`
- `name`
- `description`
- `category`
- `is_builtin`
- `version`
- `created_at`
- `updated_at`

作用：

- 预设列表展示
- 分类筛选
- 内置 / 用户自定义区分
- 版本迁移

---

## 2. Prompt Blocks 层

这是预设的核心内容层。

预设不应该只是一段大文本，而应该拆成多个 block。

### 推荐的官方 block type

- `style`
- `format`
- `safety`
- `narration`
- `roleplay`
- `author_note`
- `summary_policy`
- `output_constraint`

### 同时允许 custom block type

例如：

- `custom:emotional-tone`
- `custom:combat-style`
- `custom:poetic-layer`

### 每个 block 的统一字段

- `id`
- `preset_id`
- `block_type`
- `title`
- `content`
- `sort_order`
- `priority`
- `is_enabled`
- `scope`
- `is_locked`
- `lock_reason`
- `exclusive_group_key`
- `exclusive_group_label`

### 推荐 scope

- `global`
- `chat_only`
- `group_only`
- `single_only`
- `completion_only`
- `agent_only`

这样做的优点：

- 顺序可控
- 可以单独开关
- 可以局部继承
- 可以做 token 裁剪
- 可以做编译预览
- 可以承载条目级治理约束

### Prompt Blocks 治理元数据

为了避免核心条目被误改，以及避免同类风格条目同时开启造成冲突，推荐在 Prompt Blocks 层补充两类治理元数据：

- 条目锁：`is_locked` + `lock_reason`
- 互斥组：`exclusive_group_key` + `exclusive_group_label`

推荐规则：

- 条目锁只属于编辑期与保存期约束，不改变运行时 Prompt Compiler 的编译语义
- 锁定条目可用于禁止修改、禁用、删除与排序调整；第一阶段可先实现为统一的 full lock
- 同一预设内，相同 `exclusive_group_key` 且 `is_enabled = 1` 的 block 最多只能有一个
- 命中互斥冲突时，保存必须显式报错，不做静默自动修复或自动切换
- 互斥组的机器键应稳定，显示名可单独演进，避免因重命名造成组关系漂移

配套实施方案见 [`plans/preset-governance-plan.md`](plans/preset-governance-plan.md)。

---

## 3. Few-shot 示例层

这一层保存对话示例，用于教模型“这种预设下该怎么说话 / 怎么排版 / 怎么组织输出”。

### 推荐字段

- `id`
- `preset_id`
- `role`
- `content`
- `sort_order`
- `is_enabled`

### 作用

适合教：

- 语气
- 格式
- 叙事颗粒度
- 回答短长

不适合教：

- 世界观事实
- 某个角色的固定设定
- 当前剧情历史

### 注入建议

- 不进主 `system` 文本
- 以 few-shot `assistant/user` 示例消息形式插在 `system` 后、真实历史前

---

## 4. 采样参数层

这层是你已经明确要从 API 档案里迁走的内容。

### 建议纳入的参数

- `temperature`
- `max_output_tokens`
- `top_p`
- `presence_penalty`
- `frequency_penalty`
- `repetition_penalty`
- `stop_sequences`
- `response_mode`

### 原则

- API 档案只描述“连接谁”
- 预设只描述“如何生成”

所以：

- provider / model -> API 档案
- 采样参数 -> 预设

### 注入位置

- 不注入 prompt 文本
- 直接注入模型请求体参数层

---

## 5. Provider Override 层（+1 层）

这一层是可选高级功能。

作用：

- 针对不同 provider 做兼容覆盖
- 保持“同一个预设”跨 provider 尽量行为一致

### 例如

- `temperature_override`
- `max_output_tokens_override`
- `top_p_override`
- `response_mode_override`
- `stop_sequences_override`
- `disabled_block_types`

### 原则

- 默认预设只定义通用策略
- provider override 只修兼容问题
- 不要让 override 把整个预设重新复制一遍

---

## 三、推荐的数据表设计

## 1. `presets`

主表，存元信息与基础参数。

建议字段：

- `id`
- `name`
- `description`
- `category`
- `is_builtin`
- `temperature`
- `max_output_tokens`
- `top_p`
- `presence_penalty`
- `frequency_penalty`
- `response_mode`
- `created_at`
- `updated_at`

## 2. `preset_prompt_blocks`

建议字段：

- `id`
- `preset_id`
- `block_type`
- `title`
- `content`
- `sort_order`
- `priority`
- `is_enabled`
- `scope`
- `is_locked`
- `lock_reason`
- `exclusive_group_key`
- `exclusive_group_label`

治理约束建议：

- 条目锁只作用于编辑与保存，不参与运行时编译排序
- 同一预设内，相同 `exclusive_group_key` 且 `is_enabled = 1` 的 block 最多只能有一个
- 保存命中互斥冲突时必须显式报错，不允许静默自动关闭旧条目

## 3. `preset_examples`

建议字段：

- `id`
- `preset_id`
- `role`
- `content`
- `sort_order`
- `is_enabled`

## 4. `preset_stop_sequences`

建议字段：

- `id`
- `preset_id`
- `stop_text`
- `sort_order`

## 5. `preset_provider_overrides`

建议字段：

- `id`
- `preset_id`
- `provider_kind`
- `temperature_override`
- `max_output_tokens_override`
- `top_p_override`
- `response_mode_override`
- `stop_sequences_override`
- `disabled_block_types`

## 6. `preset_compiler_cache`（可选）

建议字段：

- `preset_id`
- `compiled_hash`
- `compiled_system_text`
- `compiled_examples_hash`
- `updated_at`

---

## 四、预设与其他层的协作关系

### 预设 vs 角色卡

- 预设定义“怎么写”
- 角色卡定义“谁来写”

所以：
- 预设不应塞角色具体人格事实
- 角色卡不应塞太多生成规则

### 预设 vs 世界书

- 预设定义“表现方式”
- 世界书定义“背景设定”

所以：
- 预设不应大量承载世界观设定
- 世界书不应负责风格约束

### 预设 vs 历史总结

- 预设定义“表达策略”
- 总结定义“到目前为止发生了什么”

所以：
- 预设不能取代剧情总结
- 剧情总结不能替代风格规则

---

## 五、最推荐的编译顺序

### Prompt Compiler 最终顺序

1. 预设 Prompt Blocks -> `system`
2. 角色卡基础层 -> `system`
3. 角色状态覆盖层 -> `system`
4. 世界书命中层 -> `system`
5. 剧情总结层 -> `system`
6. 向量细节层 -> `system` 的低权重参考区
7. 预设 Few-shot 示例 -> `assistant/user` 示例消息层
8. 最近原文窗口 -> `assistant/user history`
9. 当前轮输入 -> 最后一条 `user`

### 为什么这么排

- 预设先决定规则
- 再决定角色是谁
- 再告诉模型角色后来变成了什么样
- 再补当前场景设定
- 再补历史主线
- 再补少量检索细节
- 然后进入 few-shot 示例
- 最后是真实历史和当前输入

---

## 六、是不是所有预设都必须按一个固定模板来？

答案：**不是。**

但也不能完全无约束。

### 正确做法

- 底层编译协议固定
- 上层内容模块自由组合

也就是说：

#### 固定的是

- 预设如何被保存
- 如何排序
- 如何注入
- 如何被 provider override 覆盖
- 如何被调试和裁剪

#### 不固定的是

- block 数量
- block 类型组合
- few-shot 数量
- 是否启用某些 block
- provider override 是否存在
- 是否继承父预设

### 最终形态

Night Voyage 的预设系统不应该是：
- 一个固定表单
- 一个单文本框

而应该是：

**结构化协议 + 可组合模块系统。**

---

## 七、推荐的交互形态：单模式语义选项优先

当前更推荐的 Night Voyage 预设交互，不是把能力切成“小白模式 / 高级模式 / 专家模式”三套入口强行让用户选边站，而是：

**前台始终保持一个说人话的统一界面，后台继续使用结构化 Prompt Blocks 编译。**

也就是说：

- 用户看到的是“效果项”与“子选项”
- 系统内部保存的是 block、few-shot、参数与治理元数据
- Prompt Compiler 消费的仍然是结构化结果，而不是前台选项文案本身

### 1. 推荐的前台语义项

前台应优先暴露用户能直接理解的写作语义，例如：

- 叙事视角
- 剧情推进方式
- 输出长度
- 对话占比
- 文风基底
- 思考方式
- 特殊功能

这些都属于“用户想要什么效果”，而不是“Prompt 该怎么拼”。

### 2. 子选项优先于前后拼装条目

对于 ST 中常见的“前条目 + 后条目 + 中间补丁条目”组合，Night Voyage 更推荐提升为一个完整语义组选项。

例如：

- `思考方式`
  - `不显式思考`
  - `简短思考`
  - `结构化思考`
  - `深度思考`
- `叙事视角`
  - `第二人称`
  - `第一人称`
  - `限知第三人称`
  - `全知第三人称`
- `剧情推进`
  - `用户主导`
  - `协同推进`
  - `世界推动`

这样做的含义是：

- 用户只选择“完整能力”
- 不直接面对前后夹击式文本拼装细节
- 组内单选天然满足互斥约束
- 后台仍可把一个子选项展开成多个底层 blocks

### 3. 语义组选项与底层 blocks 的关系

推荐采用：

**语义组选项 -> 预设展开层 -> Prompt Blocks / Params / Examples**

也就是：

1. 用户在统一界面中选择一个语义子选项
2. 前端或保存层把该选择映射为稳定的机器键
3. 保存时将机器键展开为对应的底层 block 组合、参数值或 few-shot 绑定
4. Prompt Compiler 只消费最终展开后的结构化结果

这能保证：

- 前台交互始终简单
- 后台编译始终稳定
- 不需要暴露 ST 式宏拼装体验
- 不需要为了控制复杂度再做一套显式的“模式切换”

### 4. 互斥组继续作为底层治理能力

语义组选项的“单选感”，底层仍建议落在现有治理模型上：

- `exclusive_group_key`
- `exclusive_group_label`

规则不变：

- 同一组内最多只能启用一个 block
- 保存命中冲突时必须显式报错
- 前台应尽量在交互层就把它收敛成单选组，而不是让用户先冲突再报错

### 5. 推荐的产品原则

Night Voyage 预设系统在交互层应遵循以下原则：

- 不让用户操作“拼法”，只让用户操作“效果”
- 不暴露“前条目 / 后条目 / 中间补丁条目”这类实现细节
- 不让用户理解 Prompt 工程术语后才能改预设
- 不把复杂度删掉，而是把复杂度收纳到底层结构化编译流程中

一句话说：

**对用户，预设是可直接选择的写作效果；对系统，预设仍然是一组可排序、可治理、可编译的结构化块。**

### 6. 推荐落地：编辑期双层，运行期单层

为了兼顾单模式交互、作者自由与运行时性能，更推荐采用：

**编辑期双层，运行期单层。**

也就是：

- 编辑期保留“语义组选项树”这一层，供作者以缩进子项方式组织预设
- 保存期由后端统一完成校验与展开
- 运行期 Prompt Compiler 只读取已经物化好的 `preset_prompt_blocks`、`preset_examples` 与采样参数

推荐原因：

- 前台可以始终维持一个统一界面
- 后端可以作为唯一裁决层，避免前后端展开规则漂移
- 运行热路径不需要在每次发送消息时重新解析语义树
- 现有结构化编译链可以继续复用

### 7. 数据层建议

更推荐新增独立表保存“编辑态语义树”，而不是把缩进结构长期寄存在类似 markdown 头标记的纯文本协议里。

推荐原因：

- 更容易做单选、缩进、排序与显式错误提示
- 更容易支持拖拽、折叠、复制与组合编辑
- 更容易在后端做稳定展开与校验
- 可以把语义树视为编辑模型，把 blocks 视为运行模型

markdown 风格头标记更适合作为：

- 导入导出格式
- 调试视图
- 过渡期临时表示

不建议作为长期主存储。

### 8. 性能原则

语义组选项树不应进入运行时热路径。

推荐实现：

1. 编辑时读取语义树
2. 保存时由后端展开为物化 blocks / examples / params
3. 编译时继续只读取最终展开后的结构化结果

这样可以保证：

- 预设编辑能力增强
- 编译路径保持稳定
- 不需要让 Prompt Compiler 在生成时临时遍历语义树

### 9. 自由度原则

不建议把语义组选项做成封闭白名单。

更推荐：

- 系统提供一批高频语义组作为默认能力
- 预设作者允许自定义新的语义组与子项
- 预设作者也允许直接编写自由 block
- 编译器只关心最终展开后的结构化结果，不限制作者必须只走某一种编辑方式

一句话说：

**语义组选项负责常见能力，自由 block 负责作者扩展。**

---

## 八、与 SillyTavern 的差异

### SillyTavern

更像：
- prompt 工作台
- 大量灵活手工拼接
- 实验速度快
- 高自由，但容易乱

### Night Voyage

更适合：
- 后端主导的结构化编译
- 长历史、大世界书、大角色卡
- 角色成长与状态覆盖
- 多人会话
- 未来 agent 化

### 一句话区别

- SillyTavern 更像 prompt 实验平台
- Night Voyage 更像结构化叙事编译器

---

## 九、推荐实现顺序

### 第 1 阶段

先实现：
- `presets`
- `preset_prompt_blocks`
- 基础采样参数字段

### 第 2 阶段

再实现：
- `preset_examples`
- 会话 / 角色卡默认预设绑定
- Prompt Compiler 编译预览

### 第 3 阶段

最后实现：
- `preset_provider_overrides`
- 预设继承
- 编译缓存
- token 预算与裁剪可视化

---

## 十、最终结论

Night Voyage 的预设系统最推荐做成：

- 一组结构化 Prompt Blocks
- 一组 few-shot 示例
- 一组采样参数
- 一层 provider 兼容覆盖

其中：
- Prompt Blocks -> `system`
- few-shot -> `assistant/user` 示例消息层
- 采样参数 -> 请求参数层
- provider override -> 编译覆盖层

所以它足够灵活，但不是无约束地“随便拼一锅大 prompt”。

最好的形态是：

**底层模板化（编译协议固定），上层组合化（模块自由组合）。**
