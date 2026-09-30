# Spec: 蓝图横向布局回退 + UE 式分类引脚 + 真数据流 + 采样参数双版本 + Schema 字段顺序可控

## 1. 背景与动机

### 1.1 四项变更的由来

| 编号 | 变更 | 动机 |
|------|------|------|
| A | 画布布局回退为横向 | 竖向布局（提交 `118c385` 引入）实际使用中连线走向与阅读习惯不符，需回到经典横向节点图 |
| B | 所有节点引入 UE 式分类引脚 + 真数据流 | 现有端口无种类语义，连线可任意互连；值传递靠 Branch 回溯上游节点配置，是隐式耦合 |
| C | Sampling Params 拆分 OpenAI / Anthropic 两版 | 单一节点混杂两套协议专属字段（OpenAI 的 frequency/presence penalty 与 Anthropic 的 thinking），作者无法判断哪些字段对当前协议有效 |
| D | Schema Field 执行顺序可控 | `order_schema_properties()` 硬编码 `thinking → text → 其余字母序`，作者完全无法控制字段在 JSON Schema 中的先后顺序 |

### 1.2 设计原则

- **C1 前端只渲染**：引脚种类是否合法、值如何求值、哪个采样版本生效、字段如何排序，全部由 Rust 决定
- **C2 零回退**：protocol 非法、value 引脚未连接、引脚种类不匹配，一律显式报错，绝不静默兜底或默认按某一分支处理
- **C5 双端独立**：`src/` 与 `src-mobile/` 各自实现布局与表单，仅共享 `src/lib/blueprint/types.ts` 的类型契约
- **C7 双端覆盖**：每项变更 PC 与移动端同步落地

## 2. 变更 A：画布布局回退为横向

### 2.1 回退范围（严格限定）

竖向布局由提交 `118c385` 引入，该提交同时改动 33 个文件（含 `thinking` 字段双端补全、`SubSchemaEditor.tsx`、`FieldDisplayConfig.body`、`provider_adapter.rs` 等）。**禁止整体 revert**，只手工还原以下四类布局代码：

1. 布局常量
2. `computeNodeLayout`
3. `bezierPath`
4. `autoLayout`
5. 两个 canvas 的端口标签排版

**保留**：thinking 字段、`SubSchemaEditor`、`FieldDisplayConfig.body`、节点头部执行顺序徽章（`aa40987`）。

### 2.2 布局契约

| 项 | 竖向（废弃） | 横向（目标） |
|---|---|---|
| `PORT_COL_WIDTH` | 存在（28） | **删除**，横向版无此常量 |
| 宽度 | `max(NODE_WIDTH, cols * PORT_COL_WIDTH)` | 固定 `NODE_WIDTH` |
| 高度 | `HEADER_HEIGHT + PORT_ROW_HEIGHT * 2` | `HEADER_HEIGHT + PORT_ROW_HEIGHT * rows`，`rows = max(inputs, outputs, 1)` |
| 输入端口 | `x = width/2 + (i-(n-1)/2)*PORT_COL_WIDTH`，`y = 0` | `x = 0`，`y = HEADER_HEIGHT + PORT_ROW_HEIGHT*(row + 0.5)` |
| 输出端口 | `x = width/2 + (i-(n-1)/2)*PORT_COL_WIDTH`，`y = height` | `x = width`，`y = HEADER_HEIGHT + PORT_ROW_HEIGHT*(row + 0.5)` |
| 贝塞尔 | `dy` 垂直控制点 | `dx = max(\|to.x-from.x\|, BEZIER_MIN_SPAN)/2` 水平控制点 |
| autoLayout | 层深 → Y 轴、层内 → X 轴 | 层深 → X 轴、层内 → Y 轴（轴交换回横向） |

### 2.3 端口标签排版

竖向版用 `text-anchor="middle"` 且 `y = port.y ± 12`，横向版必须改为：

- 输入侧：`text-anchor="start"`，`x = port.x + 偏移`
- 输出侧：`text-anchor="end"`，`x = port.x - 偏移`

移动端 `MobileBlueprintCanvas.tsx` 的 `r=14` 透明命中圈是触控必需，**必须保留**。

## 3. 变更 B：UE 式分类引脚

### 3.1 引脚种类

| 种类 | 含义 | 形状 | 说明 |
|---|---|---|---|
| `exec` | 执行流 | 白色三角形 | 驱动节点执行顺序 |
| `value` | 值数据 | 圆形 | 承载会话属性值，按数据类型着色 |
| `bool` | 布尔判定出口 | 菱形 | 分支节点的判定结果出口 |

### 3.2 逐节点引脚表

| 节点类型 | 输入引脚 | 输出引脚 | 节点性质 |
|---|---|---|---|
| `start` | — | exec `out` | 执行节点 |
| `end` | exec `in` | — | 执行节点 |
| `prompt` | exec `in` | exec `out` | 执行节点 |
| `schema_field` | exec `in` | exec `out` | 执行节点 |
| `sampling_params`（legacy） | exec `in` | exec `out` | 执行节点 |
| `sampling_params_openai` | exec `in` | exec `out` | 执行节点 |
| `sampling_params_anthropic` | exec `in` | exec `out` | 执行节点 |
| `mutex_gate` | exec `in` | bool `out_{key}` × N | 布尔判定节点 |
| `group_gate` | exec `in` | bool `out_{key}` × N | 布尔判定节点 |
| `mode_switch` | exec `in` | bool `out_legacy` / `out_mem0` / `out_stateless` | 布尔判定节点 |
| `role_switch`（已废弃） | exec `in` | bool `out_single` / `out_online` | 布尔判定节点 |
| `constant` | **—（无入口）** | value `out` | **纯值节点** |
| `branch` | exec `in` + value `in` | bool `out_*` × N（cases + `default_port`） | 布尔判定节点 |

**关键**：`constant` 作为纯值节点**只有出口连线**，不参与执行流。这是 UE 的 Pure Node 语义。

### 3.3 端口模型契约

前端双端共享（`src/lib/blueprint/types.ts`）：

```ts
/** 引脚种类：exec＝执行流，value＝值数据，bool＝布尔判定分支出口。 */
export type PortKind = 'exec' | 'value' | 'bool';

export interface PortDescriptor {
  port: string;
  label: string | null;
  kind: PortKind;
  direction: 'input' | 'output';
  /** 仅 value 引脚携带：当前唯一取值 'string'（会话属性）。 */
  valueType?: 'string';
}
```

`PortLayout.kind` 语义从 `input|output` 改为承载引脚种类，`direction` 单独表达进出方向。

### 3.4 连线校验

校验规则（Rust 与前端双端一致实现，拒绝时给出可读提示）：

1. 起点必须是 output 方向、终点必须是 input 方向（既有）
2. 禁止自连（既有）
3. 禁止成环（既有）
4. 禁止重复边（既有）
5. **新增：引脚种类必须兼容**
6. **新增：value 引脚的数据类型必须一致**（当前仅 `string`）

兼容性规则：

| 起点 | 终点 | 是否允许 | 说明 |
|---|---|---|---|
| exec 出 | exec 入 | ✓ | 执行流直连 |
| bool 出 | exec 入 | ✓ | bool 是判定节点的分支出口，本质是执行流出口 |
| exec 出 / bool 出 | value 入 | ✗ | 执行流不能当作值 |
| value 出 | value 入 | ✓（类型须一致） | 真数据流 |
| value 出 | exec 入 / bool 入 | ✗ | 值不能驱动执行 |
| 任何 | bool 入 | ✗ | **bool 不作为入口存在**：判定条件由节点配置 + `context` 决定，不走引脚 |

「引脚是否承载执行流」由纯函数判定，不使用布尔标志位：

```ts
/** 引脚是否承载执行流。bool 出口是判定分支，同样驱动执行流。 */
function carriesExecFlow(kind: PortKind, direction: PortDirection): boolean {
  return kind === 'exec' || (kind === 'bool' && direction === 'output');
}
```

新增拒绝原因与文案：

```
kind_mismatch: '引脚种类不匹配：执行流引脚与值引脚不能互连'
value_type_mismatch: '值类型不匹配：当前仅支持 string 值引脚互连'
```

### 3.5 横向布局下的引脚排布

端口按 `(kind, index)` 计算行号：exec 引脚占第 0 行起，value/bool 引脚接续排列。

- 输入引脚固定 `x = 0`，输出引脚固定 `x = width`
- `y = HEADER_HEIGHT + PORT_ROW_HEIGHT * (row + 0.5)`
- 节点高度 `HEADER_HEIGHT + PORT_ROW_HEIGHT * max(inputRows, outputRows, 1)`

## 4. 变更 B2：真数据流

### 4.1 现状（被推翻的设计）

`blueprint_executor.rs::resolve_constant_source()`：

- 取 Branch 的第一条入边
- 要求上游节点必须是 `Constant`
- 直接读 `ConstantConfig.source`，从 `context` 取值

其源码注释明确写道「不引入运行时值传递管道……避免修改 `traverse` 的签名」。**该设计与注释一并作废**。

### 4.2 目标语义

采用 UE 的 **pull-based 求值**：

1. 执行流（exec 边）到达 Branch
2. Branch 沿其 **value 输入边** 反向求值上游纯值节点（Constant）
3. 求值结果写入 `ValueEnvironment` 缓存

这既满足「值沿 value 边向下游传递」的语义，又无需在执行流之外额外遍历纯值节点。

### 4.3 值模型

```rust
/// 蓝图中的值。当前仅会话属性字符串一类。
#[derive(Debug, Clone, PartialEq)]
pub enum BlueprintValue {
    Session(String),
}
```

### 4.4 值环境

```rust
/// 值求值环境：缓存已求值端口，并用求值栈检测 value 依赖环。
pub struct ValueEnvironment {
    resolved: HashMap<(String, String), BlueprintValue>,
    resolving: HashSet<(String, String)>,
}
```

- `get(node_id, port)`：读缓存
- `insert(node_id, port, value)`：写缓存
- `begin_resolve(node_id, port)`：入求值栈，已在栈中则返回 `ValueCycleDetected`
- `end_resolve(node_id, port)`：出栈

同一 Constant 被多个 Branch 引用时只求值一次。

### 4.5 `traverse` 签名变更

```rust
fn traverse(
    graph: &BlueprintGraph,
    node_id: &str,
    context: &BlueprintExecutionContext,
    result: &mut BlueprintExecutionResult,
    visited: &mut HashSet<String>,
    path: &mut HashSet<String>,
    values: &mut ValueEnvironment,   // 新增
) -> Result<(), BlueprintError>
```

所有递归调用点同步传递。

### 4.6 图结构变化

| | 旧 | 新 |
|---|---|---|
| 拓扑 | `Start --out--> Constant --out--> Branch(in)` | `Start --out--> Branch(in)` + `Constant --out--> Branch(value)` |
| Constant 位置 | 串在执行流上 | 挂在执行流旁，仅通过 value 边供值 |

### 4.7 `validate_graph` 调整

| 校验项 | 旧 | 新 |
|---|---|---|
| Constant | 必须有 `out` 出边 | 必须有 **value** 出边 |
| Branch | 必须有入边 | 必须有 **exec 入边** + 必须有 **value 入边且上游为 value 节点** |

### 4.8 旧图迁移（非静默）

`deserialize_blueprint_version` 硬校验只接受 `version == 2`，**不改版本号**。迁移在反序列化之后的归一化阶段完成：

识别条件：边的 `target` 为 Branch、`source` 为 Constant、`target_port == "in"`

归一化动作：
1. 将该边 `target_port` 改写为 `"value"`
2. 把原先连到 Constant 的上游 exec 边重定向到 Branch 的 `"in"`

迁移命中时：写日志 + 向前端返回「图结构已升级，请保存」的可见标记。**禁止静默兜底**。

受影响数据文件：
- `测试预设/Night Voyage 默认预设.nvpreset.json`
- `测试预设/gen_default_preset.py`

## 5. 变更 C：Sampling Params 双版本

### 5.1 节点类型

| 类型字符串 | 用途 |
|---|---|
| `sampling_params_openai` | OpenAI / chat_completions 协议采样参数 |
| `sampling_params_anthropic` | Anthropic 协议采样参数 |
| `sampling_params`（legacy） | 保留可加载可执行，**不允许新建** |

### 5.2 字段归属

| 字段 | OpenAI 版 | Anthropic 版 | 依据 |
|---|---|---|---|
| `temperature` | ✓ | ✓ | 双协议支持 |
| `max_tokens` | ✓ | ✓ | 双协议支持 |
| `top_p` | ✓ | ✓ | 双协议支持 |
| `stop` | ✓ | ✓ | 双协议支持 |
| `frequency_penalty` | ✓ | — | `provider_adapter` 中 Anthropic `supports_frequency_penalty = false` |
| `presence_penalty` | ✓ | — | `provider_adapter` 中 Anthropic `supports_presence_penalty = false` |
| `thinking_enabled` | — | ✓ | `resolve_thinking_config()` 非 anthropic 直接返回 None |
| `thinking_budget_tokens` | — | ✓ | 同上 |
| `is_locked` | ✓ | ✓ | 双版本均可锁定 |

### 5.3 运行时路由（类型驱动，非布尔）

```rust
/// 采样参数的协议方言。由 `context.protocol` 解析，未知协议显式报错。
pub enum SamplingDialect {
    OpenAi,
    Anthropic,
}

impl SamplingDialect {
    pub fn parse(protocol: &str) -> Result<Self, BlueprintError>;
}
```

规则：

- `protocol == "chat_completions"` → `SamplingDialect::OpenAi`，仅 OpenAI 版节点出参
- `protocol == "anthropic"` → `SamplingDialect::Anthropic`，仅 Anthropic 版节点出参
- 其它值 → `BlueprintError::UnknownSamplingProtocol(String)` **显式报错**（C2，禁止默认按 OpenAI 处理）

不匹配的版本的节点仍沿 exec 流继续遍历，只是不产出采样参数。

**legacy `sampling_params` 节点的路由**：按当前 dialect 应用其中对该协议有效的字段子集（OpenAI 方言下忽略 thinking_*，Anthropic 方言下忽略 frequency/presence penalty），不报错。

### 5.4 下游映射

`prompt_compiler.rs::apply_blueprint_sampling_params()` 需适配新字段归属；`CompiledSamplingParams`（blueprint 版）字段集保持不变。

## 6. 变更 D：Schema Field 顺序可控

### 6.1 现状（被替换）

```rust
fn schema_field_priority(name: &str) -> usize {
    match name { "thinking" => 0, "text" => 1, _ => 2 }
}
```

`order_schema_properties()` 按 `(schema_field_priority, 字段名升序)` 重排，作者无法干预。

### 6.2 目标契约

`SchemaFieldConfig` 新增：

```rust
/// 字段在输出 JSON Schema 中的排序权重，升序排列。缺省 0。
#[serde(default)]
pub order: i32,
```

排序键 = `(order, 遍历序)`，稳定排序。

基线字段默认 order 常量：

```rust
pub const CORE_FIELD_ORDER_THINKING: i32 = -2000;
pub const CORE_FIELD_ORDER_TEXT: i32 = -1000;
```

`thinking` / `text` 由 `inject_core_schema_baseline()` 注入时带上述常量值，保证核心字段稳定在最前；作者仍可用更小的 order 覆盖。

### 6.3 排序实现

`apply_schema_field()` 记录 `(field_name, order, insertion_seq)`；`order_schema_properties(result, entries)` 以 `(order, seq)` 为键排序 `properties`，并同步 `required` 数组顺序（仅保留确实存在于 `properties` 的字段）。

**删除** `schema_field_priority` 硬编码函数。

### 6.4 前端

PC `nodes/SchemaFieldNode.tsx` 与移动端 `MobileNodeConfigForms.tsx` 的 schema field 表单新增 order 数值输入。

## 7. 双端覆盖清单（C7）

### PC（`src/`）

| 文件 | 变更 |
|---|---|
| `lib/blueprint/types.ts` | `PortKind` 契约、两新节点类型与配置、`SchemaFieldConfig.order` |
| `components/blueprint/nodeLayout.ts` | 横向还原 + 三分类端口 + 引脚坐标 + 连线校验 |
| `components/blueprint/BlueprintCanvas.tsx` | 三角/圆/菱形渲染 + 横向标签排版 |
| `components/blueprint/NodeConfigPanel.tsx` | 两个新 Match 分支、update 助手、类型标签 |
| `components/blueprint/NodeSelector.tsx` | 新增两类型，legacy `sampling_params` 移入不可新建 |
| `components/blueprint/BlueprintEditor.tsx` | `createNode` 两个新 case |
| `components/blueprint/nodes/SamplingParamsOpenAiNode.tsx` | 新建 |
| `components/blueprint/nodes/SamplingParamsAnthropicNode.tsx` | 新建 |
| `components/blueprint/nodes/SamplingParamsNode.tsx` | 降级为 legacy 展示 |
| `components/blueprint/nodes/SchemaFieldNode.tsx` | 新增 order 输入 |

### 移动端（`src-mobile/`）

| 文件 | 变更 |
|---|---|
| `components/blueprint/mobileNodeLayout.ts` | 与 PC 对称：横向还原 + 三分类端口 + `createNode` 两新 case |
| `components/blueprint/MobileBlueprintCanvas.tsx` | 三种形状渲染（保留 `r=14` 触控命中圈） |
| `components/blueprint/MobileNodeConfigForms.tsx` | 两个新 Match、`createNode`、schema field order 输入 |
| `components/blueprint/MobileNodeConfigPanel.tsx` | 类型标签补两项 |
| `components/blueprint/BlueprintEditor.tsx` | 节点类型列表补两项 |

移动端仅共享 `src/lib/blueprint/types.ts` 的类型定义（既有做法，符合 C5）。

### 后端（`src-tauri/`）

| 文件 | 变更 |
|---|---|
| `models/blueprint.rs` | `PortKind` / `BlueprintValue` / `ValueEnvironment` / `SamplingDialect`、两个新 Config、`SchemaFieldConfig.order`、`NodeType`/`NodeConfig` 各增两变体 |
| `services/blueprint_executor.rs` | 真数据流求值、`validate_graph` 调整、`SamplingDialect` 路由、`order_schema_properties` 重写、旧图归一化、单测同步 |
| `services/prompt_compiler.rs` | `apply_blueprint_sampling_params` 适配新字段归属 |

## 8. 验收标准

1. **构建**：`scripts/build_dual_release.bat` 通过（后端 + PC 前端）；`npx tsc --noEmit -p tsconfig.json` 与 `npx tsc --noEmit -p tsconfig.mobile.json` 零错误
2. **后端单测**：`blueprint_executor.rs` 既有测试全部通过，并补充：value 引脚取值、value 依赖环检测、protocol 路由、未知 protocol 报错、order 排序、旧图归一化
3. **布局**：画布回到横向，连线自左向右，节点端口在左右边缘
4. **引脚**：exec 三角、value 圆、bool 菱形；Constant 仅出口；种类不匹配连线被拒绝并给出提示
5. **采样**：两版节点可选，按 protocol 生效，未知 protocol 显式报错
6. **字段顺序**：order 可编辑且生效，`required` 与 `properties` 顺序同步
7. **Walkthrough**：新建 `Walkthrough/20260828-HHmm-*.md`，含约束合规审计表

## 9. 已知限制

- 真数据流引入后，旧图必须经归一化迁移才能执行；迁移是一次性的，且迁移结果需用户保存
- `BlueprintValue` 当前仅 `Session(String)` 一类，未来若需数值/布尔值需扩展该枚举并同步 `valueType` 契约
- 移动端触控下引脚热区沿用 `r=14` 命中圈，高密度引脚（gate 多出口）可能出现热区重叠，需在移动端验收时确认
