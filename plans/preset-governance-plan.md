# 预设条目锁与互斥组实施方案

## 目标

在当前预设系统基础上，为所有预设引入两类作者可配置的治理能力：

- 条目锁：防止关键条目被普通编辑流误改、误删、误关闭或误调整顺序
- 互斥组：限制同组条目在同一时刻不能同时启用，保存时若出现冲突则阻止保存并返回明确错误

## 产品策略

基于当前确认的产品方向：

- 所有预设都允许作者配置条目锁
- 所有预设都允许作者配置互斥组
- 互斥冲突不做自动替换
- 互斥冲突在保存阶段阻止提交，并提示用户修正

## 与当前架构的契合点

当前预设系统已经是结构化条目模型，而不是单块 prompt 文本。

可直接复用的现有结构包括：

- 预设块表 [`preset_prompt_blocks`](src-tauri/migrations/0005_preset_system_phase1.sql:17)
- 条目级启用状态 [`is_enabled`](src-tauri/migrations/0005_preset_system_phase1.sql:25)
- 顺序字段 [`sort_order`](src-tauri/migrations/0005_preset_system_phase1.sql:23)
- 优先级字段 [`priority`](src-tauri/migrations/0005_preset_system_phase1.sql:24)
- 预设块输入结构 [`PresetPromptBlockInput`](src-tauri/src/commands/presets.rs:22)
- 预设块输出结构 [`PresetPromptBlockRecord`](src-tauri/src/models/mod.rs:170)
- 保存前归一化入口 [`normalize_blocks()`](src-tauri/src/commands/presets.rs:722)
- 运行时编译入口 [`load_preset_compiler_data()`](src-tauri/src/services/prompt_compiler.rs:792)

因此这两项能力更适合做成“条目元数据约束层”，而不是额外做一套独立预设引擎。

## 推荐设计

### 一、条目锁模型

建议在预设块维度增加以下元数据：

- `is_locked`：是否锁定
- `lock_reason`：锁定原因，可选
- `lock_scope`：锁定范围

推荐的 `lock_scope` 语义：

- `content`：不可改标题、类型、内容
- `toggle`：不可改启用状态
- `order`：不可改顺序与优先级
- `delete`：不可删除
- `full`：以上全部禁止

实现上可先做简化版：

- 第一阶段只落一个 [`is_locked`](src-tauri/migrations/0005_preset_system_phase1.sql:25) 风格的布尔字段
- 后端统一解释为 `full` 锁
- 预留后续扩展到细粒度锁范围

推荐原因：

- UI 和后端规则最容易先对齐
- 便于快速验证产品体验
- 避免一次性把锁模型做得过细

### 二、互斥组模型

建议在预设块维度增加以下元数据：

- `exclusive_group_key`：互斥组标识，同值代表同一组
- `exclusive_group_label`：互斥组显示名称，可选

语义：

- 空值表示不参与互斥
- 同一预设内，拥有相同 `exclusive_group_key` 且 `is_enabled = true` 的条目最多只能有一个
- 允许同组存在多个关闭条目
- 不同预设之间互不影响

推荐不单独建组表，先直接挂在条目上。

原因：

- 当前系统是条目式保存，直接在块记录上加组键最顺手
- 验证逻辑可以完全落在 [`normalize_blocks()`](src-tauri/src/commands/presets.rs:722) 与保存事务中
- 后续若需要组级描述、默认策略、组排序，再演进成独立组表

## 数据层方案

### 方案 A，推荐

在 [`preset_prompt_blocks`](src-tauri/migrations/0005_preset_system_phase1.sql:17) 直接增列：

- `is_locked INTEGER NOT NULL DEFAULT 0`
- `lock_reason TEXT`
- `exclusive_group_key TEXT`
- `exclusive_group_label TEXT`

优点：

- 迁移最小
- 查询最简单
- 不影响当前编译路径读取顺序
- 适合当前单条目编辑模型

缺点：

- 组的元信息暂时不够丰富

### 方案 B，暂不推荐

新增独立表，如：

- `preset_block_constraints`
- `preset_block_exclusive_groups`

优点：

- 规范化更强
- 未来可做复杂治理策略

缺点：

- 当前阶段明显过度设计
- 会抬高读写和前端表单复杂度

## 后端约束设计

### 一、输入结构扩展

扩展 [`PresetPromptBlockInput`](src-tauri/src/commands/presets.rs:22) 与 [`PresetPromptBlockRecord`](src-tauri/src/models/mod.rs:170)：

- `is_locked`
- `lock_reason`
- `exclusive_group_key`
- `exclusive_group_label`

### 二、归一化与校验

在 [`normalize_blocks()`](src-tauri/src/commands/presets.rs:722) 增加以下校验：

1. 规范化互斥组键
   - trim
   - 空字符串转 `None`
   - 可限制长度与字符集

2. 统计同组已启用条目数
   - 仅统计当前提交载荷内 `is_enabled = true` 的块
   - 任一组超过一个启用项则直接报错

3. 锁字段合法性校验
   - `lock_reason` 可选但应 trim
   - 若后续支持 `lock_scope`，则校验枚举值

### 三、保存阶段防护

在 [`presets_create()`](src-tauri/src/commands/presets.rs:132) 与 [`presets_update()`](src-tauri/src/commands/presets.rs:197) 保持“双层保护”：

- 第一层：归一化阶段校验互斥冲突
- 第二层：事务内落库前再次校验数据一致性

这样做的原因：

- 防止未来出现多个入口复用较低层写库函数时绕过校验
- 贯彻仓库要求的零回退、显式失败策略

### 四、锁行为边界

建议把锁行为明确限定为“编辑器约束”，不是运行时编译语义。

也就是说：

- [`load_preset_compiler_data()`](src-tauri/src/services/prompt_compiler.rs:792) 不需要根据锁字段改变编译行为
- 锁只影响创建、修改、删除、启停、排序这些编辑动作
- 编译器只读取最终合法结果

这样可以保持提示编译器职责单纯。

## 前端交互方案

当前 [`CompletionPresetArea`](src/components/CompletionPresetArea.tsx:28) 还是占位 UI，需要在正式预设编辑器里落实以下交互：

### 一、条目锁交互

每个条目展示锁标识：

- 锁定图标
- hover 或详情面板显示 `lock_reason`

锁定条目限制：

- 禁用启停开关
- 禁用删除按钮
- 禁用拖拽排序
- 禁用内容编辑输入区

若用户尝试提交修改锁定条目：

- 前端先阻止
- 后端仍返回硬错误，避免绕过

### 二、互斥组交互

每个条目展示：

- 所属互斥组标签
- 同组状态说明，如 `文风组，仅可启用 1 项`

交互策略按已确认方案：

- 不自动关闭旧项
- 当同组出现多个启用项时，在保存前给出错误提示
- 点击保存后若仍冲突，由后端拒绝并返回明确错误文案

### 三、编译预览辅助

建议在 [`presets_compile_preview`](src-tauri/src/commands/presets.rs:123) 配套界面中补充治理信息：

- 哪些条目被锁定
- 哪些条目属于互斥组
- 当前启用组合是否合法

这能帮助用户理解“为什么不能保存”。

## 错误文案建议

统一采用显式、可定位错误。

示例：

- `preset block 3 is locked and cannot be modified`
- `preset block 5 is locked and cannot be disabled`
- `exclusive group style has multiple enabled blocks: 2, 7`
- `exclusive group narration-tone allows only one enabled block`

## 实施顺序

1. 数据迁移
   - 为 [`preset_prompt_blocks`](src-tauri/migrations/0005_preset_system_phase1.sql:17) 增加锁与互斥字段

2. Rust 模型扩展
   - 扩展 [`PresetPromptBlockInput`](src-tauri/src/commands/presets.rs:22)
   - 扩展 [`PresetPromptBlockRecord`](src-tauri/src/models/mod.rs:170)
   - 扩展内部归一化结构 [`NormalizedPresetPromptBlockInput`](src-tauri/src/commands/presets.rs:33)

3. 后端校验
   - 在 [`normalize_blocks()`](src-tauri/src/commands/presets.rs:722) 增加互斥校验
   - 在保存事务链增加防绕过校验

4. 读写链路
   - 更新块读取与写入 SQL
   - 更新 [`load_preset_detail()`](src-tauri/src/commands/presets.rs:308) 返回结构

5. 前端编辑器
   - 在预设条目列表和详情面板展示锁与互斥组
   - 对锁定条目禁用编辑操作
   - 保存前做本地互斥校验

6. 预览与调试
   - 在预设编译预览中显示治理元数据
   - 补充错误状态展示

7. 测试
   - 归一化校验测试
   - SQL 读写回归测试
   - 编译预览回归测试
   - 前端交互测试

## 推荐默认值

- `is_locked` 默认 `false`
- `lock_reason` 默认空
- `exclusive_group_key` 默认空
- `exclusive_group_label` 默认空
- 互斥约束仅在同一预设内部生效
- 仅对启用态条目执行互斥冲突判定

## 兼容性说明

- 旧预设迁移后默认不加锁、不分组
- 因此老数据行为保持不变
- 新能力只对作者主动配置的条目生效

## 风险点

- 风险点：若前端只做展示不做禁用，用户会在保存阶段频繁遇到错误
- 影响范围：预设编辑体验、表单可理解性
- 建议的修正方向：前后端同时实现约束，前端做即时提示，后端做最终裁决

- 风险点：若互斥组只按标题显示而没有稳定键值，后续重命名会导致组关系漂移
- 影响范围：预设编辑一致性、数据迁移稳定性
- 建议的修正方向：使用稳定的 `exclusive_group_key` 作为机器键，`exclusive_group_label` 只做显示

## 推荐结论

建议实现，而且优先级较高。

原因：

- 与当前条目式预设架构天然匹配
- 能直接降低错误组合带来的 prompt 污染
- 能把 SillyTavern 社区里的经验沉淀成结构化治理能力
- 对现有编译器侵入较小，主要变更集中在预设元数据、保存校验和编辑器交互

## 交接建议

实现时建议拆成两个连续任务：

1. 后端先完成数据模型、迁移、校验和返回结构
2. 前端再补条目治理 UI 与错误提示

这样可以保证前端接入时有稳定契约可依赖。
