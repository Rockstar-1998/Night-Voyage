/**
 * 移动端蓝图画布（Task 13.1 / 13.3）。
 *
 * 基于 SVG 的节点图画布，针对触摸交互优化：
 * - 单指拖空白：平移画布
 * - 单指拖节点：长按 500ms 后进入拖拽模式（避免误触）
 * - 单指长按 output 端口：进入连线模式，拖到 input 端口松开完成连线
 * - 双指捏合：缩放（双指距离变化）+ 平移（双指中点变化）
 * - 单击节点：选中（打开底部配置抽屉）
 * - 单击连线：删除（锁定节点的连线不可删）
 *
 * 与 PC 端 `src/components/blueprint/BlueprintCanvas.tsx` 独立实现（C5）：
 * - 不 import PC 端 BlueprintCanvas / nodeLayout
 * - 仅通过相对路径引用 `src/lib/blueprint/types.ts`（spec 共享层）
 * - 布局/校验函数使用同目录的 `mobileNodeLayout.ts`
 *
 * 交互状态机（interaction）：
 * - idle：无指针
 * - pending_node：指针落在节点上，等待长按判定或位移判定
 * - pending_port：指针落在 output 端口上，等待长按判定
 * - pan：单指平移
 * - node_drag：长按触发后的节点拖拽
 * - connect：长按端口触发后的连线绘制
 * - pinch：双指捏合
 *
 * 约束：
 * - C3 响应性：节点位置通过 SVG `transform` 应用（合成器友好）；<For> 按
 *   引用 key 节点，单节点移动只 patch 该节点的 transform。
 * - C5 移动端独立：本文件仅在 src-mobile/ 内闭合。
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
  BlueprintEdge,
  BlueprintGraph,
  BlueprintNode,
  Position,
} from '../../../src/lib/blueprint/types';
import {
  bezierPath,
  clampZoom,
  computeExecutionOrder,
  computeNodeLayout,
  CONNECTION_REJECT_MESSAGES,
  ConnectingFrom,
  getEdgeEndpoints,
  getPortPosition,
  HEADER_HEIGHT,
  isEdgeLocked,
  isNodeLocked,
  LONG_PRESS_MS,
  LONG_PRESS_MOVE_TOLERANCE,
  MAX_ZOOM,
  MIN_ZOOM,
  PORT_RADIUS,
  PortLayout,
  validateConnection,
  ViewTransform,
} from './mobileNodeLayout';
import { showToast } from '../Toast';

// ─── 引脚图形（UE 式：exec 三角 / value 圆 / bool 菱形）───

interface PortShapeProps {
  port: PortLayout;
  accent: string;
  radius: number;
}

/**
 * UE 式引脚图形。命中判定与 data 属性由外层 `<g>` 承载，本组件只画形状。
 * 与 PC 端 `BlueprintCanvas` 的 PortShape 独立实现（C5）。
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

// ─── Props ───

export interface MobileBlueprintCanvasProps {
  graph: BlueprintGraph;
  viewTransform: ViewTransform;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string | null) => void;
  onNodeMove: (nodeId: string, position: Position) => void;
  onEdgeCreate: (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
  ) => void;
  onEdgeDelete: (edgeId: string) => void;
  onGraphPan: (offset: Position) => void;
  onGraphZoom: (zoom: number) => void;
}

// ─── 交互状态 ───

type InteractionState =
  | { kind: 'idle' }
  | {
      kind: 'pending_node';
      pointerId: number;
      nodeId: string;
      startX: number;
      startY: number;
      startClientX: number;
      startClientY: number;
      timer: number;
    }
  | {
      kind: 'pending_port';
      pointerId: number;
      from: ConnectingFrom;
      startClientX: number;
      startClientY: number;
      timer: number;
    }
  | {
      kind: 'pan';
      pointerId: number;
      startClientX: number;
      startClientY: number;
      startOffsetX: number;
      startOffsetY: number;
    }
  | {
      kind: 'node_drag';
      pointerId: number;
      nodeId: string;
      startClientX: number;
      startClientY: number;
      startNodeX: number;
      startNodeY: number;
    }
  | {
      kind: 'connect';
      pointerId: number;
      from: ConnectingFrom;
    }
  | {
      kind: 'pinch';
      pointerAId: number;
      pointerBId: number;
      startDistance: number;
      startMidX: number;
      startMidY: number;
      startZoom: number;
      startOffsetX: number;
      startOffsetY: number;
      /** 上次中点屏幕坐标，用于增量平移 */
      lastMidX: number;
      lastMidY: number;
    };

// ─── 常量 ───

const GRID_SIZE = 40;
const GRID_EXTENT = 5000;
const CONNECT_DASH = '6 4';

// ─── Component ───

export const MobileBlueprintCanvas: Component<MobileBlueprintCanvasProps> = (props) => {
  let svgEl: SVGSVGElement | undefined;
  const [interaction, setInteraction] = createSignal<InteractionState>({ kind: 'idle' });
  const [connectCursorPos, setConnectCursorPos] = createSignal<Position | null>(null);
  /** 当前是否处于连线模式（用于 UI 提示） */
  const [isConnecting, setIsConnecting] = createSignal(false);

  const view = () => props.viewTransform;

  /** 当前蓝图的渲染用执行顺序。 */
  const executionOrder = createMemo(() => computeExecutionOrder(props.graph));

  // ─── 坐标转换 ───

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

  // ─── 长按计时器清理 ───

  const clearPendingTimers = (state: InteractionState): void => {
    if (state.kind === 'pending_node') {
      window.clearTimeout(state.timer);
    } else if (state.kind === 'pending_port') {
      window.clearTimeout(state.timer);
    }
  };

  onCleanup(() => {
    clearPendingTimers(interaction());
  });

  // ─── 指针落下：背景 / 节点 / 端点 ───

  const handleBackgroundPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    // 取消任何 pending 长按
    const prev = interaction();
    if (prev.kind === 'pending_node' || prev.kind === 'pending_port') {
      clearPendingTimers(prev);
    }

    // 若已有一指在捏合，第二指由全局 pointerdown 处理
    if (prev.kind === 'pan' || prev.kind === 'node_drag' || prev.kind === 'connect') {
      // 第一指仍在交互中，忽略背景的第二个 pointerdown（让全局处理器接管捏合）
      return;
    }

    props.onNodeSelect(null);
    setInteraction({
      kind: 'pan',
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: view().offsetX,
      startOffsetY: view().offsetY,
    });
    try {
      svgEl?.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture 在某些移动浏览器对多点触控可能抛错，忽略不致命
    }
  };

  const handleNodePointerDown = (e: PointerEvent, node: BlueprintNode) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const prev = interaction();
    if (prev.kind === 'pending_node' || prev.kind === 'pending_port') {
      clearPendingTimers(prev);
    }

    // 已有交互中（如平移）：交给全局处理器判断是否进入捏合
    if (prev.kind === 'pan' || prev.kind === 'node_drag' || prev.kind === 'connect') {
      return;
    }

    const timer = window.setTimeout(() => {
      // 长按触发：进入节点拖拽模式
      const cur = interaction();
      if (cur.kind === 'pending_node' && cur.pointerId === e.pointerId) {
        if (isNodeLocked(node)) {
          showToast('节点已锁定，不能拖拽', 'warning');
          setInteraction({ kind: 'idle' });
  
          return;
        }
        setInteraction({
          kind: 'node_drag',
          pointerId: e.pointerId,
          nodeId: node.id,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startNodeX: node.position.x,
          startNodeY: node.position.y,
        });

        // 触感反馈（支持的设备）
        if (navigator.vibrate) navigator.vibrate(15);
      }
    }, LONG_PRESS_MS);

    setInteraction({
      kind: 'pending_node',
      pointerId: e.pointerId,
      nodeId: node.id,
      startX: node.position.x,
      startY: node.position.y,
      startClientX: e.clientX,
      startClientY: e.clientY,
      timer,
    });
    try {
      svgEl?.setPointerCapture(e.pointerId);
    } catch {
      // 忽略多点触控捕获异常
    }
  };

  const handleOutputPortPointerDown = (
    e: PointerEvent,
    node: BlueprintNode,
    port: string,
  ) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const prev = interaction();
    if (prev.kind === 'pending_node' || prev.kind === 'pending_port') {
      clearPendingTimers(prev);
    }
    if (prev.kind === 'pan' || prev.kind === 'node_drag' || prev.kind === 'connect') {
      return;
    }

    // is_locked 只限制内容编辑，不限制连线（与 PC 端 nodeLayout 保持一致）。

    const timer = window.setTimeout(() => {
      const cur = interaction();
      if (cur.kind === 'pending_port' && cur.pointerId === e.pointerId) {
        // 长按触发：进入连线模式
        setInteraction({
          kind: 'connect',
          pointerId: e.pointerId,
          from: { nodeId: node.id, port },
        });
        setConnectCursorPos(screenToGraph(e.clientX, e.clientY));
        setIsConnecting(true);

        if (navigator.vibrate) navigator.vibrate(15);
      }
    }, LONG_PRESS_MS);

    setInteraction({
      kind: 'pending_port',
      pointerId: e.pointerId,
      from: { nodeId: node.id, port },
      startClientX: e.clientX,
      startClientY: e.clientY,
      timer,
    });
    try {
      svgEl?.setPointerCapture(e.pointerId);
    } catch {
      // 忽略多点触控捕获异常
    }
  };

  // ─── 指针移动（统一）───

  const handlePointerMove = (e: PointerEvent) => {
    const it = interaction();

    if (it.kind === 'pan') {
      if (e.pointerId !== it.pointerId) {
        // 第二个指针出现，交给 handlePointerDownGlobal 处理捏合
        return;
      }
      const dx = e.clientX - it.startClientX;
      const dy = e.clientY - it.startClientY;
      props.onGraphPan({
        x: it.startOffsetX + dx,
        y: it.startOffsetY + dy,
      });
      return;
    }

    if (it.kind === 'node_drag') {
      if (e.pointerId !== it.pointerId) return;
      const v = view();
      const dx = (e.clientX - it.startClientX) / v.zoom;
      const dy = (e.clientY - it.startClientY) / v.zoom;
      props.onNodeMove(it.nodeId, {
        x: it.startNodeX + dx,
        y: it.startNodeY + dy,
      });
      return;
    }

    if (it.kind === 'connect') {
      if (e.pointerId !== it.pointerId) return;
      setConnectCursorPos(screenToGraph(e.clientX, e.clientY));
      return;
    }

    if (it.kind === 'pinch') {
      handlePinchMove(e);
      return;
    }

    if (it.kind === 'pending_node' && e.pointerId === it.pointerId) {
      const dx = e.clientX - it.startClientX;
      const dy = e.clientY - it.startClientY;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) {
        // 位移超过容忍：取消长按，转为平移
        window.clearTimeout(it.timer);

        props.onNodeSelect(null);
        setInteraction({
          kind: 'pan',
          pointerId: it.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startOffsetX: view().offsetX,
          startOffsetY: view().offsetY,
        });
      }
      return;
    }

    if (it.kind === 'pending_port' && e.pointerId === it.pointerId) {
      const dx = e.clientX - it.startClientX;
      const dy = e.clientY - it.startClientY;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE) {
        window.clearTimeout(it.timer);

        setInteraction({
          kind: 'pan',
          pointerId: it.pointerId,
          startClientX: e.clientX,
          startClientY: e.clientY,
          startOffsetX: view().offsetX,
          startOffsetY: view().offsetY,
        });
      }
      return;
    }
  };

  // ─── 指针抬起（统一）───

  const handlePointerUp = (e: PointerEvent) => {
    const it = interaction();

    if (it.kind === 'pending_node' && it.pointerId === e.pointerId) {
      // 长按未触发即松手：视为点击 → 选中节点
      window.clearTimeout(it.timer);

      props.onNodeSelect(it.nodeId);
      setInteraction({ kind: 'idle' });
      try {
        svgEl?.releasePointerCapture(e.pointerId);
      } catch {
        // 忽略
      }
      return;
    }

    if (it.kind === 'pending_port' && it.pointerId === e.pointerId) {
      window.clearTimeout(it.timer);

      // 长按未触发即松手：选中端口所属节点
      props.onNodeSelect(it.from.nodeId);
      setInteraction({ kind: 'idle' });
      try {
        svgEl?.releasePointerCapture(e.pointerId);
      } catch {
        // 忽略
      }
      return;
    }

    if (it.kind === 'pan' && it.pointerId === e.pointerId) {
      setInteraction({ kind: 'idle' });
      try {
        svgEl?.releasePointerCapture(e.pointerId);
      } catch {
        // 忽略
      }
      return;
    }

    if (it.kind === 'node_drag' && it.pointerId === e.pointerId) {
      setInteraction({ kind: 'idle' });
      try {
        svgEl?.releasePointerCapture(e.pointerId);
      } catch {
        // 忽略
      }
      return;
    }

    if (it.kind === 'connect' && it.pointerId === e.pointerId) {
      completeConnection(e.clientX, e.clientY, it.from);
      setConnectCursorPos(null);
      setIsConnecting(false);
      setInteraction({ kind: 'idle' });
      try {
        svgEl?.releasePointerCapture(e.pointerId);
      } catch {
        // 忽略
      }
      return;
    }

    if (it.kind === 'pinch' &&
        (e.pointerId === it.pointerAId || e.pointerId === it.pointerBId)) {
      // 一指松开：若另一指仍在，转为单指平移
      const remainingId = e.pointerId === it.pointerAId ? it.pointerBId : it.pointerAId;
      try {
        svgEl?.releasePointerCapture(e.pointerId);
      } catch {
        // 忽略
      }
      // 用最后已知的 pointer 位置作为平移起点（取 pointerup 事件位置）
      setInteraction({
        kind: 'pan',
        pointerId: remainingId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startOffsetX: view().offsetX,
        startOffsetY: view().offsetY,
      });
      return;
    }
  };

  const handlePointerCancel = (e: PointerEvent) => {
    const it = interaction();
    if (it.kind === 'pending_node' || it.kind === 'pending_port') {
      clearPendingTimers(it);

    }
    setInteraction({ kind: 'idle' });
    setConnectCursorPos(null);
    setIsConnecting(false);
    try {
      svgEl?.releasePointerCapture(e.pointerId);
    } catch {
      // 忽略
    }
  };

  // ─── 第二指落下：进入捏合 ───

  const handlePointerDownGlobal = (e: PointerEvent) => {
    const it = interaction();
    // 只有单指交互时才考虑捏合
    if (it.kind === 'idle' || it.kind === 'pinch') return;

    // pending 状态下第二指出现：取消长按等待，进入捏合
    if (it.kind === 'pending_node' || it.kind === 'pending_port') {
      clearPendingTimers(it);
    }

    const firstPointerId = it.kind === 'pan' || it.kind === 'node_drag' || it.kind === 'connect' || it.kind === 'pending_node' || it.kind === 'pending_port'
      ? it.pointerId
      : null;
    if (firstPointerId === null || firstPointerId === e.pointerId) return;

    // 从指针缓存获取第一指位置（捕获阶段 onCapturePointerMove 持续更新）
    const aPos = pointerCache.get(firstPointerId);
    const bPos = { x: e.clientX, y: e.clientY };
    if (!aPos) {
      return;
    }
    const dist = Math.hypot(bPos.x - aPos.x, bPos.y - aPos.y);
    const midX = (aPos.x + bPos.x) / 2;
    const midY = (aPos.y + bPos.y) / 2;
    const v = view();

    // 取消当前交互，进入捏合
    setInteraction({
      kind: 'pinch',
      pointerAId: firstPointerId,
      pointerBId: e.pointerId,
      startDistance: dist,
      startMidX: midX,
      startMidY: midY,
      startZoom: v.zoom,
      startOffsetX: v.offsetX,
      startOffsetY: v.offsetY,
      lastMidX: midX,
      lastMidY: midY,
    });
    try {
      svgEl?.setPointerCapture(e.pointerId);
    } catch {
      // 忽略
    }
  };

  const handlePinchMove = (e: PointerEvent) => {
    const it = interaction();
    if (it.kind !== 'pinch') return;
    if (e.pointerId !== it.pointerAId && e.pointerId !== it.pointerBId) return;

    // 需要两指的最新位置；PointerEvent 只给当前一指。
    // 利用 SVG getCoalescedEvents? 不一定可用。
    // 折中方案：用 pointers Map 缓存每指最后位置。
    const a = pointerCache.get(it.pointerAId);
    const b = pointerCache.get(it.pointerBId);
    if (!a || !b) return;

    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;

    if (it.startDistance < 1) return;

    const ratio = dist / it.startDistance;
    const newZoom = clampZoom(it.startZoom * ratio);
    if (newZoom === view().zoom) return;

    // 保持双指中点在屏幕上的位置不变
    // 中点屏幕坐标 → 图坐标（用起始变换）→ 用新 zoom 投影回屏幕 → 偏移
    const rect = svgEl?.getBoundingClientRect();
    if (!rect) return;
    const midLocalX = it.startMidX - rect.left;
    const midLocalY = it.startMidY - rect.top;
    // 起始时中点对应的图坐标
    const graphX = (midLocalX - it.startOffsetX) / it.startZoom;
    const graphY = (midLocalY - it.startOffsetY) / it.startZoom;
    // 新偏移使该图坐标仍投影到当前中点屏幕位置
    const curMidLocalX = midX - rect.left;
    const curMidLocalY = midY - rect.top;
    props.onGraphPan({
      x: curMidLocalX - graphX * newZoom,
      y: curMidLocalY - graphY * newZoom,
    });
    props.onGraphZoom(newZoom);
  };

  // ─── 指针缓存（用于捏合时拿两指最新位置）───

  const pointerCache = new Map<number, Position>();

  // ─── 连线完成 ───

  const completeConnection = (
    clientX: number,
    clientY: number,
    from: ConnectingFrom,
  ) => {
    const el = document.elementFromPoint(clientX, clientY);
    const portEl = el?.closest('[data-port-direction="input"]') as SVGElement | null;
    if (!portEl) return;
    const targetNodeId = portEl.getAttribute('data-node-id');
    const targetPort = portEl.getAttribute('data-port');
    if (!targetNodeId || !targetPort) return;

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
      if (navigator.vibrate) navigator.vibrate(10);
    } else if (result.reason) {
      showToast(CONNECTION_REJECT_MESSAGES[result.reason], 'error');
    }
  };

  // ─── 连线删除 ───

  const handleEdgePointerDown = (e: PointerEvent, edge: BlueprintEdge) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (isEdgeLocked(props.graph, edge)) {
      showToast('锁定节点的连线不能删除', 'warning');
      return;
    }
    props.onEdgeDelete(edge.id);
    if (navigator.vibrate) navigator.vibrate(8);
  };

  // ─── 滚轮缩放（桌面调试用，移动端无滚轮）───

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (!svgEl) return;
    const rect = svgEl.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const v = view();
    const oldZoom = v.zoom;
    const delta = -e.deltaY * 0.0015;
    const newZoom = clampZoom(oldZoom * (1 + delta));
    if (newZoom === oldZoom) return;
    const graphX = (mouseX - v.offsetX) / oldZoom;
    const graphY = (mouseY - v.offsetY) / oldZoom;
    props.onGraphPan({
      x: mouseX - graphX * newZoom,
      y: mouseY - graphY * newZoom,
    });
    props.onGraphZoom(newZoom);
  };

  // ─── 派生状态 ───

  const visibleNodes = createMemo(() => props.graph.nodes);

  const isEdgeHidden = (_edge: BlueprintEdge): boolean => false;

  const cursorClass = () => {
    const it = interaction();
    if (it?.kind === 'pan') return 'cursor-grabbing';
    if (it?.kind === 'connect') return 'cursor-crosshair';
    if (it?.kind === 'node_drag') return 'cursor-grabbing';
    return 'cursor-grab';
  };

  // ─── 全局指针监听绑定（捕获阶段，确保不漏事件）───
  // SolidJS 的 SVG 类型不支持 onPointerDownCapture 等 capture-phase JSX props，
  // 改用 ref + addEventListener 在捕获阶段注册，确保节点/端口上的 stopPropagation
  // 不影响 pointerCache 的更新和捏合检测。

  const onCapturePointerDown = (e: PointerEvent) => {
    pointerCache.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointerCache.size === 2 && interaction().kind !== 'pinch') {
      handlePointerDownGlobal(e);
    }
  };
  const onCapturePointerMove = (e: PointerEvent) => {
    pointerCache.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onCapturePointerUp = (e: PointerEvent) => {
    pointerCache.delete(e.pointerId);
  };
  const onSvgWheel = (e: WheelEvent) => {
    handleWheel(e);
  };

  onMount(() => {
    if (!svgEl) return;
    svgEl.addEventListener('pointerdown', onCapturePointerDown, { capture: true });
    svgEl.addEventListener('pointermove', onCapturePointerMove, { capture: true });
    svgEl.addEventListener('pointerup', onCapturePointerUp, { capture: true });
    svgEl.addEventListener('pointercancel', onCapturePointerUp, { capture: true });
    onCleanup(() => {
      if (!svgEl) return;
      svgEl.removeEventListener('pointerdown', onCapturePointerDown, { capture: true });
      svgEl.removeEventListener('pointermove', onCapturePointerMove, { capture: true });
      svgEl.removeEventListener('pointerup', onCapturePointerUp, { capture: true });
      svgEl.removeEventListener('pointercancel', onCapturePointerUp, { capture: true });
    });
  });

  // ─── 渲染 ───

  return (
    <svg
      ref={(el) => {
        svgEl = el;
      }}
      class={`block w-full h-full ${cursorClass()} ${isConnecting() ? 'bp-connecting' : ''}`}
      style={{ 'touch-action': 'none', 'user-select': 'none' }}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onWheel={onSvgWheel}
    >
      <defs>
        <pattern
          id="bp-grid-mobile"
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
        {/* 背景网格 */}
        <rect
          x={-GRID_EXTENT}
          y={-GRID_EXTENT}
          width={GRID_EXTENT * 2}
          height={GRID_EXTENT * 2}
          fill="url(#bp-grid-mobile)"
          pointer-events="none"
        />

        {/* 连线（在节点下方）*/}
        <For each={props.graph.edges}>
          {(edge) => (
            <Show when={!isEdgeHidden(edge)}>
              {(() => {
                const endpoints = getEdgeEndpoints(props.graph, edge);
                if (!endpoints) return null;
                const locked = isEdgeLocked(props.graph, edge);
                const d = bezierPath(endpoints.from, endpoints.to);
                return (
                  <g>
                    <path
                      d={d}
                      fill="none"
                      stroke={locked ? 'rgba(245,158,11,0.85)' : 'rgba(245,245,247,0.55)'}
                      stroke-width={1.5}
                      pointer-events="none"
                    />
                    {/* 加粗透明命中区，便于触摸 */}
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      stroke-width={22}
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

        {/* 节点 */}
        <For each={visibleNodes()}>
          {(node) => {
            const layout = computeNodeLayout(node);
            const isSelected = props.selectedNodeId === node.id;
            return (
              <g
                transform={`translate(${node.position.x}, ${node.position.y})`}
                onPointerDown={(e) => handleNodePointerDown(e, node)}
                style={{
                  cursor: layout.isLocked ? 'not-allowed' : 'move',
                }}
              >
                {/* 选中态外发光 */}
                <Show when={isSelected}>
                  <rect
                    x={-4}
                    y={-4}
                    width={layout.width + 8}
                    height={layout.height + 8}
                    rx={12}
                    fill="none"
                    stroke="#3A6D8C"
                    stroke-width={2}
                    opacity={0.5}
                    pointer-events="none"
                  />
                </Show>
                {/* 主体背景 */}
                <rect
                  width={layout.width}
                  height={layout.height}
                  rx={8}
                  fill="rgba(11, 18, 27, 0.96)"
                  stroke={isSelected ? '#3A6D8C' : layout.accentColor}
                  stroke-width={isSelected ? 2.5 : 1.5}
                />
                {/* 标题栏底色 */}
                <path
                  d={`M 0,8 Q 0,0 8,0 H ${layout.width - 8} Q ${layout.width},0 ${layout.width},8 V ${HEADER_HEIGHT} H 0 Z`}
                  fill={layout.accentColor}
                  opacity={0.32}
                  pointer-events="none"
                />
                {/* 执行顺序标签 */}
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
                {/* 标题 */}
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
                {/* 副标题 */}
                <Show when={layout.subtitle}>
                  <text
                    x={layout.width - 12}
                    y={HEADER_HEIGHT / 2 + 4}
                    font-size="10"
                    fill="rgba(255,255,255,0.65)"
                    text-anchor="end"
                    pointer-events="none"
                  >
                    {layout.subtitle}
                  </text>
                </Show>
                {/* 锁定图标 */}
                <Show when={layout.isLocked}>
                  <g
                    transform={`translate(${layout.width - 22}, 11)`}
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
                {/* 端口 */}
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
                      {/* 加大命中半径，便于触摸 */}
                      <circle
                        cx={port.x}
                        cy={port.y}
                        r={14}
                        fill="transparent"
                      />
                      <PortShape
                        port={port}
                        accent={layout.accentColor}
                        radius={PORT_RADIUS}
                      />
                    </g>
                  )}
                </For>
              </g>
            );
          }}
        </For>

        {/* 连线模式下的临时线 */}
        <Show when={interaction()?.kind === 'connect' && connectCursorPos()}>
          {(() => {
            const it = interaction();
            if (!it || it.kind !== 'connect') return null;
            const sourceNode = props.graph.nodes.find((n) => n.id === it.from.nodeId);
            if (!sourceNode) return null;
            const fromPos = getPortPosition(sourceNode, it.from.port);
            const toPos = connectCursorPos();
            if (!fromPos || !toPos) return null;
            return (
              <path
                d={bezierPath(fromPos, toPos)}
                fill="none"
                stroke="#3A6D8C"
                stroke-width={2.5}
                stroke-dasharray={CONNECT_DASH}
                pointer-events="none"
              />
            );
          })()}
        </Show>
      </g>

      {/* 连线模式提示（屏幕固定坐标，不随画布变换）*/}
      <Show when={isConnecting()}>
        <g pointer-events="none">
          <rect
            x={12}
            y={12}
            rx={8}
            ry={8}
            width={220}
            height={28}
            fill="rgba(11, 18, 27, 0.9)"
            stroke="#3A6D8C"
            stroke-width={1}
          />
          <text x={20} y={30} font-size="12" fill="#F5F5F7">
            长按连线模式：拖到目标输入端口
          </text>
        </g>
      </Show>

      {/* 缩放指示 */}
      <g pointer-events="none">
        <text
          x={12}
          y={view().offsetY === undefined ? 60 : 60}
          font-size="11"
          fill="rgba(245,245,247,0.5)"
        >
          {`缩放 ${(view().zoom * 100).toFixed(0)}% · 范围 ${(MIN_ZOOM * 100).toFixed(0)}%–${(MAX_ZOOM * 100).toFixed(0)}%`}
        </text>
      </g>
    </svg>
  );
};
