/**
 * ConstantNode — 常量节点配置面板（spec 里程碑 B）。
 *
 * 配置字段：
 * - label：节点标签（仅显示用）
 * - source：会话属性键名，当前支持 "conversation_type" / "memory_mode"
 *
 * 运行时：节点读取会话属性值，输出到 `out` 端口供下游 BranchNode 回溯查询。
 */
import { Component } from 'solid-js';
import type { ConstantConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const ConstantNode: Component<NodeConfigComponentProps<ConstantConfig>> = (props) => {
  const update = (updates: Partial<ConstantConfig>) => props.onUpdate(updates);

  return (
    <div class="space-y-4">
      <div class="space-y-1">
        <label class={LABEL_CLASS}>label（显示名）</label>
        <input
          type="text"
          value={props.config.label}
          disabled={props.isLocked}
          onInput={(e) => update({ label: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="如：会话角色"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>source（会话属性键名）</label>
        <select
          class="w-full bg-night-deep/60 border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent disabled:opacity-50"
          value={props.config.source}
          disabled={props.isLocked}
          onChange={(e) => update({ source: e.currentTarget.value })}
        >
          <option value="conversation_type">conversation_type（single / online）</option>
          <option value="memory_mode">memory_mode（stateless / legacy / mem0）</option>
          <option value="protocol">protocol（anthropic / chat_completions）</option>
        </select>
        <p class="text-[10px] text-mist-solid/35 mt-1">
          运行时读取会话对应属性，输出值供下游 Branch 节点按值匹配走分支。
        </p>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>出口端口（固定）</label>
        <span class="font-mono text-xs text-mist-solid/80 bg-white/5 px-1.5 py-0.5 rounded">
          out
        </span>
      </div>
    </div>
  );
};
