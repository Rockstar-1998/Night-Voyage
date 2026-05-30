# 前端 Bug 修复交接文档（第八轮后）

> 生成时间：2026-05-29
> 上下文：用户即将切换开发环境，需要完整总结本轮修复历程、当前进度、下一步计划与遗留坑。

---

## 一、八轮 Bug 修复历程

### 背景
本项目基于 `Tauri 2.0 + Rust` 后端 + `SolidJS` 前端。本次修复围绕 **Structured Outputs（结构化输出）模式** 下的流式传输体验、预设顺序、消息格式化等问题展开。

### Round 1：初始修复
- **上下文标签剔除格式**：前端序列化格式从嵌套 JSON 改为扁平格式，匹配后端期望。
- **上下文标签默认行为**：为 `CollapsibleTag` 添加 `createEffect` 同步 `defaultExpanded` props。
- **Schema 编辑器 object 类型支持**：`SchemaConfigPanel` 支持 object 类型字段配置。
- **预设顺序**：移除三级分组（locked/exclusive/normal），改为统一平铺列表。

### Round 2：CollapsibleTag props 响应问题
- **问题**：`CollapsibleTag` 不响应 `defaultExpanded` 变化。
- **修复**：添加 `createEffect(() => setIsExpanded(props.defaultExpanded))`。
- **副作用**：流式传输时每次 delta 都会强制重置折叠状态。

### Round 3：流式强制展开 + 预设顺序
- **问题**：流式传输时标签来回闪烁，手动折叠后被强制展开。
- **修复尝试**：添加 `hasUserToggled` 标志位。
- **预设顺序**：添加 `priority DESC` 和 `id ASC` tie-breaker。
- **结果**：流式闪烁未解决，预设顺序仍不对。

### Round 4：全局状态 + 自然顺序
- **CollapsibleTag**：引入全局 `userToggleState` Map。
- **预设顺序**：移除前端排序，使用 `detail.blocks` 自然顺序。
- **流式动画**：添加 `.streaming-text-fade` CSS 动画。
- **结果**：预设顺序错误（锁定组跑到最前），动画未生效。

### Round 5：Index 组件尝试
- **CollapsibleTag**：使用 `<Index>` 替代 `<For>` 防止 remount。
- **预设顺序**：恢复 `sortOrder ASC, priority DESC, id ASC` 排序，blocks 与 groups 合并排序。
- **结果**：`<Index>` 导致流式内容卡死/只显示初始字符。

### Round 6：回退 Index + 全局状态
- **回退**：`<Index>` → `<For>`，恢复全局 `userToggleState`。
- **结果**：回到闪烁问题，但内容正常更新。

### Round 7：StreamingFieldTag 增量组件
- **核心架构变更**：创建 `StreamingFieldTag` 组件，内部用 `createMemo` 读取 `structuredFields[fieldKey]`。
- **防闪烁**：`<Index>` + `StreamingFieldTag` 组合，组件结构不 remount，仅文本节点更新。
- **预设顺序**：已解决（第五轮）。
- **问题**：`defaultExpanded` 作为静态 prop 传入，配置更新后不生效；标签内容无格式化。

### Round 8：响应式 defaultExpanded + 格式化 + 动画
- **响应式 defaultExpanded**：`StreamingFieldTag` 不再接收计算好的 `defaultExpanded`，改为接收 `structuredOutputDisplay` 字符串 + `defaultExpandedGlobal`，内部用 `createMemo` 计算。
- **消息格式化**：`StreamingFieldTag` 内部使用 `parseMessageContent` + `MessageFormatRenderer` 渲染标签内容。
- **流式动画**：通过 `MessageFormatRenderer` 的 `isStreaming` prop 为文本节点添加 `streaming-char` class。
- **构建状态**：✅ 通过

---

## 二、已修改文件清单

| 文件 | 修改内容 | 当前状态 |
|------|----------|----------|
| `src/components/MessageItem.tsx` | 新增 `StreamingFieldTag` 组件；`<Index>` 渲染流式字段；`userToggleState` 改为 per-message Map | 最新 |
| `src/components/MessageFormatRenderer.tsx` | `CollapsibleTag` 全局状态；`isStreaming` prop 支持；动画 class | 最新 |
| `src/components/CompletionPresetArea.tsx` | `orderedItems` 合并 blocks + groups 按 `sortOrder ASC, priority DESC, id ASC` 排序 | 最新 |
| `src/index.css` | `@keyframes streamingFadeIn` + `.streaming-char` | 最新 |
| `src/components/SchemaConfigPanel.tsx` | 上下文标签配置、Schema 编辑器（Phase 3 功能） | 稳定 |
| `src/components/CompletionParametersPanel.tsx` | 删除 JSON Schema textarea，改为打开 Schema 配置面板按钮 | 稳定 |
| `src/lib/backend.ts` | 添加 `contextIncludedKeys`、`linkedSchemaKeys` 等字段 | 稳定 |
| `src/lib/icons.ts` | 添加 `Braces` 图标导出 | 稳定 |
| `src-tauri/src/services/prompt_compiler.rs` | 后端编译顺序 `ORDER BY sort_order ASC, priority DESC, id ASC` | 稳定 |
| `src-tauri/src/repositories/preset_repository.rs` | 查询添加 `contextIncludedKeys` 等字段 | 稳定 |
| `src-tauri/src/models/mod.rs` | Rust 模型添加新字段 | 稳定 |
| `src-tauri/src/commands/presets/mod.rs` | 命令参数扩展 | 稳定 |
| `src-tauri/src/services/preset_service.rs` | 服务层支持新字段 | 稳定 |
| `src-tauri/migrations/0030_preset_context_included_keys.sql` | 数据库迁移 | 稳定 |

---

## 三、当前进度

### ✅ 已解决的问题
1. **流式传输闪烁**：`StreamingFieldTag` + `<Index>` 架构确保组件不 remount，文本增量更新。
2. **预设顺序**：前端排序逻辑与后端编译顺序一致（`sortOrder ASC, priority DESC, id ASC`）。
3. **消息格式化**：`StreamingFieldTag` 内部使用 `parseMessageContent` + `MessageFormatRenderer`。
4. **流式文本淡入动画**：`isStreaming` prop + `.streaming-char` CSS class。

### ❓ 待验收的问题
1. **思考标签默认展开**：第八轮已改为响应式 `defaultExpanded`（内部 `createMemo` 计算），**需要用户验收**。
   - 如果仍不生效，可能原因：
     - `structuredOutputDisplay` 配置格式不正确（应为 `{"思考": {"defaultCollapsed": true}}`）
     - 配置在消息开始流式传输后才加载，初始状态已定型
     - `userToggleState` 中该消息已有 persisted 状态

---

## 四、下一步修复计划（Plan）

### 优先级：高
1. **验收思考标签默认展开**：确认第八轮修复是否生效。如仍不生效，需排查：
   - `structuredOutputDisplay` 配置是否正确存储和传递
   - `StreamingFieldTag` 的 `createMemo` 是否在配置加载后重新计算
   - 考虑在 `StreamingFieldTag` 添加 `console.log` 调试 `defaultExpanded()` 值

2. **流式动画精细化**：当前动画应用于整个文本节点。用户提到"后期考虑使用 motion one 重写动画"。
   - 短期：保持现有 CSS 动画
   - 长期：使用 Motion One 实现字符级或 chunk 级淡入

### 优先级：中
3. **CollapsibleTag 全局状态清理**：`MessageFormatRenderer.tsx` 中的 `userToggleState`（单例 Map）仍在被非流式路径使用（`StructuredResponseRenderer`）。
   - 建议统一为 per-message 状态，或确认非流式路径是否需要跨消息共享状态。

4. **代码重构**：`StreamingFieldTag` 目前内联在 `MessageItem.tsx` 中，可考虑提取到独立文件。

### 优先级：低
5. **Schema 配置面板优化**：`SchemaConfigPanel.tsx` 的 UI/UX 可进一步优化。
6. **后端命令缺失**：`presets_compile_preview` 命令在前端调用但后端可能未完全实现，需确认。

---

## 五、遗留坑（Known Issues / Risks）

### 1. `userToggleState` 内存泄漏
- `userToggleState` 是模块级全局 Map，按 `messageId` 存储折叠状态。
- 消息数量增多时，Map 会无限增长。
- **建议**：添加清理逻辑（如消息删除时清理对应状态），或使用 `WeakMap`（但 `messageId` 是 string，无法使用 WeakMap）。

### 2. `<Index>` 与 SolidJS 信号交互的复杂性
- `<Index>` 的 render 函数只执行一次，后续通过信号更新 props。
- 如果未来需要在 `StreamingFieldTag` 中添加更多动态 props，必须确保它们是响应式的（信号/memo）。
- **风险**：静态 props 在 `<Index>` 中不会更新。

### 3. `MessageFormatRenderer` 在流式模式下的性能
- `StreamingFieldTag` 每次 delta 都会调用 `parseMessageContent`，该函数使用正则解析文本。
- 文本很长时，解析开销可能累积。
- **建议**：考虑增量解析，或缓存解析结果。

### 4. `streamingContentText()` 的 `content` key 假设
- 当前代码假设主内容字段 key 为 `content`：
  ```ts
  return sf?.['content'] ?? props.message.content ?? '';
  ```
- 如果后端使用其他 key（如 `正文`），主内容可能无法正确提取。
- **建议**：根据 Schema 动态确定主内容字段 key。

### 5. `CollapsibleTag` 与 `StreamingFieldTag` 的代码重复
- 两者都实现了折叠/展开逻辑和动画。
- `CollapsibleTag` 接收 `children`（FormatNode[]），`StreamingFieldTag` 直接读取字段值。
- **建议**：提取公共的折叠动画逻辑为 hook 或基础组件。

### 6. 后端 `presets_compile_preview` 命令
- 前端调用 `presetsCompilePreview`，但后端 `commands/presets/mod.rs` 中未找到对应命令处理器。
- **风险**：编译预览功能可能无法工作。

### 7. 动画对长文本的性能影响
- `.streaming-char` 动画应用于整个文本节点。如果文本很长（数千字），CSS 动画可能影响性能。
- **建议**：仅对新增部分应用动画，或使用 `will-change` 优化。

---

## 六、关键代码片段速查

### StreamingFieldTag（增量更新核心）
```tsx
const StreamingFieldTag: Component<{
  fieldKey: string;
  message: ChatMessage;
  structuredOutputDisplay?: string;
  defaultExpandedGlobal: boolean;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
  onChoiceSelect?: (key: string, value: string) => void;
}> = (props) => {
  const text = createMemo(() => props.message.structuredFields?.[props.fieldKey] ?? '');

  const defaultExpanded = createMemo(() => {
    if (props.structuredOutputDisplay) {
      try {
        const config = JSON.parse(props.structuredOutputDisplay);
        if (config[props.fieldKey] && typeof config[props.fieldKey].defaultCollapsed === 'boolean') {
          return !config[props.fieldKey].defaultCollapsed;
        }
      } catch { /* ignore */ }
    }
    return props.defaultExpandedGlobal;
  });

  // ... toggle state + animation + parseMessageContent rendering
};
```

### Per-message toggle state
```ts
const userToggleState = new Map<string, Map<string, boolean>>();
function getToggleState(messageId: string, fieldKey: string): boolean | undefined {
  return userToggleState.get(messageId)?.get(fieldKey);
}
function setToggleState(messageId: string, fieldKey: string, value: boolean) {
  if (!userToggleState.has(messageId)) {
    userToggleState.set(messageId, new Map());
  }
  userToggleState.get(messageId)!.set(fieldKey, value);
}
```

### 流式字段 keys（稳定引用）
```ts
const streamingStringAuxFieldKeys = createMemo(() => {
  const sf = props.message.structuredFields;
  if (!sf) return [];
  return Object.keys(sf).filter((key) => key !== 'content' && !sf[key].trimStart().startsWith('{'));
});
```

---

## 七、快速验证清单

切换环境后，建议按以下顺序验证：

1. [ ] `npm run build` 通过
2. [ ] 流式传输不闪烁
3. [ ] 思考标签默认折叠（配置 `{"思考": {"defaultCollapsed": true}}`）
4. [ ] 标签内容有格式化效果（如 `*斜体*`、`<tag>` 等）
5. [ ] 流式文本有淡入动画
6. [ ] 预设顺序与请求体一致
7. [ ] 手动折叠/展开标签后，流式传输不强制重置状态

---

## 八、第九轮修复记录

### 修复目标
- 修复动画桌面路径未传递 `structuredOutputDisplay`，导致“思考”等结构化字段仍按全局默认展开。
- 修复流式文本淡入动画作用于整段文本节点，导致每次 delta 都让旧文本重新闪烁。
- 修复自定义消息格式规则在内置规则先切分文本后偶发失效的问题。

### 已实施修改
- `src/App.tsx`：`AnimatedDesktopView` 补齐 active preset 查询，并向 `ChatArea` 传递 `structuredOutputDisplay`。
- `src/components/MessageFormatRenderer.tsx`：新增消息级 `toggleScope`、稳定 `streamKey`、流式文本 suffix 缓存与 `clearStreamingRenderCache`；结构化字段渲染时透传当前 `formatConfig` 与 `worldBookKeywords`。
- `src/components/MessageItem.tsx`：为普通内容、结构化内容、流式字段传入独立 scope/key，并在流结束后清理流式文本动画缓存。
- `src/lib/messageFormatter.ts`：自定义规则改为优先于世界书关键词、引号、斜体等内置 inline 规则执行；新增 `format_error` 节点显式展示无效正则或无效匹配组。
- `src/components/SettingsArea.tsx`：保存自定义规则前校验正则与 `groupIndex`，避免不存在的匹配组进入配置。
- `src/index.css`：`.streaming-char` 仅用于新增 suffix，并增加 `prefers-reduced-motion` 禁用动画。

### 验证结果
- `npm run build` 已通过。
- 构建仍输出既有 esbuild CSS minify 警告：`room:*` 类名被识别成未知 CSS 属性；本轮未处理该既有警告。

### 待人工验收
- 使用 `{"思考":{"defaultCollapsed":true}}` 验证桌面动画路径、移动端和历史已完成消息中的“思考”字段均默认折叠。
- 长文本流式输出时确认只有新增文字淡入，旧文字不闪烁。
- 自定义规则与世界书关键词、引号、斜体同时命中时确认自定义规则优先生效。
