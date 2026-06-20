import { Component, For, Show, createEffect, createSignal } from 'solid-js';
import { Select } from './ui/Select';
import { ArrowRightToLine, Plus, Save, Trash2 } from '../lib/icons';
import type { PresetDetail, PresetSemanticOptionRecord } from '../lib/backend';
import { IconButton } from './ui/IconButton';

interface SchemaSubKeyConfig {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
}

interface SchemaKeyConfig {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
  description: string;
  contextIncluded: boolean;
  defaultExpanded: boolean;
  hideLabel: boolean;
  linkedBySemanticOption: string | null;
  additionalPropertiesType?: string;
  itemsType?: string;
  required: boolean;
  properties?: SchemaSubKeyConfig[];
  objectKind?: 'additional_properties' | 'fixed_properties';
}

const SCHEMA_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'] as const;

const flattenAllSemanticOptions = (
  options: PresetSemanticOptionRecord[],
): PresetSemanticOptionRecord[] =>
  options.flatMap((option) => [option, ...flattenAllSemanticOptions(option.children)]);

const buildLinkedKeyMap = (
  semanticGroups: PresetDetail['semanticGroups'],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const group of semanticGroups) {
    for (const option of flattenAllSemanticOptions(group.options)) {
      if (option.linkedSchemaKeys?.length) {
        for (const key of option.linkedSchemaKeys) {
          map.set(key, group.label);
        }
      }
    }
  }
  return map;
};

const parseJsonSchema = (
  schema: string,
  displayConfig: string,
  contextConfig: string,
  semanticGroups: PresetDetail['semanticGroups'],
): SchemaKeyConfig[] => {
  try {
    const parsed = JSON.parse(schema);
    const display = displayConfig ? JSON.parse(displayConfig) : {};
    const context = contextConfig ? JSON.parse(contextConfig) : {};
    const linkedKeyMap = buildLinkedKeyMap(semanticGroups);
    return Object.entries(parsed.properties || {}).map(([name, prop]: [string, any]) => {
      let contextIncluded = true;
      if (context[name] !== undefined) {
        if (typeof context[name] === 'object' && context[name] !== null) {
          contextIncluded = context[name].included ?? true;
        } else if (typeof context[name] === 'boolean') {
          contextIncluded = context[name];
        }
      }

      let properties: SchemaSubKeyConfig[] | undefined;
      let objectKind: 'additional_properties' | 'fixed_properties' = 'additional_properties';
      
      if (prop.type === 'object') {
        if (prop.properties) {
          objectKind = 'fixed_properties';
          properties = Object.entries(prop.properties).map(([subName, subProp]: [string, any]) => ({
            name: subName,
            type: subProp.type || 'string',
            description: subProp.description || '',
            required: (prop.required || []).includes(subName),
          }));
        } else {
          objectKind = 'additional_properties';
        }
      }

      return {
        name,
        type: prop.type || 'string',
        description: prop.description || '',
        contextIncluded,
        defaultExpanded: !(display[name]?.defaultCollapsed ?? false),
        hideLabel: display[name]?.hideLabel ?? false,
        linkedBySemanticOption: linkedKeyMap.get(name) ?? null,
        additionalPropertiesType: prop.additionalProperties?.type,
        itemsType: prop.items?.type,
        required: (parsed.required || []).includes(name),
        properties,
        objectKind,
      };
    });
  } catch {
    return [];
  }
};

const serializeToJsonSchema = (keys: SchemaKeyConfig[]): string => {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const key of keys) {
    const prop: any = { type: key.type, description: key.description };
    if (key.type === 'object') {
      if (key.objectKind === 'fixed_properties' && key.properties) {
        const subProperties: Record<string, any> = {};
        const subRequired: string[] = [];
        for (const subKey of key.properties) {
          if (subKey.name.trim()) {
            subProperties[subKey.name] = {
              type: subKey.type,
              description: subKey.description
            };
            if (subKey.required) {
              subRequired.push(subKey.name);
            }
          }
        }
        prop.properties = subProperties;
        if (subRequired.length > 0) {
          prop.required = subRequired;
        }
        prop.additionalProperties = false;
      } else {
        prop.additionalProperties = key.additionalPropertiesType 
          ? { type: key.additionalPropertiesType } 
          : { type: 'string' };
      }
    }
    if (key.type === 'array' && key.itemsType) {
      prop.items = { type: key.itemsType };
    }
    properties[key.name] = prop;
    if (key.required) {
      required.push(key.name);
    }
  }
  return JSON.stringify({
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  }, null, 2);
};

const serializeDisplayConfig = (keys: SchemaKeyConfig[]): string => {
  const config: Record<string, { defaultCollapsed: boolean; hideLabel?: boolean }> = {};
  for (const key of keys) {
    const entry: { defaultCollapsed: boolean; hideLabel?: boolean } = { defaultCollapsed: !key.defaultExpanded };
    if (key.hideLabel) {
      entry.hideLabel = true;
    }
    config[key.name] = entry;
  }
  return JSON.stringify(config);
};

const serializeContextConfig = (keys: SchemaKeyConfig[]): string => {
  const config: Record<string, boolean> = {};
  for (const key of keys) {
    config[key.name] = key.contextIncluded;
  }
  return JSON.stringify(config);
};

const EMPTY_KEY: SchemaKeyConfig = {
  name: '',
  type: 'string',
  description: '',
  contextIncluded: true,
  defaultExpanded: true,
  hideLabel: false,
  linkedBySemanticOption: null,
  required: false,
  objectKind: 'additional_properties',
  properties: [],
};

export const SchemaConfigPanel: Component<{
  isOpen: boolean;
  detail: PresetDetail | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (data: { structuredOutputSchema: string; structuredOutputDisplay: string; contextIncludedKeys: string }) => void;
}> = (props) => {
  const [keys, setKeys] = createSignal<SchemaKeyConfig[]>([]);

  createEffect(() => {
    if (!props.isOpen || !props.detail) {
      setKeys([]);
      return;
    }
    const preset = props.detail.preset;
    if (preset.structuredOutputSchema) {
      setKeys(parseJsonSchema(
        preset.structuredOutputSchema,
        preset.structuredOutputDisplay ?? '',
        preset.contextIncludedKeys ?? '',
        props.detail.semanticGroups,
      ));
    }
  });

  const addKey = () => {
    setKeys([...keys(), { ...EMPTY_KEY }]);
  };

  const removeKey = (index: number) => {
    setKeys(keys().filter((_, i) => i !== index));
  };

  const updateKey = (index: number, patch: Partial<SchemaKeyConfig>) => {
    setKeys(keys().map((key, i) => i === index ? { ...key, ...patch } : key));
  };

  const handleSave = () => {
    const validKeys = keys().filter(k => k.name.trim());
    props.onSave({
      structuredOutputSchema: serializeToJsonSchema(validKeys),
      structuredOutputDisplay: serializeDisplayConfig(validKeys),
      contextIncludedKeys: serializeContextConfig(validKeys),
    });
  };

  return (
    <>
      <div class={`fixed inset-0 z-[890] bg-xuanqing/40 transition-all duration-300 ease-out ${props.isOpen ? "opacity-100 backdrop-blur-sm pointer-events-auto" : "opacity-0 backdrop-blur-none pointer-events-none"}`} onClick={props.onClose} />
      <div class={`fixed inset-y-0 right-0 w-[460px] bg-xuanqing/95 backdrop-blur-2xl border-l border-white/5 z-[900] shadow-2xl flex flex-col transition-all duration-300 ease-out ${props.isOpen ? "translate-x-0" : "translate-x-full"}`}>
        <div class="h-16 flex items-center justify-between px-6 border-b border-white/5 flex-shrink-0">
          <div class="flex items-center gap-2 text-mist-solid">
            <div>
              <h2 class="font-bold tracking-widest text-sm uppercase">Schema 与显示配置</h2>
              <p class="text-[10px] text-mist-solid/35 mt-1">可视化编辑结构化输出的 Schema、上下文包含和显示行为</p>
            </div>
          </div>
          <IconButton onClick={props.onClose} label="关闭 Schema 配置面板" size="md">
            <ArrowRightToLine size={18} />
          </IconButton>
        </div>

        <div class="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar relative">
          <div class="space-y-4 pb-24">
            <Show when={props.error}>
              <div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {props.error}
              </div>
            </Show>

            <Show when={keys().length === 0}>
              <div class="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-mist-solid/35">
                当前没有 Schema 键。点击下方「添加键」开始配置。
              </div>
            </Show>

            <For each={keys()}>
              {(key, index) => (
                <div class="border-b border-white/10 pb-6 space-y-4">
                  <div class="flex items-center justify-between gap-3">
                    <input
                      type="text"
                      value={key.name}
                      onInput={(e) => updateKey(index(), { name: e.currentTarget.value })}
                      class="flex-1 bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
                      placeholder="键名"
                    />
                    <Show when={!key.linkedBySemanticOption}>
                      <IconButton
                        onClick={() => removeKey(index())}
                        label="删除键"
                        tone="danger"
                        size="sm"
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </Show>
                  </div>

                  <Show when={key.linkedBySemanticOption}>
                    <div class="text-[11px] px-3 py-1.5 rounded-none border-l-2 border-accent/40 text-accent">
                      受语义组「{key.linkedBySemanticOption}」控制
                    </div>
                  </Show>

                  <div class="grid grid-cols-2 gap-3">
                    <div class="space-y-1">
                      <label class="text-[10px] text-mist-solid/40 uppercase tracking-widest">类型</label>
                      <Select
  value={key.type}
  onChange={(val) => updateKey(index(), { type: val as SchemaKeyConfig['type'] })}
  options={[
  ...(SCHEMA_TYPES).map(t => ({ label: t, value: (t)?.toString() }))
  ]}
/>
                    </div>
                    <div class="space-y-1">
                      <label class="text-[10px] text-mist-solid/40 uppercase tracking-widest">描述</label>
                      <input
                        type="text"
                        value={key.description}
                        onInput={(e) => updateKey(index(), { description: e.currentTarget.value })}
                        class="w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
                        placeholder="键的描述..."
                      />
                    </div>
                  </div>

                  <Show when={key.type === 'object'}>
                    <div class="space-y-3 pl-4 border-l border-white/10 mt-2">
                      <div class="space-y-1">
                        <label class="text-[10px] text-mist-solid/40 uppercase tracking-widest">对象模式</label>
                        <Select
  value={key.objectKind ?? 'additional_properties'}
  onChange={(val) => updateKey(index(), { objectKind: val })}
  options={[
  { label: "自由键值对 (Map)", value: "additional_properties" },
  { label: "固定子键列表 (Object)", value: "fixed_properties" }
  ]}
/>
                      </div>

                      <Show when={key.objectKind === 'fixed_properties'} fallback={
                        <div class="space-y-1">
                          <label class="text-[10px] text-mist-solid/40 uppercase tracking-widest">additionalProperties 类型</label>
                          <Select
  value={key.additionalPropertiesType ?? 'string'}
  onChange={(val) => updateKey(index(), { additionalPropertiesType: val })}
  options={[
  ...(SCHEMA_TYPES).map(t => ({ label: t, value: (t)?.toString() }))
  ]}
/>
                        </div>
                      }>
                        <div class="space-y-2">
                          <div class="flex items-center justify-between">
                            <span class="text-[11px] font-bold text-mist-solid/60">子键列表 (Properties)</span>
                            <button
                              type="button"
                              onClick={() => {
                                const currentProps = key.properties ?? [];
                                updateKey(index(), {
                                  properties: [...currentProps, { name: '', type: 'string', description: '', required: false }]
                                });
                              }}
                              class="text-[10px] text-accent hover:underline flex items-center gap-1"
                            >
                              <Plus size={10} /> 添加子键
                            </button>
                          </div>

                          <For each={key.properties ?? []}>
                            {(subKey, subIndex) => (
                              <div class="border-l-2 border-white/10 pl-3 space-y-2 relative mb-4">
                                <div class="flex items-center justify-between gap-2">
                                  <input
                                    type="text"
                                    value={subKey.name}
                                    onInput={(e) => {
                                      const newProps = [...(key.properties ?? [])];
                                      newProps[subIndex()] = { ...subKey, name: e.currentTarget.value };
                                      updateKey(index(), { properties: newProps });
                                    }}
                                    class="flex-1 bg-transparent border-b border-white/20 rounded-none px-1 py-1 text-xs text-mist-solid focus:outline-none focus:border-accent transition-all"
                                    placeholder="子键名 (如 A)"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const newProps = (key.properties ?? []).filter((_, si) => si !== subIndex());
                                      updateKey(index(), { properties: newProps });
                                    }}
                                    class="text-red-400 hover:text-red-300 p-1"
                                    title="删除子键"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>

                                <div class="grid grid-cols-2 gap-2">
                                  <div>
                                    <Select
  value={subKey.type}
  onChange={(val) => {
    const newProps = [...(key.properties ?? [])];
    newProps[subIndex()] = { ...subKey, type: val };
    updateKey(index(), { properties: newProps });
  }}
  options={[
  { label: "string", value: "string" },
  { label: "number", value: "number" },
  { label: "integer", value: "integer" },
  { label: "boolean", value: "boolean" }
  ]}
/>
                                  </div>
                                  <div>
                                    <input
                                      type="text"
                                      value={subKey.description}
                                      onInput={(e) => {
                                        const newProps = [...(key.properties ?? [])];
                                        newProps[subIndex()] = { ...subKey, description: e.currentTarget.value };
                                        updateKey(index(), { properties: newProps });
                                      }}
                                      class="w-full bg-transparent border-b border-white/20 rounded-none px-1 py-1 text-[11px] text-mist-solid focus:outline-none focus:border-accent transition-all"
                                      placeholder="描述..."
                                    />
                                  </div>
                                </div>

                                <label class="flex items-center gap-1.5 text-[10px] text-mist-solid/55 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={subKey.required}
                                    onChange={(e) => {
                                      const newProps = [...(key.properties ?? [])];
                                      newProps[subIndex()] = { ...subKey, required: e.currentTarget.checked };
                                      updateKey(index(), { properties: newProps });
                                    }}
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

                  <Show when={key.type === 'array'}>
                    <div class="space-y-1">
                      <label class="text-[10px] text-mist-solid/40 uppercase tracking-widest">items 类型</label>
                      <Select
  value={key.itemsType ?? 'string'}
  onChange={(val) => updateKey(index(), { itemsType: val })}
  options={[
  ...(SCHEMA_TYPES).map(t => ({ label: t, value: (t)?.toString() }))
  ]}
/>
                    </div>
                  </Show>

                  <div class="flex items-center gap-4">
                    <label class="flex items-center gap-2 text-xs text-mist-solid/60 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={key.contextIncluded}
                        onChange={(e) => updateKey(index(), { contextIncluded: e.currentTarget.checked })}
                        class="accent-accent"
                      />
                      上下文包含
                    </label>
                    <label class={`flex items-center gap-2 text-xs cursor-pointer ${key.hideLabel ? 'text-mist-solid/30' : 'text-mist-solid/60'}`}>
                      <input
                        type="checkbox"
                        checked={key.defaultExpanded}
                        disabled={key.hideLabel}
                        onChange={(e) => updateKey(index(), { defaultExpanded: e.currentTarget.checked })}
                        class="accent-accent"
                      />
                      默认展开
                    </label>
                    <label class="flex items-center gap-2 text-xs text-mist-solid/60 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={key.hideLabel}
                        onChange={(e) => {
                          const hideLabel = e.currentTarget.checked;
                          updateKey(index(), { hideLabel, ...(hideLabel ? { defaultExpanded: true } : {}) });
                        }}
                        class="accent-accent"
                      />
                      隐藏标签
                    </label>
                    <label class="flex items-center gap-2 text-xs text-mist-solid/60 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={key.required}
                        onChange={(e) => updateKey(index(), { required: e.currentTarget.checked })}
                        class="accent-accent"
                      />
                      必填
                    </label>
                  </div>
                </div>
              )}
            </For>
          </div>

          <div class="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-xuanqing via-xuanqing/90 to-transparent flex items-center justify-between gap-4 pointer-events-none">
            <div class="pointer-events-auto flex items-center gap-3">
              <IconButton onClick={addKey} label="添加键" size="md">
                <Plus size={16} />
              </IconButton>
              <div>
                <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">保存操作</div>
                <div class="text-sm text-mist-solid/40 mt-1">{props.saving ? '保存中...' : '保存 Schema 配置'}</div>
              </div>
            </div>
            <IconButton
              class="pointer-events-auto"
              onClick={handleSave}
              disabled={props.saving}
              label="保存 Schema 配置"
              tone="accent"
              size="lg"
            >
              <Save size={18} class={props.saving ? 'animate-pulse' : ''} />
            </IconButton>
          </div>
        </div>
      </div>
    </>
  );
};
