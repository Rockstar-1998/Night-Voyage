# Spec: 蓝图节点 / 开场消息编辑器「一键插入占位符」按钮

- 状态：**已批准，实现中**（用户已拍板范围/双端/按钮集/交互，2026-07-23；开始 PC 端实现）
- 关联变更：`.trae/specs/blueprint-content-template-rendering/spec.md`（渲染层已接通，本功能是它的作者侧配套 UI）
- 任务分类：**前端**（纯 UI 便利功能，无后端改动）

## 1. 目标与动机

渲染层已支持在蓝图节点 content 与 AI 角色卡开场消息里写 `{{ character.name }}` 等 minijinja 变量（见关联 spec）。但作者要**手动敲**这些变量名，易拼错；拼错会在编译期 Strict 报错（D2）。本功能在相关输入框旁提供一排「占位符按钮」，点一下把对应 `{{ }}` 插入**光标处**，降低出错率、提升写作效率。

纯前端功能：插入只是把文本写回既有的受控 `content` / `firstMessages` 值，渲染仍由既有编译期层完成。**不新增任何后端命令、不改动 Rust。**

## 2. 范围（用户已拍板 2026-07-23）

**IN（本变更做）—— 四处编辑器各加一排按钮：**

| # | 端 | 编辑器 | 落地文件 / 组件 |
|---|----|--------|----------------|
| ① | PC | 蓝图 Prompt 节点 content | `src/components/blueprint/nodes/PromptNode.tsx`（`PromptNode`，textarea ≈91-100） |
| ② | PC | 角色卡开场消息（多开局，数组） | `src/components/CharacterSidebar.tsx`（`CharacterSidebar`，firstMessages 循环 ≈577-615） |
| ③ | 移动 | 蓝图 Prompt 节点 content | `src-mobile/components/blueprint/MobileNodeConfigForms.tsx`（`PromptForm` + `TextArea` 封装 ≈163/185） |
| ④ | 移动 | 角色卡开场消息（多开局，数组） | `src-mobile/components/characters/CharacterDrawer.tsx`（`CharacterDrawer`，firstMessages 循环 ≈367-402） |

**OUT：**
- 聊天输入框不加此功能（用户对话文本不进渲染层，插入 `{{ }}` 会变成字面垃圾）。
- 不提供 `current_user.*` / conversation / provider 等按钮（开场消息引用会 Strict 报错，按钮反而误导）。
- 不做变量列表弹窗 / 动态枚举，初版就是固定的 4 个按钮。

## 3. 按钮集合（初版固定 4 个）

| 按钮文字 | 插入内容 | 说明 |
|---------|---------|------|
| 角色名 | `{{ character.name }}` | AI 角色名 |
| 玩家名 | `{{ player_character.name }}` | 玩家人格名（ST 的 `<user>`） |
| 角色描述 | `{{ character.description }}` | AI 角色描述 |
| 玩家描述 | `{{ player_character.description }}` | 玩家人格描述 |

**变量名纠正提醒**：玩家名对应 `player_character.name`，**不是** `character.name`（那是 AI 角色）。按钮定义里写死正确变量名即可，作者无需关心。

## 4. 交互细节（用户已确认）

- **插入位置**：当前光标处（`selectionStart`/`selectionEnd`），不是末尾追加。
- **插入后光标**：落在插入文本之后（如插入 `{{ character.name }}`，光标在 `}` 后），方便继续输入。受控组件在值更新后浏览器会把光标重置到末尾，因此插入后**必须手动 `setSelectionRange(newPos, newPos)` 还原**。
- **多按多次**：每次插一个，纯前端字符串拼接，无异步、无性能风险。
- **锁定态**：PC 蓝图节点 `isLocked` 时，按钮禁用（与 textarea 的 `disabled` 一致）。

### 4.1 插入实现（每端一份，不共享）

工具函数（每端独立文件，见 §5）：
```
insertAtCursor(
  el: HTMLTextAreaElement,
  text: string,
  currentValue: string,
  commit: (next: string) => void,
): void
```
- `const start = el.selectionStart; const end = el.selectionEnd;`
- `const next = currentValue.slice(0, start) + text + currentValue.slice(end);`
- `commit(next);`（写回受控值：`update({content})` / `setFormData` / `onChange` / `setFirstMessages`）
- 受控值更新后 DOM `.value` 被重置光标到末尾，需在 DOM 反映新值后还原：
  `requestAnimationFrame(() => el.setSelectionRange(start + text.length, start + text.length));`
  （用 rAF 而非同步，确保 Solid 的受控值绑定已完成 DOM 更新）

### 4.2 各编辑器写回接口（探查确认）

- ① PC 蓝图：`update({ content: next })` → `NodeConfigPanel.updatePrompt` → `BlueprintEditor.handleUpdateNode`（`setGraph`）。
- ② PC 开场：`next = [...formData().firstMessages]; next[idx] = 新值; setFormData({...formData(), firstMessages: next})`。需给循环里的每个 textarea 加 `ref`（`<For>` 闭包内 `let ta; ref={el => ta = el}`），按钮引用该 `ta`。
- ③ 移动蓝图：`props.onChange({ ...props.config, content: next })`（流入草稿 `draftConfig`，保存时落库）。需给 `TextArea` 封装补一个可选 `ref` 透传，或 `PromptForm` 内改用原生 `<textarea ref>`。
- ④ 移动开场：`next = [...firstMessages()]; next[idx] = 新值; setFirstMessages(next)`。同 ② 加 per-textarea ref。

## 5. 双端独立性（C5 硬约束）

- PC 端工具函数放 `src/lib/insertAtCursor.ts`（或等价位置），按钮组件/标记写在 PC 对应组件内。
- 移动端工具函数放 `src-mobile/lib/insertAtCursor.ts`，**独立一份**，禁止 `import` 自 `src/`。
- 4 个按钮的「文字→模板」常量数组在两端**各自定义一份**（纯数据，约 4 行；不抽共享组件、不加 `isMobile` 分支）。
- 两前端项目零 UI 代码耦合，实现可不完全一致，但功能与交互必须对齐。

## 6. 约束合规审计表（预估）

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 纯前端 UI；插入只是写回既有受控值，无业务计算/存储搬前端 |
| C2 Zero-Fallback Errors | √ | 插入失败（如 ref 缺失）应显式报错/忽略按钮而非伪成功；变量名写死正确值，不依赖运行时校验 |
| C3 Responsiveness | √ | 同步字符串拼接 + rAF 还原光标，无 IO/阻塞/异步 |
| C4 AI UI Isolation | √ | 不涉及 AI 沙箱层 |
| C5 Mobile Frontend Independence | √ | 双端独立实现、独立工具函数/常量，零共享组件 |
| C6 Project Cache Location | √ | 无缓存写入 |
| C7 PC/Android Coverage | √ | 四处编辑器（PC+移动 × 蓝图+开场）全部覆盖 |

## 7. 验收

**构建（真实输出）：**
```
cd src && npm run build          # PC 前端
cd src-mobile && npm run build   # 移动端前端（或 npm run build:mobile）
```
**手动验收：**
- PC 蓝图节点：聚焦 content textarea 中间某处，点「角色名」→ 光标处出现 `{{ character.name }}`，光标落在 `}` 后；点「玩家名」→ `{{ player_character.name }}`。
- PC 开场消息：聚焦某条开局白中间，点按钮插入正确变量，光标正确还原；多开局每条独立。
- 移动端重复上述两步（在窄屏/触控下按钮可点、热区足够）。
- 锁定节点（PC 蓝图 `isLocked`）按钮禁用。
- 普通聊天输入框**无**此按钮（范围外）。

## 8. 已知限制 / 后续

- 初版固定 4 按钮，不含动态变量列表。后续若开放 `{% %}` 或更多变量，可升级为变量选择器。
- 移动端 `TextArea` 封装需补 ref 透传（仅移动端改动，不影响 PC）。
- 插入依赖 `requestAnimationFrame` 还原光标；极端情况（如插入瞬间组件卸载）光标还原可能失效，属可接受边缘情况，不引入复杂状态管理。
