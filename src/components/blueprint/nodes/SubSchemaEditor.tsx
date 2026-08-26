/**
 * SubSchemaEditor: structured editor for a JSON Schema sub-tree, recursive.
 *
 * Renders UI appropriate to `fieldType`:
 * - object: mode select (Map vs Object) + (if Object) sub-key list editor
 * - array:  items type select
 * - string/number/integer/boolean: no sub-schema UI
 *
 * Always offers a "高级模式 (JSON)" collapsible textarea for power users;
 * the structured UI is the source of truth and writes back to the same
 * `sub_schema` JSON object on every change.
 *
 * Sub-keys are stored as `{ properties: { name: { type, description, required? } } }`
 * for Object mode, or `{ additionalProperties: { type } }` for Map mode, or
 * `{ items: { type } }` for array. The shapes match what the Rust executor
 * merges into the parent property via `build_property_schema`.
 */
import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { Select } from '../../ui/Select';

const FIELD_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'object',
  'array',
] as const;
type FieldType = (typeof FIELD_TYPES)[number];

interface SubKey {
  name: string;
  type: FieldType;
  description: string;
  required: boolean;
}

type ObjectMode = 'additional_properties' | 'fixed_properties';

interface ParsedSubSchema {
  /** Object mode: 'additional_properties' or 'fixed_properties'. */
  objectMode: ObjectMode;
  /** Sub-key list (only meaningful when objectMode == 'fixed_properties'). */
  properties: SubKey[];
  /** Free-form additionalProperties type (Map mode). */
  additionalType: FieldType;
  /** Array items type. */
  itemsType: FieldType;
}

const DEFAULT_PARSED: ParsedSubSchema = {
  objectMode: 'additional_properties',
  properties: [],
  additionalType: 'string',
  itemsType: 'string',
};

function parseSubSchema(sub: Record<string, unknown> | null): ParsedSubSchema {
  if (!sub) return { ...DEFAULT_PARSED };
  const out: ParsedSubSchema = { ...DEFAULT_PARSED };

  if (sub.items && typeof sub.items === 'object') {
    const items = sub.items as { type?: string };
    if (items.type && (FIELD_TYPES as readonly string[]).includes(items.type)) {
      out.itemsType = items.type as FieldType;
    }
  }
  if (sub.additionalProperties !== undefined && sub.additionalProperties !== null) {
    const apRaw = sub.additionalProperties as
      | { type?: string }
      | boolean
      | undefined;
    if (typeof apRaw === 'object' && apRaw !== null) {
      if (apRaw.type && (FIELD_TYPES as readonly string[]).includes(apRaw.type)) {
        out.additionalType = apRaw.type as FieldType;
        out.objectMode = 'additional_properties';
      }
    } else if (apRaw === false) {
      // `additionalProperties: false` 是「禁止自由键」的标志，对应 fixed_properties 模式
      out.objectMode = 'fixed_properties';
    }
  }
  if (sub.properties && typeof sub.properties === 'object') {
    out.objectMode = 'fixed_properties';
    out.properties = Object.entries(sub.properties as Record<string, unknown>).map(
      ([name, propRaw]) => {
        const prop = (propRaw ?? {}) as { type?: string; description?: string };
        const requiredList = Array.isArray(sub.required) ? (sub.required as unknown[]).map(String) : [];
        return {
          name,
          type: ((FIELD_TYPES as readonly string[]).includes(prop.type ?? '')
            ? (prop.type as FieldType)
            : 'string'),
          description: prop.description ?? '',
          required: requiredList.includes(name),
        };
      },
    );
  }
  return out;
}

function serializeSubSchema(
  fieldType: string,
  parsed: ParsedSubSchema,
): Record<string, unknown> {
  if (fieldType === 'array') {
    return { items: { type: parsed.itemsType } };
  }
  if (fieldType === 'object') {
    if (parsed.objectMode === 'additional_properties') {
      return { additionalProperties: { type: parsed.additionalType } };
    }
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const k of parsed.properties) {
      if (!k.name.trim()) continue;
      properties[k.name] = { type: k.type, description: k.description };
      if (k.required) required.push(k.name);
    }
    const out: Record<string, unknown> = {
      properties,
      additionalProperties: false,
    };
    if (required.length > 0) out.required = required;
    return out;
  }
  return {};
}

export interface SubSchemaEditorProps {
  fieldType: string;
  subSchema: Record<string, unknown> | null;
  onChange: (next: Record<string, unknown> | null) => void;
}

export const SubSchemaEditor: Component<SubSchemaEditorProps> = (props) => {
  const [advancedOpen, setAdvancedOpen] = createSignal(false);
  const [advancedText, setAdvancedText] = createSignal('');
  const [advancedError, setAdvancedError] = createSignal<string | null>(null);

  const parsed = createMemo(() => parseSubSchema(props.subSchema));
  const showStructured = createMemo(() =>
    props.fieldType === 'object' || props.fieldType === 'array',
  );

  const commit = (next: ParsedSubSchema) => {
    props.onChange(serializeSubSchema(props.fieldType, next));
  };

  // ---------- Object mode handlers ----------
  const setObjectMode = (mode: ObjectMode) => {
    commit({ ...parsed(), objectMode: mode });
  };
  const setAdditionalType = (t: FieldType) => {
    commit({ ...parsed(), additionalType: t });
  };
  const setItemsType = (t: FieldType) => {
    commit({ ...parsed(), itemsType: t });
  };

  // ---------- Sub-key list handlers ----------
  const addSubKey = () => {
    const properties = [
      ...parsed().properties,
      { name: '', type: 'string' as FieldType, description: '', required: false },
    ];
    commit({ ...parsed(), properties });
  };
  const removeSubKey = (idx: number) => {
    const properties = parsed().properties.filter((_, i) => i !== idx);
    commit({ ...parsed(), properties });
  };
  const updateSubKey = (idx: number, patch: Partial<SubKey>) => {
    const properties = parsed().properties.map((k, i) =>
      i === idx ? { ...k, ...patch } : k,
    );
    commit({ ...parsed(), properties });
  };

  // ---------- Advanced JSON handlers ----------
  const openAdvanced = () => {
    setAdvancedText(
      props.subSchema === null ? '' : JSON.stringify(props.subSchema, null, 2),
    );
    setAdvancedError(null);
    setAdvancedOpen(true);
  };
  const commitAdvanced = () => {
    const text = advancedText().trim();
    if (text === '') {
      setAdvancedError(null);
      props.onChange(null);
      setAdvancedOpen(false);
      return;
    }
    try {
      const value: unknown = JSON.parse(text);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        setAdvancedError('sub_schema 必须是 JSON 对象（{}）');
        return;
      }
      setAdvancedError(null);
      props.onChange(value as Record<string, unknown>);
      setAdvancedOpen(false);
    } catch (e) {
      setAdvancedError('JSON 解析失败：' + (e as Error).message);
    }
  };

  return (
    <div class="space-y-3">
      <Show when={showStructured() && !advancedOpen()}>
        <Show when={props.fieldType === 'object'}>
          <div class="space-y-3 pl-3 border-l border-white/10">
            <div class="space-y-1">
              <label class="text-[10px] text-mist-solid/40 uppercase tracking-widest">
                对象模式
              </label>
              <Select
                value={parsed().objectMode}
                onChange={(v) => setObjectMode(v as ObjectMode)}
                options={[
                  { label: '自由键值对 (Map)', value: 'additional_properties' },
                  { label: '固定子键列表 (Object)', value: 'fixed_properties' },
                ]}
              />
            </div>

            <Show
              when={parsed().objectMode === 'fixed_properties'}
              fallback={
                <div class="space-y-1">
                  <label class="text-[10px] text-mist-solid/40 uppercase tracking-widest">
                    additionalProperties 类型
                  </label>
                  <Select
                    value={parsed().additionalType}
                    onChange={(v) => setAdditionalType(v as FieldType)}
                    options={FIELD_TYPES.map((t) => ({ label: t, value: t }))}
                  />
                </div>
              }
            >
              <div class="space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] font-bold text-mist-solid/60">
                    子键列表 (Properties)
                  </span>
                  <button
                    type="button"
                    onClick={addSubKey}
                    class="text-[10px] text-accent hover:underline"
                  >
                    + 添加子键
                  </button>
                </div>
                <Show when={parsed().properties.length === 0}>
                  <div class="text-[10px] text-mist-solid/30 italic">
                    暂无子键。点击「+ 添加子键」开始。
                  </div>
                </Show>
                <For each={parsed().properties}>
                  {(subKey, idx) => (
                    <div class="border-l-2 border-white/10 pl-3 space-y-2 mb-3 relative">
                      <div class="flex items-center gap-2">
                        <input
                          type="text"
                          value={subKey.name}
                          onInput={(e) =>
                            updateSubKey(idx(), { name: e.currentTarget.value })
                          }
                          class="flex-1 bg-transparent border-b border-white/20 rounded-none px-1 py-1 text-xs text-mist-solid focus:outline-none focus:border-accent"
                          placeholder="子键名"
                        />
                        <button
                          type="button"
                          onClick={() => removeSubKey(idx())}
                          class="text-red-400 hover:text-red-300 text-[10px] px-1"
                        >
                          删除
                        </button>
                      </div>
                      <div class="grid grid-cols-2 gap-2">
                        <Select
                          value={subKey.type}
                          onChange={(v) =>
                            updateSubKey(idx(), { type: v as FieldType })
                          }
                          options={FIELD_TYPES.map((t) => ({ label: t, value: t }))}
                        />
                        <input
                          type="text"
                          value={subKey.description}
                          onInput={(e) =>
                            updateSubKey(idx(), {
                              description: e.currentTarget.value,
                            })
                          }
                          class="bg-transparent border-b border-white/20 rounded-none px-1 py-1 text-[11px] text-mist-solid focus:outline-none focus:border-accent"
                          placeholder="描述"
                        />
                      </div>
                      <label class="flex items-center gap-1.5 text-[10px] text-mist-solid/55 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={subKey.required}
                          onChange={(e) =>
                            updateSubKey(idx(), { required: e.currentTarget.checked })
                          }
                          class="accent-accent scale-90"
                        />
                        必填
                      </label>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={props.fieldType === 'array'}>
          <div class="space-y-1 pl-3 border-l border-white/10">
            <label class="text-[10px] text-mist-solid/40 uppercase tracking-widest">
              items 类型
            </label>
            <Select
              value={parsed().itemsType}
              onChange={(v) => setItemsType(v as FieldType)}
              options={FIELD_TYPES.map((t) => ({ label: t, value: t }))}
            />
          </div>
        </Show>
      </Show>

      {/* JSON 高级模式（折叠区）*/}
      <Show when={!advancedOpen()}>
        <button
          type="button"
          onClick={openAdvanced}
          class="text-[10px] text-mist-solid/40 hover:text-mist-solid/70 transition-colors"
        >
          ▸ 高级模式（编辑 JSON）
        </button>
      </Show>
      <Show when={advancedOpen()}>
        <div class="space-y-1 pt-2 border-t border-white/10">
          <div class="flex items-center justify-between">
            <label class="text-[10px] text-mist-solid/40 uppercase tracking-widest">
              sub_schema（JSON 对象）
            </label>
            <button
              type="button"
              onClick={() => setAdvancedOpen(false)}
              class="text-[10px] text-mist-solid/40 hover:text-mist-solid/70"
            >
              ▾ 收起
            </button>
          </div>
          <textarea
            value={advancedText()}
            onInput={(e) => setAdvancedText(e.currentTarget.value)}
            onBlur={commitAdvanced}
            class="w-full bg-transparent border border-white/15 rounded-lg py-2 px-2 text-xs text-mist-solid focus:outline-none focus:border-accent resize-y min-h-[120px] font-mono"
            placeholder='{"properties": {"location": {"type": "string"}}}'
          />
          <Show when={advancedError()}>
            <p class="text-xs text-red-400">{advancedError()}</p>
          </Show>
          <p class="text-[10px] text-mist-solid/35">
            失焦时解析。结构化编辑会被 JSON 覆盖，反之亦然。
          </p>
        </div>
      </Show>
    </div>
  );
};
