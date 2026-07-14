/**
 * SamplingParams node config editor (Task 9).
 *
 * Edits a SamplingParamsConfig: temperature / max_tokens / top_p /
 * frequency_penalty / presence_penalty / stop[] / is_locked.
 *
 * Migrated from the legacy sampling-params form. Numeric fields accept
 * null (empty input = null). The stop list is an editable string array.
 * When locked, all sampling fields become read-only; the is_locked toggle
 * remains interactive.
 *
 * Constraints:
 * - C1 Frontend Render-Only: edits forwarded via onUpdate, no backend calls.
 * - C3 Responsiveness: SolidJS fine-grained props; stop list uses <For>
 *   keyed by index so a single edit patches one input.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 */

import { Component, For, Show } from 'solid-js';
import type { SamplingParamsConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Plus, Trash2 } from '../../../lib/icons';
import { IconButton } from '../../ui/IconButton';

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

const parseNum = (raw: string): number | null => {
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

export const SamplingParamsNode: Component<NodeConfigComponentProps<SamplingParamsConfig>> = (
  props,
) => {
  const update = (updates: Partial<SamplingParamsConfig>) => props.onUpdate(updates);

  const handleLockToggle = (checked: boolean) => {
    update({ is_locked: checked });
  };

  const addStop = () => {
    const current = props.config.stop ?? [];
    update({ stop: [...current, ''] });
  };

  const removeStop = (index: number) => {
    const current = props.config.stop ?? [];
    update({ stop: current.filter((_, i) => i !== index) });
  };

  const updateStop = (index: number, value: string) => {
    const current = props.config.stop ?? [];
    update({ stop: current.map((s, i) => (i === index ? value : s)) });
  };

  return (
    <div class="space-y-4">
      <div class="space-y-1">
        <label class={LABEL_CLASS}>temperature（0.0 – 2.0）</label>
        <input
          type="number"
          step="0.05"
          min="0"
          max="2"
          value={props.config.temperature ?? ''}
          disabled={props.isLocked}
          onChange={(e) => update({ temperature: parseNum(e.currentTarget.value) })}
          class={INPUT_CLASS}
          placeholder="留空 = 不覆盖"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>max_tokens（正整数）</label>
        <input
          type="number"
          step="1"
          min="1"
          value={props.config.max_tokens ?? ''}
          disabled={props.isLocked}
          onChange={(e) => {
            const n = parseNum(e.currentTarget.value);
            update({ max_tokens: n === null ? null : Math.max(1, Math.trunc(n)) });
          }}
          class={INPUT_CLASS}
          placeholder="留空 = 不覆盖"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>top_p（0.0 – 1.0）</label>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={props.config.top_p ?? ''}
          disabled={props.isLocked}
          onChange={(e) => update({ top_p: parseNum(e.currentTarget.value) })}
          class={INPUT_CLASS}
          placeholder="留空 = 不覆盖"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>frequency_penalty（-2.0 – 2.0）</label>
        <input
          type="number"
          step="0.1"
          min="-2"
          max="2"
          value={props.config.frequency_penalty ?? ''}
          disabled={props.isLocked}
          onChange={(e) => update({ frequency_penalty: parseNum(e.currentTarget.value) })}
          class={INPUT_CLASS}
          placeholder="留空 = 不覆盖"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>presence_penalty（-2.0 – 2.0）</label>
        <input
          type="number"
          step="0.1"
          min="-2"
          max="2"
          value={props.config.presence_penalty ?? ''}
          disabled={props.isLocked}
          onChange={(e) => update({ presence_penalty: parseNum(e.currentTarget.value) })}
          class={INPUT_CLASS}
          placeholder="留空 = 不覆盖"
        />
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class={LABEL_CLASS}>stop（字符串列表）</label>
          <IconButton
            onClick={addStop}
            label="添加 stop"
            size="sm"
            disabled={props.isLocked}
          >
            <Plus size={14} />
          </IconButton>
        </div>
        <Show when={props.config.stop === null}>
          <p class="text-xs text-mist-solid/40 px-1">stop = null（无停止序列）。点击 + 添加。</p>
        </Show>
        <For each={props.config.stop ?? []}>
          {(stop, index) => (
            <div class="flex items-center gap-2">
              <input
                type="text"
                value={stop}
                disabled={props.isLocked}
                onInput={(e) => updateStop(index(), e.currentTarget.value)}
                class={INPUT_CLASS}
                placeholder="停止序列"
              />
              <button
                type="button"
                onClick={() => removeStop(index())}
                disabled={props.isLocked}
                class="text-red-400/70 hover:text-red-300 transition-colors p-1 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label="删除 stop"
              >
                <Trash2 size={12} />
              </button>
            </div>
          )}
        </For>
      </div>

      <div class="space-y-1 pt-2 border-t border-white/10">
        <label class="flex items-center gap-2 text-xs text-mist-solid/70 cursor-pointer">
          <input
            type="checkbox"
            checked={props.config.is_locked}
            onChange={(e) => handleLockToggle(e.currentTarget.checked)}
            class="accent-accent"
          />
          is_locked（锁定后内容只读）
        </label>
      </div>
    </div>
  );
};
