/**
 * Prompt node config editor (Task 9).
 *
 * Edits a PromptConfig: identifier / block_type / content / priority /
 * is_locked / lock_reason. When the node is locked, all content fields
 * become read-only; the is_locked toggle and lock_reason input remain
 * editable so the user can unlock or annotate the reason.
 *
 * Migrated from the legacy blocks editor: identifier + block_type + content
 * + priority map directly onto the old PromptBlock fields.
 *
 * Constraints:
 * - C1 Frontend Render-Only: edits are forwarded via onUpdate, no backend calls.
 * - C3 Responsiveness: SolidJS fine-grained props — each input reads its own
 *   slice of config, so a single field edit patches only that DOM node.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 */

import { Component, Show } from 'solid-js';
import type { PromptConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Select } from '../../ui/Select';

const BLOCK_TYPES = [
  'system',
  'character',
  'player',
  'world_book',
  'world_variable',
  'plot_summary',
  'recent_history',
  'current_user',
  'multiplayer_protocol',
  'retrieved_detail',
] as const;

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const TEXTAREA_CLASS =
  'w-full bg-transparent border border-white/15 rounded-lg py-2 px-2 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed resize-y min-h-[120px] font-mono';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const PromptNode: Component<NodeConfigComponentProps<PromptConfig>> = (props) => {
  const update = (updates: Partial<PromptConfig>) => props.onUpdate(updates);

  const handleLockToggle = (checked: boolean) => {
    if (checked) {
      update({ is_locked: true, lock_reason: props.config.lock_reason ?? '' });
    } else {
      update({ is_locked: false, lock_reason: null });
    }
  };

  const handlePriorityChange = (raw: string) => {
    if (raw === '') {
      update({ priority: null });
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
      update({ priority: Math.trunc(n) });
    }
  };

  return (
    <div class="space-y-4">
      <div class="space-y-1">
        <label class={LABEL_CLASS}>identifier</label>
        <input
          type="text"
          value={props.config.identifier}
          disabled={props.isLocked}
          onInput={(e) => update({ identifier: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="block 标识，如 role_definition"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>block_type</label>
        <Select
          value={props.config.block_type}
          options={BLOCK_TYPES.map((t) => ({ label: t, value: t }))}
          disabled={props.isLocked}
          onChange={(val) => update({ block_type: val })}
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>content</label>
        <textarea
          value={props.config.content}
          disabled={props.isLocked}
          onInput={(e) => update({ content: e.currentTarget.value })}
          class={TEXTAREA_CLASS}
          placeholder="提示词内容…"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>priority（可选，留空使用类型默认）</label>
        <input
          type="number"
          value={props.config.priority ?? ''}
          disabled={props.isLocked}
          onChange={(e) => handlePriorityChange(e.currentTarget.value)}
          class={INPUT_CLASS}
          placeholder="留空 = 默认优先级"
        />
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

      <Show when={props.config.is_locked}>
        <div class="space-y-1">
          <label class={LABEL_CLASS}>lock_reason</label>
          <input
            type="text"
            value={props.config.lock_reason ?? ''}
            onInput={(e) => update({ lock_reason: e.currentTarget.value })}
            class={INPUT_CLASS}
            placeholder="为什么锁定这个 block"
          />
        </div>
      </Show>
    </div>
  );
};
