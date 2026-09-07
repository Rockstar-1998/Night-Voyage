/**
 * SchemaField node config editor.
 *
 * Edits a SchemaFieldConfig: field_name / field_type / description /
 * sub_schema (structured editor for object/array) / db_mapping /
 * required / context_included / display (default_expanded, hide_label) /
 * is_locked / lock_reason.
 *
 * sub_schema is rendered by `<SubSchemaEditor>` which adapts UI to field_type
 * (object: mode switch + sub-key list; array: items type; others: empty).
 * A collapsible "高级模式 (JSON)" textarea lets power users edit the raw
 * JSON directly.
 *
 * Constraints:
 * - C1 Frontend Render-Only: edits forwarded via onUpdate, no backend calls.
 * - C3 Responsiveness: SolidJS fine-grained props; JSON advanced mode holds
 *   local text signal so keystrokes don't re-render the parent.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 * - C2 Zero-Fallback: invalid JSON shows an error and does NOT silently
 *   commit a null/partial value.
 */

import { Component, Show } from 'solid-js';
import type {
  FieldDisplayConfig,
  SchemaFieldConfig,
} from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Select } from '../../ui/Select';
import { SubSchemaEditor } from './SubSchemaEditor';

const FIELD_TYPES = [
  'string',
  'object',
  'array',
  'number',
  'integer',
  'boolean',
] as const;

const DB_MAPPING_OPTIONS = [
  { label: '（不持久化）', value: '' },
  { label: 'world_variables', value: 'world_variables' },
  { label: 'plot_summary', value: 'plot_summary' },
];

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

const CHECKBOX_ROW =
  'flex items-center gap-2 text-xs text-mist-solid/70 cursor-pointer';

export const SchemaFieldNode: Component<NodeConfigComponentProps<SchemaFieldConfig>> = (props) => {
  const update = (updates: Partial<SchemaFieldConfig>) => props.onUpdate(updates);

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

  const handleSubSchemaChange = (next: Record<string, unknown> | null) => {
    update({ sub_schema: next });
  };

  const updateDisplay = (patch: Partial<FieldDisplayConfig>) => {
    // Old presets may lack `display`; default it so spread never hits undefined.
    const base = props.config.display ?? { default_expanded: true, hide_label: false };
    update({ display: { ...base, ...patch } });
  };

  // Old presets (pre-display/required/context_included fields) may omit these.
  const display = props.config.display ?? { default_expanded: true, hide_label: false };

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

      <Show when={props.config.field_type === 'object' || props.config.field_type === 'array'}>
        <div class="space-y-1 pt-2 border-t border-white/10">
          <label class={LABEL_CLASS}>sub_schema</label>
          <SubSchemaEditor
            fieldType={props.config.field_type}
            subSchema={props.config.sub_schema}
            onChange={handleSubSchemaChange}
          />
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

      <div class="space-y-1">
        <label class={LABEL_CLASS}>order（字段顺序权重）</label>
        <input
          type="number"
          step="1"
          value={props.config.order ?? 0}
          disabled={props.isLocked}
          onInput={(e) =>
            update({ order: e.currentTarget.valueAsNumber || 0 })
          }
          class={INPUT_CLASS}
          placeholder="数值越小越靠前；缺省 0"
        />
        <p class="text-[10px] text-mist-solid/35 mt-1">
          控制该字段在结构化输出 schema 的 properties / required 中的排列顺序
          （按 (order, 遍历序) 升序排序，数值越小越靠前；相同 order 按画布连线遍历序）。
        </p>
      </div>

      <div class="space-y-1 pt-2 border-t border-white/10">
        <label class={LABEL_CLASS}>schema 行为</label>
        <div class="space-y-1.5">
          <label class={CHECKBOX_ROW}>
            <input
              type="checkbox"
              checked={props.config.required ?? true}
              onChange={(e) => update({ required: e.currentTarget.checked })}
              class="accent-accent"
            />
            required（加入 schema `required` 数组）
          </label>
          <label class={CHECKBOX_ROW}>
            <input
              type="checkbox"
              checked={props.config.context_included ?? false}
              onChange={(e) =>
                update({ context_included: e.currentTarget.checked })
              }
              class="accent-accent"
            />
            context_included（注入下一轮对话上下文）
          </label>
        </div>
        <p class="text-[10px] text-mist-solid/35 mt-1">
          注：若 db_mapping 已设置，该字段值会自动经由 world_variable / plot_summary
          块进入下一轮上下文，context_included 过滤对其无意义。
        </p>
      </div>

      <div class="space-y-1 pt-2 border-t border-white/10">
        <label class={LABEL_CLASS}>显示偏好</label>
        <div class="space-y-1.5">
          <label class={CHECKBOX_ROW}>
            <input
              type="checkbox"
              checked={display.default_expanded}
              onChange={(e) =>
                updateDisplay({ default_expanded: e.currentTarget.checked })
              }
              class="accent-accent"
            />
            default_expanded（消息列表默认展开）
          </label>
          <label class={CHECKBOX_ROW}>
            <input
              type="checkbox"
              checked={display.hide_label}
              onChange={(e) =>
                updateDisplay({ hide_label: e.currentTarget.checked })
              }
              class="accent-accent"
            />
            hide_label（消息列表隐藏字段标签）
          </label>
        </div>
      </div>

      <div class="space-y-1 pt-2 border-t border-white/10">
        <label class={CHECKBOX_ROW}>
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
