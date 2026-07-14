/**
 * SchemaField node config editor (Task 9).
 *
 * Edits a SchemaFieldConfig: field_name / field_type / description /
 * sub_schema (JSON) / db_mapping / is_locked / lock_reason.
 *
 * The sub_schema is a JSON object edited via a textarea: the local text
 * signal holds the in-progress string, and on blur we parse + validate +
 * commit. Parse errors are shown inline without losing the user's text.
 *
 * Migrated from SchemaConfigPanel: field_name/field_type/description map to
 * the old key editor; sub_schema replaces the old properties/items editor
 * with a raw JSON surface (the spec stores sub_schema as an opaque object).
 *
 * Constraints:
 * - C1 Frontend Render-Only: edits forwarded via onUpdate, no backend calls.
 * - C3 Responsiveness: SolidJS fine-grained props; sub_schema text is a
 *   local signal so keystrokes don't re-render the parent.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 * - C2 Zero-Fallback: invalid JSON shows an error and does NOT silently
 *   commit a null/partial value — the user must fix it or clear the field.
 */

import { Component, Show, createMemo, createSignal } from 'solid-js';
import type { SchemaFieldConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Select } from '../../ui/Select';

const FIELD_TYPES = ['string', 'object', 'array', 'number', 'boolean'] as const;

const DB_MAPPING_OPTIONS = [
  { label: '（不持久化）', value: '' },
  { label: 'world_variables', value: 'world_variables' },
  { label: 'plot_summary', value: 'plot_summary' },
];

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const TEXTAREA_CLASS =
  'w-full bg-transparent border border-white/15 rounded-lg py-2 px-2 text-xs text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed resize-y min-h-[120px] font-mono';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

const hasSubSchema = (fieldType: string): boolean =>
  fieldType === 'object' || fieldType === 'array';

export const SchemaFieldNode: Component<NodeConfigComponentProps<SchemaFieldConfig>> = (props) => {
  // Local signal mirrors the stringified sub_schema so the user can type
  // freely; we only commit to props.config.sub_schema on blur, after parse.
  const [subSchemaText, setSubSchemaText] = createSignal(
    props.config.sub_schema === null ? '' : JSON.stringify(props.config.sub_schema, null, 2),
  );
  const [subSchemaError, setSubSchemaError] = createSignal<string | null>(null);

  const update = (updates: Partial<SchemaFieldConfig>) => props.onUpdate(updates);

  const showSubSchema = createMemo(() => hasSubSchema(props.config.field_type));

  const handleSubSchemaBlur = () => {
    const text = subSchemaText().trim();
    if (text === '') {
      setSubSchemaError(null);
      update({ sub_schema: null });
      return;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setSubSchemaError('sub_schema 必须是 JSON 对象（{}）');
        return;
      }
      setSubSchemaError(null);
      update({ sub_schema: parsed as Record<string, unknown> });
    } catch (e) {
      setSubSchemaError('JSON 解析失败：' + (e as Error).message);
    }
  };

  const handleLockToggle = (checked: boolean) => {
    if (checked) {
      update({ is_locked: true, lock_reason: props.config.lock_reason ?? '' });
    } else {
      update({ is_locked: false, lock_reason: null });
    }
  };

  const handleDbTypeChange = (val: string) => {
    update({ db_mapping: val === '' ? null : val });
  };

  return (
    <div class="space-y-4">
      <div class="space-y-1">
        <label class={LABEL_CLASS}>field_name</label>
        <input
          type="text"
          value={props.config.field_name}
          disabled={props.isLocked}
          onInput={(e) => update({ field_name: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="schema property 名，如 thinking / world_variables"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>field_type</label>
        <Select
          value={props.config.field_type}
          options={FIELD_TYPES.map((t) => ({ label: t, value: t }))}
          disabled={props.isLocked}
          onChange={(val) => update({ field_type: val })}
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>description</label>
        <input
          type="text"
          value={props.config.description}
          disabled={props.isLocked}
          onInput={(e) => update({ description: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="字段描述"
        />
      </div>

      <Show when={showSubSchema()}>
        <div class="space-y-1">
          <label class={LABEL_CLASS}>sub_schema（JSON 对象）</label>
          <textarea
            value={subSchemaText()}
            disabled={props.isLocked}
            onInput={(e) => setSubSchemaText(e.currentTarget.value)}
            onBlur={handleSubSchemaBlur}
            class={TEXTAREA_CLASS}
            placeholder={'{"properties": {"location": {"type": "string"}}}'}
          />
          <Show when={subSchemaError()}>
            <p class="text-xs text-red-400">{subSchemaError()}</p>
          </Show>
          <p class="text-[10px] text-mist-solid/35">
            失焦时解析。留空 = null。无效 JSON 不会覆盖已有值。
          </p>
        </div>
      </Show>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>db_mapping</label>
        <Select
          value={props.config.db_mapping ?? ''}
          options={DB_MAPPING_OPTIONS}
          disabled={props.isLocked}
          onChange={handleDbTypeChange}
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
            placeholder="为什么锁定这个字段"
          />
        </div>
      </Show>
    </div>
  );
};
