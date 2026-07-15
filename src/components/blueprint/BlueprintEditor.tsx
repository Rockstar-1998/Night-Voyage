/**
 * BlueprintEditor — preset blueprint editor host (Task 10).
 *
 * Orchestrates the blueprint editing experience for a single preset:
 * - Loads the preset on mount and resolves its `blueprint_graph`. If the
 *   preset has no graph yet, uses a default Start→End empty graph.
 * - Owns the graph state via `createStore` (immutable updates through
 *   `produce` / array replacement) and exposes node/edge CRUD handlers to
 *   the canvas and config panel.
 * - Renders the canvas (Task 8), the node config panel (Task 9), a toolbar
 *   with save / add-node / show-all controls, and the NodeSelector (Task 10.2).
 *
 * Architecture:
 * - The editor is the single source of truth for `graph`, `selectedNodeId`,
 *   `hiddenNodeIds`, and `viewTransform`. Children are controlled components
 *   that notify intent via callbacks.
 * - Save: `JSON.stringify(graph)` → `presetsUpdate({ id, blueprintGraph, ... })`.
 *   The full preset detail is re-fetched before save so the update payload
 *   carries every required field (name / category / etc.). The backend uses
 *   `COALESCE(?, blueprint_graph)` so omitting the field would preserve the
 *   old value; we always send the new graph explicitly.
 *
 * Constraints:
 * - C1 Frontend Render-Only: the editor only renders + calls Tauri commands
 *   for load/save. No business logic, no prompt compilation.
 * - C2 Zero-Fallback Errors: load/save failures surface as visible
 *   error toasts and an error banner; no silent fallback.
 * - C3 Responsiveness: SolidJS fine-grained signals + `createStore`. Node
 *   moves patch only the moved node's position; config edits patch only the
 *   edited node's config.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`. The mobile
 *   editor (Task 13) is a separate implementation under `src-mobile/`.
 */

import { Component, Show, createMemo, createSignal, onMount } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { ArrowLeft, Eye, Save } from '../../lib/icons';
import {
  NODE_TYPES,
  type BlueprintEdge,
  type BlueprintGraph,
  type BlueprintNode,
  type NodeConfig,
  type NodeType,
  type Position,
} from '../../lib/blueprint/types';
import {
  presetsGet,
  presetsUpdate,
  type CreatePresetPayload,
  type PresetDetail,
} from '../../lib/backend';
import { BlueprintCanvas } from './BlueprintCanvas';
import { NodeConfigPanel } from './NodeConfigPanel';
import { NodeSelector } from './NodeSelector';
import { IconButton } from '../ui/IconButton';
import { showConfirm, showToast } from '../Toast';
import type { ViewTransform } from './nodeLayout';

// ─── Props ───

export interface BlueprintEditorProps {
  presetId: number;
  onClose?: () => void;
}

// ─── Default node configs ───

function defaultConfigForType(type: NodeType): NodeConfig {
  switch (type) {
    case 'start':
      return { type: 'start', config: {} };
    case 'end':
      return { type: 'end', config: {} };
    case 'prompt':
      return {
        type: 'prompt',
        config: {
          identifier: 'new_block',
          block_type: 'system',
          content: '',
          priority: null,
          is_locked: false,
          lock_reason: null,
        },
      };
    case 'schema_field':
      return {
        type: 'schema_field',
        config: {
          field_name: 'new_field',
          field_type: 'string',
          description: '',
          sub_schema: null,
          db_mapping: null,
          is_locked: false,
          lock_reason: null,
        },
      };
    case 'mutex_gate':
      return {
        type: 'mutex_gate',
        config: {
          gate_id: `gate_${Date.now().toString(36)}`,
          label: '互斥组',
          options: [{ key: 'opt_1', label: '选项 1' }],
        },
      };
    case 'group_gate':
      return {
        type: 'group_gate',
        config: {
          gate_id: `group_${Date.now().toString(36)}`,
          label: '普通组',
          options: [{ key: 'opt_1', label: '选项 1' }],
        },
      };
    case 'mode_switch':
      return {
        type: 'mode_switch',
        config: { label: '记忆模式分支' },
      };
    case 'sampling_params':
      return {
        type: 'sampling_params',
        config: {
          temperature: null,
          max_tokens: null,
          top_p: null,
          frequency_penalty: null,
          presence_penalty: null,
          stop: null,
          is_locked: false,
        },
      };
  }
}

// ─── ID generation ───

let nodeCounter = 0;
function generateNodeId(type: NodeType): string {
  const c = ++nodeCounter;
  return `n_${type}_${c}_${Date.now().toString(36).slice(-4)}`;
}

let edgeCounter = 0;
function generateEdgeId(): string {
  return `e_${++edgeCounter}_${Date.now().toString(36).slice(-4)}`;
}

// ─── Empty graph ───

function createEmptyGraph(): BlueprintGraph {
  return {
    version: 2,
    nodes: [
      {
        id: 'n_start',
        type: 'start',
        position: { x: 0, y: 300 },
        config: {},
      },
      {
        id: 'n_end',
        type: 'end',
        position: { x: 400, y: 300 },
        config: {},
      },
    ],
    edges: [
      {
        id: 'e_init',
        source: 'n_start',
        source_port: 'out',
        target: 'n_end',
        target_port: 'in',
      },
    ],
  };
}

// ─── Save payload builder ───

/**
 * Build a full-row update payload from the editor's current `PresetDetail`.
 *
 * `presets_update` is a full-row patch (no `COALESCE` semantics) so the
 * Blueprint editor must echo back every column — even ones the editor
 * did not touch — to avoid overwriting them with `NULL` / `""`. Field-
 * level numeric sentinel values (`max_output_tokens = 0`, `top_k = 0`)
 * are normalized server-side in `preset_validator` to `NULL`, so legacy
 * presets with the old zero-sentinel round-trip cleanly.
 */
function buildBlueprintUpdatePayload(
  detail: PresetDetail,
  blueprintGraph: string,
): CreatePresetPayload & { id: number } {
  return {
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
    structuredOutputDisplay: detail.preset.structuredOutputDisplay,
    contextIncludedKeys: detail.preset.contextIncludedKeys,
    blueprintGraph,
  };
}

// ─── Graph serialization helper ───

/**
 * Serialize the in-memory `BlueprintGraph` to the JSON string persisted
 * in `presets.blueprint_graph`. Centralized so that the editor's auto-
 * migration save and the user-driven save produce byte-identical payloads.
 */
function serializeBlueprintGraph(graph: BlueprintGraph): string {
  // Rust serde `#[serde(tag = "type", content = "config")]` serializes unit
  // variants (Start/End) WITHOUT a `config` field — `{"type":"start"}`. The
  // in-memory TypeScript representation uses `config: {}` as a placeholder
  // for type narrowing, but the serialized JSON must omit it to match
  // backend deserialization expectations.
  const nodes = graph.nodes.map((node) => {
    if (node.type === 'start' || node.type === 'end') {
      return { type: node.type, id: node.id, position: node.position };
    }
    return node;
  });
  return JSON.stringify({ version: 2, nodes, edges: graph.edges });
}

/// Ensure Start/End nodes have an in-memory `config: {}` placeholder after
/// loading from DB (the serialized JSON omits it per Rust serde convention).
function normalizeLoadedNodes(nodes: BlueprintNode[]): BlueprintNode[] {
  return nodes.map((n) => {
    if ((n.type === 'start' || n.type === 'end') && n.config === undefined) {
      return { ...n, config: {} } as BlueprintNode;
    }
    return n;
  });
}

// ─── Component ───

export const BlueprintEditor: Component<BlueprintEditorProps> = (props) => {
  const [graph, setGraph] = createStore<BlueprintGraph>(createEmptyGraph());
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [hiddenNodeIds, setHiddenNodeIds] = createSignal<Set<string>>(new Set());
  const [viewTransform, setViewTransform] = createStore<ViewTransform>({
    offsetX: 80,
    offsetY: 80,
    zoom: 1,
  });
  const [isDirty, setDirty] = createSignal(false);
  const [isLoading, setLoading] = createSignal(true);
  const [isSaving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [presetDetail, setPresetDetail] = createSignal<PresetDetail | null>(null);

  let canvasContainerEl: HTMLDivElement | undefined;

  const selectedNode = createMemo<BlueprintNode | null>(() => {
    const id = selectedNodeId();
    if (id == null) return null;
    return graph.nodes.find((n) => n.id === id) ?? null;
  });

  // ─── Load + migrate ───

  onMount(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await presetsGet(props.presetId);
      setPresetDetail(detail);

      const rawGraph = detail.preset.blueprintGraph;
      if (rawGraph && rawGraph.trim() !== '') {
        // Preset already has a blueprint graph — parse it.
        try {
          const parsed = JSON.parse(rawGraph) as BlueprintGraph;
          if (parsed.version !== 2 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
            throw new Error('blueprint_graph JSON 结构无效（version/nodes/edges 缺失）');
          }
          // Normalize Start/End nodes: the serialized JSON omits `config`
          // per Rust serde convention; add `config: {}` back in memory.
          const normalizedNodes = normalizeLoadedNodes(parsed.nodes);
          setGraph(produce(() => {
            graph.nodes.splice(0, graph.nodes.length, ...normalizedNodes);
            graph.edges.splice(0, graph.edges.length, ...parsed.edges);
            (graph as BlueprintGraph).version = 2;
          }));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(`解析蓝图 JSON 失败：${msg}`);
          showToast(`解析蓝图 JSON 失败：${msg}`, 'error');
          // Keep the empty graph initialized in createStore as a safe default
          // so the user can still see the canvas and re-author the graph.
        }
      } else {
        // No blueprint graph yet — use default Start→End empty graph.
        const empty = createEmptyGraph();
        setGraph(produce(() => {
          graph.nodes.splice(0, graph.nodes.length, ...empty.nodes);
          graph.edges.splice(0, graph.edges.length, ...empty.edges);
          (graph as BlueprintGraph).version = 2;
        }));
        setDirty(false);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`加载预设失败：${msg}`);
      showToast(`加载预设失败：${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  });

  // ─── View center helper ───

  const computeViewCenterGraph = (): Position => {
    if (!canvasContainerEl) return { x: 200, y: 200 };
    const rect = canvasContainerEl.getBoundingClientRect();
    const v = viewTransform;
    return {
      x: (rect.width / 2 - v.offsetX) / v.zoom,
      y: (rect.height / 2 - v.offsetY) / v.zoom,
    };
  };

  // ─── Node CRUD ───

  const handleAddNode = (type: NodeType, _sentinel: Position) => {
    const center = computeViewCenterGraph();
    const node: BlueprintNode = {
      id: generateNodeId(type),
      position: { x: Math.round(center.x), y: Math.round(center.y) },
      ...defaultConfigForType(type),
    } as BlueprintNode;
    setGraph('nodes', (prev) => [...prev, node]);
    setSelectedNodeId(node.id);
    setDirty(true);
  };

  const handleDeleteNode = (nodeId: string) => {
    setGraph(produce((g) => {
      g.nodes = g.nodes.filter((n) => n.id !== nodeId);
      g.edges = g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
    }));
    if (selectedNodeId() === nodeId) setSelectedNodeId(null);
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    setDirty(true);
  };

  const handleUpdateNode = (nodeId: string, updates: Partial<NodeConfig>) => {
    // NodeConfigPanel always passes a complete { type, config } variant.
    const patch = updates as NodeConfig;
    setGraph('nodes', (prev) => prev.map((n) => {
      if (n.id !== nodeId) return n;
      return { id: n.id, position: n.position, ...patch } as BlueprintNode;
    }));
    setDirty(true);
  };

  const handleNodeMove = (nodeId: string, position: Position) => {
    setGraph('nodes', (prev) => prev.map((n) =>
      n.id === nodeId ? { ...n, position } : n
    ));
    setDirty(true);
  };

  // ─── Edge CRUD ───

  const handleEdgeCreate = (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
  ) => {
    const edge: BlueprintEdge = {
      id: generateEdgeId(),
      source,
      source_port: sourcePort,
      target,
      target_port: targetPort,
    };
    setGraph('edges', (prev) => [...prev, edge]);
    setDirty(true);
  };

  const handleEdgeDelete = (edgeId: string) => {
    setGraph('edges', (prev) => prev.filter((e) => e.id !== edgeId));
    setDirty(true);
  };

  // ─── View transform ───

  const handleGraphPan = (offset: Position) => {
    setViewTransform({ ...viewTransform, offsetX: offset.x, offsetY: offset.y });
  };

  const handleGraphZoom = (zoom: number) => {
    setViewTransform('zoom', zoom);
  };

  // ─── Hidden nodes ───

  const handleToggleNodeHidden = (nodeId: string) => {
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  };

  const handleShowAllNodes = () => {
    if (hiddenNodeIds().size === 0) return;
    setHiddenNodeIds(new Set<string>());
  };

  // ─── Save ───

  const handleSave = async () => {
    const detail = presetDetail();
    if (!detail) {
      showToast('预设尚未加载完成，无法保存', 'error');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const json = serializeBlueprintGraph(graph);
      const payload = buildBlueprintUpdatePayload(detail, json);
      const updated = await presetsUpdate(payload);
      setPresetDetail(updated);
      setDirty(false);
      showToast('蓝图已保存', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(`保存蓝图失败：${msg}`);
      showToast(`保存蓝图失败：${msg}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  // ─── Close with dirty check ───

  const handleClose = async () => {
    if (isDirty()) {
      const ok = await showConfirm({
        title: '退出蓝图编辑器',
        message: '当前有未保存的改动，确定要退出吗？',
        confirmText: '退出',
        cancelText: '继续编辑',
      });
      if (!ok) return;
    }
    props.onClose?.();
  };

  // ─── Render ───

  return (
    <div class="flex flex-col h-full w-full bg-transparent overflow-hidden">
      {/* Toolbar */}
      <header class="flex items-center justify-between gap-4 px-6 py-3 border-b border-white/5 bg-night-water/40 backdrop-blur-sm flex-shrink-0 relative z-50">
        <div class="flex items-center gap-3 min-w-0">
          <Show when={props.onClose}>
            <IconButton
              onClick={() => void handleClose()}
              label="返回预设列表"
              size="sm"
            >
              <ArrowLeft size={16} />
            </IconButton>
          </Show>
          <div class="min-w-0">
            <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">
              蓝图编辑器
            </div>
            <div class="text-sm font-bold text-mist-solid truncate">
              {presetDetail()?.preset.name ?? '加载中…'}
              <Show when={isDirty()}>
                <span class="ml-2 text-[10px] text-amber-300/90 border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 rounded-full align-middle">
                  未保存
                </span>
              </Show>
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <NodeSelector onAddNode={handleAddNode} disabled={isLoading()} />
          <IconButton
            onClick={handleShowAllNodes}
            disabled={hiddenNodeIds().size === 0}
            label={`显示全部节点（${hiddenNodeIds().size} 个隐藏）`}
            size="sm"
          >
            <Eye size={16} />
          </IconButton>
          <IconButton
            onClick={() => void handleSave()}
            disabled={isLoading() || isSaving() || !presetDetail()}
            label={isSaving() ? '保存中…' : '保存蓝图'}
            tone="accent"
            size="sm"
          >
            <Save size={16} />
          </IconButton>
        </div>
      </header>

      {/* Error banner */}
      <Show when={error()}>
        <div class="px-6 py-2 border-b border-red-500/20 bg-red-500/10 text-xs text-red-200 flex items-start gap-2 flex-shrink-0">
          <span class="font-bold">错误</span>
          <span class="flex-1">{error()}</span>
        </div>
      </Show>

      {/* Loading overlay */}
      <Show when={isLoading()}>
        <div class="absolute inset-0 flex items-center justify-center bg-night-water/60 backdrop-blur-sm z-40 pointer-events-none">
          <div class="text-sm text-mist-solid/60">正在加载预设蓝图…</div>
        </div>
      </Show>

      {/* Body: canvas + config panel */}
      <div class="flex-1 flex min-h-0 relative">
        <div
          class="flex-1 min-w-0 relative"
          ref={(el) => { canvasContainerEl = el; }}
        >
          <BlueprintCanvas
            graph={graph}
            viewTransform={viewTransform}
            selectedNodeId={selectedNodeId()}
            hiddenNodeIds={hiddenNodeIds()}
            onNodeSelect={setSelectedNodeId}
            onNodeMove={handleNodeMove}
            onEdgeCreate={handleEdgeCreate}
            onEdgeDelete={handleEdgeDelete}
            onGraphPan={handleGraphPan}
            onGraphZoom={handleGraphZoom}
            onToggleNodeHidden={handleToggleNodeHidden}
          />
        </div>

        <div class="w-[360px] flex-shrink-0 h-full">
          <NodeConfigPanel
            node={selectedNode()}
            onUpdate={handleUpdateNode}
            onDelete={handleDeleteNode}
          />
        </div>
      </div>
    </div>
  );
};

// ─── Guard against unused import warnings (NODE_TYPES is re-exported for
// downstream consumers that want the canonical list). ───
export { NODE_TYPES };
