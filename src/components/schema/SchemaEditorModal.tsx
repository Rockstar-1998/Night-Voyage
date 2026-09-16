import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import {
  type SchemaDefinition,
  type SchemaFieldDefinition,
  type SchemaFieldType,
  type DisplayTarget,
  presetSchemasList,
  presetSchemaSave,
  presetSchemaDelete,
} from '../../lib/backend';
import { showToast } from '../Toast';
import { Plus, Trash2, Save, X, Layers3, ArrowUp, ArrowDown, Eye, AlertCircle, Sparkles } from '../../lib/icons';

interface SchemaEditorModalProps {
  presetId: number;
  isOpen: boolean;
  onClose: () => void;
  onSchemaSelected?: (schemaId: string) => void;
}

export const SchemaEditorModal: Component<SchemaEditorModalProps> = (props) => {
  const [schemas, setSchemas] = createSignal<SchemaDefinition[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [selectedSchemaId, setSelectedSchemaId] = createSignal<string | null>(null);

  // Form signals for the currently editing schema
  const [currentId, setCurrentId] = createSignal('');
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [enableRetention, setEnableRetention] = createSignal(false);
  const [retentionDepthInput, setRetentionDepthInput] = createSignal('3');
  const [fields, setFields] = createSignal<SchemaFieldDefinition[]>([]);
  const [showPreview, setShowPreview] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  // Validation for retention depth: must be positive integer >= 1
  const retentionError = createMemo(() => {
    if (!enableRetention()) return null;
    const val = Number(retentionDepthInput());
    if (isNaN(val) || !Number.isInteger(val) || val < 1) {
      return '保留层数必须为大于等于 1 的正整数（如 1、3）';
    }
    return null;
  });

  const isValid = createMemo(() => {
    if (!name().trim()) return false;
    if (retentionError()) return false;
    if (fields().some((f) => !f.name.trim())) return false;
    return true;
  });

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
  };

  const createNewSchema = () => {
    setSelectedSchemaId(null);
    setCurrentId('');
    setName('新结构化 Schema');
    setDescription('');
    setEnableRetention(false);
    setRetentionDepthInput('3');
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
        description: '当前生命值数值',
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
    if (!isValid()) return;
    setSaving(true);
    try {
      const payload: SchemaDefinition = {
        id: currentId(),
        presetId: props.presetId,
        name: name().trim(),
        description: description().trim(),
        retentionDepth: enableRetention() ? parseInt(retentionDepthInput(), 10) : null,
        fields: fields(),
        createdAt: 0,
        updatedAt: 0,
      };

      const saved = await presetSchemaSave(payload);
      showToast('Schema 保存成功', 'success');
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

  // Compile JSON Schema preview strictly in physical array order
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
      },
      null,
      2
    );
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div class="relative flex flex-col w-full max-w-5xl h-[88vh] rounded-2xl border border-white/10 bg-[#0f141c] text-mist-solid shadow-2xl overflow-hidden">
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-xl bg-accent/15 border border-accent/30 text-accent">
                <Layers3 size={20} />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-base font-bold text-mist-solid">独立结构化 Schema 编辑器</h2>
                  <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent">
                    Non-Node Asset
                  </span>
                </div>
                <p class="text-xs text-mist-solid/50 mt-0.5">
                  脱离图连线独立定义，物理顺序严格对齐大模型解析，支持按单个 Schema 限制历史保留层数。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="p-2 rounded-lg text-mist-solid/60 hover:text-mist-solid hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div class="flex flex-1 min-h-0">
            {/* Left sidebar: schema list */}
            <div class="w-64 border-r border-white/10 flex flex-col bg-black/20">
              <div class="p-3 border-b border-white/5 flex items-center justify-between">
                <span class="text-xs font-bold text-mist-solid/60 uppercase tracking-wider">预设 Schema 列表</span>
                <button
                  type="button"
                  onClick={createNewSchema}
                  class="p-1.5 rounded-lg bg-accent/20 hover:bg-accent/30 text-accent text-xs font-semibold flex items-center gap-1 transition-colors"
                  title="新建 Schema"
                >
                  <Plus size={14} />
                  <span>新建</span>
                </button>
              </div>
              <div class="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                <Show when={schemas().length === 0 && !loading()}>
                  <div class="p-4 text-center text-xs text-mist-solid/40">暂无独立 Schema，点击上方新建</div>
                </Show>
                <For each={schemas()}>
                  {(s) => {
                    const isSelected = createMemo(() => selectedSchemaId() === s.id);
                    return (
                      <div
                        onClick={() => selectSchema(s)}
                        class={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer border transition-all ${
                          isSelected()
                            ? 'bg-accent/15 border-accent/40 text-accent'
                            : 'bg-white/[0.02] border-white/5 text-mist-solid/80 hover:bg-white/[0.06] hover:text-mist-solid'
                        }`}
                      >
                        <div class="min-w-0 flex-1">
                          <div class="text-xs font-bold truncate">{s.name}</div>
                          <div class="text-[10px] text-mist-solid/40 truncate mt-0.5">
                            {s.fields?.length || 0} 个字段 · {s.retentionDepth ? `保留 ${s.retentionDepth} 层` : '不限历史'}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(s.id);
                          }}
                          class="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded transition-all"
                          title="删除"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>

            {/* Right main area: form & table */}
            <div class="flex-1 flex flex-col min-w-0 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {/* Basic metadata & Retention Depth Row */}
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="space-y-3">
                  <div>
                    <label class="block text-xs font-bold text-mist-solid/60 uppercase tracking-wider mb-1">
                      Schema 名称
                    </label>
                    <input
                      type="text"
                      value={name()}
                      onInput={(e) => setName(e.currentTarget.value)}
                      placeholder="如: RPG 回合总结 (rpg_turn_summary)"
                      class="w-full px-3 py-2 text-xs rounded-xl bg-black/40 border border-white/10 text-mist-solid focus:border-accent focus:outline-none"
                    />
                  </div>
                  <div>
                    <label class="block text-xs font-bold text-mist-solid/60 uppercase tracking-wider mb-1">
                      描述说明
                    </label>
                    <input
                      type="text"
                      value={description()}
                      onInput={(e) => setDescription(e.currentTarget.value)}
                      placeholder="描述该 Schema 的业务用途（可选）"
                      class="w-full px-3 py-2 text-xs rounded-xl bg-black/40 border border-white/10 text-mist-solid focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>

                {/* Single Schema Retention Depth Control */}
                <div class="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between">
                  <div>
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-xs font-bold text-mist-solid flex items-center gap-1.5">
                        <span>⏳ 限制历史保留层数</span>
                        <span class="text-[9px] uppercase px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300/80">
                          Per-Schema
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setEnableRetention(!enableRetention())}
                        class={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          enableRetention() ? 'bg-accent' : 'bg-white/10'
                        }`}
                      >
                        <span
                          class={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            enableRetention() ? 'translate-x-4' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                    <p class="text-[11px] text-mist-solid/40 leading-relaxed">
                      仅对本 Schema 生效：从最新层倒数保留指定层数在上下文，过远直接丢弃，彻底消除长文本下的 Token 恶性膨胀。
                    </p>
                  </div>

                  <Show when={enableRetention()}>
                    <div class="mt-3 pt-3 border-t border-white/5 flex items-center justify-between gap-3">
                      <span class="text-xs text-mist-solid/70">保留最近层数 (N):</span>
                      <div class="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={retentionDepthInput()}
                          onInput={(e) => setRetentionDepthInput(e.currentTarget.value)}
                          class={`w-24 px-2.5 py-1 text-xs text-center font-bold rounded-lg border focus:outline-none ${
                            retentionError()
                              ? 'border-red-500 bg-red-500/10 text-red-200'
                              : 'border-accent/40 bg-accent/10 text-accent'
                          }`}
                        />
                        <span class="text-xs text-mist-solid/50">轮</span>
                      </div>
                    </div>
                  </Show>

                  <Show when={retentionError()}>
                    <div class="mt-2 text-[11px] text-red-400 flex items-center gap-1.5">
                      <AlertCircle size={13} />
                      <span>{retentionError()}</span>
                    </div>
                  </Show>
                </div>
              </div>

              {/* Fields Table Header & Action */}
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <div>
                    <h3 class="text-xs font-bold text-mist-solid uppercase tracking-wider">
                      Schema 字段列表（物理顺序排列）
                    </h3>
                    <p class="text-[11px] text-mist-solid/40">
                      上下移动可调整顺序；生成的 JSON Schema 及大模型流式解析将 100% 严格依照此顺序执行。
                    </p>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowPreview(!showPreview())}
                      class={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1.5 ${
                        showPreview()
                          ? 'border-accent/40 bg-accent/15 text-accent'
                          : 'border-white/10 bg-white/5 text-mist-solid/60 hover:text-mist-solid'
                      }`}
                    >
                      <Eye size={13} />
                      <span>{showPreview() ? '收起预览' : '预览 JSON'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={addField}
                      class="px-3 py-1.5 rounded-lg text-xs font-bold bg-accent text-white hover:bg-accent/90 transition-colors flex items-center gap-1"
                    >
                      <Plus size={14} />
                      <span>添加字段</span>
                    </button>
                  </div>
                </div>

                {/* Real-time Preview Panel */}
                <Show when={showPreview()}>
                  <div class="p-3 rounded-xl border border-accent/30 bg-black/50 space-y-1">
                    <div class="text-[10px] font-bold uppercase tracking-wider text-accent flex items-center gap-1.5">
                      <Sparkles size={12} />
                      <span>编译期生成的严格保序 JSON Schema 预览</span>
                    </div>
                    <pre class="text-[11px] font-mono text-mist-solid/80 max-h-48 overflow-auto custom-scrollbar p-2 bg-black/40 rounded-lg">
                      {compiledJsonSchema()}
                    </pre>
                  </div>
                </Show>

                {/* Fields Table */}
                <div class="border border-white/10 rounded-xl overflow-hidden bg-black/30">
                  <table class="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr class="border-b border-white/10 bg-white/[0.03] text-mist-solid/50 uppercase tracking-wider text-[10px]">
                        <th class="py-2.5 px-3 w-16 text-center">排序</th>
                        <th class="py-2.5 px-3 w-40">字段名 (Field)</th>
                        <th class="py-2.5 px-3 w-28">数据类型</th>
                        <th class="py-2.5 px-3 w-16 text-center">必填</th>
                        <th class="py-2.5 px-3 w-44">展示目标</th>
                        <th class="py-2.5 px-3 w-32">DB 映射</th>
                        <th class="py-2.5 px-3">说明</th>
                        <th class="py-2.5 px-3 w-12 text-center">操作</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-white/5">
                      <For each={fields()}>
                        {(field, idx) => (
                          <tr class="hover:bg-white/[0.02] transition-colors group">
                            {/* Reorder Buttons */}
                            <td class="py-2 px-2 text-center">
                              <div class="flex items-center justify-center gap-0.5">
                                <button
                                  type="button"
                                  disabled={idx() === 0}
                                  onClick={() => moveField(idx(), idx() - 1)}
                                  class="p-1 rounded text-mist-solid/40 hover:text-mist-solid disabled:opacity-20 transition-colors"
                                  title="上移"
                                >
                                  <ArrowUp size={12} />
                                </button>
                                <span class="text-[10px] font-mono text-mist-solid/50 w-4">{idx() + 1}</span>
                                <button
                                  type="button"
                                  disabled={idx() === fields().length - 1}
                                  onClick={() => moveField(idx(), idx() + 1)}
                                  class="p-1 rounded text-mist-solid/40 hover:text-mist-solid disabled:opacity-20 transition-colors"
                                  title="下移"
                                >
                                  <ArrowDown size={12} />
                                </button>
                              </div>
                            </td>

                            {/* Field Name */}
                            <td class="py-2 px-3">
                              <input
                                type="text"
                                value={field.name}
                                onInput={(e) => updateField(idx(), { name: e.currentTarget.value })}
                                placeholder="字段名 (英文)"
                                class="w-full px-2 py-1 text-xs rounded bg-white/5 border border-white/10 text-mist-solid font-mono focus:border-accent focus:outline-none"
                              />
                            </td>

                            {/* Field Type */}
                            <td class="py-2 px-3">
                              <select
                                value={field.fieldType}
                                onChange={(e) => updateField(idx(), { fieldType: e.currentTarget.value as SchemaFieldType })}
                                class="w-full px-2 py-1 text-xs rounded bg-night-water border border-white/10 text-mist-solid focus:border-accent focus:outline-none"
                              >
                                <option value="string">string</option>
                                <option value="number">number</option>
                                <option value="boolean">boolean</option>
                                <option value="array">array</option>
                                <option value="object">object</option>
                              </select>
                            </td>

                            {/* Required */}
                            <td class="py-2 px-3 text-center">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) => updateField(idx(), { required: e.currentTarget.checked })}
                                class="w-4 h-4 rounded border-white/20 bg-white/5 text-accent focus:ring-1 focus:ring-accent/40"
                              />
                            </td>

                            {/* Display Target */}
                            <td class="py-2 px-3">
                              <select
                                value={field.displayTarget}
                                onChange={(e) => updateField(idx(), { displayTarget: e.currentTarget.value as DisplayTarget })}
                                class={`w-full px-2 py-1 text-xs rounded border focus:outline-none ${
                                  field.displayTarget === 'PersistentHUD'
                                    ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                                    : 'bg-white/5 border-white/10 text-mist-solid/80'
                                }`}
                              >
                                <option value="InlineMessage">内联气泡 (InlineMessage)</option>
                                <option value="PersistentHUD">常驻视口 (PersistentHUD)</option>
                              </select>
                            </td>

                            {/* DB Mapping */}
                            <td class="py-2 px-3">
                              <input
                                type="text"
                                value={field.dbMapping || ''}
                                onInput={(e) => updateField(idx(), { dbMapping: e.currentTarget.value })}
                                placeholder="如: world_variables"
                                class="w-full px-2 py-1 text-xs rounded bg-white/5 border border-white/10 text-mist-solid focus:border-accent focus:outline-none"
                              />
                            </td>

                            {/* Description */}
                            <td class="py-2 px-3">
                              <input
                                type="text"
                                value={field.description}
                                onInput={(e) => updateField(idx(), { description: e.currentTarget.value })}
                                placeholder="大模型输出指南 / 字段用途"
                                class="w-full px-2 py-1 text-xs rounded bg-white/5 border border-white/10 text-mist-solid focus:border-accent focus:outline-none"
                              />
                            </td>

                            {/* Delete Action */}
                            <td class="py-2 px-3 text-center">
                              <button
                                type="button"
                                onClick={() => removeField(idx())}
                                class="p-1 rounded text-mist-solid/40 hover:text-red-400 transition-colors"
                                title="删除字段"
                              >
                                <Trash2 size={13} />
                              </button>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-white/[0.02]">
            <div class="text-xs text-mist-solid/40">
              提示：在预设蓝图中使用 <code class="text-accent bg-accent/10 px-1 py-0.5 rounded font-mono">InvokeSchema</code> 节点可按需挂载本 Schema。
            </div>
            <div class="flex items-center gap-3">
              <button
                type="button"
                onClick={props.onClose}
                class="px-4 py-2 text-xs rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-mist-solid/80 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!isValid() || saving()}
                onClick={handleSave}
                class="px-5 py-2 text-xs font-bold rounded-xl bg-accent hover:bg-accent/90 disabled:opacity-40 text-white transition-colors flex items-center gap-1.5 shadow-lg shadow-accent/20"
              >
                <Save size={14} />
                <span>{saving() ? '保存中…' : '保存 Schema'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
