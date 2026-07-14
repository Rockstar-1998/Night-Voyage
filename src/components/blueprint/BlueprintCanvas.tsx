/**
 * Blueprint editor SVG canvas — PC frontend (Task 8).
 *
 * Renders the blueprint graph as an SVG node diagram with pan/zoom, node
 * dragging, edge creation/deletion, cycle detection, locked-node
 * constraints, and per-node visibility toggles.
 *
 * Architecture:
 * - The canvas is a controlled component: `graph`, `viewTransform`,
 *   `selectedNodeId`, and `hiddenNodeIds` are owned by the parent
 *   (BlueprintEditor, Task 10) and passed in as props. The canvas notifies
 *   the parent of changes via the `on*` callbacks.
 * - Transient interaction state (active pan / node-drag / connect gesture
 *   and the current connect-cursor position) is internal to the canvas
 *   because it has no business meaning outside the gesture.
 * - Pointer capture on the SVG root ensures drag/pan/connect gestures
 *   continue to receive move/up events even when the pointer leaves the
 *   SVG bounding box.
 *
 * Constraints:
 * - C1 Frontend Render-Only: the canvas only renders and forwards user
 *   intent (node move / edge create / edge delete) to the parent. No
 *   business logic, no persistence, no backend calls.
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
  Show,
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
} from '../../lib/blueprint/types';
import {
  bezierPath,
  clampZoom,
  computeNodeLayout,
  CONNECTION_REJECT_MESSAGES,
  ConnectingFrom,
  getEdgeEndpoints,
  getPortPosition,
  isEdgeLocked,
  isNodeLocked,
  HEADER_HEIGHT,
  PORT_RADIUS,
  validateConnection,
  ViewTransform,
} from './nodeLayout';
import { showToast } from '../Toast';

// ─── Props ───

export interface BlueprintCanvasProps {
  graph: BlueprintGraph;
  /** View transform owned by the parent (survives canvas unmount). */
  viewTransform: ViewTransform;
  selectedNodeId: string | null;
  /** Node IDs in this set are not rendered (but still exist in the graph). */
  hiddenNodeIds: Set<string>;
  onNodeSelect: (nodeId: string | null) => void;
  onNodeMove: (nodeId: string, position: Position) => void;
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
}

// ─── Internal interaction state ───

type InteractionState =
  | {
      kind: 'pan';
      pointerId: number;
      startScreenX: number;
      startScreenY: number;
      startOffsetX: number;
      startOffsetY: number;
    }
  | {
      kind: 'node-drag';
      pointerId: number;
      nodeId: string;
      startScreenX: number;
      startScreenY: number;
      startNodeX: number;
      startNodeY: number;
    }
  | {
      kind: 'connect';
      pointerId: number;
      from: ConnectingFrom;
    };

// ─── Constants ───

const GRID_SIZE = 40;
const GRID_EXTENT = 5000;
const CONNECT_DASH = '6 4';

// ─── Component ───

export const BlueprintCanvas: Component<BlueprintCanvasProps> = (props) => {
  let svgEl: SVGSVGElement | undefined;
  const [interaction, setInteraction] = createSignal<InteractionState | null>(null);
  const [connectMousePos, setConnectMousePos] = createSignal<Position | null>(null);

  const view = () => props.viewTransform;

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

  // ─── Pan ───

  const handleBackgroundPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    props.onNodeSelect(null);
    const v = view();
    setInteraction({
      kind: 'pan',
      pointerId: e.pointerId,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startOffsetX: v.offsetX,
      startOffsetY: v.offsetY,
    });
    svgEl?.setPointerCapture(e.pointerId);
  };

  // ─── Node drag ───

  const handleNodePointerDown = (e: PointerEvent, node: BlueprintNode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    props.onNodeSelect(node.id);
    if (isNodeLocked(node)) return;
    setInteraction({
      kind: 'node-drag',
      pointerId: e.pointerId,
      nodeId: node.id,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startNodeX: node.position.x,
      startNodeY: node.position.y,
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
    if (isNodeLocked(node)) {
      showToast('节点已锁定，不能从该节点连线', 'warning');
      return;
    }
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
    if (!it) return;
    if (it.kind === 'pan') {
      const dx = e.clientX - it.startScreenX;
      const dy = e.clientY - it.startScreenY;
      props.onGraphPan({
        x: it.startOffsetX + dx,
        y: it.startOffsetY + dy,
      });
    } else if (it.kind === 'node-drag') {
      const v = view();
      const dx = (e.clientX - it.startScreenX) / v.zoom;
      const dy = (e.clientY - it.startScreenY) / v.zoom;
      props.onNodeMove(it.nodeId, {
        x: it.startNodeX + dx,
        y: it.startNodeY + dy,
      });
    } else if (it.kind === 'connect') {
      setConnectMousePos(screenToGraph(e.clientX, e.clientY));
    }
  };

  // ─── Pointer up (unified) ───

  const handlePointerUp = (e: PointerEvent) => {
    const it = interaction();
    if (!it) return;
    svgEl?.releasePointerCapture(it.pointerId);
    if (it.kind === 'connect') {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const portEl = el?.closest('[data-port-kind="input"]') as SVGElement | null;
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
  });

  // ─── Edge deletion ───

  const handleEdgePointerDown = (e: PointerEvent, edge: BlueprintEdge) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (isEdgeLocked(props.graph, edge)) {
      showToast('锁定节点的连线不能删除', 'warning');
      return;
    }
    props.onEdgeDelete(edge.id);
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

  const cursorClass = () => {
    const it = interaction();
    if (it?.kind === 'pan') return 'cursor-grabbing';
    if (it?.kind === 'connect') return 'cursor-crosshair';
    return 'cursor-grab';
  };

  // ─── Render ───

  return (
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

        {/* Edges (below nodes) */}
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
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      stroke-width={14}
                      stroke-linecap="round"
                      style={{
                        cursor: locked ? 'not-allowed' : 'pointer',
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
            const isSelected = props.selectedNodeId === node.id;
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
                {/* Title */}
                <text
                  x={12}
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
                    <g>
                      <Show when={port.label}>
                        <text
                          x={port.kind === 'output' ? layout.width - 14 : 14}
                          y={port.y + 3}
                          font-size="10"
                          fill="rgba(255,255,255,0.7)"
                          text-anchor={port.kind === 'output' ? 'end' : 'start'}
                          pointer-events="none"
                        >
                          {port.label}
                        </text>
                      </Show>
                      <circle
                        cx={port.x}
                        cy={port.y}
                        r={PORT_RADIUS}
                        fill={layout.accentColor}
                        stroke="white"
                        stroke-width={1.5}
                        data-node-id={node.id}
                        data-port={port.port}
                        data-port-kind={port.kind}
                        style={{
                          cursor: 'crosshair',
                        }}
                        onPointerDown={
                          port.kind === 'output'
                            ? (e) => handleOutputPortPointerDown(e, node, port.port)
                            : undefined
                        }
                      />
                    </g>
                  )}
                </For>
              </g>
            );
          }}
        </For>

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
  );
};
