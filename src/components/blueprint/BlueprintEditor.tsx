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
 *   carries every required field (name / category / etc.). The backend
 *   `presets_update` is a direct full-row assignment (no `COALESCE`), so
 *   every column must be echoed back to avoid overwriting with NULL.
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

import { Component, Show, createMemo, createSignal, onMount, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { ArrowLeft, Eye, LayoutGrid, Save } from '../../lib/icons';
import {
  NODE_TYPES,
  type BlueprintComment,
  type BlueprintEdge,
  type BlueprintGraph,
  type BlueprintNode,
  type NodeConfig,
  type NodePositionPatch,
  type NodeType,
  type Position,
} from '../../lib/blueprint/types';
import {
  normalizeBlueprintGraph,
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
import { autoLayout, isNodeLocked, type ViewTransform } from './nodeLayout';

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
          required: true,
          context_included: true,
          display: { default_expanded: true, hide_label: false },
          is_locked: false,
          lock_reason: null,
          order: 0,
        },
      };
    case 'mutex_gate':
      return {
        type: 'mutex_gate',
        config: {
          label: '互斥组',
          options: [{ key: 'opt_1', label: '选项 1', description: '' }],
        },
      };
    case 'group_gate':
      return {
        type: 'group_gate',
        config: {
          label: '普通组',
          options: [{ key: 'opt_1', label: '选项 1', description: '' }],
        },
      };
    case 'mode_switch':
      return {
        type: 'mode_switch',
        config: { label: '记忆模式分支' },
      };
    case 'role_switch':
      return {
        type: 'role_switch',
        config: { label: '角色模式分支' },
      };
    case 'constant':
      return {
        type: 'constant',
        config: {
          label: '会话角色',
          source: 'conversation_type',
        },
      };
    case 'branch':
      return {
        type: 'branch',
        config: {
          label: '角色分支',
          cases: [
            { match_value: 'single', port: 'out_single' },
            { match_value: 'online', port: 'out_online' },
          ],
          default_port: 'out_single',
        },
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
          thinking_enabled: null,
          thinking_budget_tokens: null,
          is_locked: false,
        },
      };
    case 'sampling_params_openai':
      return {
        type: 'sampling_params_openai',
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
    case 'sampling_params_anthropic':
      return {
        type: 'sampling_params_anthropic',
        config: {
          temperature: null,
          max_tokens: null,
          top_p: null,
          stop: null,
          thinking_enabled: null,
          thinking_budget_tokens: null,
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

let commentCounter = 0;
function generateCommentId(): string {
  return `c_${++commentCounter}_${Date.now().toString(36).slice(-4)}`;
}

/** Comment box default geometry (graph units), kept in sync with the canvas. */
const COMMENT_DEFAULT_WIDTH = 360;
const COMMENT_DEFAULT_HEIGHT = 240;

// ─── Empty graph ───

function createEmptyGraph(): BlueprintGraph {
  return {
    version: 2,
    comments: [],
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
        order: 0,
      },
    ],
  };
}

// ─── Save payload builder ───

/**
 * Build a full-row update payload from the editor's current `PresetDetail`.
 *
 * `presets_update` is a full-row direct assignment (no `COALESCE`) so the
 * Blueprint editor must echo back every column — even ones the editor
 * did not touch — to avoid overwriting them with `NULL`. Field-level
 * numeric sentinel values (`max_output_tokens = 0`, `top_k = 0`) are
 * normalized server-side in `preset_validator` to `NULL`, so legacy
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
  // comments 属编辑器标注元数据：随图落库，Rust 侧 `#[serde(default)]` 保留，
  // 执行器忽略。空列表也显式输出，保持序列化确定性。
  return JSON.stringify({
    version: 2,
    nodes,
    edges: graph.edges,
    comments: graph.comments ?? [],
  });
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

// ─── Component ───

export const BlueprintEditor: Component<BlueprintEditorProps> = (props) => {
  const [graph, setGraph] = createStore<BlueprintGraph>(createEmptyGraph());
  // 主选中节点：仅在恰好选中 1 个节点时非空，驱动配置面板。
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  // 框选 / Ctrl+点选产生的多选集合（含主选中节点）。
  const [selectedNodeIds, setSelectedNodeIds] = createSignal<Set<string>>(new Set());
  const [selectedEdgeId, setSelectedEdgeId] = createSignal<string | null>(null);
  const [selectedCommentId, setSelectedCommentId] = createSignal<string | null>(null);
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

  // ─── Selection helpers ───

  /** Single-select a node (replaces the multi-selection). */
  const handleNodeSelect = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setSelectedNodeIds(nodeId ? new Set<string>([nodeId]) : new Set<string>());
    setSelectedEdgeId(null);
    setSelectedCommentId(null);
  };

  /** Ctrl+click toggle of a node's membership in the multi-selection. */
  const handleNodeToggleSelect = (nodeId: string) => {
    setSelectedEdgeId(null);
    setSelectedCommentId(null);
    const next = new Set(selectedNodeIds());
    if (next.has(nodeId)) next.delete(nodeId);
    else next.add(nodeId);
    setSelectedNodeIds(next);
    setSelectedNodeId(next.size === 1 ? [...next][0] : null);
  };

  /** Marquee finalize: replace the selection with the boxed nodes. */
  const handleNodesBoxSelected = (nodeIds: string[]) => {
    setSelectedEdgeId(null);
    setSelectedCommentId(null);
    setSelectedNodeIds(new Set(nodeIds));
    setSelectedNodeId(nodeIds.length === 1 ? nodeIds[0] : null);
  };

  const handleEdgeSelect = (edgeId: string | null) => {
    setSelectedNodeId(null);
    setSelectedNodeIds(new Set<string>());
    setSelectedCommentId(null);
    setSelectedEdgeId(edgeId);
  };

  const handleCommentSelect = (commentId: string | null) => {
    setSelectedNodeId(null);
    setSelectedNodeIds(new Set<string>());
    setSelectedEdgeId(null);
    setSelectedCommentId(commentId);
  };

  // ─── Keyboard: Delete removes selection, X breaks all pins ───

  const handleKeyDown = (e: KeyboardEvent) => {
    // Avoid hijacking keys when the user is typing in an input/textarea.
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const nodeIds = [...selectedNodeIds()];
      const commentId = selectedCommentId();
      const edgeId = selectedEdgeId();
      if (nodeIds.length === 0 && !commentId && !edgeId) return;
      e.preventDefault();
      if (nodeIds.length > 0) {
        handleDeleteNodes(nodeIds);
      } else if (commentId) {
        handleDeleteComment(commentId);
      } else if (edgeId) {
        handleEdgeDelete(edgeId);
        setSelectedEdgeId(null);
      }
      return;
    }
    // X：断开所有选中节点的全部连线（断开所有引脚）。
    if ((e.key === 'x' || e.key === 'X') && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const nodeIds = [...selectedNodeIds()];
      if (nodeIds.length === 0) return;
      e.preventDefault();
      handleDisconnectNodes(nodeIds);
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
  });

  onCleanup(() => {
    window.removeEventListener('keydown', handleKeyDown);
  });

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
          // 旧图归一化：真数据流引入后 Constant 成为无 exec 入口的纯值节点，
          // 旧拓扑（Constant 串在 exec 链上）由后端改写为
          // 「上游 → Branch(in)」+「Constant → Branch(value)」（C1，规则在后端）。
          const migration = await normalizeBlueprintGraph(rawGraph);
          const parsed = JSON.parse(migration.graphJson) as BlueprintGraph;
          if (parsed.version !== 2 || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
            throw new Error('blueprint_graph JSON 结构无效（version/nodes/edges 缺失）');
          }
          // Normalize Start/End nodes: the serialized JSON omits `config`
          // per Rust serde convention; add `config: {}` back in memory.
          const normalizedNodes = normalizeLoadedNodes(parsed.nodes);
          setGraph('nodes', normalizedNodes);
          setGraph('edges', parsed.edges);
          setGraph('comments', parsed.comments ?? []);
          setGraph('version', 2);

          if (migration.migrated) {
            // 迁移必须可见：提示用户保存，绝不静默改写（C2）。
            showToast('蓝图结构已升级为 value 引脚拓扑，请点击保存使其生效', 'warning');
            setDirty(true);
          }

          // If the imported JSON stripped positions (every node at 0,0),
          // auto-layout so the editor opens with a usable view.
          const allAtOrigin =
            normalizedNodes.length > 0 &&
            normalizedNodes.every((n) => n.position.x === 0 && n.position.y === 0);
          if (allAtOrigin) {
            const positions = autoLayout(normalizedNodes, parsed.edges);
            setGraph('nodes', (prev) =>
              prev.map((n) => {
                const pos = positions.get(n.id);
                return pos ? { ...n, position: pos } : n;
              }),
            );
            setDirty(true);
          }
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
        setGraph('nodes', empty.nodes);
        setGraph('edges', empty.edges);
        setGraph('comments', empty.comments ?? []);
        setGraph('version', 2);
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

  const addNodeAt = (type: NodeType, position: Position) => {
    const node: BlueprintNode = {
      id: generateNodeId(type),
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      ...defaultConfigForType(type),
    } as BlueprintNode;
    setGraph('nodes', (prev) => [...prev, node]);
    handleNodeSelect(node.id);
    setDirty(true);
  };

  /** Toolbar / NodeSelector creation: place at the current view center. */
  const handleAddNode = (type: NodeType, _sentinel: Position) => {
    addNodeAt(type, computeViewCenterGraph());
  };

  /** Context-menu creation: place at the right-clicked graph position. */
  const handleCreateNodeAt = (type: NodeType, position: Position) => {
    addNodeAt(type, position);
  };

  /**
   * Batch node deletion. Locked nodes are skipped with a visible toast
   * (locked nodes cannot be deleted per spec — zero-fallback visibility).
   */
  const handleDeleteNodes = (nodeIds: string[]) => {
    const idSet = new Set(nodeIds);
    const lockedIds = graph.nodes
      .filter((n) => idSet.has(n.id) && isNodeLocked(n))
      .map((n) => n.id);
    const deletable = nodeIds.filter((id) => !lockedIds.includes(id));
    if (deletable.length === 0) {
      showToast('选中节点均已锁定，不可删除', 'warning');
      return;
    }
    if (lockedIds.length > 0) {
      showToast(`${lockedIds.length} 个锁定节点未删除（锁定节点不可删除）`, 'warning');
    }
    const deleteSet = new Set(deletable);
    setGraph('nodes', (prev) => prev.filter((n) => !deleteSet.has(n.id)));
    setGraph('edges', (prev) =>
      prev.filter((e) => !deleteSet.has(e.source) && !deleteSet.has(e.target)),
    );
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      deleteSet.forEach((id) => next.delete(id));
      return next;
    });
    setSelectedNodeId((prev) => (prev && deleteSet.has(prev) ? null : prev));
    setHiddenNodeIds((prev) => {
      const next = new Set(prev);
      deleteSet.forEach((id) => next.delete(id));
      return next;
    });
    setDirty(true);
  };

  /** Single-node delete (NodeConfigPanel button) reuses the batch path. */
  const handleDeleteNode = (nodeId: string) => {
    handleDeleteNodes([nodeId]);
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

  /** Batch node position patches in one store update (C3: single patch). */
  const handleNodesMoveBatch = (moves: NodePositionPatch[]) => {
    if (moves.length === 0) return;
    const byId = new Map(moves.map((m) => [m.id, m.position]));
    setGraph('nodes', (prev) => prev.map((n) => {
      const pos = byId.get(n.id);
      return pos ? { ...n, position: pos } : n;
    }));
    setDirty(true);
  };

  /** Disconnect every edge touching any of the selected nodes. */
  const handleDisconnectNodes = (nodeIds: string[]) => {
    const idSet = new Set(nodeIds);
    const removed = graph.edges.filter((e) => idSet.has(e.source) || idSet.has(e.target));
    if (removed.length === 0) {
      showToast('选中节点没有连线可断开', 'info');
      return;
    }
    setGraph('edges', (prev) =>
      prev.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
    );
    setDirty(true);
    showToast(`已断开 ${removed.length} 条连线`, 'success');
  };

  // ─── Comment box CRUD ───

  const patchComment = (commentId: string, patch: Partial<BlueprintComment>) => {
    setGraph('comments', (prev) => (prev ?? []).map((c) =>
      c.id === commentId ? { ...c, ...patch } : c,
    ));
    setDirty(true);
  };

  /** UE-style comment box created at the right-clicked position. */
  const handleAddCommentAt = (position: Position) => {
    const comment: BlueprintComment = {
      id: generateCommentId(),
      text: '注释',
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      width: COMMENT_DEFAULT_WIDTH,
      height: COMMENT_DEFAULT_HEIGHT,
    };
    setGraph('comments', (prev) => [...(prev ?? []), comment]);
    handleCommentSelect(comment.id);
    setDirty(true);
  };

  const handleCommentMove = (commentId: string, position: Position) => {
    patchComment(commentId, { position });
  };

  const handleCommentResize = (commentId: string, width: number, height: number) => {
    patchComment(commentId, {
      width: Math.round(width),
      height: Math.round(height),
    });
  };

  const handleUpdateCommentText = (commentId: string, text: string) => {
    patchComment(commentId, { text });
  };

  const handleDeleteComment = (commentId: string) => {
    setGraph('comments', (prev) => (prev ?? []).filter((c) => c.id !== commentId));
    if (selectedCommentId() === commentId) setSelectedCommentId(null);
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
      order: 0,
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

  // ─── Auto layout ───

  const handleAutoLayout = () => {
    const positions = autoLayout(graph.nodes, graph.edges);
    setGraph('nodes', (prev) => prev.map((n) => {
      const pos = positions.get(n.id);
      return pos ? { ...n, position: pos } : n;
    }));
    setDirty(true);
    showToast('节点已自动整理', 'success');
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
            onClick={handleAutoLayout}
            disabled={isLoading() || graph.nodes.length <= 2}
            label="整理节点布局"
            size="sm"
          >
            <LayoutGrid size={16} />
          </IconButton>
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
            selectedNodeIds={selectedNodeIds()}
            selectedEdgeId={selectedEdgeId()}
            selectedCommentId={selectedCommentId()}
            hiddenNodeIds={hiddenNodeIds()}
            onNodeSelect={handleNodeSelect}
            onNodeToggleSelect={handleNodeToggleSelect}
            onNodesBoxSelected={handleNodesBoxSelected}
            onEdgeSelect={handleEdgeSelect}
            onCommentSelect={handleCommentSelect}
            onNodesMoveBatch={handleNodesMoveBatch}
            onEdgeCreate={handleEdgeCreate}
            onEdgeDelete={handleEdgeDelete}
            onGraphPan={handleGraphPan}
            onGraphZoom={handleGraphZoom}
            onToggleNodeHidden={handleToggleNodeHidden}
            onCreateNodeAt={handleCreateNodeAt}
            onAddCommentAt={handleAddCommentAt}
            onCommentMove={handleCommentMove}
            onCommentResize={handleCommentResize}
            onUpdateCommentText={handleUpdateCommentText}
          />

          {/* Shortcut legend (render-only) */}
          <div class="absolute bottom-2 left-3 z-10 pointer-events-none text-[10px] text-mist-solid/35 flex gap-3 flex-wrap">
            <span>左键拖动空白 = 框选</span>
            <span>右键空白 = 创建节点/注释</span>
            <span>右键拖动 = 平移</span>
            <span>Ctrl+点击 = 加选</span>
            <span>DEL = 删除选中</span>
            <span>X = 断开连线</span>
            <span>双击注释 = 编辑文字</span>
          </div>
        </div>

        <div class="w-[360px] flex-shrink-0 h-full min-h-0">
          <Show
            when={selectedNode() && selectedNodeIds().size === 1}
            fallback={
              <Show when={selectedNodeIds().size > 1}>
                <div class="h-full flex flex-col items-center justify-center gap-3 px-6 text-center border-l border-white/5">
                  <div class="text-sm font-bold text-mist-solid/70">
                    已选中 {selectedNodeIds().size} 个节点
                  </div>
                  <div class="text-xs text-mist-solid/40 leading-6">
                    拖动任一选中节点可整体移动
                    <br />
                    按 <kbd class="px-1.5 py-0.5 rounded bg-white/10 text-mist-solid/70">DEL</kbd> 删除全部
                    <br />
                    按 <kbd class="px-1.5 py-0.5 rounded bg-white/10 text-mist-solid/70">X</kbd> 断开全部连线
                    <br />
                    点击单个节点可编辑其配置
                  </div>
                </div>
              </Show>
            }
          >
            <NodeConfigPanel
              node={selectedNode()}
              onUpdate={handleUpdateNode}
              onDelete={handleDeleteNode}
            />
          </Show>
        </div>
      </div>
    </div>
  );
};

// ─── Guard against unused import warnings (NODE_TYPES is re-exported for
// downstream consumers that want the canonical list). ───
export { NODE_TYPES };
