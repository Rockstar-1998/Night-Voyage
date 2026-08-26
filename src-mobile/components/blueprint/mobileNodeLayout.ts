/**
 * 移动端蓝图画布纯布局 / 校验辅助函数（Task 13.1）。
 *
 * 本文件与 PC 端 `src/components/blueprint/nodeLayout.ts` 独立实现，遵守 C5
 * 移动端前端独立性约束——不 import PC 端任何模块。函数签名与 PC 版保持一致
 * 以便两端行为对齐，但实现完全在 `src-mobile/` 内闭合。
 *
 * 与 `src/lib/blueprint/types.ts` 的 snake_case 字段命名约定保持一致（图 JSON
 * 存储格式），详见 types.ts 头部注释。
 *
 * 简化项（相对 PC 版）：
 * - 不含显隐切换相关 helper（移动端按 spec 省略该功能）
 * - 环路检测保留 DFS（保证图合法性，不可省略）
 */

import type {
  BlueprintEdge,
  BlueprintGraph,
  BlueprintNode,
  NodeType,
  Position,
} from '../../../src/lib/blueprint/types';

// ─── 布局常量（图坐标，与缩放无关）───
// 竖向蓝图：端口在上下边缘（输入顶部、输出底部），连线垂直走向（见 computeNodeLayout）。

export const NODE_WIDTH = 200;
export const HEADER_HEIGHT = 36;
/** 竖向布局下，单排端口（顶部/底部）占用的垂直高度。 */
export const PORT_ROW_HEIGHT = 22;
/** 竖向布局下，单排端口（顶部/底部）内相邻端口水平间距 */
export const PORT_COL_WIDTH = 28;
export const PORT_RADIUS = 7;
export const BEZIER_MIN_SPAN = 80;
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2.5;

/** 长按触发阈值（毫秒）——超过此时长未松手即进入拖拽/连线模式 */
export const LONG_PRESS_MS = 500;
/** 长按判定容忍的位移（像素）——超过此位移取消长按，视为平移 */
export const LONG_PRESS_MOVE_TOLERANCE = 10;

// ─── 视口变换 ───

export interface ViewTransform {
  offsetX: number;
  offsetY: number;
  zoom: number;
}

export interface ConnectingFrom {
  nodeId: string;
  port: string;
}

// ─── 端口布局 ───

export interface PortDescriptor {
  port: string;
  label: string | null;
}

export interface PortLayout {
  port: string;
  kind: 'input' | 'output';
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
  accentColor: string;
  isLocked: boolean;
}

// ─── 节点类型元数据 ───

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
      return `${node.config.options.length} 选项`;
    case 'mode_switch':
      return '3 分支';
    case 'role_switch':
      return '2 分支';
    case 'constant':
      return node.config.source;
    case 'branch':
      return `${node.config.cases.length} 规则`;
    case 'start':
    case 'end':
    case 'sampling_params':
      return null;
  }
}

export function computeNodeLayout(node: BlueprintNode): NodeLayout {
  const inputs = getInputPorts(node);
  const outputs = getOutputPorts(node);
  // 竖向布局：输入端口排顶部一行，输出端口排底部一行（按端口数水平均分）。
  const cols = Math.max(inputs.length, outputs.length, 1);
  const width = Math.max(NODE_WIDTH, cols * PORT_COL_WIDTH);
  const height = HEADER_HEIGHT + PORT_ROW_HEIGHT * 2;

  const ports: PortLayout[] = [];
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

// ─── 端口位置查询 ───

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

// ─── 贝塞尔路径 ───

export function bezierPath(from: Position, to: Position): string {
  const dy = Math.max(Math.abs(to.y - from.y), BEZIER_MIN_SPAN) / 2;
  const c1y = from.y + dy;
  const c2y = to.y - dy;
  return `M ${from.x},${from.y} C ${from.x},${c1y} ${to.x},${c2y} ${to.x},${to.y}`;
}

// ─── 环路检测（DFS）───

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

export function wouldCreateCycle(
  edges: ReadonlyArray<BlueprintEdge>,
  source: string,
  target: string,
): boolean {
  if (source === target) return true;
  return hasPath(edges, target, source);
}

// ─── 连线校验 ───

export type ConnectionRejectReason =
  | 'self_loop'
  | 'wrong_direction'
  | 'cycle'
  | 'duplicate';

export interface ConnectionValidationResult {
  ok: boolean;
  reason: ConnectionRejectReason | null;
}

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

// ─── 连线端点 ───

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
 * 拓扑分层自动布局：将节点按 BFS 深度分层，每列纵向排列。
 * 与 PC 端 nodeLayout.ts 同名函数行为对齐（C5 独立实现）。
 */
export function autoLayout(
  nodes: ReadonlyArray<BlueprintNode>,
  edges: ReadonlyArray<BlueprintEdge>,
): Map<string, Position> {
  // 竖向蓝图：拓扑深度对应 Y 轴（自上而下），同层节点横向铺开。
  const LAYER_HEIGHT = 200;
  const COL_SPACING = 240;
  const LAYER_VPAD = 20;
  const COL_VPAD = 20;

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
  for (const n of nodes) {
    if (!layers.has(n.id)) layers.set(n.id, 0);
  }

  const byLayer = new Map<number, string[]>();
  for (const [id, layer] of layers) {
    let list = byLayer.get(layer);
    if (!list) {
      list = [];
      byLayer.set(layer, list);
    }
    list.push(id);
  }

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

// ─── 缩放钳制 ───

export function clampZoom(zoom: number): number {
  if (zoom < MIN_ZOOM) return MIN_ZOOM;
  if (zoom > MAX_ZOOM) return MAX_ZOOM;
  return zoom;
}

// ─── 新节点工厂（移动端工具栏添加节点时使用）───

let mobileNodeIdCounter = 0;

function genNodeId(prefix: string): string {
  mobileNodeIdCounter += 1;
  return `n_m_${prefix}_${Date.now().toString(36)}_${mobileNodeIdCounter}`;
}

export function createNode(
  type: NodeType,
  position: Position,
): BlueprintNode {
  switch (type) {
    case 'start':
      return {
        id: genNodeId('start'),
        type: 'start',
        position,
        config: {},
      };
    case 'end':
      return {
        id: genNodeId('end'),
        type: 'end',
        position,
        config: {},
      };
    case 'prompt':
      return {
        id: genNodeId('prompt'),
        type: 'prompt',
        position,
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
        id: genNodeId('schema'),
        type: 'schema_field',
        position,
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
        },
      };
    case 'mutex_gate':
      return {
        id: genNodeId('mutex'),
        type: 'mutex_gate',
        position,
        config: {
          label: '互斥组',
          options: [
            { key: 'opt_a', label: '选项 A', description: '' },
            { key: 'opt_b', label: '选项 B', description: '' },
          ],
        },
      };
    case 'group_gate':
      return {
        id: genNodeId('group'),
        type: 'group_gate',
        position,
        config: {
          label: '多选组',
          options: [
            { key: 'opt_a', label: '选项 A', description: '' },
            { key: 'opt_b', label: '选项 B', description: '' },
          ],
        },
      };
    case 'mode_switch':
      return {
        id: genNodeId('mode'),
        type: 'mode_switch',
        position,
        config: { label: '记忆模式分支' },
      };
    case 'role_switch':
      return {
        id: genNodeId('role'),
        type: 'role_switch',
        position,
        config: { label: '角色模式分支' },
      };
    case 'constant':
      return {
        id: genNodeId('const'),
        type: 'constant',
        position,
        config: { label: '会话角色', source: 'conversation_type' },
      };
    case 'branch':
      return {
        id: genNodeId('branch'),
        type: 'branch',
        position,
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
        id: genNodeId('sampling'),
        type: 'sampling_params',
        position,
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
  }
}
