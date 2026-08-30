/**
 * Blueprint editor SVG canvas — PC frontend (Task 8).
 *
 * Renders the blueprint graph as an SVG node diagram with UE-style canvas
 * interactions: box (marquee) selection, comment boxes, right-click context
 * node creation, right/middle-drag panning, node dragging (multi-node aware),
 * edge creation/deletion, cycle detection, locked-node constraints, and
 * per-node visibility toggles.
 *
 * Architecture:
 * - The canvas is a controlled component: `graph`, `viewTransform`, the
 *   selection sets, and `hiddenNodeIds` are owned by the parent
 *   (BlueprintEditor, Task 10) and passed in as props. The canvas notifies
 *   the parent of changes via the `on*` callbacks.
 * - Transient interaction state (pan / marquee / node-drag / comment-drag /
 *   comment-resize / connect gestures and transient overlays) is internal to
 *   the canvas because it has no business meaning outside the gesture.
 * - Pointer capture on the SVG root ensures drag/pan/connect gestures
 *   continue to receive move/up events even when the pointer leaves the
 *   SVG bounding box.
 *
 * UE-style interaction map:
 * - LMB drag on background → marquee box-select (multi-node selection).
 * - LMB drag on node → drag every selected node (single-select if the node
 *   was not selected yet); Ctrl+LMB click toggles a node's membership.
 * - RMB / MMB drag on background → pan; RMB tap (no drag) → context menu to
 *   create a node or a comment box at the clicked position.
 * - Comment boxes: drag moves the box together with the nodes fully
 *   contained in it; the corner handle resizes; double-click edits the text.
 *
 * Constraints:
 * - C1 Frontend Render-Only: the canvas only renders and forwards user
 *   intent (node move / edge create / edge delete / comment CRUD) to the
 *   parent. No business logic, no persistence, no backend calls.
 * - C3 Responsiveness: node positions are applied via SVG `transform`
 *   attributes (composite-friendly), and SolidJS `<For>` keys each node
 *   by reference so a single node move only patches that node's transform.
 * - C5 Mobile Frontend Independence: this file lives under `src/` (PC
 *   only). The mobile canvas (Task 13) is a separate implementation under
 *   `src-mobile/`. The pure helpers in `nodeLayout.ts` are shared via
 *   relative-path import, which is the spec-sanctioned shared layer.
 */

import {
  Component,
  For,
  Match,
  Show,
  Switch,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import type {
  BlueprintComment,
  BlueprintEdge,
  BlueprintGraph,
  BlueprintNode,
  NodePositionPatch,
  NodeType,
  Position,
} from '../../lib/blueprint/types';
import {
  bezierPath,
  clampZoom,
  computeExecutionOrder,
  computeNodeLayout,
  CONNECTION_REJECT_MESSAGES,
  ConnectingFrom,
  getEdgeEndpoints,
  getPortPosition,
  isEdgeLocked,
  isNodeLocked,
  HEADER_HEIGHT,
  PORT_RADIUS,
  PortLayout,
  validateConnection,
  ViewTransform,
} from './nodeLayout';
import { NODE_LABELS, SELECTABLE_NODE_TYPES } from './NodeSelector';
import { showToast } from '../Toast';

// ─── Props ───

export interface BlueprintCanvasProps {
  graph: BlueprintGraph;
  /** View transform owned by the parent (survives canvas unmount). */
  viewTransform: ViewTransform;
  /** All currently selected node IDs (multi-selection aware). */
  selectedNodeIds: Set<string>;
  /** Currently selected edge ID (for Delete-key deletion). */
  selectedEdgeId: string | null;
  /** Currently selected comment box ID (for Delete-key deletion/editing). */
  selectedCommentId: string | null;
  /** Node IDs in this set are not rendered (but still exist in the graph). */
  hiddenNodeIds: Set<string>;
  /** Single-select a node (null clears the whole selection). */
  onNodeSelect: (nodeId: string | null) => void;
  /** Ctrl+click toggle of a node's membership in the multi-selection. */
  onNodeToggleSelect: (nodeId: string) => void;
  /** Finalized marquee selection (replaces the node selection). */
  onNodesBoxSelected: (nodeIds: string[]) => void;
  onEdgeSelect: (edgeId: string | null) => void;
  /** Select a comment box (null clears comment selection). */
  onCommentSelect: (commentId: string | null) => void;
  /** Batch node position patches (single-node drag sends one entry). */
  onNodesMoveBatch: (moves: NodePositionPatch[]) => void;
  onEdgeCreate: (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
  ) => void;
  onEdgeDelete: (edgeId: string) => void;
  /** Fired with the new top-left offset (graph coords) when the user pans. */
  onGraphPan: (offset: Position) => void;
  /** Fired with the new zoom factor when the user zooms. */
  onGraphZoom: (zoom: number) => void;
  /** Toggle a node's membership in `hiddenNodeIds` (SubTask 8.6). */
  onToggleNodeHidden: (nodeId: string) => void;
  /** Create a node of `type` at the given graph position (context menu). */
  onCreateNodeAt: (type: NodeType, position: Position) => void;
  /** Create a comment box with its top-left at the given graph position. */
  onAddCommentAt: (position: Position) => void;
  onCommentMove: (commentId: string, position: Position) => void;
  onCommentResize: (commentId: string, width: number, height: number) => void;
  onUpdateCommentText: (commentId: string, text: string) => void;
}

// ─── Internal interaction state ───

interface NodeDragEntry {
  nodeId: string;
  startNodeX: number;
  startNodeY: number;
}

type InteractionState =
  | {
      /** RMB / MMB drag pans; an RMB press without drag opens the context menu. */
      kind: 'pan';
      pointerId: number;
      /** Original pointer button (2 = right → tap opens the context menu). */
      button: number;
      startScreenX: number;
      startScreenY: number;
      startOffsetX: number;
      startOffsetY: number;
      moved: boolean;
    }
  | {
      kind: 'box-select';
      pointerId: number;
      startGraphX: number;
      startGraphY: number;
    }
  | {
      kind: 'node-drag';
      pointerId: number;
      entries: NodeDragEntry[];
      startScreenX: number;
      startScreenY: number;
    }
  | {
      kind: 'comment-drag';
      pointerId: number;
      commentId: string;
      startGraphX: number;
      startGraphY: number;
      startCommentX: number;
      startCommentY: number;
      /** Nodes fully inside the box at drag start — they move with it. */
      nodeEntries: NodeDragEntry[];
    }
  | {
      kind: 'comment-resize';
      pointerId: number;
      commentId: string;
      startGraphX: number;
      startGraphY: number;
      startWidth: number;
      startHeight: number;
    }
  | {
      kind: 'connect';
      pointerId: number;
      from: ConnectingFrom;
    };

interface ContextMenuState {
  /** Position relative to the canvas container (screen px). */
  screenX: number;
  screenY: number;
  /** Position in graph coordinates (node/comment creation anchor). */
  graphX: number;
  graphY: number;
}

// ─── Constants ───

const GRID_SIZE = 40;
const GRID_EXTENT = 5000;
const CONNECT_DASH = '6 4';
/** Comment box minimum geometry (graph units). */
const COMMENT_MIN_WIDTH = 140;
const COMMENT_MIN_HEIGHT = 80;
const COMMENT_HEADER_HEIGHT = 26;
/** Comment accent (UE-style desaturated green on the dark canvas). */
const COMMENT_STROKE = 'rgba(94, 186, 125, 0.65)';
const COMMENT_FILL = 'rgba(94, 186, 125, 0.10)';
const COMMENT_HEADER_FILL = 'rgba(94, 186, 125, 0.22)';
/** Pointer travel (screen px) below which a press counts as a click. */
const CLICK_TOLERANCE_PX = 4;

// ─── Port shape (UE 式：exec 三角形 / value 圆形 / bool 菱形) ───

interface PortShapeProps {
  port: PortLayout;
  accent: string;
  radius: number;
}

/**
 * UE 式引脚图形。exec 为右向三角（执行流），value 为圆点（值数据），
 * bool 为菱形（判定分支出口）。命中判定与 data 属性由外层 `<g>` 承载。
 */
const PortShape: Component<PortShapeProps> = (props) => {
  const cx = () => props.port.x;
  const cy = () => props.port.y;
  return (
    <Switch fallback={null}>
      <Match when={props.port.kind === 'exec'}>
        <path
          d={`M ${cx() - 5},${cy() - 5.5} L ${cx() + 5.5},${cy()} L ${cx() - 5},${cy() + 5.5} Z`}
          fill={props.accent}
          stroke="white"
          stroke-width={1.2}
        />
      </Match>
      <Match when={props.port.kind === 'value'}>
        <circle
          cx={cx()}
          cy={cy()}
          r={props.radius}
          fill={props.accent}
          stroke="white"
          stroke-width={1.5}
        />
      </Match>
      <Match when={props.port.kind === 'bool'}>
        <path
          d={`M ${cx()},${cy() - 6} L ${cx() + 6},${cy()} L ${cx()},${cy() + 6} L ${cx() - 6},${cy()} Z`}
          fill={props.accent}
          stroke="white"
          stroke-width={1.2}
        />
      </Match>
    </Switch>
  );
};

// ─── Rect intersection (marquee + comment containment) ───

const rectsIntersect = (
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
): boolean =>
  ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;

// ─── Component ───

export const BlueprintCanvas: Component<BlueprintCanvasProps> = (props) => {
  let svgEl: SVGSVGElement | undefined;
  let containerEl: HTMLDivElement | undefined;
  const [interaction, setInteraction] = createSignal<InteractionState | null>(null);
  const [connectMousePos, setConnectMousePos] = createSignal<Position | null>(null);
  /** Live marquee rectangle (graph coords) while box-selecting. */
  const [marquee, setMarquee] = createSignal<{ x: number; y: number; width: number; height: number } | null>(null);
  /** Nodes currently highlighted by the marquee drag (preview only). */
  const [marqueeNodeIds, setMarqueeNodeIds] = createSignal<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = createSignal<ContextMenuState | null>(null);
  /** Comment whose text is being edited via the HTML overlay input. */
  const [editingCommentId, setEditingCommentId] = createSignal<string | null>(null);
  const [editingText, setEditingText] = createSignal('');

  const view = () => props.viewTransform;

  /** Render-only execution order for the current graph. */
  const executionOrder = createMemo(() => computeExecutionOrder(props.graph));

  const commentList = createMemo<BlueprintComment[]>(() => props.graph.comments ?? []);

  // ─── Coordinate conversion ───

  const screenToGraph = (clientX: number, clientY: number): Position => {
    if (!svgEl) return { x: 0, y: 0 };
    const rect = svgEl.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const v = view();
    return {
      x: (localX - v.offsetX) / v.zoom,
      y: (localY - v.offsetY) / v.zoom,
    };
  };

  const closeContextMenu = () => setContextMenu(null);

  // ─── Background: LMB = marquee box-select, RMB/MMB = pan (RMB tap = menu) ───

  const handleBackgroundPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    closeContextMenu();
    cancelCommentEditing();
    if (e.button === 0) {
      props.onNodeSelect(null);
      props.onEdgeSelect(null);
      props.onCommentSelect(null);
      const start = screenToGraph(e.clientX, e.clientY);
      setInteraction({
        kind: 'box-select',
        pointerId: e.pointerId,
        startGraphX: start.x,
        startGraphY: start.y,
      });
    } else {
      const v = view();
      setInteraction({
        kind: 'pan',
        pointerId: e.pointerId,
        button: e.button,
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        startOffsetX: v.offsetX,
        startOffsetY: v.offsetY,
        moved: false,
      });
    }
    svgEl?.setPointerCapture(e.pointerId);
  };

  /** Native browser menu must never appear; RMB tap opens our own menu. */
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
  };

  // ─── Node drag ───

  const handleNodePointerDown = (e: PointerEvent, node: BlueprintNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    closeContextMenu();
    cancelCommentEditing();

    // Ctrl+click toggles membership (UE-style multi-select); no drag.
    if (e.ctrlKey || e.metaKey) {
      props.onNodeToggleSelect(node.id);
      return;
    }

    props.onEdgeSelect(null);
    props.onCommentSelect(null);
    if (!props.selectedNodeIds.has(node.id)) {
      props.onNodeSelect(node.id);
    }
    if (isNodeLocked(node)) return;

    // Drag the whole active selection when the pressed node is part of it.
    const entries: NodeDragEntry[] = props.selectedNodeIds.has(node.id)
      ? [...props.selectedNodeIds]
          .map((id) => props.graph.nodes.find((n) => n.id === id))
          .filter((n): n is BlueprintNode => !!n && !isNodeLocked(n))
          .map((n) => ({ nodeId: n.id, startNodeX: n.position.x, startNodeY: n.position.y }))
      : [{ nodeId: node.id, startNodeX: node.position.x, startNodeY: node.position.y }];
    setInteraction({
      kind: 'node-drag',
      pointerId: e.pointerId,
      entries,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
    });
    svgEl?.setPointerCapture(e.pointerId);
  };

  // ─── Connect ───

  const handleOutputPortPointerDown = (
    e: PointerEvent,
    node: BlueprintNode,
    port: string,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    closeContextMenu();
    // is_locked only restricts content editing, not topology (connections).
    // Locked nodes can still be connection sources/targets.
    const pos = screenToGraph(e.clientX, e.clientY);
    setInteraction({
      kind: 'connect',
      pointerId: e.pointerId,
      from: { nodeId: node.id, port },
    });
    setConnectMousePos(pos);
    svgEl?.setPointerCapture(e.pointerId);
  };

  // ─── Pointer move (unified) ───

  const handlePointerMove = (e: PointerEvent) => {
    const it = interaction();
    if (!it || e.pointerId !== it.pointerId) return;
    if (it.kind === 'pan') {
      const dx = e.clientX - it.startScreenX;
      const dy = e.clientY - it.startScreenY;
      if (!it.moved && Math.hypot(dx, dy) > CLICK_TOLERANCE_PX) {
        it.moved = true;
      }
      props.onGraphPan({
        x: it.startOffsetX + dx,
        y: it.startOffsetY + dy,
      });
    } else if (it.kind === 'box-select') {
      const current = screenToGraph(e.clientX, e.clientY);
      const x = Math.min(it.startGraphX, current.x);
      const y = Math.min(it.startGraphY, current.y);
      const width = Math.abs(current.x - it.startGraphX);
      const height = Math.abs(current.y - it.startGraphY);
      setMarquee({ x, y, width, height });
      setMarqueeNodeIds(
        new Set(
          props.graph.nodes
            .filter((n) => {
              const l = computeNodeLayout(n);
              return rectsIntersect(
                n.position.x, n.position.y, l.width, l.height,
                x, y, width, height,
              );
            })
            .map((n) => n.id),
        ),
      );
    } else if (it.kind === 'node-drag') {
      const v = view();
      const dx = (e.clientX - it.startScreenX) / v.zoom;
      const dy = (e.clientY - it.startScreenY) / v.zoom;
      props.onNodesMoveBatch(
        it.entries.map((entry) => ({
          id: entry.nodeId,
          position: { x: entry.startNodeX + dx, y: entry.startNodeY + dy },
        })),
      );
    } else if (it.kind === 'comment-drag') {
      const current = screenToGraph(e.clientX, e.clientY);
      const dx = current.x - it.startGraphX;
      const dy = current.y - it.startGraphY;
      props.onCommentMove(it.commentId, {
        x: it.startCommentX + dx,
        y: it.startCommentY + dy,
      });
      props.onNodesMoveBatch(
        it.nodeEntries.map((entry) => ({
          id: entry.nodeId,
          position: { x: entry.startNodeX + dx, y: entry.startNodeY + dy },
        })),
      );
    } else if (it.kind === 'comment-resize') {
      const current = screenToGraph(e.clientX, e.clientY);
      props.onCommentResize(
        it.commentId,
        Math.max(COMMENT_MIN_WIDTH, it.startWidth + (current.x - it.startGraphX)),
        Math.max(COMMENT_MIN_HEIGHT, it.startHeight + (current.y - it.startGraphY)),
      );
    } else if (it.kind === 'connect') {
      setConnectMousePos(screenToGraph(e.clientX, e.clientY));
    }
  };

  // ─── Pointer up (unified) ───

  const handlePointerUp = (e: PointerEvent) => {
    const it = interaction();
    if (!it || e.pointerId !== it.pointerId) return;
    svgEl?.releasePointerCapture(it.pointerId);
    if (it.kind === 'box-select') {
      const ids = [...marqueeNodeIds()];
      props.onNodesBoxSelected(ids);
      setMarquee(null);
      setMarqueeNodeIds(new Set<string>());
    } else if (it.kind === 'pan') {
      // RMB press without travel = context menu request at the pointer.
      if (it.button === 2 && !it.moved) {
        openContextMenuAt(e.clientX, e.clientY);
      }
    } else if (it.kind === 'connect') {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const portEl = el?.closest('[data-port-direction="input"]') as SVGElement | null;
      if (portEl) {
        const targetNodeId = portEl.getAttribute('data-node-id');
        const targetPort = portEl.getAttribute('data-port');
        if (targetNodeId && targetPort) {
          completeConnection(it.from, targetNodeId, targetPort);
        }
      }
      setConnectMousePos(null);
    }
    setInteraction(null);
  };

  const openContextMenuAt = (clientX: number, clientY: number) => {
    if (!containerEl) return;
    const rect = containerEl.getBoundingClientRect();
    const graph = screenToGraph(clientX, clientY);
    setContextMenu({
      screenX: clientX - rect.left,
      screenY: clientY - rect.top,
      graphX: graph.x,
      graphY: graph.y,
    });
  };

  const completeConnection = (
    from: ConnectingFrom,
    targetNodeId: string,
    targetPort: string,
  ) => {
    const sourceNode = props.graph.nodes.find((n) => n.id === from.nodeId);
    const targetNode = props.graph.nodes.find((n) => n.id === targetNodeId);
    if (!sourceNode || !targetNode) return;
    const result = validateConnection(
      props.graph,
      sourceNode,
      from.port,
      targetNode,
      targetPort,
    );
    if (result.ok) {
      props.onEdgeCreate(from.nodeId, from.port, targetNodeId, targetPort);
    } else if (result.reason) {
      showToast(CONNECTION_REJECT_MESSAGES[result.reason], 'error');
    }
  };

  // ─── Wheel zoom (attached non-passive so we can preventDefault) ───

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    closeContextMenu();
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const v = view();
    const oldZoom = v.zoom;
    const delta = -e.deltaY * 0.0015;
    const newZoom = clampZoom(oldZoom * (1 + delta));
    if (newZoom === oldZoom) return;
    // Keep the point under the cursor stationary in graph coords.
    const graphX = (mouseX - v.offsetX) / oldZoom;
    const graphY = (mouseY - v.offsetY) / oldZoom;
    props.onGraphPan({
      x: mouseX - graphX * newZoom,
      y: mouseY - graphY * newZoom,
    });
    props.onGraphZoom(newZoom);
  };

  onMount(() => {
    if (svgEl) {
      svgEl.addEventListener('wheel', handleWheel, { passive: false });
      onCleanup(() => svgEl?.removeEventListener('wheel', handleWheel));
    }
    // Close the context menu / cancel text editing on Escape.
    const handleWindowKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeContextMenu();
        cancelCommentEditing();
      }
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleWindowKeyDown));
  });

  // ─── Edge deletion ───

  const handleEdgePointerDown = (e: PointerEvent, edge: BlueprintEdge) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    closeContextMenu();
    // Click selects the edge; Delete key removes it (see BlueprintEditor
    // keydown handler). Direct click-delete was removed to support selection.
    props.onNodeSelect(null);
    props.onCommentSelect(null);
    props.onEdgeSelect(edge.id);
  };

  // ─── Comment boxes ───

  /** Nodes fully contained in the box at drag start — UE moves them along. */
  const nodesContainedIn = (comment: BlueprintComment): NodeDragEntry[] =>
    props.graph.nodes
      .filter((n) => {
        const l = computeNodeLayout(n);
        return (
          n.position.x >= comment.position.x &&
          n.position.y >= comment.position.y &&
          n.position.x + l.width <= comment.position.x + comment.width &&
          n.position.y + l.height <= comment.position.y + comment.height
        );
      })
      .map((n) => ({ nodeId: n.id, startNodeX: n.position.x, startNodeY: n.position.y }));

  const cancelCommentEditing = () => {
    setEditingCommentId(null);
  };

  const commitCommentEditing = () => {
    const id = editingCommentId();
    if (!id) return;
    const text = editingText().trim();
    if (text !== '') {
      props.onUpdateCommentText(id, text);
    }
    setEditingCommentId(null);
  };

  const handleCommentPointerDown = (e: PointerEvent, comment: BlueprintComment) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    closeContextMenu();
    if (editingCommentId() && editingCommentId() !== comment.id) {
      commitCommentEditing();
    }
    props.onNodeSelect(null);
    props.onEdgeSelect(null);
    props.onCommentSelect(comment.id);
    const start = screenToGraph(e.clientX, e.clientY);
    setInteraction({
      kind: 'comment-drag',
      pointerId: e.pointerId,
      commentId: comment.id,
      startGraphX: start.x,
      startGraphY: start.y,
      startCommentX: comment.position.x,
      startCommentY: comment.position.y,
      nodeEntries: nodesContainedIn(comment),
    });
    svgEl?.setPointerCapture(e.pointerId);
  };

  const handleCommentResizePointerDown = (e: PointerEvent, comment: BlueprintComment) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    props.onCommentSelect(comment.id);
    const start = screenToGraph(e.clientX, e.clientY);
    setInteraction({
      kind: 'comment-resize',
      pointerId: e.pointerId,
      commentId: comment.id,
      startGraphX: start.x,
      startGraphY: start.y,
      startWidth: comment.width,
      startHeight: comment.height,
    });
    svgEl?.setPointerCapture(e.pointerId);
  };

  const handleCommentDoubleClick = (e: MouseEvent, comment: BlueprintComment) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingText(comment.text);
    setEditingCommentId(comment.id);
  };

  // ─── Eye toggle ───

  const handleEyePointerDown = (e: PointerEvent) => {
    e.stopPropagation();
  };
  const handleEyeClick = (e: MouseEvent, nodeId: string) => {
    e.stopPropagation();
    props.onToggleNodeHidden(nodeId);
  };

  // ─── Derived state ───

  const visibleNodes = createMemo(() =>
    props.graph.nodes.filter((n) => !props.hiddenNodeIds.has(n.id)),
  );

  const isEdgeHidden = (edge: BlueprintEdge): boolean =>
    props.hiddenNodeIds.has(edge.source) || props.hiddenNodeIds.has(edge.target);

  const isNodeSelected = (nodeId: string): boolean =>
    props.selectedNodeIds.has(nodeId) || marqueeNodeIds().has(nodeId);

  const cursorClass = () => {
    const it = interaction();
    if (it?.kind === 'pan') return 'cursor-grabbing';
    if (it?.kind === 'connect' || it?.kind === 'box-select') return 'cursor-crosshair';
    return 'cursor-default';
  };

  /** Screen-space (container-relative) position of the comment's top-left. */
  const commentScreenPos = (comment: BlueprintComment): Position => {
    const v = view();
    return {
      x: comment.position.x * v.zoom + v.offsetX,
      y: comment.position.y * v.zoom + v.offsetY,
    };
  };

  // ─── Render ───

  return (
    <div class="relative w-full h-full" ref={(el) => { containerEl = el; }}>
      <svg
        ref={(el) => {
          svgEl = el;
        }}
        class={`block w-full h-full ${cursorClass()}`}
        style={{ 'touch-action': 'none', 'user-select': 'none' }}
        onPointerDown={handleBackgroundPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
      >
        <defs>
          <pattern
            id="bp-grid"
            x="0"
            y="0"
            width={GRID_SIZE}
            height={GRID_SIZE}
            patternUnits="userSpaceOnUse"
          >
            <circle cx="0" cy="0" r="1" fill="rgba(245,245,247,0.10)" />
          </pattern>
        </defs>
        <g
          transform={`translate(${view().offsetX}, ${view().offsetY}) scale(${view().zoom})`}
        >
          {/* Background grid (covers a large area in graph coords) */}
          <rect
            x={-GRID_EXTENT}
            y={-GRID_EXTENT}
            width={GRID_EXTENT * 2}
            height={GRID_EXTENT * 2}
            fill="url(#bp-grid)"
            pointer-events="none"
          />

          {/* UE-style comment boxes (behind edges and nodes) */}
          <For each={commentList()}>
            {(comment) => {
              const selected = props.selectedCommentId === comment.id;
              return (
                <g
                  onPointerDown={(e) => handleCommentPointerDown(e, comment)}
                  onDblClick={(e) => handleCommentDoubleClick(e, comment)}
                  style={{ cursor: 'move' }}
                >
                  <rect
                    width={comment.width}
                    height={comment.height}
                    rx={6}
                    fill={COMMENT_FILL}
                    stroke={selected ? '#60a5fa' : COMMENT_STROKE}
                    stroke-width={selected ? 2 : 1.2}
                  />
                  {/* Title bar */}
                  <path
                    d={`M 0,6 Q 0,0 6,0 H ${comment.width - 6} Q ${comment.width},0 ${comment.width},6 V ${COMMENT_HEADER_HEIGHT} H 0 Z`}
                    fill={COMMENT_HEADER_FILL}
                    pointer-events="none"
                  />
                  <text
                    x={10}
                    y={COMMENT_HEADER_HEIGHT / 2 + 4}
                    font-size="12"
                    font-weight="600"
                    fill="rgba(220, 245, 228, 0.9)"
                    pointer-events="none"
                  >
                    {comment.text}
                  </text>
                  {/* Bottom-right resize handle */}
                  <g
                    onPointerDown={(e) => handleCommentResizePointerDown(e, comment)}
                    style={{ cursor: 'nwse-resize' }}
                  >
                    <rect
                      x={comment.width - 16}
                      y={comment.height - 16}
                      width={16}
                      height={16}
                      fill="transparent"
                    />
                    <path
                      d={`M ${comment.width - 4},${comment.height - 12} L ${comment.width - 4},${comment.height - 4} L ${comment.width - 12},${comment.height - 4}`}
                      fill="none"
                      stroke={selected ? '#60a5fa' : COMMENT_STROKE}
                      stroke-width={2}
                      pointer-events="none"
                    />
                  </g>
                </g>
              );
            }}
          </For>

          {/* Edges (below nodes) */}
          <For each={props.graph.edges}>
            {(edge) => (
              <Show when={!isEdgeHidden(edge)}>
                {(() => {
                  const endpoints = getEdgeEndpoints(props.graph, edge);
                  if (!endpoints) return null;
                  const locked = isEdgeLocked(props.graph, edge);
                  const selected = props.selectedEdgeId === edge.id;
                  const d = bezierPath(endpoints.from, endpoints.to);
                  // Selected edges render with a brighter accent + thicker stroke.
                  const strokeColor = selected
                    ? 'rgba(96,165,250,0.95)'
                    : locked
                      ? 'rgba(245,158,11,0.85)'
                      : 'rgba(245,245,247,0.55)';
                  const strokeWidth = selected ? 2.5 : 1.5;
                  return (
                    <g>
                      <path
                        d={d}
                        fill="none"
                        stroke={strokeColor}
                        stroke-width={strokeWidth}
                        pointer-events="none"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        stroke-width={14}
                        stroke-linecap="round"
                        style={{
                          cursor: 'pointer',
                        }}
                        onPointerDown={(e) => handleEdgePointerDown(e, edge)}
                      />
                    </g>
                  );
                })()}
              </Show>
            )}
          </For>

          {/* Nodes */}
          <For each={visibleNodes()}>
            {(node) => {
              const layout = computeNodeLayout(node);
              const isSelected = isNodeSelected(node.id);
              const isHidden = props.hiddenNodeIds.has(node.id);
              return (
                <g
                  transform={`translate(${node.position.x}, ${node.position.y})`}
                  onPointerDown={(e) => handleNodePointerDown(e, node)}
                  style={{
                    cursor: layout.isLocked ? 'not-allowed' : 'move',
                  }}
                >
                  {/* Background rect */}
                  <rect
                    width={layout.width}
                    height={layout.height}
                    rx={8}
                    fill="rgba(11, 18, 27, 0.96)"
                    stroke={isSelected ? '#3A6D8C' : layout.accentColor}
                    stroke-width={isSelected ? 2.5 : 1.5}
                  />
                  {/* Header tint */}
                  <path
                    d={`M 0,8 Q 0,0 8,0 H ${layout.width - 8} Q ${layout.width},0 ${layout.width},8 V ${HEADER_HEIGHT} H 0 Z`}
                    fill={layout.accentColor}
                    opacity={0.32}
                    pointer-events="none"
                  />
                  {/* Execution order badge */}
                  <Show when={executionOrder().get(node.id)}>
                    {(order) => (
                      <g pointer-events="none">
                        <circle
                          cx={12}
                          cy={HEADER_HEIGHT / 2}
                          r={9}
                          fill={layout.accentColor}
                          stroke="white"
                          stroke-width={1}
                        />
                        <text
                          x={12}
                          y={HEADER_HEIGHT / 2 + 4}
                          font-size="10"
                          font-weight="700"
                          fill="white"
                          text-anchor="middle"
                        >
                          {order()}
                        </text>
                      </g>
                    )}
                  </Show>
                  {/* Title */}
                  <text
                    x={executionOrder().get(node.id) ? 28 : 12}
                    y={HEADER_HEIGHT / 2 + 4}
                    font-size="13"
                    font-weight="600"
                    fill="white"
                    pointer-events="none"
                  >
                    {layout.title}
                  </text>
                  {/* Subtitle (top-right of header, left of icons) */}
                  <Show when={layout.subtitle}>
                    <text
                      x={layout.width - 52}
                      y={HEADER_HEIGHT / 2 + 4}
                      font-size="10"
                      fill="rgba(255,255,255,0.65)"
                      text-anchor="end"
                      pointer-events="none"
                    >
                      {layout.subtitle}
                    </text>
                  </Show>
                  {/* Lock icon (only if locked) */}
                  <Show when={layout.isLocked}>
                    <g
                      transform={`translate(${layout.width - 42}, 9)`}
                      pointer-events="none"
                    >
                      <path
                        d="M 2,6 V 4 Q 2,1 5,1 Q 8,1 8,4 V 6"
                        fill="none"
                        stroke="rgba(245,158,11,0.95)"
                        stroke-width={1.2}
                      />
                      <rect
                        x={1}
                        y={6}
                        width={8}
                        height={6}
                        rx={1}
                        fill="rgba(245,158,11,0.95)"
                      />
                    </g>
                  </Show>
                  {/* Eye toggle (always visible) */}
                  <g
                    transform={`translate(${layout.width - 22}, 9)`}
                    onPointerDown={handleEyePointerDown}
                    onClick={(e: MouseEvent) => handleEyeClick(e, node.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    {/* Hit area */}
                    <rect
                      x={-4}
                      y={-4}
                      width={20}
                      height={20}
                      fill="transparent"
                    />
                    {/* Eye outline */}
                    <ellipse
                      cx={6}
                      cy={6}
                      rx={6}
                      ry={3.5}
                      fill="none"
                      stroke="rgba(255,255,255,0.75)"
                      stroke-width={1.2}
                    />
                    {/* Pupil */}
                    <circle
                      cx={6}
                      cy={6}
                      r={1.6}
                      fill="rgba(255,255,255,0.75)"
                    />
                    {/* Slash for hidden state */}
                    <Show when={isHidden}>
                      <line
                        x1={0}
                        y1={0}
                        x2={12}
                        y2={12}
                        stroke="rgba(239,68,68,0.95)"
                        stroke-width={1.6}
                        stroke-linecap="round"
                      />
                    </Show>
                  </g>
                  {/* Ports */}
                  <For each={layout.ports}>
                    {(port) => (
                      <g
                        data-node-id={node.id}
                        data-port={port.port}
                        data-port-direction={port.direction}
                        onPointerDown={
                          port.direction === 'output'
                            ? (e) => handleOutputPortPointerDown(e, node, port.port)
                            : undefined
                        }
                        style={{ cursor: port.direction === 'output' ? 'crosshair' : 'default' }}
                      >
                        <Show when={port.label}>
                          <text
                            x={port.direction === 'input' ? port.x + 10 : port.x - 10}
                            y={port.y + 3}
                            font-size="9"
                            fill="rgba(255,255,255,0.7)"
                            text-anchor={port.direction === 'input' ? 'start' : 'end'}
                            pointer-events="none"
                          >
                            {port.label}
                          </text>
                        </Show>
                        <PortShape port={port} accent={layout.accentColor} radius={PORT_RADIUS} />
                      </g>
                    )}
                  </For>
                </g>
              );
            }}
          </For>

          {/* Marquee selection rectangle */}
          <Show when={marquee()}>
            {(rect) => (
              <rect
                x={rect().x}
                y={rect().y}
                width={rect().width}
                height={rect().height}
                fill="rgba(58,109,140,0.15)"
                stroke="#60a5fa"
                stroke-width={1}
                stroke-dasharray="5 3"
                pointer-events="none"
              />
            )}
          </Show>

          {/* Temporary connecting line (above everything) */}
          <Show when={interaction()?.kind === 'connect' && connectMousePos()}>
            {(() => {
              const it = interaction();
              if (!it || it.kind !== 'connect') return null;
              const sourceNode = props.graph.nodes.find((n) => n.id === it.from.nodeId);
              if (!sourceNode) return null;
              const fromPos = getPortPosition(sourceNode, it.from.port);
              const toPos = connectMousePos();
              if (!fromPos || !toPos) return null;
              return (
                <path
                  d={bezierPath(fromPos, toPos)}
                  fill="none"
                  stroke="#3A6D8C"
                  stroke-width={2}
                  stroke-dasharray={CONNECT_DASH}
                  pointer-events="none"
                />
              );
            })()}
          </Show>
        </g>
      </svg>

      {/* Comment text editing overlay (HTML input over the SVG header) */}
      <Show when={editingCommentId()}>
        {(() => {
          const comment = commentList().find((c) => c.id === editingCommentId());
          if (!comment) return null;
          const pos = commentScreenPos(comment);
          return (
            <input
              type="text"
              value={editingText()}
              onInput={(e) => setEditingText(e.currentTarget.value)}
              onPointerDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') commitCommentEditing();
                if (e.key === 'Escape') cancelCommentEditing();
              }}
              onBlur={commitCommentEditing}
              autofocus
              class="absolute z-30 px-2 py-0.5 rounded-md bg-night-water/95 border border-accent text-mist-solid text-[12px] font-semibold outline-none"
              style={{
                left: `${pos.x}px`,
                top: `${pos.y + 3}px`,
                width: `${Math.max(120, Math.min(comment.width - 60, 260) * view().zoom)}px`,
              }}
            />
          );
        })()}
      </Show>

      {/* Right-click context menu: create node / comment at the clicked spot */}
      <Show when={contextMenu()}>
        {(menu) => (
          <div
            class="absolute z-40 w-64 max-h-[70%] overflow-y-auto rounded-xl border border-white/10 bg-night-water/95 backdrop-blur-xl shadow-2xl custom-scrollbar"
            style={{ left: `${Math.min(menu().screenX, 400)}px`, top: `${menu().screenY}px` }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div class="px-4 pt-3 pb-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-mist-solid/35">
              创建
            </div>
            <button
              type="button"
              class="w-full text-left px-4 py-2.5 hover:bg-white/5 transition-colors border-b border-white/5"
              onClick={() => {
                props.onAddCommentAt({ x: menu().graphX, y: menu().graphY });
                closeContextMenu();
              }}
            >
              <div class="text-sm font-bold text-emerald-300">注释框</div>
              <div class="text-[11px] text-mist-solid/45 mt-0.5 leading-5">
                UE 式注释框，拖动可携带框内节点
              </div>
            </button>
            <For each={SELECTABLE_NODE_TYPES}>
              {(type) => (
                <button
                  type="button"
                  class="w-full text-left px-4 py-2 hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
                  onClick={() => {
                    props.onCreateNodeAt(type, { x: menu().graphX, y: menu().graphY });
                    closeContextMenu();
                  }}
                >
                  <div class="text-sm font-bold text-mist-solid">{NODE_LABELS[type]}</div>
                </button>
              )}
            </For>
          </div>
        )}
      </Show>
    </div>
  );
};
