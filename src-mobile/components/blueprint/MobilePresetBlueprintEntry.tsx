/**
 * 移动端蓝图编辑器集成入口（Task 13.4）。
 *
 * 列出 preset，点击后加载 PresetDetail → 读取 blueprint_graph（若有）或
 * 使用空 Start→End 图 → 打开 BlueprintEditor。
 *
 * 也提供"新建空白蓝图"入口，直接创建 Start → End 最小图。
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
  BlueprintNode,
} from '../../../src/lib/blueprint/types';
import {
  PresetSummary,
  presetsGet,
  presetsList,
  presetsCreate,
  presetsDelete,
  presetsRename,
  presetsDuplicate,
  presetsUpdate,
  presetsExportToFile,
  presetsImport,
  normalizeBlueprintGraph,
} from '../../../src/lib/backend';
import { BlueprintEditor } from './BlueprintEditor';
import { MobilePresetDetailView } from './MobilePresetDetailView';
import { showToast, showConfirm } from '../Toast';
import { deriveStructuredOutputDisplay } from '../../lib/structured';
import { openPath } from '@tauri-apps/plugin-opener';
import { autoLayout as autoLayoutGraph } from './mobileNodeLayout';

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

/// Ensure Start/End nodes have an in-memory `config: {}` placeholder after
/// loading from DB (the serialized JSON omits it per Rust serde convention).
/// Also default missing `position` to {x: 0, y: 0} for portable presets that
/// strip position data (Rust schema treats position as optional since v2).
function normalizeLoadedNodes(nodes: BlueprintNode[]): BlueprintNode[] {
  return nodes.map((n) => {
    let next = n;
    if ((n.type === 'start' || n.type === 'end') && n.config === undefined) {
      next = { ...n, config: {} } as BlueprintNode;
    }
    if (!next.position || typeof next.position.x !== 'number' || typeof next.position.y !== 'number') {
      next = { ...next, position: { x: 0, y: 0 } };
    }
    return next;
  });
}

/// 序列化 BlueprintGraph 为后端持久化的 JSON 字符串。
/// Rust serde `#[serde(tag = "type", content = "config")]` 序列化 unit
/// 变体（Start/End）时不带 `config` 字段，故此处需剥离占位 `config: {}`。
/// `comments`（UE 式注释框）随图落库，Rust 侧 `#[serde(default)]` 保留往返。
function serializeBlueprintGraph(graph: BlueprintGraph): string {
  const nodes = graph.nodes.map((node) => {
    if (node.type === 'start' || node.type === 'end') {
      return { type: node.type, id: node.id, position: node.position };
    }
    return node;
  });
  return JSON.stringify({
    version: 2,
    nodes,
    edges: graph.edges,
    comments: graph.comments ?? [],
  });
}

/// 从后端 blueprint_graph JSON 字符串解析为 BlueprintGraph。
///
/// 先经后端归一化命令改写旧拓扑（Constant 串在 exec 链上 → value 引脚拓扑）；
/// 规则由后端裁定（C1），前端不复制改写逻辑。`migrated` 为 true 时调用方必须
/// 可见地提示用户保存，禁止静默迁移（C2）。
async function parseGraph(json: string): Promise<{ graph: BlueprintGraph; migrated: boolean }> {
  const migration = await normalizeBlueprintGraph(json);
  const parsed = JSON.parse(migration.graphJson) as BlueprintGraph;
  if (parsed.version !== 2 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('blueprint_graph JSON 结构无效');
  }
  const nodes = normalizeLoadedNodes(parsed.nodes);
  // 如果导入节点位置全为 (0,0)（便携 JSON 剥离 position 的特征），
  // 自动调用 autoLayout 让编辑器打开即可用，不让用户看到一堆重叠节点。
  const allAtOrigin =
    nodes.length > 0 && nodes.every((n) => n.position.x === 0 && n.position.y === 0);
  const nodesWithPositions = allAtOrigin
    ? (() => {
        const positions = autoLayoutGraph(nodes, parsed.edges);
        return nodes.map((n) => {
          const pos = positions.get(n.id);
          return pos ? { ...n, position: pos } : n;
        });
      })()
    : nodes;

  return {
    graph: {
      version: 2,
      nodes: nodesWithPositions,
      edges: parsed.edges,
      comments: parsed.comments ?? [],
    },
    migrated: migration.migrated,
  };
}

// ─── 组件 ───

export const MobilePresetBlueprintEntry: Component<MobilePresetBlueprintEntryProps> = (props) => {
  const [presets, setPresets] = createSignal<PresetSummary[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [editingPreset, setEditingPreset] = createSignal<{ presetId: number | null; graph: BlueprintGraph; title: string } | null>(null);
  const [viewingPreset, setViewingPreset] = createSignal<PresetSummary | null>(null);
  const [openingPreset, setOpeningPreset] = createSignal<number | null>(null);
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

  const handleOpenPreset = (preset: PresetSummary) => {
    if (renamingPresetId() === preset.id) return;
    if (presetBusy() !== null) return;
    // 进入预设详情视图（台前），而非直接进入蓝图编辑器（幕后）
    setViewingPreset(preset);
  };

  const handleEditBlueprint = async (preset: PresetSummary) => {
    setOpeningPreset(preset.id);
    try {
      const detail = await presetsGet(preset.id);
      const rawGraph = detail.preset.blueprintGraph;
      let graph: BlueprintGraph;
      let migrated = false;
      if (rawGraph && rawGraph.trim() !== '') {
        const parsed = await parseGraph(rawGraph);
        graph = parsed.graph;
        migrated = parsed.migrated;
      } else {
        graph = createEmptyGraph();
      }
      setViewingPreset(null);
      setEditingPreset({ presetId: preset.id, graph, title: `编辑：${preset.name}` });
      if (migrated) {
        // 迁移必须可见：提示用户保存，绝不静默改写（C2）。
        showToast('蓝图结构已升级为 value 引脚拓扑，请保存使其生效', 'warning', 5000);
      }
    } catch (err) {
      showToast(
        `加载预设失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    } finally {
      setOpeningPreset(null);
    }
  };

  const handleNewBlueprint = () => {
    setEditingPreset({ presetId: null, graph: createEmptyGraph(), title: '新建空白蓝图' });
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

  // ─── 导出/导入（便携格式 .nvpreset.json，复用后端 presets_export / presets_import）───
  // 导出改走后端文件写入，返回真实保存路径并提示用户；导入仍走 <input type=file>。

  let presetImportInput: HTMLInputElement | undefined;

  const sanitizeFileName = (name: string): string =>
    name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '预设';

  const handleExportPreset = async (preset: PresetSummary) => {
    if (presetBusy() !== null) return;
    setPresetBusy(preset.id);
    try {
      const fileName = `${sanitizeFileName(preset.name)}.nvpreset.json`;
      const filePath = await presetsExportToFile(preset.id, fileName);
      const open = await showConfirm({
        title: '预设导出成功',
        message: `已保存到：\n${filePath}`,
        confirmText: '打开文件',
        cancelText: '知道了',
      });
      if (open) {
        await openPath(filePath);
      }
    } catch (err) {
      showToast(
        `导出预设失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    } finally {
      setPresetBusy(null);
    }
  };

  const handleImportFileChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (presetBusy() !== null) return;
    setPresetBusy(-1);
    try {
      const payloadJson = await file.text();
      const imported = await presetsImport(payloadJson);
      showToast(`已导入预设「${imported.preset.name}」`, 'success');
      await refreshPresets();
    } catch (err) {
      showToast(
        `导入预设失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    } finally {
      setPresetBusy(null);
    }
  };

  const handleSaveGraph = async (graph: BlueprintGraph) => {
    // 持久化蓝图到后端：加载 PresetDetail → 构建完整更新 payload → presetsUpdate。
    // 与 PC 端 BlueprintEditor.handleSave 逻辑对齐（presets_update 是全行直接赋值，
    // 必须回传所有列以避免 NULL 覆盖）。
    const editing = editingPreset();
    if (!editing) {
      showToast('未在编辑预设中，无法保存', 'error');
      return;
    }
    if (editing.presetId === null) {
      showToast('新建空白蓝图需先创建预设后才能保存，请返回列表点击"新建预设"', 'warning', 4000);
      return;
    }
    setPresetBusy(editing.presetId);
    try {
      const detail = await presetsGet(editing.presetId);
      const json = serializeBlueprintGraph(graph);
      const derivedDisplay = deriveStructuredOutputDisplay(graph);
      const updated = await presetsUpdate({
        id: detail.preset.id,
        name: detail.preset.name,
        description: detail.preset.description,
        category: detail.preset.category,
        temperature: detail.preset.temperature,
        maxOutputTokens: detail.preset.maxOutputTokens,
        topP: detail.preset.topP,
        topK: detail.preset.topK,
        presencePenalty: detail.preset.presencePenalty,
        frequencyPenalty: detail.preset.frequencyPenalty,
        responseMode: detail.preset.responseMode,
        thinkingEnabled: detail.preset.thinkingEnabled,
        thinkingBudgetTokens: detail.preset.thinkingBudgetTokens,
        betaFeatures: detail.preset.betaFeatures,
        structuredOutputSchema: detail.preset.structuredOutputSchema,
        structuredOutputDisplay: derivedDisplay ?? detail.preset.structuredOutputDisplay,
        contextIncludedKeys: detail.preset.contextIncludedKeys,
        blueprintGraph: json,
      });
      // 更新编辑中的图（用保存后的回传图重新解析，确保状态一致）
      setEditingPreset({
        presetId: editing.presetId,
        graph: updated.preset.blueprintGraph
          ? (await parseGraph(updated.preset.blueprintGraph)).graph
          : createEmptyGraph(),
        title: `编辑：${updated.preset.name}`,
      });
      const sizeKb = (new Blob([json]).size / 1024).toFixed(1);
      showToast(
        `蓝图已保存（${graph.nodes.length} 节点 / ${graph.edges.length} 连线 / ${sizeKb} KB）`,
        'success',
        3000,
      );
    } catch (err) {
      showToast(
        `保存蓝图失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    } finally {
      setPresetBusy(null);
    }
  };

  const handleBackToEntry = () => {
    setEditingPreset(null);
  };

  // ─── 渲染 ───

  return (
    <Show
      when={editingPreset()}
      fallback={
        <Show
          when={viewingPreset()}
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

            {/* 导入预设（从 .nvpreset.json 文件） */}
            <input
              ref={presetImportInput}
              type="file"
              accept=".json,.nvpreset.json,application/json"
              class="hidden"
              onChange={(e) => void handleImportFileChange(e)}
            />
            <button
              onClick={() => presetImportInput?.click()}
              disabled={presetBusy() !== null}
              class="w-full mb-4 p-4 rounded-2xl border border-white/10 bg-white/5 flex items-center gap-3 active:scale-[0.99] transition-transform disabled:opacity-50"
            >
              <div class="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-mist-solid/80">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
              </div>
              <div class="flex-1 text-left">
                <div class="text-[14px] font-bold text-white">导入预设</div>
                <div class="text-[11px] text-mist-solid/50">从 .nvpreset.json 文件导入</div>
              </div>
            </button>

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
              <h3 class="text-[12px] font-bold text-mist-solid/60 mb-2 px-1">现有预设</h3>
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
                              // IME 组合输入期间不拦截按键
                              if (e.isComposing) return;
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
                            class="p-1.5 rounded-lg text-mist-solid/50 hover:text-amber-300 hover:bg-amber-500/15 transition-colors"
                            aria-label="导出预设"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleExportPreset(preset);
                            }}
                            disabled={presetBusy() !== null}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
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
                      <Show when={openingPreset() === preset.id}>
                        <div class="text-[11px] text-accent animate-pulse shrink-0">加载中…</div>
                      </Show>
                      <Show when={openingPreset() !== preset.id && renamingPresetId() !== preset.id}>
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
          {(preset) => (
            <MobilePresetDetailView
              preset={preset()}
              onBack={() => setViewingPreset(null)}
              onEditBlueprint={() => void handleEditBlueprint(preset())}
            />
          )}
        </Show>
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
