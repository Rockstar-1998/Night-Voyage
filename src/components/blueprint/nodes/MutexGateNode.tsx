/**
 * MutexGate node config editor (Task 9).
 *
 * Edits a MutexGateConfig: label / options[{key,label,description}].
 * Options are "click-to-edit": each row is collapsed by default showing
 * the key (read-only badge) + label preview; clicking the expand toggle
 * reveals a label input. Keys are auto-generated (option_N) and stable
 * because they back the output port names (out_{key}).
 *
 * MutexGate is single-select at runtime — the UI label reflects this.
 *
 * Constraints:
 * - C1 Frontend Render-Only: edits forwarded via onUpdate, no backend calls.
 * - C3 Responsiveness: expand state is a local Set signal, so toggling one
 *   option does not re-render the whole list.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 */

import { Component, For, Show, createSignal } from 'solid-js';
import type { GateOption, MutexGateConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { ChevronDown, ChevronRight, Plus, Trash2 } from '../../../lib/icons';
import { IconButton } from '../../ui/IconButton';

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

const OPTION_LABEL_INPUT_CLASS =
  'w-full bg-transparent border-b border-white/15 rounded-none py-1.5 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all';

const generateOptionKey = (existing: GateOption[]): string => {
  let n = 1;
  while (existing.some((o) => o.key === `option_${n}`)) n++;
  return `option_${n}`;
};

export const MutexGateNode: Component<NodeConfigComponentProps<MutexGateConfig>> = (props) => {
  const [expandedKeys, setExpandedKeys] = createSignal<Set<string>>(new Set());

  const update = (updates: Partial<MutexGateConfig>) => props.onUpdate(updates);

  const toggleExpand = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const addOption = () => {
    const existing = props.config.options;
    const key = generateOptionKey(existing);
    const newOption: GateOption = { key, label: '', description: '' };
    update({ options: [...existing, newOption] });
    setExpandedKeys((prev) => new Set(prev).add(key));
  };

  const removeOption = (key: string) => {
    update({ options: props.config.options.filter((o) => o.key !== key) });
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  };

  const updateOptionLabel = (key: string, label: string) => {
    update({
      options: props.config.options.map((o) => (o.key === key ? { ...o, label } : o)),
    });
  };

  const updateOptionDescription = (key: string, description: string) => {
    update({
      options: props.config.options.map((o) => (o.key === key ? { ...o, description } : o)),
    });
  };

  return (
    <div class="space-y-4">
      <div class="space-y-1">
        <label class={LABEL_CLASS}>label（显示名）</label>
        <input
          type="text"
          value={props.config.label}
          onInput={(e) => update({ label: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="如 选择当前心情"
        />
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class={LABEL_CLASS}>options（单选 — 运行时只走一个出口）</label>
          <IconButton onClick={addOption} label="添加选项" size="sm">
            <Plus size={14} />
          </IconButton>
        </div>

        <Show when={props.config.options.length === 0}>
          <p class="text-xs text-mist-solid/40 px-1 py-2">暂无选项，点击 + 添加。</p>
        </Show>

        <For each={props.config.options}>
          {(option) => {
            const expanded = () => expandedKeys().has(option.key);
            return (
              <div class="border border-white/10 rounded-lg overflow-hidden">
                <div class="flex items-center gap-2 px-2 py-1.5 bg-white/[0.02]">
                  <button
                    type="button"
                    onClick={() => toggleExpand(option.key)}
                    class="text-mist-solid/50 hover:text-mist-solid transition-colors p-0.5"
                    aria-label={expanded() ? '收起选项' : '展开选项编辑'}
                  >
                    <Show when={expanded()} fallback={<ChevronRight size={14} />}>
                      <ChevronDown size={14} />
                    </Show>
                  </button>
                  <span class="text-[10px] text-mist-solid/50 font-mono bg-white/5 px-1.5 py-0.5 rounded">
                    {option.key}
                  </span>
                  <span class="flex-1 text-sm text-mist-solid/80 truncate">
                    {option.label || <span class="text-mist-solid/30 italic">未命名</span>}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeOption(option.key)}
                    class="text-red-400/70 hover:text-red-300 transition-colors p-1"
                    aria-label="删除选项"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <Show when={expanded()}>
                  <div class="px-3 pb-2 pt-2 border-t border-white/10 space-y-2">
                    <div class="space-y-1">
                      <label class={LABEL_CLASS}>label</label>
                      <input
                        type="text"
                        value={option.label}
                        onInput={(e) => updateOptionLabel(option.key, e.currentTarget.value)}
                        class={OPTION_LABEL_INPUT_CLASS}
                        placeholder="选项显示名"
                      />
                    </div>
                    <div class="space-y-1">
                      <label class={LABEL_CLASS}>description（描述）</label>
                      <textarea
                        value={option.description}
                        onInput={(e) => updateOptionDescription(option.key, e.currentTarget.value)}
                        class={`${OPTION_LABEL_INPUT_CLASS} resize-none min-h-[60px]`}
                        placeholder="选项描述（在预设工作区选择时展示给用户）"
                        rows={2}
                      />
                    </div>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
};
