/**
 * 移动端蓝图编辑器集成入口（Task 13.4）。
 *
 * 列出 preset，点击后加载 PresetDetail → 映射为 LegacyPresetForMigration →
 * 调用 migrateToBlueprint 迁移为 BlueprintGraph → 打开 BlueprintEditor。
 *
 * 也提供"新建空白蓝图"入口，直接创建 Start → End 最小图。
 *
 * 后端持久化状态：当前 PresetSummary / CreatePresetPayload 尚未含 blueprintGraph
 * 字段（待 Task 12 后端重构）。保存回调先以 toast 形式展示生成的蓝图 JSON
 * 摘要，并诚实提示"后端持久化待 Task 12 接入"——不静默回退（C2）。
 */

import {
  Component,
  For,
  Show,
  createSignal,
  onMount,
} from 'solid-js';
import type {
  BlueprintGraph,
} from '../../../src/lib/blueprint/types';
import {
  LegacyBlock,
  LegacyPresetForMigration,
  LegacySemanticGroup,
  migrateToBlueprint,
  MigrationResult,
} from '../../../src/lib/blueprint/migration';
import {
  PresetDetail,
  PresetPromptBlock,
  PresetSemanticGroupRecord,
  PresetSemanticOptionBlockRecord,
  PresetSemanticOptionRecord,
  PresetStopSequenceRecord,
  PresetSummary,
  presetsGet,
  presetsList,
  presetsCreate,
  presetsDelete,
  presetsRename,
  presetsDuplicate,
} from '../../../src/lib/backend';
import { BlueprintEditor } from './BlueprintEditor';
import { showToast, showConfirm } from '../Toast';

// ─── Props ───

export interface MobilePresetBlueprintEntryProps {
  onBack: () => void;
}

// ─── 最小空白蓝图 ───

function createEmptyGraph(): BlueprintGraph {
  return {
    version: 2,
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 0, y: 300 }, config: {} },
      { id: 'n_end', type: 'end', position: { x: 400, y: 300 }, config: {} },
    ],
    edges: [
      { id: 'e_start_end', source: 'n_start', source_port: 'out', target: 'n_end', target_port: 'in' },
    ],
  };
}

// ─── PresetDetail → LegacyPresetForMigration 映射 ───

function mapBlock(b: PresetPromptBlock | PresetSemanticOptionBlockRecord): LegacyBlock {
  return {
    id: b.id,
    blockType: b.blockType,
    title: b.title ?? null,
    content: b.content,
    sortOrder: b.sortOrder ?? null,
    priority: b.priority ?? null,
    isEnabled: b.isEnabled ?? null,
    scope: b.scope ?? null,
    isLocked: b.isLocked ?? null,
    lockReason: b.lockReason ?? null,
    exclusiveGroupKey: b.exclusiveGroupKey ?? null,
    exclusiveGroupLabel: b.exclusiveGroupLabel ?? null,
  };
}

function mapSemanticGroup(g: PresetSemanticGroupRecord): LegacySemanticGroup {
  const mapOption = (opt: PresetSemanticOptionRecord): LegacySemanticGroup['options'][number] => ({
    optionKey: opt.optionKey,
    label: opt.label,
    description: opt.description ?? null,
    blocks: (opt.blocks ?? []).map(mapBlock),
  });
  return {
    groupKey: g.groupKey,
    label: g.label,
    description: g.description ?? null,
    selectionMode: g.selectionMode === 'multiple' ? 'multiple' : 'single',
    options: (g.options ?? []).map(mapOption),
  };
}

function mapStopSequences(stops: PresetStopSequenceRecord[]): string[] | null {
  if (!stops || stops.length === 0) return null;
  return stops.map((s) => s.stopText);
}

function buildLegacyPreset(
  preset: PresetSummary,
  detail: PresetDetail,
): LegacyPresetForMigration {
  return {
    id: preset.id,
    name: preset.name,
    blocks: (detail.blocks ?? []).map(mapBlock),
    structuredOutputSchema: preset.structuredOutputSchema,
    semanticGroups: (detail.semanticGroups ?? []).map(mapSemanticGroup),
    temperature: preset.temperature ?? null,
    maxOutputTokens: preset.maxOutputTokens ?? null,
    topP: preset.topP ?? null,
    topK: null,
    presencePenalty: preset.presencePenalty ?? null,
    frequencyPenalty: preset.frequencyPenalty ?? null,
    responseMode: preset.responseMode ?? null,
    stopSequences: mapStopSequences(detail.stopSequences ?? []),
    thinkingEnabled: null,
    thinkingBudgetTokens: null,
    betaFeatures: null,
  };
}

// ─── 组件 ───

export const MobilePresetBlueprintEntry: Component<MobilePresetBlueprintEntryProps> = (props) => {
  const [presets, setPresets] = createSignal<PresetSummary[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [editingPreset, setEditingPreset] = createSignal<{ graph: BlueprintGraph; title: string } | null>(null);
  const [migrating, setMigrating] = createSignal<number | null>(null);
  const [renamingPresetId, setRenamingPresetId] = createSignal<number | null>(null);
  const [renamingValue, setRenamingValue] = createSignal('');
  const [presetBusy, setPresetBusy] = createSignal<number | null>(null);

  const refreshPresets = async () => {
    try {
      const list = await presetsList();
      setPresets(list);
    } catch (err) {
      showToast(
        `刷新预设列表失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    }
  };

  onMount(async () => {
    try {
      const list = await presetsList();
      setPresets(list);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  });

  const handleOpenPreset = async (preset: PresetSummary) => {
    if (renamingPresetId() === preset.id) return;
    if (presetBusy() !== null) return;
    setMigrating(preset.id);
    try {
      const detail = await presetsGet(preset.id);
      const legacy = buildLegacyPreset(preset, detail);
      const result: MigrationResult = migrateToBlueprint(legacy);
      if (!result.ok) {
        showToast(`迁移失败：${result.error}`, 'error', 5000);
        return;
      }
      setEditingPreset({ graph: result.graph, title: `编辑：${preset.name}` });
    } catch (err) {
      showToast(
        `加载预设失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    } finally {
      setMigrating(null);
    }
  };

  const handleNewBlueprint = () => {
    setEditingPreset({ graph: createEmptyGraph(), title: '新建空白蓝图' });
  };

  const handleCreatePreset = async () => {
    if (presetBusy() !== null) return;
    try {
      const stamp = Date.now();
      await presetsCreate({ name: `新预设 ${stamp}` });
      showToast('已新建预设', 'success');
      await refreshPresets();
    } catch (err) {
      showToast(
        `新建预设失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    }
  };

  const handleDuplicatePreset = async (preset: PresetSummary) => {
    if (presetBusy() !== null) return;
    setPresetBusy(preset.id);
    try {
      await presetsDuplicate(preset.id, `${preset.name} 副本`);
      showToast('已复制预设', 'success');
      await refreshPresets();
    } catch (err) {
      showToast(
        `复制预设失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    } finally {
      setPresetBusy(null);
    }
  };

  const handleStartRename = (preset: PresetSummary) => {
    if (presetBusy() !== null) return;
    setRenamingPresetId(preset.id);
    setRenamingValue(preset.name);
  };

  const handleCancelRename = () => {
    setRenamingPresetId(null);
    setRenamingValue('');
  };

  const handleCommitRename = async (id: number) => {
    const newName = renamingValue().trim();
    if (!newName) {
      showToast('预设名称不能为空', 'warning');
      return;
    }
    setPresetBusy(id);
    try {
      await presetsRename(id, newName);
      setRenamingPresetId(null);
      setRenamingValue('');
      showToast('已重命名预设', 'success');
      await refreshPresets();
    } catch (err) {
      showToast(
        `重命名预设失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    } finally {
      setPresetBusy(null);
    }
  };

  const handleDeletePreset = async (preset: PresetSummary) => {
    if (presetBusy() !== null) return;
    const ok = await showConfirm({
      title: '删除预设',
      message: `确定删除预设「${preset.name}」吗？此操作不可撤销。`,
      confirmText: '删除',
      cancelText: '取消',
    });
    if (!ok) return;
    setPresetBusy(preset.id);
    try {
      await presetsDelete(preset.id);
      showToast('已删除预设', 'success');
      await refreshPresets();
    } catch (err) {
      showToast(
        `删除预设失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    } finally {
      setPresetBusy(null);
    }
  };

  const handleSaveGraph = (graph: BlueprintGraph) => {
    // 后端 blueprint_graph 字段待 Task 12 接入持久化。
    // 当前阶段：诚实提示，不静默回退（C2）。
    const json = JSON.stringify(graph);
    const sizeKb = (new Blob([json]).size / 1024).toFixed(1);
    showToast(
      `蓝图已生成（${graph.nodes.length} 节点 / ${graph.edges.length} 连线 / ${sizeKb} KB）。后端 blueprint_graph 持久化待 Task 12 接入。`,
      'info',
      5000,
    );
  };

  const handleBackToEntry = () => {
    setEditingPreset(null);
  };

  // ─── 渲染 ───

  return (
    <Show
      when={editingPreset()}
      fallback={
        <div class="h-full w-full flex flex-col bg-xuanqing">
          {/* 头部 */}
          <header class="shrink-0 h-14 flex items-center gap-2 px-4 bg-xuanqing/90 backdrop-blur-md border-b border-white/5 safe-area-top">
            <button
              onClick={props.onBack}
              class="shrink-0 p-2 text-mist-solid/70 hover:text-white transition-colors"
              aria-label="返回"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <h1 class="text-[15px] font-bold text-white flex-1">蓝图编辑器</h1>
          </header>

          {/* 主体 */}
          <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
            {/* 新建空白蓝图 */}
            <button
              onClick={handleNewBlueprint}
              class="w-full mb-4 p-4 rounded-2xl border-2 border-dashed border-accent/30 bg-accent/5 flex items-center gap-3 active:scale-[0.99] transition-transform"
            >
              <div class="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center text-accent">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
              </div>
              <div class="flex-1 text-left">
                <div class="text-[14px] font-bold text-white">新建空白蓝图</div>
                <div class="text-[11px] text-mist-solid/50">从 Start → End 最小图开始</div>
              </div>
            </button>

            {/* 新建预设（持久化到后端） */}
            <button
              onClick={handleCreatePreset}
              disabled={presetBusy() !== null}
              class="w-full mb-4 p-4 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 flex items-center gap-3 active:scale-[0.99] transition-transform disabled:opacity-50"
            >
              <div class="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center text-emerald-300">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M12 18v-6"/><path d="M9 15h6"/></svg>
              </div>
              <div class="flex-1 text-left">
                <div class="text-[14px] font-bold text-emerald-200">新建预设</div>
                <div class="text-[11px] text-emerald-300/60">创建一个空白预设并保存到后端</div>
              </div>
            </button>

            {/* 说明卡 */}
            <div class="mb-4 p-3 rounded-xl bg-white/5 border border-white/5 text-[11px] text-mist-solid/55 leading-relaxed">
              点击下方预设自动迁移为蓝图并打开编辑器。旧 preset 的 blocks / schema / semanticGroups / 采样参数会被映射为对应节点。
            </div>

            {/* 加载状态 */}
            <Show when={loading()}>
              <div class="flex items-center justify-center py-12">
                <div class="text-[13px] text-mist-solid/50">加载预设列表…</div>
              </div>
            </Show>

            {/* 错误 */}
            <Show when={loadError()}>
              {(err) => (
                <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[12px] text-red-200">
                  加载预设列表失败：{err()}
                </div>
              )}
            </Show>

            {/* preset 列表 */}
            <Show when={!loading() && !loadError()}>
              <h3 class="text-[12px] font-bold text-mist-solid/60 mb-2 px-1">从现有预设迁移</h3>
              <div class="flex flex-col gap-2">
                <For each={presets()}>
                  {(preset) => (
                    <div
                      class="relative w-full p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3 text-left active:scale-[0.99] transition-transform"
                      onClick={() => handleOpenPreset(preset)}
                    >
                      <div class="w-9 h-9 rounded-lg bg-accent/15 flex items-center justify-center text-accent shrink-0">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="16" height="16" x="4" y="4" rx="2"/><path d="M9 9h6v6H9z"/></svg>
                      </div>
                      <div class="flex-1 min-w-0">
                        <Show
                          when={renamingPresetId() === preset.id}
                          fallback={
                            <>
                              <div class="text-[14px] font-semibold text-white truncate">{preset.name}</div>
                              <div class="text-[11px] text-mist-solid/45 truncate">
                                {preset.category} · {preset.isBuiltin ? '内置' : '自定义'}
                              </div>
                            </>
                          }
                        >
                          <input
                            type="text"
                            class="w-full bg-xuanqing/80 border border-emerald-500/40 rounded px-2 py-1 text-[14px] font-semibold text-white focus:outline-none focus:border-emerald-500/70"
                            value={renamingValue()}
                            onClick={(e) => e.stopPropagation()}
                            onInput={(e) => setRenamingValue(e.currentTarget.value)}
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleCommitRename(preset.id);
                              } else if (e.key === 'Escape') {
                                e.preventDefault();
                                handleCancelRename();
                              }
                            }}
                            onBlur={() => {
                              if (renamingPresetId() === preset.id) {
                                void handleCommitRename(preset.id);
                              }
                            }}
                          />
                          <div class="text-[10px] text-mist-solid/40 mt-1">Enter 保存 · Esc 取消</div>
                        </Show>
                      </div>
                      <Show when={renamingPresetId() !== preset.id}>
                        <div class="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            class="p-1.5 rounded-lg text-mist-solid/50 hover:text-emerald-300 hover:bg-emerald-500/15 transition-colors"
                            aria-label="复制预设"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDuplicatePreset(preset);
                            }}
                            disabled={presetBusy() !== null}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                          </button>
                          <button
                            type="button"
                            class="p-1.5 rounded-lg text-mist-solid/50 hover:text-sky-300 hover:bg-sky-500/15 transition-colors"
                            aria-label="重命名预设"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartRename(preset);
                            }}
                            disabled={presetBusy() !== null}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                          </button>
                          <button
                            type="button"
                            class="p-1.5 rounded-lg text-mist-solid/50 hover:text-red-300 hover:bg-red-500/15 transition-colors"
                            aria-label="删除预设"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeletePreset(preset);
                            }}
                            disabled={presetBusy() !== null}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                          </button>
                        </div>
                      </Show>
                      <Show when={migrating() === preset.id}>
                        <div class="text-[11px] text-accent animate-pulse shrink-0">迁移中…</div>
                      </Show>
                      <Show when={migrating() !== preset.id && renamingPresetId() !== preset.id}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-mist-solid/40 shrink-0"><path d="m9 18 6-6-6-6"/></svg>
                      </Show>
                      <Show when={presetBusy() === preset.id}>
                        <div class="absolute inset-0 rounded-xl bg-xuanqing/40 backdrop-blur-[1px] flex items-center justify-center">
                          <div class="text-[11px] text-mist-solid/60 animate-pulse">处理中…</div>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
                <Show when={presets().length === 0}>
                  <div class="py-8 text-center text-[13px] text-mist-solid/40">
                    暂无预设。请新建空白蓝图或上方新建预设。
                  </div>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      }
    >
      {(ep) => (
        <BlueprintEditor
          initialGraph={ep().graph}
          title={ep().title}
          onSave={handleSaveGraph}
          onBack={handleBackToEntry}
        />
      )}
    </Show>
  );
};
