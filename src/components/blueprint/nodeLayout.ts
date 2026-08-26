/**
 * Pure layout / validation helpers for the blueprint canvas.
 *
 * All functions in this module are pure (no SolidJS, no side effects) so they
 * can be unit-tested in isolation and reused by the mobile canvas (Task 13)
 * without pulling in PC-only UI dependencies. This file deliberately mirrors
 * the snake_case field names of `src/lib/blueprint/types.ts` (graph storage
 * JSON convention) — see types.ts header comment for the naming rationale.
 */

import type {
  BlueprintEdge,
  BlueprintGraph,
  BlueprintNode,
  NodeType,
  Position,
} from '../../lib/blueprint/types';

// ─── Layout constants (graph coordinates, independent of zoom) ───
// 竖向蓝图：节点端口在上下边缘（输入在顶部、输出在底部），连线走向改为垂直。
// 因此原先的「宽度/行高」语义反转：「列宽」对应节点水平尺寸，「节点垂直跨度」
// 由端口堆叠决定，但竖向布局下端口改为左右排列（见 computeNodeLayout）。

export const NODE_WIDTH = 200;
export const HEADER_HEIGHT = 36;
/** 竖向布局下，单排端口（顶部/底部）占用的垂直高度。 */
export const PORT_ROW_HEIGHT = 22;
/** 竖向布局下，单排端口（顶部/底部）内相邻端口的水平间距。 */
export const PORT_COL_WIDTH = 28;
export const PORT_RADIUS = 6;
/** Minimum vertical distance used to compute vertical bezier control points. */
export const BEZIER_MIN_SPAN = 80;
/** Zoom clamp range. */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;

// ─── View transform ───

export interface ViewTransform {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface ConnectingFrom {
  nodeId: string;
  port: string;
}

// ─── Port layout ───

export interface PortDescriptor {
  port: string;
  label: string | null;
}

export interface PortLayout {
  port: string;
  kind: 'input' | 'output';
  /** Position relative to the node's top-left corner (graph units). */
  x: number;
  y: number;
  label: string | null;
}

export interface NodeLayout {
  width: number;
  height: number;
  title: string;
  subtitle: string | null;
  ports: PortLayout[];
  /** Hex color string used for the node accent (border + header bar). */
  accentColor: string;
  /** True if the node's content/edges are locked (is_locked flag). */
  isLocked: boolean;
}

// ─── Node type metadata ───

const NODE_ACCENT_COLORS: Record<NodeType, string> = {
  start: '#10b981',
  end: '#ef4444',
  prompt: '#3b82f6',
  schema_field: '#a855f7',
  mutex_gate: '#f97316',
  group_gate: '#eab308',
  mode_switch: '#06b6d4',
  role_switch: '#8b5cf6',
  sampling_params: '#6b7280',
  constant: '#14b8a6',
  branch: '#d946ef',
};

/**
 * Returns the output port descriptors for a node, in display order.
 * Single-output nodes return a single `out` port; Gate/ModeSwitch nodes
 * return one port per option/branch.
 */
export function getOutputPorts(node: BlueprintNode): PortDescriptor[] {
  switch (node.type) {
    case 'start':
      return [{ port: 'out', label: null }];
    case 'end':
      return [];
    case 'prompt':
      return [{ port: 'out', label: null }];
    case 'schema_field':
      return [{ port: 'out', label: null }];
    case 'mutex_gate':
      return node.config.options.map((opt) => ({
        port: `out_${opt.key}`,
        label: opt.label,
      }));
    case 'group_gate':
      return node.config.options.map((opt) => ({
        port: `out_${opt.key}`,
        label: opt.label,
      }));
    case 'mode_switch':
      return [
        { port: 'out_legacy', label: 'Legacy' },
        { port: 'out_mem0', label: 'MEM0' },
        { port: 'out_stateless', label: 'Stateless' },
      ];
    case 'role_switch':
      return [
        { port: 'out_single', label: '单人' },
        { port: 'out_online', label: '多人' },
      ];
    case 'constant':
      return [{ port: 'out', label: null }];
    case 'branch':
      // 每个 case 的 port + default_port
      return [
        ...node.config.cases.map((c) => ({
          port: c.port,
          label: c.match_value,
        })),
        { port: node.config.default_port, label: '默认' },
      ];
    case 'sampling_params':
      return [{ port: 'out', label: null }];
  }
}

/**
 * Returns the input port descriptors for a node. Start has no input;
 * all other node types have exactly one `in` port.
 */
export function getInputPorts(node: BlueprintNode): PortDescriptor[] {
  switch (node.type) {
    case 'start':
      return [];
    case 'end':
    case 'prompt':
    case 'schema_field':
    case 'mutex_gate':
    case 'group_gate':
    case 'mode_switch':
    case 'role_switch':
    case 'constant':
    case 'branch':
    case 'sampling_params':
      return [{ port: 'in', label: null }];
  }
}

/**
 * Returns true if the node's `is_locked` flag is set. Only Prompt,
 * SchemaField, and SamplingParams nodes can be locked (per spec).
 */
export function isNodeLocked(node: BlueprintNode): boolean {
  switch (node.type) {
    case 'prompt':
      return node.config.is_locked;
    case 'schema_field':
      return node.config.is_locked;
    case 'sampling_params':
      return node.config.is_locked;
    case 'start':
    case 'end':
    case 'mutex_gate':
    case 'group_gate':
    case 'mode_switch':
    case 'role_switch':
    case 'constant':
    case 'branch':
      return false;
  }
}

function computeNodeTitle(node: BlueprintNode): string {
  switch (node.type) {
    case 'start':
      return 'Start';
    case 'end':
      return 'End';
    case 'prompt':
      return node.config.identifier || 'Prompt';
    case 'schema_field':
      return node.config.field_name || 'Schema Field';
    case 'mutex_gate':
      return node.config.label || 'Mutex Gate';
    case 'group_gate':
      return node.config.label || 'Group Gate';
    case 'mode_switch':
      return node.config.label || 'Mode Switch';
    case 'role_switch':
      return node.config.label || 'Role Switch';
    case 'constant':
      return node.config.label || 'Constant';
    case 'branch':
      return node.config.label || 'Branch';
    case 'sampling_params':
      return 'Sampling Params';
  }
}

function computeNodeSubtitle(node: BlueprintNode): string | null {
  switch (node.type) {
    case 'prompt':
      return node.config.block_type;
    case 'schema_field':
      return node.config.field_type;
    case 'mutex_gate':
    case 'group_gate':
      return `${node.config.options.length} options`;
    case 'mode_switch':
      return '3 branches';
    case 'role_switch':
      return '2 branches';
    case 'constant':
      return node.config.source;
    case 'branch':
      return `${node.config.cases.length} cases`;
    case 'start':
    case 'end':
    case 'sampling_params':
      return null;
  }
}

/**
 * Compute the full layout for a node: size, title, port positions.
 * Layout is purely a function of the node's config and is deterministic.
 */
export function computeNodeLayout(node: BlueprintNode): NodeLayout {
  const inputs = getInputPorts(node);
  const outputs = getOutputPorts(node);
  // 竖向布局：输入端口排顶部一行，输出端口排底部一行（按端口数水平均分）。
  // 节点宽度需容纳最多的一排端口（每端口 PORT_COL_WIDTH），至少 NODE_WIDTH。
  const cols = Math.max(inputs.length, outputs.length, 1);
  const contentWidth = Math.max(NODE_WIDTH, cols * PORT_COL_WIDTH);
  const width = contentWidth;
  const height = HEADER_HEIGHT + PORT_ROW_HEIGHT * 2;

  const ports: PortLayout[] = [];
  // 输入端口：顶部边缘（y=0），水平居中均分
  for (let i = 0; i < inputs.length; i++) {
    const x = width / 2 + (i - (inputs.length - 1) / 2) * PORT_COL_WIDTH;
    ports.push({
      port: inputs[i].port,
      kind: 'input' as const,
      x,
      y: 0,
      label: inputs[i].label,
    });
  }
  // 输出端口：底部边缘（y=height），水平居中均分
  for (let i = 0; i < outputs.length; i++) {
    const x = width / 2 + (i - (outputs.length - 1) / 2) * PORT_COL_WIDTH;
    ports.push({
      port: outputs[i].port,
      kind: 'output' as const,
      x,
      y: height,
      label: outputs[i].label,
    });
  }

  return {
    width,
    height,
    title: computeNodeTitle(node),
    subtitle: computeNodeSubtitle(node),
    ports,
    accentColor: NODE_ACCENT_COLORS[node.type],
    isLocked: isNodeLocked(node),
  };
}

// ─── Port position lookup ───

/**
 * Returns the absolute (graph) position of a node's port, or null if the
 * node/port combination is invalid.
 */
export function getPortPosition(
  node: BlueprintNode,
  port: string,
): Position | null {
  const layout = computeNodeLayout(node);
  const p = layout.ports.find((it) => it.port === port);
  if (!p) return null;
  return {
    x: node.position.x + p.x,
    y: node.position.y + p.y,
  };
}

// ─── Bezier path ───

/**
 * Compute a smooth cubic-bezier path between two points for a vertical
 * blueprint. Control points are offset vertically (since output ports sit at
 * the node bottom and input ports at the top), producing a vertical "node
 * graph" curve; the offset is clamped to `BEZIER_MIN_SPAN / 2`.
 */
export function bezierPath(from: Position, to: Position): string {
  const dy = Math.max(Math.abs(to.y - from.y), BEZIER_MIN_SPAN) / 2;
  const c1y = from.y + dy;
  const c2y = to.y - dy;
  return `M ${from.x},${from.y} C ${from.x},${c1y} ${to.x},${c2y} ${to.x},${to.y}`;
}

// ─── Execution order (render-only topological order) ───

/**
 * Compute a deterministic execution-order index for each node in the graph.
 *
 * Rules:
 * - Start from the `start` node if one exists; otherwise start from every
 *   node with no incoming edges.
 * - Walk the graph in BFS along output → input edges so downstream nodes are
 *   numbered after their dependencies.
 * - Branching gates/switches naturally get consecutive numbers following their
 *   parent.
 * - Nodes unreachable from the start (or from any source) are not assigned an
 *   order and will not display a label.
 *
 * This is a render-only helper: the real backend executor decides the actual
 * runtime order. The returned numbers are only for visual orientation.
 */
export function computeExecutionOrder(
  graph: BlueprintGraph,
): Map<string, number> {
  const incoming = new Map<string, Set<string>>();
  const outgoing = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    let outs = outgoing.get(e.source);
    if (!outs) {
      outs = new Set<string>();
      outgoing.set(e.source, outs);
    }
    outs.add(e.target);
    let ins = incoming.get(e.target);
    if (!ins) {
      ins = new Set<string>();
      incoming.set(e.target, ins);
    }
    ins.add(e.source);
  }

  const startNode = graph.nodes.find((n) => n.type === 'start');
  const queue: string[] = [];
  if (startNode) {
    queue.push(startNode.id);
  } else {
    for (const n of graph.nodes) {
      if (!incoming.has(n.id) || incoming.get(n.id)!.size === 0) {
        queue.push(n.id);
      }
    }
  }

  const order = new Map<string, number>();
  let next = 1;
  const visited = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.set(id, next++);
    const targets = outgoing.get(id);
    if (targets) {
      for (const t of targets) {
        if (!visited.has(t)) queue.push(t);
      }
    }
  }
  return order;
}

// ─── Cycle detection (DFS) ───

/**
 * Build an adjacency map from edges. Multiple edges between the same pair of
 * nodes are collapsed into a single entry (we only care about reachability).
 */
function buildAdjacency(
  edges: ReadonlyArray<BlueprintEdge>,
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    let targets = adj.get(e.source);
    if (!targets) {
      targets = new Set<string>();
      adj.set(e.source, targets);
    }
    targets.add(e.target);
  }
  return adj;
}

/**
 * Returns true if there is a directed path from `from` to `to` along
 * outgoing edges. Iterative DFS to avoid stack overflow on deep graphs.
 */
export function hasPath(
  edges: ReadonlyArray<BlueprintEdge>,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const adj = buildAdjacency(edges);
  const visited = new Set<string>();
  const stack: string[] = [from];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === to) return true;
    if (visited.has(node)) continue;
    visited.add(node);
    const targets = adj.get(node);
    if (targets) {
      for (const t of targets) {
        if (!visited.has(t)) stack.push(t);
      }
    }
  }
  return false;
}

/**
 * Returns true if adding an edge source→target would create a cycle.
 * A cycle is created iff there is already a path from target back to source.
 */
export function wouldCreateCycle(
  edges: ReadonlyArray<BlueprintEdge>,
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  return hasPath(edges, target, source);
}

// ─── Connection validation ───

export type ConnectionRejectReason =
  | 'self_loop'
  | 'wrong_direction'
  | 'cycle'
  | 'duplicate';

export interface ConnectionValidationResult {
  ok: boolean;
  reason: ConnectionRejectReason | null;
}

/**
 * Validate a proposed edge. Returns ok=true if the edge may be created.
 *
 * Rules (per spec):
 * - Direction: source must be an output port, target must be an input port.
 * - Self-loops are forbidden.
 * - Cycles are forbidden (DFS check).
 * - Duplicate edges (same source/port + target/port) are forbidden.
 * - Locked nodes cannot be a connection source or target (SubTask 8.5).
 *
 * Note: per spec, an input port MAY accept multiple incoming edges (used as
 * a merge point for Gate/ModeSwitch branches). We therefore do NOT reject
 * based on existing input-port occupancy — only exact duplicates are rejected.
 */
export function validateConnection(
  graph: BlueprintGraph,
  sourceNode: BlueprintNode,
  sourcePort: string,
  targetNode: BlueprintNode,
  targetPort: string,
): ConnectionValidationResult {
  const sourceOutputs = getOutputPorts(sourceNode).map((p) => p.port);
  const targetInputs = getInputPorts(targetNode).map((p) => p.port);
  if (!sourceOutputs.includes(sourcePort)) {
    return { ok: false, reason: 'wrong_direction' };
  }
  if (!targetInputs.includes(targetPort)) {
    return { ok: false, reason: 'wrong_direction' };
  }
  if (sourceNode.id === targetNode.id) {
    return { ok: false, reason: 'self_loop' };
  }
  // is_locked only restricts content editing, not topology. Locked nodes
  // can still be connection sources/targets.
  const dup = graph.edges.some(
    (e) =>
      e.source === sourceNode.id &&
      e.source_port === sourcePort &&
      e.target === targetNode.id &&
      e.target_port === targetPort,
  );
  if (dup) {
    return { ok: false, reason: 'duplicate' };
  }
  if (wouldCreateCycle(graph.edges, sourceNode.id, targetNode.id)) {
    return { ok: false, reason: 'cycle' };
  }
  return { ok: true, reason: null };
}

export const CONNECTION_REJECT_MESSAGES: Record<ConnectionRejectReason, string> = {
  self_loop: '禁止自连：起点和终点不能是同一节点',
  wrong_direction: '方向错误：连线必须从 output 端口指向 input 端口',
  cycle: '禁止环路：该连线会形成环',
  duplicate: '连线已存在：相同起终点的连线已经画过',
};

// ─── Edge endpoint helpers ───

/**
 * Returns the source and target positions for an edge, or null if either
 * endpoint cannot be resolved (e.g., the node was deleted).
 */
export function getEdgeEndpoints(
  graph: BlueprintGraph,
  edge: BlueprintEdge,
): { from: Position; to: Position; sourceNode: BlueprintNode; targetNode: BlueprintNode } | null {
  const sourceNode = graph.nodes.find((n) => n.id === edge.source);
  const targetNode = graph.nodes.find((n) => n.id === edge.target);
  if (!sourceNode || !targetNode) return null;
  const from = getPortPosition(sourceNode, edge.source_port);
  const to = getPortPosition(targetNode, edge.target_port);
  if (!from || !to) return null;
  return { from, to, sourceNode, targetNode };
}

/**
 * Returns true if either endpoint of the edge is a locked node. Such edges
 * cannot be deleted via the canvas (SubTask 8.5).
 */
export function isEdgeLocked(
  graph: BlueprintGraph,
  edge: BlueprintEdge,
): boolean {
  const sourceNode = graph.nodes.find((n) => n.id === edge.source);
  const targetNode = graph.nodes.find((n) => n.id === edge.target);
  if (!sourceNode || !targetNode) return false;
  return isNodeLocked(sourceNode) || isNodeLocked(targetNode);
}

// ─── Auto layout ───

/**
 * Auto-arrange nodes into a layered layout (topological sort) for a vertical
 * blueprint.
 *
 * Topological depth becomes the Y axis (top → bottom): layer 0 sits at the top,
 * deeper layers stack downward. Within a layer, nodes are spread horizontally
 * along X. Merge nodes (multiple incoming edges) naturally land after all
 * their parents. This mirrors the pre-vertical behaviour but swaps the axes so
 * the dominant flow direction is downward.
 *
 * @param nodes  Blueprint nodes (order preserved)
 * @param edges  Blueprint edges
 * @returns      Map from node ID to new position
 */
export function autoLayout(
  nodes: ReadonlyArray<BlueprintNode>,
  edges: ReadonlyArray<BlueprintEdge>,
): Map<string, Position> {
  // ── Layout constants ──
  const LAYER_HEIGHT = 200;  // vertical span per topological layer (node + gap)
  const COL_SPACING = 240;   // horizontal spacing between nodes in same layer
  const LAYER_VPAD = 20;     // breathing room at the top
  const COL_VPAD = 20;       // breathing room at the left

  // ── 1. Build adjacency structures ──
  const inDegree = new Map<string, number>();
  const outEdges = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    outEdges.set(n.id, []);
  }
  for (const e of edges) {
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
    const list = outEdges.get(e.source);
    if (list) list.push(e.target);
  }

  // ── 2. BFS topological layering ──
  // layer[start] = 0; layer[node] = max(parent layers) + 1
  const layers = new Map<string, number>();
  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      layers.set(n.id, 0);
      queue.push(n.id);
    }
  }
  while (queue.length > 0) {
    const id = queue.shift()!;
    const layer = layers.get(id)!;
    for (const target of outEdges.get(id) ?? []) {
      const newLayer = layer + 1;
      const existing = layers.get(target);
      if (existing === undefined || newLayer > existing) {
        layers.set(target, newLayer);
      }
      const remaining = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, remaining);
      if (remaining <= 0) {
        queue.push(target);
      }
    }
  }
  // Fallback for unreachable nodes (cycles, orphans)
  for (const n of nodes) {
    if (!layers.has(n.id)) layers.set(n.id, 0);
  }

  // ── 3. Group by layer ──
  const byLayer = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    let list = byLayer.get(layer);
    if (!list) {
      list = [];
      byLayer.set(layer, list);
    }
    list.push(id);
  }

  // ── 4. Assign positions ──
  const positions = new Map<string, Position>();
  for (const [layer, ids] of byLayer) {
    ids.forEach((id, i) => {
      positions.set(id, {
        x: Math.round(COL_VPAD + i * (COL_SPACING + LAYER_VPAD)),
        y: Math.round(LAYER_VPAD + layer * LAYER_HEIGHT),
      });
    });
  }
  return positions;
}

// ─── Zoom clamp ───

/** Clamp a zoom factor to the supported range. */
export function clampZoom(zoom: number): number {
  if (zoom < MIN_ZOOM) return MIN_ZOOM;
  if (zoom > MAX_ZOOM) return MAX_ZOOM;
  return zoom;
}
