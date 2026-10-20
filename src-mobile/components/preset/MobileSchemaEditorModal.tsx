/**
 * 移动端结构化 Schema 编辑器弹窗（Task 08）。
 *
 * C5 移动端独立性：位于 src-mobile/components/preset/，零 PC 端 UI 耦合。
 * 管理预设关联的独立 Schema 资产（字段排序、保留层数、产物卡配置、类型定义）。
 */

import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import {
  type SchemaDefinition,
  type SchemaFieldDefinition,
  type SchemaFieldType,
  type DisplayTarget,
  presetSchemasList,
  presetSchemaSave,
  presetSchemaDelete,
} from '../../../src/lib/backend';
import { showToast } from '../Toast';

export interface MobileSchemaEditorModalProps {
  presetId: number;
  isOpen: boolean;
  onClose: () => void;
  onSchemaSelected?: (schemaId: string) => void;
}

const FIELD_TYPES: Array<{ value: SchemaFieldType; label: string }> = [
  { value: 'string', label: '字符串 (string)' },
  { value: 'number', label: '数值 (number)' },
  { value: 'boolean', label: '布尔 (boolean)' },
  { value: 'array', label: '数组 (array)' },
  { value: 'object', label: '对象 (object)' },
];

const DISPLAY_TARGETS: Array<{ value: DisplayTarget; label: string }> = [
  { value: 'InlineMessage', label: '行内消息 (InlineMessage)' },
  { value: 'PersistentHUD', label: '常驻 HUD (PersistentHUD)' },
  { value: 'ProductCard', label: '产物卡 (ProductCard)' },
];

const DB_MAPPINGS = [
  { value: '', label: '不持久化' },
  { value: 'world_variables', label: '世界变量 (world_variables)' },
  { value: 'plot_summary', label: '剧情摘要 (plot_summary)' },
];

export const MobileSchemaEditorModal: Component<MobileSchemaEditorModalProps> = (props) => {
  const [schemas, setSchemas] = createSignal<SchemaDefinition[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [selectedSchemaId, setSelectedSchemaId] = createSignal<string | null>(null);

  // Form states
  const [currentId, setCurrentId] = createSignal('');
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [enableRetention, setEnableRetention] = createSignal(false);
  const [retentionDepthInput, setRetentionDepthInput] = createSignal('3');
  const [fields, setFields] = createSignal<SchemaFieldDefinition[]>([]);
  const [saving, setSaving] = createSignal(false);
  const [showJsonPreview, setShowJsonPreview] = createSignal(false);

  // 产物卡配置
  const [cardEnabled, setCardEnabled] = createSignal(false);
  const [cardTitleField, setCardTitleField] = createSignal('');
  const [cardActions, setCardActions] = createSignal<Array<{ label: string; command: string; argsTemplate: Array<[string, string]> }>>([]);

  const loadSchemas = async () => {
    setLoading(true);
    try {
      const list = await presetSchemasList(props.presetId);
      setSchemas(list);
      if (list.length > 0 && !selectedSchemaId()) {
        selectSchema(list[0]);
      } else if (list.length === 0) {
        createNewSchema();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`加载 Schema 失败：${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (props.isOpen) {
      void loadSchemas();
    }
  });

  const selectSchema = (schema: SchemaDefinition) => {
    setSelectedSchemaId(schema.id);
    setCurrentId(schema.id);
    setName(schema.name);
    setDescription(schema.description || '');
    if (schema.retentionDepth !== null && schema.retentionDepth !== undefined && schema.retentionDepth >= 1) {
      setEnableRetention(true);
      setRetentionDepthInput(String(schema.retentionDepth));
    } else {
      setEnableRetention(false);
      setRetentionDepthInput('3');
    }
    setFields(JSON.parse(JSON.stringify(schema.fields || [])));
    if (schema.card) {
      setCardEnabled(true);
      setCardTitleField(schema.card.titleField || schema.fields?.[0]?.name || '');
      setCardActions(JSON.parse(JSON.stringify(schema.card.actions || [])));
    } else {
      setCardEnabled(false);
      setCardTitleField('');
      setCardActions([]);
    }
  };

  const createNewSchema = () => {
    setSelectedSchemaId(null);
    setCurrentId('');
    setName('新结构化 Schema');
    setDescription('');
    setEnableRetention(false);
    setRetentionDepthInput('3');
    setCardEnabled(false);
    setCardTitleField('');
    setCardActions([]);
    setFields([
      {
        name: 'thinking',
        fieldType: 'string',
        required: true,
        displayTarget: 'InlineMessage',
        dbMapping: '',
        description: '隐藏推演与策略思考',
      },
      {
        name: 'narrative',
        fieldType: 'string',
        required: true,
        displayTarget: 'InlineMessage',
        dbMapping: '',
        description: '叙事正文主句',
      },
      {
        name: 'hp',
        fieldType: 'number',
        required: true,
        displayTarget: 'PersistentHUD',
        dbMapping: 'world_variables',
        description: '当前数值属性',
      },
    ]);
  };

  const addField = () => {
    setFields((prev) => [
      ...prev,
      {
        name: `field_${prev.length + 1}`,
        fieldType: 'string',
        required: true,
        displayTarget: 'InlineMessage',
        dbMapping: '',
        description: '',
      },
    ]);
  };

  const removeField = (index: number) => {
    setFields((prev) => prev.filter((_, idx) => idx !== index));
  };

  const moveField = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= fields().length) return;
    setFields((prev) => {
      const copy = [...prev];
      const [item] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, item);
      return copy;
    });
  };

  const updateField = (index: number, partial: Partial<SchemaFieldDefinition>) => {
    setFields((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...partial };
      return copy;
    });
  };

  const handleSave = async () => {
    if (!name().trim()) {
      showToast('Schema 名称不能为空', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload: SchemaDefinition = {
        id: currentId(),
        presetId: props.presetId,
        name: name().trim(),
        description: description().trim(),
        retentionDepth: enableRetention() ? parseInt(retentionDepthInput(), 10) : null,
        fields: fields(),
        card: cardEnabled()
          ? {
              titleField: cardTitleField(),
              actions: cardActions().map((a) => ({
                label: a.label,
                command: a.command,
                argsTemplate: a.argsTemplate.map(([k, v]) => [k, v] as [string, string]),
              })),
            }
          : null,
        createdAt: 0,
        updatedAt: 0,
      };

      const saved = await presetSchemaSave(payload);
      showToast('Schema 已保存', 'success');
      await loadSchemas();
      selectSchema(saved);
      if (props.onSchemaSelected) {
        props.onSchemaSelected(saved.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`保存 Schema 失败：${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (schemaId: string) => {
    if (!confirm('确定删除该 Schema 吗？蓝图中若有调用该 Schema 的节点将受影响。')) return;
    try {
      await presetSchemaDelete(schemaId);
      showToast('Schema 已删除', 'success');
      await loadSchemas();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`删除失败：${msg}`, 'error');
    }
  };

  // 编译预览 JSON Schema
  const compiledJsonSchema = createMemo(() => {
    const properties: Record<string, any> = {};
    const required: string[] = [];

    for (const f of fields()) {
      if (!f.name.trim()) continue;
      properties[f.name.trim()] = {
        type: f.fieldType,
        ...(f.description ? { description: f.description } : {}),
      };
      if (f.required) {
        required.push(f.name.trim());
      }
    }

    return JSON.stringify(
      {
        type: 'object',
        properties,
        required,
        additionalProperties: false,
      },
      null,
      2,
    );
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex flex-col bg-xuanqing text-mist-solid safe-area-top safe-area-bottom animate-in fade-in duration-200">
        {/* Header */}
        <header class="shrink-0 h-14 flex items-center justify-between px-4 bg-xuanqing/90 backdrop-blur-md border-b border-white/5">
          <div class="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={props.onClose}
              class="p-2 text-mist-solid/70 hover:text-white transition-colors"
              aria-label="关闭"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <div class="flex items-center gap-1.5 min-w-0">
              <h2 class="text-[15px] font-bold text-white truncate">Schema 资产管理</h2>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent/20 text-accent border border-accent/30 shrink-0">
                预设 #{props.presetId}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving()}
            class="px-4 py-1.5 rounded-lg bg-accent text-white font-semibold text-[13px] active:scale-95 transition-transform disabled:opacity-40"
          >
            {saving() ? '保存中…' : '保存'}
          </button>
        </header>

        {/* Schema 选择药丸条 */}
        <div class="shrink-0 px-4 py-2.5 border-b border-white/5 bg-white/[0.02] flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={createNewSchema}
            class="shrink-0 px-3 py-1.5 rounded-xl border border-dashed border-accent/40 text-accent text-xs font-semibold active:scale-95 transition-transform"
          >
            + 新建 Schema
          </button>
          <For each={schemas()}>
            {(sch) => (
              <button
                type="button"
                onClick={() => selectSchema(sch)}
                class={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  selectedSchemaId() === sch.id
                    ? 'bg-accent/20 text-accent border border-accent/40'
                    : 'bg-white/5 text-mist-solid/70 border border-white/10'
                }`}
              >
                {sch.name}
              </button>
            )}
          </For>
        </div>

        {/* 主编辑区 */}
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-5 custom-scrollbar">
          {/* 基本属性 */}
          <div class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <h3 class="text-xs font-bold text-accent tracking-wider uppercase">基本信息</h3>
            <div>
              <label class="text-[12px] font-semibold text-mist-solid/80 block mb-1">Schema 名称</label>
              <input
                type="text"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="如 战斗结算 Schema"
                class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label class="text-[12px] font-semibold text-mist-solid/80 block mb-1">描述说明</label>
              <input
                type="text"
                value={description()}
                onInput={(e) => setDescription(e.currentTarget.value)}
                placeholder="Schema 适用场景与用途…"
                class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-accent"
              />
            </div>

            <div class="pt-2 border-t border-white/10 flex items-center justify-between">
              <div>
                <div class="text-[13px] font-semibold text-white">历史保留层数 (retention_depth)</div>
                <div class="text-[11px] text-mist-solid/40">限制进入下一轮上下文的历史条数，控制 Token 开销</div>
              </div>
              <button
                type="button"
                onClick={() => setEnableRetention(!enableRetention())}
                class={`relative w-11 h-6 rounded-full transition-colors ${enableRetention() ? 'bg-accent' : 'bg-white/15'}`}
              >
                <span class={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enableRetention() ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            <Show when={enableRetention()}>
              <div>
                <label class="text-[12px] font-semibold text-mist-solid/80 block mb-1">保留轮数</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={retentionDepthInput()}
                  onInput={(e) => setRetentionDepthInput(e.currentTarget.value)}
                  class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-accent"
                />
              </div>
            </Show>
          </div>

          {/* 字段列表 */}
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-xs font-bold text-accent tracking-wider uppercase">字段定义 (物理排序即输出顺序)</h3>
                <span class="text-[11px] text-mist-solid/40">已定义 {fields().length} 个字段</span>
              </div>
              <button
                type="button"
                onClick={addField}
                class="px-3 py-1.5 rounded-xl bg-accent/20 text-accent text-xs font-semibold active:scale-95 transition-transform"
              >
                + 添加字段
              </button>
            </div>

            <For each={fields()}>
              {(f, idx) => (
                <div class="rounded-2xl border border-white/10 bg-white/5 p-3.5 space-y-2.5">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-mono font-bold text-sky-400">
                      #{idx() + 1} {f.name || '未命名'}
                    </span>
                    <div class="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx() === 0}
                        onClick={() => moveField(idx(), idx() - 1)}
                        class="p-1 rounded bg-white/5 text-mist-solid/60 hover:text-white disabled:opacity-30 text-xs"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={idx() === fields().length - 1}
                        onClick={() => moveField(idx(), idx() + 1)}
                        class="p-1 rounded bg-white/5 text-mist-solid/60 hover:text-white disabled:opacity-30 text-xs"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => removeField(idx())}
                        class="p-1 rounded bg-white/5 text-mist-solid/40 hover:text-rose-400 text-xs ml-1"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="text-[11px] text-mist-solid/50 block mb-1">字段标识 (name)</label>
                      <input
                        type="text"
                        value={f.name}
                        onInput={(e) => updateField(idx(), { name: e.currentTarget.value })}
                        class="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label class="text-[11px] text-mist-solid/50 block mb-1">类型</label>
                      <select
                        value={f.fieldType}
                        onChange={(e) => updateField(idx(), { fieldType: e.currentTarget.value as SchemaFieldType })}
                        class="w-full px-2 py-1.5 rounded-lg bg-xuanqing border border-white/10 text-xs text-white"
                      >
                        <For each={FIELD_TYPES}>
                          {(opt) => <option value={opt.value}>{opt.label}</option>}
                        </For>
                      </select>
                    </div>
                  </div>

                  <div class="grid grid-cols-2 gap-2">
                    <div>
                      <label class="text-[11px] text-mist-solid/50 block mb-1">显示目标</label>
                      <select
                        value={f.displayTarget}
                        onChange={(e) => updateField(idx(), { displayTarget: e.currentTarget.value as DisplayTarget })}
                        class="w-full px-2 py-1.5 rounded-lg bg-xuanqing border border-white/10 text-xs text-white"
                      >
                        <For each={DISPLAY_TARGETS}>
                          {(opt) => <option value={opt.value}>{opt.label}</option>}
                        </For>
                      </select>
                    </div>
                    <div>
                      <label class="text-[11px] text-mist-solid/50 block mb-1">数据库持久化</label>
                      <select
                        value={f.dbMapping || ''}
                        onChange={(e) => updateField(idx(), { dbMapping: e.currentTarget.value })}
                        class="w-full px-2 py-1.5 rounded-lg bg-xuanqing border border-white/10 text-xs text-white"
                      >
                        <For each={DB_MAPPINGS}>
                          {(opt) => <option value={opt.value}>{opt.label}</option>}
                        </For>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label class="text-[11px] text-mist-solid/50 block mb-1">字段描述说明 (供模型理解)</label>
                    <input
                      type="text"
                      value={f.description || ''}
                      onInput={(e) => updateField(idx(), { description: e.currentTarget.value })}
                      placeholder="指导模型填充该字段的语义…"
                      class="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white"
                    />
                  </div>

                  <div class="flex items-center justify-between pt-1">
                    <span class="text-xs text-mist-solid/70">必填字段 (required)</span>
                    <button
                      type="button"
                      onClick={() => updateField(idx(), { required: !f.required })}
                      class={`relative w-9 h-5 rounded-full transition-colors ${f.required ? 'bg-accent' : 'bg-white/15'}`}
                    >
                      <span class={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${f.required ? 'translate-x-4' : ''}`} />
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>

          {/* 产物卡配置 */}
          <div class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-xs font-bold text-accent tracking-wider uppercase">产物卡渲染 (Product Card)</h3>
                <div class="text-[11px] text-mist-solid/40">将输出结构渲染为精美交互卡片并挂载快捷动作</div>
              </div>
              <button
                type="button"
                onClick={() => setCardEnabled(!cardEnabled())}
                class={`relative w-11 h-6 rounded-full transition-colors ${cardEnabled() ? 'bg-accent' : 'bg-white/15'}`}
              >
                <span class={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${cardEnabled() ? 'translate-x-5' : ''}`} />
              </button>
            </div>

            <Show when={cardEnabled()}>
              <div class="space-y-3 pt-2 border-t border-white/10">
                <div>
                  <label class="text-[12px] font-semibold text-mist-solid/80 block mb-1">卡片标题字段</label>
                  <select
                    value={cardTitleField()}
                    onChange={(e) => setCardTitleField(e.currentTarget.value)}
                    class="w-full px-3 py-2 rounded-xl bg-xuanqing border border-white/10 text-sm text-white"
                  >
                    <For each={fields()}>
                      {(f) => <option value={f.name}>{f.name} ({f.fieldType})</option>}
                    </For>
                  </select>
                </div>

                <div class="space-y-2">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-semibold text-mist-solid/80">卡片动作按钮</span>
                    <button
                      type="button"
                      onClick={() =>
                        setCardActions((prev) => [
                          ...prev,
                          { label: '执行动作', command: '', argsTemplate: [] },
                        ])
                      }
                      class="px-2.5 py-1 rounded-lg bg-sky-500/20 text-sky-300 text-xs font-semibold"
                    >
                      + 添加动作
                    </button>
                  </div>

                  <For each={cardActions()}>
                    {(act, actIdx) => (
                      <div class="p-2.5 rounded-xl bg-white/5 border border-white/10 space-y-2">
                        <div class="flex items-center justify-between">
                          <span class="text-xs font-semibold text-white">动作 #{actIdx() + 1}</span>
                          <button
                            type="button"
                            onClick={() => setCardActions((prev) => prev.filter((_, i) => i !== actIdx()))}
                            class="text-mist-solid/40 hover:text-rose-400 text-xs"
                          >
                            删除
                          </button>
                        </div>
                        <div class="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={act.label}
                            onInput={(e) => {
                              const copy = [...cardActions()];
                              copy[actIdx()].label = e.currentTarget.value;
                              setCardActions(copy);
                            }}
                            placeholder="按钮文字"
                            class="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white"
                          />
                          <input
                            type="text"
                            value={act.command}
                            onInput={(e) => {
                              const copy = [...cardActions()];
                              copy[actIdx()].command = e.currentTarget.value;
                              setCardActions(copy);
                            }}
                            placeholder="白名单命令名"
                            class="px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white"
                          />
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </div>

          {/* JSON Schema 预览 */}
          <div class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-2">
            <button
              type="button"
              onClick={() => setShowJsonPreview(!showJsonPreview())}
              class="w-full flex items-center justify-between text-xs font-bold text-mist-solid/80 uppercase"
            >
              <span>查看生成的 JSON Schema</span>
              <span>{showJsonPreview() ? '收起 ▲' : '展开 ▼'}</span>
            </button>
            <Show when={showJsonPreview()}>
              <pre class="p-3 rounded-xl bg-black/40 border border-white/5 text-[11px] font-mono text-emerald-300 overflow-x-auto max-h-60 custom-scrollbar">
                {compiledJsonSchema()}
              </pre>
            </Show>
          </div>

          {/* 删除 Schema */}
          <Show when={selectedSchemaId()}>
            <div class="pt-4 pb-8 flex justify-center">
              <button
                type="button"
                onClick={() => handleDelete(selectedSchemaId()!)}
                class="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-semibold active:scale-95 transition-transform"
              >
                删除此 Schema
              </button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};
