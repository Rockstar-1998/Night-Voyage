import { Component } from 'solid-js';
import type { ToolDefinitionConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Wrench, Lock } from '../../../lib/icons';

const INPUT_CLASS =
  'w-full bg-black/30 border border-white/15 rounded-lg py-2 px-3 text-sm font-mono text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const TEXTAREA_CLASS =
  'w-full bg-black/30 border border-white/15 rounded-lg py-2 px-3 text-sm font-mono text-mist-solid focus:outline-none focus:border-accent transition-all custom-scrollbar disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const ToolDefinitionNode: Component<NodeConfigComponentProps<ToolDefinitionConfig>> = (props) => {
  const update = (updates: Partial<ToolDefinitionConfig>) => props.onUpdate(updates);

  return (
    <div class="space-y-4">
      <div class="p-3 rounded-xl border border-sky-500/20 bg-sky-500/5 space-y-2">
        <div class="flex items-center gap-2 text-xs font-bold text-sky-400">
          <Wrench size={16} />
          <span>自定义 ToolCall 契约定义</span>
        </div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          向大模型暴露函数调用接口（如 <code class="text-sky-300">check_inventory</code>、<code class="text-sky-300">buy_item</code>）。大模型按需发起 ToolCall，由 Rust 确定性运算器与门禁处理。
        </p>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>工具名称 (Tool Name)</label>
        <input
          type="text"
          value={props.config.tool_name || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ tool_name: e.currentTarget.value.trim() })}
          class={INPUT_CLASS}
          placeholder="如: buy_item, check_inventory"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>功能描述 (Description)</label>
        <input
          type="text"
          value={props.config.description || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ description: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="供大模型决策是否调用的功能说明"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>参数定义 (Parameters JSON Schema)</label>
        <textarea
          rows={6}
          value={props.config.parameters_schema || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ parameters_schema: e.currentTarget.value })}
          class={TEXTAREA_CLASS}
          placeholder='{\n  "type": "object",\n  "properties": {\n    "item_id": { "type": "string" },\n    "count": { "type": "number" }\n  },\n  "required": ["item_id"]\n}'
        />
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-white/5">
        <label class="text-xs text-mist-solid/60 flex items-center gap-1.5 cursor-pointer">
          <Lock size={13} class={props.config.is_locked ? 'text-amber-400' : 'text-mist-solid/30'} />
          <span>锁定节点</span>
        </label>
        <input
          type="checkbox"
          checked={props.config.is_locked || false}
          onChange={(e) => update({ is_locked: e.currentTarget.checked })}
          class="w-4 h-4 rounded border-white/20 bg-white/5 text-accent focus:ring-1 focus:ring-accent/40"
        />
      </div>
    </div>
  );
};
