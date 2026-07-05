# Walkthrough: Schema Key 启用/禁用功能（纯前端过滤）

## 改动摘要

### 涉及文件

- `src/components/SchemaConfigPanel.tsx`
- `.trae/specs/multiplayer-guest-state-and-schema-sync/tasks.md`

### 改动模块与函数

1. `SchemaKeyConfig` 接口（约 14-28 行）：新增可选字段 `isEnabled?: boolean`。
2. `parseJsonSchema` 函数（约 53-110 行）：反序列化时为每个解析出的 key 显式设置 `isEnabled: true`。
3. `serializeToJsonSchema` 函数（约 112-158 行）：遍历 keys 时 `if (key.isEnabled === false) continue;`，跳过禁用 key，使其不出现在 `properties` 对象与 `required` 数组中。
4. UI 复选框区域（约 460-510 行）：在"上下文包含/默认展开/隐藏标签/必填"之前新增"启用"开关，`checked` 绑定 `key.isEnabled !== false`，`onChange` 切换 `isEnabled` 字段。
5. key 编辑器外层容器（约 273 行）：当 `key.isEnabled === false` 时附加 `opacity-50` class，整个 key 编辑器显示为灰色。
6. `tasks.md`：将 Task 25、26、27、28 的复选框 `[ ]` 改为 `[x]`（含子任务）。

## 改动动机

用户希望能启用或禁用某个 schema key。采用路径 A（纯前端过滤）：禁用的 key 不写入最终 JSON Schema，从而在保存到后端时被过滤掉，不传给 LLM API。前端 state 仍保留 `SchemaKeyConfig` 对象，便于用户重新启用。该改动对单人/多人模式均生效（同一份 `SchemaConfigPanel` 组件）。

## 约束合规审计表

| 约束 | 合规 | 说明 |
|------|------|------|
| C1 Frontend Render-Only | √ | 仅前端 UI 与前端 state 过滤逻辑改动，无后端职责迁移到前端 |
| C2 Zero-Fallback Errors | √ | `parseJsonSchema` 显式设置 `isEnabled: true`，无静默回退；`serializeToJsonSchema` 显式跳过禁用 key，无默认成功掩盖 |
| C3 Responsiveness | √ | 改动均为细粒度响应式（checkbox onChange + class 绑定），无主线程阻塞风险 |
| C4 AI UI Isolation | √ | 不涉及 AI 动态 UI 层 |
| C5 Mobile Frontend Independence | √ | 仅改动 `src/components/SchemaConfigPanel.tsx`，未触及 `src-mobile/`，未引入 `isMobile` 分支 |
| C6 Project Cache Location | √ | 不涉及缓存写入 |
| C7 PC/Android Coverage | √ | 后端 schema 字符串为同一份，PC 与 Android 共享同一过滤后的 schema；移动端前端独立项目未受影响，后端无单端后门 |

## 验收记录

### 构建命令

```
npx tsc --noEmit
```

### 预期效果

- 不引入新的 TS 错误。
- 项目预存 18 个错误保持不变。
- 特别关注 `SchemaConfigPanel.tsx` 第 329、400 行的预存错误是否变化。

### 实际结果

`npx tsc --noEmit` 退出码 2，输出 18 个错误，与改动前预存错误完全一致：

```
src/App.tsx(528,27): error TS2322
src/App.tsx(529,46): error TS2322
src/App.tsx(533,35): error TS2367
src/App.tsx(537,35): error TS2367
src/App.tsx(541,35): error TS2367
src/components/CharacterSidebar.tsx(257,14): error TS2304
src/components/CharacterSidebar.tsx(258,16): error TS2552
src/components/CharacterSidebar.tsx(342,17): error TS2552
src/components/CharacterSidebar.tsx(343,16): error TS2552
src/components/CharacterSidebar.tsx(427,17): error TS2552
src/components/CharacterSidebar.tsx(428,17): error TS2304
src/components/CharacterSidebar.tsx(537,37): error TS2322
src/components/MessageFormatRenderer.tsx(126,21): error TS2769
src/components/MessageFormatRenderer.tsx(135,9): error TS2774
src/components/MessageFormatRenderer.tsx(158,19): error TS2769
src/components/SchemaConfigPanel.tsx(329,43): error TS2322
src/components/SchemaConfigPanel.tsx(400,41): error TS2322
src/components/WorkspaceTransitionStage.tsx(43,31): error TS6133
```

`SchemaConfigPanel.tsx` 的两个错误（329、400 行）为预存错误，源于 `Select` 组件 `onChange` 回调的 `val` 类型为 `string`，与 `objectKind`（`"additional_properties" | "fixed_properties"`）和 subKey `type`（联合字面量）不兼容。本次改动未触及这两行 `Select` 调用，也未引入新的类型错误。

### 验收方式

- UI 验收：在 SchemaConfigPanel 中取消勾选某个 key 的"启用"开关，该 key 整个编辑器变灰（opacity-50）；保存后该 key 不出现在最终 JSON Schema 字符串中。
- 反序列化验收：重新打开同一 schema，所有 key 默认启用（isEnabled=true）。

## 已知限制或后续待办

1. **禁用 key 配置保留策略**：禁用 key 时前端仍保留该 `SchemaKeyConfig` 对象在前端 state 中，但保存到后端时只保存过滤后的 schema 字符串。这意味着后端持久化的 schema 不含禁用 key，重新加载时 `parseJsonSchema` 不会恢复被禁用的 key（因为它们已不在 JSON Schema 中）。这是任务描述中明确列出的已知限制。
2. **多人模式同步**：本次改动是纯前端过滤，房主保存后 schema 字符串已不含禁用 key，房客通过现有 schema 同步机制拿到的就是过滤后的 schema，无需额外同步逻辑。
3. **预存 TS 错误未修复**：`SchemaConfigPanel.tsx` 第 329、400 行的预存类型错误不在本次任务范围内，未做修复（避免越界改动）。
