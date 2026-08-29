/**
 * OpenAI 版 SamplingParams 节点配置编辑器。
 *
 * 只暴露 OpenAI / chat_completions 协议支持的字段：temperature /
 * max_tokens / top_p / frequency_penalty / presence_penalty / stop[]。
 * thinking 相关字段不在此出现——OpenAI 兼容路径遇到 thinking 会直接报错。
 *
 * Constraints:
 * - C1 Frontend Render-Only: edits forwarded via onUpdate, no backend calls.
 * - C3 Responsiveness: SolidJS fine-grained props; stop list uses <For>
 *   keyed by index so a single edit patches one input.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 */

import { Component, For, Show } from 'solid-js';
import type { OpenAiSamplingParamsConfig } from '../../../lib/blueprint/types';
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

export const SamplingParamsOpenAiNode: Component<
  NodeConfigComponentProps<OpenAiSamplingParamsConfig>
> = (props) => {
  const update = (updates: Partial<OpenAiSamplingParamsConfig>) =>
    props.onUpdate(updates);

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
      <p class="text-[11px] text-mist-solid/45 leading-5">
        仅在当前会话协议为 <span class="text-emerald-400/80">chat_completions</span>{' '}
        时生效；Anthropic 会话下该节点不出参。
      </p>

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
          onChange={(e) =>
            update({ frequency_penalty: parseNum(e.currentTarget.value) })
          }
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
          onChange={(e) =>
            update({ presence_penalty: parseNum(e.currentTarget.value) })
          }
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
            onChange={(e) => update({ is_locked: e.currentTarget.checked })}
            class="accent-accent"
          />
          is_locked（锁定后内容只读）
        </label>
      </div>
    </div>
  );
};
