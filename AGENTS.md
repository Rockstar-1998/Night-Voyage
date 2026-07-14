# Night Voyage Agent Rules

## Project Overview

Night Voyage 是一个基于 `Tauri 2.0 + Rust` 后端 + `SolidJS` 前端宿主的桌面/移动端 AI 角色扮演聊天应用。后端共享同一套 Rust 核心，前端按 PC（`src/`）和移动端（`src-mobile/`）独立隔离，AI 动态生成的 UI 层与宿主隔离。所有设计决策以"永不假死、零静默回退、双端覆盖"为硬目标。

## Mandatory Skill

- Before doing any work in this repository, read and apply D:/data/Night Voyage/.codex/skills/night-voyage-guardrails/SKILL.md.
- Treat night-voyage-guardrails as mandatory for every task in this repository.
- If the skill requires refusal or risk escalation, stop immediately and follow it.

## Skills

### Available skills

- night-voyage-guardrails: Mandatory project guardrails for Tauri 2 + Rust core, SolidJS host, Motion One animations, isolated AI-generated UI layers, frontend/backend boundaries, performance rules, risk escalation, zero-fallback error handling, and PC/Android considerations. Use for every task in this repo. (file: D:/data/Night Voyage/.codex/skills/night-voyage-guardrails/SKILL.md)
- frontend-skill: Frontend implementation guidance. (file: D:/data/Night Voyage/skills/frontend-skill/SKILL.md)

## Technical Baseline

- Core shell: `Tauri 2.0 + Rust` for all networking, database work, LLM access, parsing, storage, and other non-rendering logic.
- Frontend host: `SolidJS`.
- Animation engine: `Motion One`.
- AI-generated UI: isolate inside `iframe` or `Shadow DOM`; allow `HTML + Tailwind` inside the sandboxed layer without affecting the `SolidJS` host.

## Technology Stack (Decided, Not Mutable)

| Layer | Choice | Note |
|-------|--------|------|
| Desktop shell | Tauri 2.0 | 跨平台桌面/移动端容器，PC 与 Android 共享后端 |
| Backend language | Rust | 网络、数据库、LLM、解析、存储、索引、缓存等非渲染逻辑 |
| Database | SQLite (sqlx) + aiosqlite | 本地持久化；迁移校验和需与 `_sqlx_migrations` 表对齐 |
| LLM sidecar | Letta (自定义 run_letta.py 启动) | 通过 uvicorn.run() 启动，禁用 CLI；端口 8283 |
| PC frontend host | SolidJS + Tailwind | `src/` 入口，零 VDOM，高频流式更新优先 |
| Mobile frontend host | SolidJS + Tailwind | `src-mobile/` 入口，独立项目，与 PC 零 UI 代码耦合 |
| Animation | Motion One | 限合成友好属性（transform/opacity），避免主线程动画 |
| Build tooling | Vite + tsc | 双前端独立构建（`vite.config.ts` / `vite.config.mobile.ts`） |
| AI sandbox UI | iframe / Shadow DOM + HTML + Tailwind | 与宿主隔离，仅通过最小通信桥交互 |

> 除非用户明确要求做架构升级评估，否则不要擅自替换、稀释或并行引入其他主路线。

## Key Directories

```
src/                  → PC 前端（SolidJS + Tailwind）
  components/         → UI 组件
  lib/backend/        → 后端 Tauri command/event 封装
  store/              → 状态管理
src-mobile/           → 移动端前端（独立 SolidJS 项目，Android APK 来源）
src-tauri/            → Rust 后端
  src/
    commands/         → Tauri command 处理
    db/               → SQLite 持久化
    llm/              → LLM provider 接入
    models/           → 数据模型
    network/          → 网络层（联机房间等）
    services/         → 业务服务
    backdoor/         → 调试入口
  vendor/             → 依赖本地补丁（勿随意改动）
plans/                → 设计计划文档（handoff、POC、版本计划）
.trae/specs/          → 变更设计 spec（每个功能一个目录，含 spec.md）
.codex/skills/        → 项目技能文件
skills/               → 前端技能文件
scripts/              → 构建与调试脚本
D:\software_cache/    → 统一运行时缓存目录（禁止写入系统盘）
Walkthrough/          → 变更留痕记录（每次代码修改一份新文件，永不追加）
```

## Non-Negotiable Constraints

以下约束有严格的性能/架构/隔离理由。未经用户明确批准，违反即停并上报，不得自行修复或绕过。详细内容见 `night-voyage-guardrails` 技能文件对应章节。

- **C1 Frontend Render-Only**：前端只渲染，后端负责除渲染之外的一切。详见 guardrails "Keep Frontend Render-Only"。
- **C2 Zero-Fallback Errors**：严禁静默回退、吞异常、默认成功、自动降级、悄悄重试。详见 guardrails "Enforce Zero-Fallback Errors"。
- **C3 Responsiveness Protection**：UI 线程永不阻塞，耗时操作必须异步，超大数据量用虚拟化/增量渲染。详见 guardrails "Protect Responsiveness"。
- **C4 AI UI Isolation**：AI 动态 UI 只允许在 iframe/Shadow DOM 内，不得污染宿主样式、状态、事件循环。详见 guardrails "Lock The Technical Baseline"。
- **C5 Mobile Frontend Independence**：`src/` 与 `src-mobile/` 零 UI 代码耦合，禁止 `isMobile` 条件分支，禁止互引组件。详见 guardrails "Enforce Mobile Frontend Independence"。
- **C6 Project Cache Location**：所有运行时缓存必须写入 `D:\software_cache`，禁止写入系统盘。详见 guardrails "Enforce Project Cache Location"。
- **C7 PC/Android Dual-Platform Coverage**：每个新功能必须同时覆盖两端，后端命令不得为某端单开后门。详见 guardrails "Design For PC And Android Together"。

### Approved Exceptions

（任何对上述约束的例外必须在此登记：日期、用户批准记录、例外范围、性能/架构理由。）

| 日期 | 用户批准记录 | 例外范围 | 性能/架构理由 |
|------|--------------|----------|----------------|
| （无） | | | |

## Violation Stop Rule

发现以下情况时，**立即停止推进**，不得自行修复或绕过，阻塞到用户给出决策：

- 代码与上述 C1–C7 任一约束冲突；
- 重大设计缺陷、重大架构不一致性；
- 高风险回归问题；
- 严重性能隐患或严重安全隐患。

上报每个问题时必须包含以下三项，原样给出：

- 风险点：
- 影响范围：
- 建议的修正方向：

如果一次发现多个问题，逐项分开上报。

## Delivery Workflow

- Frontend first: define and validate the UI flow, loading/error states, and sandbox boundaries before backend implementation.
- 涉及多步骤的任务，每一步必须通过用户验收后才能开始下一步。
- 涉及边界/后端/隔离层的改动，对应 `.trae/specs/<feature>/spec.md` 是该变更设计的真相源；若 spec 不存在，先与用户确认是否需要补 spec。

## Code Style

- **Rust**：
  - 低耦合、模块独立；模块边界清晰，避免跨模块直接访问内部状态。
  - 生产路径禁裸 `unwrap()` / `expect()`，使用显式错误处理（与 C2 零回退一致）。
  - 跨 IPC 错误信息必须把反斜杠替换为正斜杠，防止 JSON 解析问题。
  - Windows 路径比较前必须规范化（`canonicalize()` 返回 UNC 路径需归一化）。
  - **组合优于继承**：复用与扩展用结构体组合（newtype、字段嵌入、方法委托）与可自由组合的小 trait；禁深 trait 继承（`trait Sub: Super`）与运行时 downcast 模拟 OO 继承；变体行为用独立类型 + 公共 trait，不写 `enum Kind + match + flag: bool`。
  - **类型驱动、最小分支**：无效状态不可表达；`if let Some(x) = y { x.foo() } else { alt.foo() }` 这类"同一抽象不同实现"分支改 trait 调度；禁 `enabled: bool` / `is_admin: bool` / `force: bool` / `skip_*` / `.silent` / `.dry_run` 这类把类型决策推迟到运行期的标志位；用 `unwrap_or` / `and_then` / `map` / `filter_map` 组合子替代命令式 if-let 链；错误处理用 `?` + `From`，禁层层 `match err` 改写错误；`match` 用于穷尽分支是被鼓励的，禁 `_ =>` 吞未知变体、禁 `..` 跳过字段。
  - **Rust 官方风格细节**：公共 API 遵循 Rust API Guidelines；参数优先 `&str` / `&[T]` / `Cow<'_, T>` 而非 `&String` / `&Vec<T>`；复杂构造用 builder 模式；类型转换用 `From` / `TryFrom`；格式化用 `write!` / `format!` 禁 `+` 拼接；迭代器链与闭包优先于显式 `for`；`unsafe` / `transmute` / 裸指针 / `as` 非数值转换必须给出理由并最小化；公开导出项必须有 `#[doc]`；Cargo 依赖优先 workspace 共享版本，禁同 crate 引入同一 crate 多 major。
- **TypeScript / SolidJS**：
  - 优先细粒度响应式，避免在热路径创建不必要的信号或派生计算。
  - 长列表/流式输出场景必须使用虚拟化、增量渲染、批量提交。
- **通用**：
  - 命名清晰，模块职责单一。
  - 不为单次操作造抽象，不为假想未来需求加配置项或特性开关。
  - 不新增与当前任务无关的注释、文档字符串或类型注解。

## Walkthrough Change Record (Mandatory)

每次代码修改后，在 `Walkthrough/` 目录新建一个文件说明改了什么、为什么、每条核心约束的合规情况。**永不追加到已有文件**。

- **文件名格式**：`YYYYMMDD-HHmm-主题-修改类型.md`
- **修改类型**：`新功能增加` / `修改` / `debug`
- **必含内容**：
  1. 改动摘要（哪些文件、哪些函数/模块、改了什么）
  2. 改动动机（为什么改，解决什么问题）
  3. 约束合规审计表（见下）
  4. 验收记录（构建命令、验收方式、预期效果、实际结果）
  5. 已知限制或后续待办

### 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √/× |  |
| C2 Zero-Fallback Errors | √/× |  |
| C3 Responsiveness | √/× |  |
| C4 AI UI Isolation | √/× |  |
| C5 Mobile Frontend Independence | √/× |  |
| C6 Project Cache Location | √/× |  |
| C7 PC/Android Coverage | √/× |  |

任何 × 必须附用户批准记录，否则不得提交。

## Anti-False-Completion Mechanism

为防止"假完成"（声称完成但代码严重残缺），任何标记为"完成"的里程碑或任务必须满足以下硬性要求。

### 禁止行为（完成态里出现即视为假完成）

1. **禁止 stub/placeholder**：`return Ok(()); // TODO`
2. **禁止定值替换**：`let result = 1.0; // 简化`
3. **禁止省略错误检查**：`// 省略 NaN/空值检查`
4. **禁止省略算法步骤**：`// 跳过边界处理`
5. **禁止以注释充当实现**：`// 这里应该做持久化`
6. **禁止 TODO/FIXME 标记**残留在完成代码中
7. **禁止伪造构建/验收结果**：必须实际运行构建命令并贴出真实输出

### 构建验证要求

声称"编译通过"或"构建通过"前，必须实际运行并贴出输出：

- 后端改动：`cargo build`（在 `src-tauri/` 下）
- 前端改动：`npm run build` 或 `tsc --noEmit`（区分 PC / mobile 构建配置）
- 双端改动：两端都要跑

### 里程碑门禁

- 涉及多步骤的任务，**上一步必须通过用户验收**才能开始下一步。
- 每次提交必须包含：
  1. Walkthrough 文件（见上节）
  2. 真实构建命令输出
  3. 验收说明（如何验收、预期效果、检查点）
  4. 已知限制列表
- 用户验收项：
  - 审计表是否诚实（抽查合规性是否真实）
  - 构建是否真的通过
  - 效果是否符合预期
  - 是否存在禁止行为

## Git Commit Hygiene

写完 Walkthrough 文件后立即提交并推送。

1. 提交前先 `git status`，清理无关文件（缓存、构建产物、临时文件、IDE 文件），必要时补 `.gitignore`。
2. 用 `git add <具体文件>` 而非 `git add .`，避免误提交敏感文件（`.env`、`night-voyage.keystore` 等）。
3. 提交信息使用 Walkthrough 内容：
   - 首行：`[修改类型] 主题`
   - 正文：Walkthrough 摘要 + 约束合规审计表
4. 提交后立即 push。
5. 禁止 `--force` push 到主分支；如需 rebase，先与用户确认。
