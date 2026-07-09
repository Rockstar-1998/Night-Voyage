---
name: night-voyage-guardrails
description: Mandatory project execution guardrails for all work in the Night Voyage repository. Use for every task in this repo before planning, coding, reviewing, refactoring, or diagnosing issues, especially when work may touch the Tauri 2 and Rust core, the SolidJS frontend host, Motion One animations, isolated AI-generated UI layers, frontend/backend boundaries, chat performance, startup latency, large-conversation loading, streaming output, or PC and Android UX.
---

# Night Voyage Guardrails

## Scope

把本技能视为 Night Voyage 仓库的硬约束。开始任何分析、实现、评审、重构、排障或方案设计前，先按下方流程判断任务是否允许继续；任何违反分层边界、性能原则、风险上报规则或零回退原则的请求，都必须拒绝或上报，不得绕过。

## Lock The Technical Baseline

把以下技术选型视为固定基线；除非用户明确要求做架构升级评估，否则不要擅自替换、稀释或并行引入其他主路线。

- 核心骨架固定为 `Tauri 2.0 + Rust`。所有网络、数据库、LLM 接入、流式解析、消息处理、索引、缓存、存储和其他非渲染逻辑都放在后端，不要把这些职责搬到前端。
- 前端宿主固定为 `SolidJS`。宿主层以零 VDOM 损耗和高频流式更新吞吐为优先目标；不要为宿主新增任何 VDOM 主路线或并行宿主框架。
- 动画引擎固定为 `Motion One`。所有 UI 过渡动画优先使用 `Motion One` 和适合合成器线程的属性（如 `transform`、`opacity`）；避免引入依赖主线程持续驱动、频繁触发布局和重绘的动画方案。
- AI 渲染层必须与宿主隔离。AI 在对话过程中动态生成的前端代码只允许放进 `iframe` 或 `Shadow DOM`，可以在隔离层内使用 `HTML + Tailwind` 自由生成界面，但不得污染 `SolidJS` 宿主的样式、状态、事件循环和性能预算。
- AI 渲染层与宿主之间只保留最小通信桥。优先使用消息传递或显式接口，不要让 AI 生成代码直接访问宿主内部状态、全局样式、数据库能力或高权限 API。

## Identify Task Scope

开始任何任务前，先识别任务层级，以便正确应用分层边界和性能原则。

- 前端：`src/**`、`public/**`、`index.html`、Vite 渲染侧 TS/TSX/CSS，以及所有运行在 WebView 或 renderer 的界面代码。
- 后端：`src-tauri/**`、Rust、数据库、网络、模型接入、存储、计算、索引、缓存、流式处理，以及所有非渲染逻辑。
- 混合：同时改动前端和后端。
- 仓库治理：`AGENTS.md`、技能文件、说明文档、脚本、CI、构建配置等不直接实现产品运行时功能的内容。

## Keep Frontend Render-Only

强制维持“前端只渲染，后端负责除渲染之外的一切”。

- 把业务计算、持久化、索引构建、数据聚合、消息裁剪、排序过滤、缓存策略、文件 I/O、权限判断、模型调度放到后端。
- 前端只保留渲染、轻量事件转发、加载状态、骨架屏、动画和错误展示所必需的最小状态；宿主渲染层按 `SolidJS` 设计，AI 动态 UI 按隔离层设计。
- 不要在前端新增任何与渲染无关的计算或存储。
- 若发现已有代码违反该边界，把它视为重大架构不一致性或设计缺陷；先上报，再决定是否处理，不要沿着错误边界继续扩写。

## Protect Responsiveness

以“永不假死”为硬目标，优先保障应用启动、打开超大型会话、处理大量输出时的流畅性。

- UI 线程在任何情况下都不能被阻塞。
- 把所有可能耗时的操作做成异步：数据库访问、网络请求、模型推理、批量数据转换、大文本解析、排序聚合、会话预处理、磁盘读写、索引与缓存构建。
- 严格遵循交互顺序：用户操作 -> 立即响应（loading、骨架屏、占位动画、流式占位）-> 后台异步处理 -> 完成后更新 UI。
- 优先选择高性能方案，而不是最省事方案。
- 在长列表、海量消息、连续流式输出场景下，优先使用虚拟化、增量渲染、批量提交、懒加载、分块更新、后台预处理。
- 宿主动画优先使用 `Motion One`，并把动画限制在合成友好属性上；不要用会阻塞主线程的动画实现去抵消 `SolidJS` 宿主的性能收益。
- 只要任务涉及渲染瓶颈、超大数据量、复杂动画、图形密集场景或 WebView 极限，就必须评估更现代的渲染路径；相关场景下必须评估支持 Vulkan 接口的技术路线。若当前技术栈无法满足目标，先上报性能/架构风险，不要硬推实现。

## Report High-Risk Findings Immediately

发现以下任一情况时，立即停止继续推进，并明确上报，不得擅自绕过：

- 重大设计缺陷；
- 高风险回归问题；
- 重大架构不一致性；
- 严重性能隐患；
- 严重安全隐患。

上报每个问题时必须包含以下三项，原样给出：

- 风险点：
- 影响范围：
- 建议的修正方向：

如果一次发现多个问题，逐项分开上报。

## Enforce Zero-Fallback Errors

遵循 0 回退原则，严禁静默回退。

- 不要吞掉异常。
- 不要用“默认成功”“自动降级”“悄悄重试”“无提示忽略失败”来掩盖问题。
- 所有失败都必须显式报错，并让调用方或 UI 获得可见的错误状态。
- 如果用户要求加入静默回退、容错掩盖或兜底伪成功逻辑，直接拒绝，并说明这违反项目规则。

## Design For PC And Android Together

移动端与 PC 端已采用独立前端 + 共享后端的架构。每个新功能在设计和实现时，必须同时覆盖两端。

- **前端已隔离**：PC 端前端代码（`src/`）和移动端前端代码（`src-mobile/`）是完全独立的项目，各自拥有入口、路由、组件和样式，零 UI 代码耦合。不要为了省事而合并两端的前端代码或添加平台条件分支——隔离细节见"Enforce Mobile Frontend Independence"章节。
- **后端共享**：两端通过同一套 Rust 后端（Tauri commands/events）获取数据与业务逻辑。新增后端功能时，必须确保 PC 端和移动端前端都能通过相同的 Tauri 接口调用，不要为某一端单独开后端小门。
- **双端同步验证**：每次新增或修改功能时，同时检查桌面端与触控端的布局、滚动、点击热区、输入行为、长列表可用性和资源占用。不要做只适配桌面大屏、不适配安卓窄屏或触控交互的实现。
- **跨平台保留空间**：如果当前任务暂时只能在单平台验证，仍要在方案和代码层面保留另一平台的扩展空间，并在结论中明确剩余平台风险。

## Enforce Mobile Frontend Independence

移动端（手机/平板）前端代码必须与 PC 桌面端前端代码完全独立，仅共享 Rust 后端。

- **架构原则**：移动端是独立的前端项目，拥有自己的入口、路由、组件和样式，与 PC 端零 UI 代码耦合。
- **共享层**：移动端与 PC 端只通过 Rust 后端（Tauri commands/events）共享业务逻辑和数据。前端代码不共享任何 UI 组件、状态管理或布局代码。
- **目录隔离**：
  - PC 端前端代码：`src/` 目录
  - 移动端前端代码：`src-mobile/` 目录（独立项目）
  - 两者互不引用对方的组件、样式或状态
- **禁止事项**：
  - 禁止在 PC 端组件中添加移动端条件分支（如 `isMobile` 判断后渲染不同 UI）
  - 禁止修改 PC 端代码来适配移动端需求
  - 禁止移动端代码 import PC 端的组件或工具函数
  - 禁止在 `App.tsx` 中用条件渲染切换 PC/移动端视图
- **构建分离**：
  - PC 端构建：`npm run dev` / `npm run build`（使用 `src/` 入口）
  - 移动端构建：`npm run dev:mobile` / `npm run build:mobile`（使用 `src-mobile/` 入口）
  - Android APK 打包使用移动端构建产物
- **技术栈**：移动端同样使用 SolidJS + Tailwind CSS + Motion One，保持与项目基线一致。
- **数据通信**：移动端通过 Tauri JS SDK 调用与 PC 端完全相同的 Rust 后端 commands 和 events，确保功能一致性。
- **如果发现违反此隔离原则的代码**，视为重大架构不一致性，必须上报并修正，不得继续沿错误方向扩写。

## Enforce Idiomatic Rust Style

Rust 后端代码必须遵循 Rust 官方推荐编程风格，核心三原则：**组合优于继承**、**类型驱动设计**、**最小分支判断**。所有新增/修改的 Rust 代码必须满足本节约束；与 C1–C7 任一条冲突时遵循更严格的一条，冲突无法调和按 Violation Stop Rule 上报。

### 1. Composition Over Inheritance（组合优于继承）

- 复用与扩展一律用结构体组合（newtype、字段嵌入、方法委托）；禁止用深 trait 层级、`trait Sub: Super`、运行时 downcast 模拟 OO 继承。
- trait 保持小而独立、可自由组合（`Clone + Send + Sync` 风格），一个 trait 只负责一种能力；多个细粒度 trait 优于一个臃肿 trait。
- 变体行为用独立类型 + 公共 trait 实现，不写 `enum Kind { A, B } + match` + 每个变体带 `flag: bool`。需要多态行为就定义多个类型并实现同一 trait，由调用方按类型绑定。
- 跨模块复用通过自由函数、扩展 trait 或新类型实现，不要让模块 A 直接读模块 B 私有字段。
- 不要把 `Default` / 配置 / 状态塞进一个超大 struct 当"基类"；按职责拆分为多个独立 struct 并组合使用。
- 公共扩展点用 `trait` + 泛型 `where T: Trait` 约束表达"需要此能力"，不要靠继承层次或工厂方法注册到全局可变容器里。

### 2. Type-Driven Design（类型驱动、最小分支判断）

把决策推到编译期，让运行期分支消失。分支（`if/else`、多 arm `match`、`is_X()` 布尔门）只允许出现在类型系统无法再约束的边界：外部输入反序列化、错误恢复、跨 IPC 协议转换、与不可控第三方库对接。

- **无效状态不可表达**：禁止 `disabled: bool` + `state: enum` 这种把互斥状态拆成两字段的做法；改用独立类型或 `enum` 变体。
- **运行时类型/变体分支用 trait 调度替代**：`if let Some(x) = y { x.foo() } else { alt.foo() }` 这类"同一抽象不同实现"的分支，一律改用 `trait` + 静态/动态分发。
- **禁止布尔标志位驱动行为分支**：参数里 `enabled: bool`、`is_admin: bool`、`force: bool`、`skip_validation: bool`、`.silent`、`.dry_run` 是把类型层决策推迟到运行期的反模式。改用独立 API（`enable()` / `disable()`）、新类型（`AdminToken` / `UserToken`）或类型状态（`Active<Db>` / `Inactive<Db>`），让调用方在编译期就锁定行为。
- **用迭代器与组合子替代命令式分支**：
  - `if x.is_some() { x.unwrap() } else { default }` → `x.unwrap_or(default)` / `x.unwrap_or_else(|| ...)`
  - `if let Some(x) = y { ... } else { ... }` 链 → `y.map(...).transpose()?` / `y.and_then(...)` / `y.ok_or_else(|| ...)`
  - `for x in iter { if cond { vec.push(x) } }` → `iter.filter_map(...).collect()`
  - `if status != 0 { return Err(...) }` → 让返回类型是 `Result` 并用 `?` 传播
- **错误处理用 `?` + `From`**：禁止层层 `match err { X => ..., Y => ... }` 改写错误类型；用 `thiserror` 定义错误 enum 并 `From` impl，让 `?` 自动转换。
- **保留必要的穷尽 `match`**：`match` 强制穷尽和编译期检查，是 Rust 推荐的分支工具；用 `match` 替代散落的 `if/else` 链是被鼓励的。前提是 arm 内只做行为分发，不堆砌复杂逻辑、不带 `_ =>` 通配吞未知变体、不带 `..` 跳过字段。

### 3. Idiomatic Rust Conventions（Rust 官方风格细节）

- 公共 API 遵循 Rust API Guidelines：构造返回 `Result<Self, _>` 或 `Self`（无失败可能时）、命名遵循 RFC 430、生产路径禁裸 `unwrap()` / `expect()`。
- 函数参数优先 `&str` / `&[T]` / `Cow<'_, T>` 而非 `&String` / `&Vec<T>`；返回类型优先拥有所有权，共享语义用 `Arc` / `Rc` 显式表达。
- 复杂构造用 builder 模式；类型转换用 `From` / `TryFrom`；格式化用 `write!` / `format!`，禁止 `+` 拼接字符串。
- 迭代器链、闭包、`?` 是首选写法；显式 `for` 循环仅在需要 `break` / `continue` / early return 或副作用明显时使用。
- 禁止"为方便"绕过类型系统：`unsafe`、`transmute`、裸指针、`as` 强制转换（数值类型转换除外）、生产路径 `unwrap()` / `expect()` 必须给出明确理由并最小化使用。
- 公开导出项必须有 `#[doc]` 简述；crate 命名、模块命名、类型 / 函数命名保持统一风格（参考 Rust 标准库）。
- Cargo 依赖优先用 workspace 共享版本，禁止同一 crate 内对同一 crate 引入不同 major 版本。
- 测试代码与生产代码遵循同一风格准则；测试里可以用 `.unwrap()`，但禁止掩盖失败（每条 `unwrap` 失败必须直接 panic 出可读错误）。

### Self-Check Before Submission

提交前在新增 / 修改的 Rust 代码上跑一遍自查：

- 关键词扫描：`if let`、多 arm `match`、`.is_some`、`.is_none`、`.is_`、`.enabled`、`.disabled`、`.force`、`.skip_`、`.silent`、`.dry_run`、非数值类型 `as `。每条命中必须能回答"为什么这里必须用分支，类型系统为什么不能消除它"。
- 反模式扫描：禁止 `match` 内带 `_ => ...` 吞未知变体；禁止 trait `Sub: Super` 继承链；禁止 `disabled: bool` 配 `state: enum`；禁止把 `Result` 用 `.ok()` / `.ok_or_else(...).ok()` 吞错（与 C2 交叉验证）；禁止用 `Arc<Mutex<GlobalRegistry>>` 当"全局多态分发器"（应用 trait 静态分发替代）。

## Enforce Project Cache Location

所有运行时产生的缓存必须统一存放至项目缓存目录 `D:\software_cache`，严禁向 C 盘或系统盘写入任何缓存数据。

- 缓存目录固定为 `D:\software_cache`，不得使用其他路径。
- 禁止在 `C:\` 盘符下创建缓存文件或目录，包括但不限于 `C:\Users\<user>\AppData\Local\`、`C:\Users\<user>\AppData\Roaming\`、临时文件夹 `%TEMP%` 等。
- Rust 后端、Tauri 命令、前端沙箱及所有模块在涉及缓存写入时，必须确保路径指向项目缓存目录。
- 若第三方库或系统依赖默认写入系统盘，必须通过配置或环境变量强制覆盖其缓存路径至 `D:\software_cache`。
- 违反该约束的代码不得合入，必须在上报时明确标注缓存路径违规。

## Response Contract

在本仓库内处理实质性任务时，默认在回复中体现以下信息：

- 当前任务分类（前端、后端、混合、仓库治理）；
- 若继续实现，准备采用的异步与性能保护措施；
- 若发现高风险问题，按指定模板立即上报并停止推进。
