/**
 * 移动端蓝图编辑器主组件（Task 13.1 / 13.4）。
 *
 * 整合画布（MobileBlueprintCanvas）、底部配置抽屉（MobileNodeConfigPanel）、
 * 顶部浮动工具栏（添加节点 / 保存 / 缩放）和节点类型选择底部表单。
 *
 * 状态模型：
 * - `graph`：已提交的蓝图（createSignal；更新时保持非变更节点引用稳定，
 *   让 <For> 仅 patch 变更节点，符合 C3 细粒度响应式）
 * - `draftConfig`：当前选中节点的配置草稿；面板实时编辑草稿，保存时提交到 graph，
 *   取消时丢弃。这让"取消"能真正回滚未保存的编辑。
 * - `viewTransform`：画布平移/缩放（独立信号，拖拽平移时不触节点重渲染）
 *
 * 约束：
 * - C1 前端只渲染：所有业务逻辑（执行蓝图、持久化）由父级通过 props 接入
 * - C2 零回退：添加 Start/End 时校验唯一性，违反时显式 toast 报错
 * - C3 响应性：节点位置通过 SVG transform 应用；高频拖拽用信号细粒度更新
 * - C5 移动端独立：不 import PC 端组件，仅引用 src-mobile 内 + 共享 types
 */

import {
  Component,
  For,
  Show,
  createMemo,
  createSignal,
} from 'solid-js';
import type {
  BlueprintEdge,
  BlueprintGraph,
  BlueprintNode,
  NodeConfig,
  NodeType,
  Position,
} from '../../../src/lib/blueprint/types';
import {
  clampZoom,
  createNode,
  NODE_WIDTH,
  ViewTransform,
  autoLayout,
} from './mobileNodeLayout';
import { MobileBlueprintCanvas } from './MobileBlueprintCanvas';
import { MobileNodeConfigPanel } from './MobileNodeConfigPanel';
import { showToast } from '../Toast';

// ─── Props ───

export interface BlueprintEditorProps {
  /** 初始图（父级加载 / 迁移后传入） */
  initialGraph: BlueprintGraph;
  /** 保存回调：父级持久化已提交的图 */
  onSave: (graph: BlueprintGraph) => void;
  /** 返回回调（导航返回） */
  onBack: () => void;
  /** 编辑器标题（如 preset 名称） */
  title: string;
}

// ─── 节点类型选择项 ───

// role_switch 已废弃，从可选列表移除（旧图仍可加载执行）
const ADDABLE_NODE_TYPES: Array<{ type: NodeType; label: string; desc: string }> = [
  { type: 'prompt', label: 'Prompt', desc: '提示词片段 → block' },
  { type: 'schema_field', label: 'SchemaField', desc: 'schema 字段，可选 db_mapping' },
  { type: 'mutex_gate', label: 'MutexGate', desc: '互斥组，单选' },
  { type: 'group_gate', label: 'GroupGate', desc: '普通组，多选' },
  { type: 'mode_switch', label: 'ModeSwitch', desc: '三模式分支' },
  { type: 'constant', label: 'Constant', desc: '读取会话属性（如 conversation_type / memory_mode / protocol）输出值' },
  { type: 'branch', label: 'Branch', desc: '接收上游常量值，按 cases 匹配走对应出口' },
  { type: 'sampling_params_openai', label: 'SamplingParams (OpenAI)', desc: 'OpenAI 版采样参数（仅 chat_completions 生效）' },
  { type: 'sampling_params_anthropic', label: 'SamplingParams (Anthropic)', desc: 'Anthropic 版采样参数（含 thinking 配置）' },
  { type: 'start', label: 'Start', desc: '链表起点（每图唯一）' },
  { type: 'end', label: 'End', desc: '链表终点（每图唯一）' },
];

// ─── 组件 ───

export const BlueprintEditor: Component<BlueprintEditorProps> = (props) => {
  const [graph, setGraph] = createSignal<BlueprintGraph>(props.initialGraph);
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  const [draftConfig, setDraftConfig] = createSignal<NodeConfig | null>(null);
  const [viewTransform, setViewTransform] = createSignal<ViewTransform>({
    offsetX: 40,
    offsetY: 200,
    zoom: 1,
  });
  const [isAddSheetOpen, setIsAddSheetOpen] = createSignal(false);
  const [isDirty, setIsDirty] = createSignal(false);

  // ─── 选中节点（含草稿配置）───

  const selectedNode = createMemo<BlueprintNode | null>(() => {
    const id = selectedNodeId();
    if (!id) return null;
    const n = graph().nodes.find((x) => x.id === id);
    if (!n) return null;
    const draft = draftConfig();
    if (draft) {
      return { ...n, config: draft.config } as BlueprintNode;
    }
    return n;
  });

  // ─── 选中节点时初始化草稿 ───

  const handleNodeSelect = (nodeId: string | null) => {
    if (nodeId === null) {
      setSelectedNodeId(null);
      setDraftConfig(null);
      return;
    }
    const node = graph().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setSelectedNodeId(nodeId);
    // 深拷贝 config 作为草稿
    setDraftConfig({ type: node.type, config: structuredClone(node.config) } as NodeConfig);
  };

  // ─── 配置变更（更新草稿，不碰 graph）───

  const handleConfigChange = (_nodeId: string, config: NodeConfig) => {
    setDraftConfig(config);
    setIsDirty(true);
  };

  // ─── 保存（提交草稿到 graph，再回调父级）───

  const handleSaveNode = (nodeId: string) => {
    const draft = draftConfig();
    if (!draft) return;
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === nodeId ? ({ ...n, config: draft.config } as BlueprintNode) : n,
      ),
    }));
    setDraftConfig({ type: draft.type, config: structuredClone(draft.config) } as NodeConfig);
    showToast('节点配置已保存到当前蓝图', 'success', 2000);
  };

  // ─── 取消（丢弃草稿）───

  const handleCancelNode = (_nodeId: string) => {
    setDraftConfig(null);
    setSelectedNodeId(null);
  };

  // ─── 删除节点 ───

  const handleDeleteNode = (nodeId: string) => {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.filter((n) => n.id !== nodeId),
      edges: g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }));
    setSelectedNodeId(null);
    setDraftConfig(null);
    setIsDirty(true);
    showToast('节点已删除', 'info', 2000);
  };

  // ─── 节点移动 ───

  const handleNodeMove = (nodeId: string, position: Position) => {
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((n) =>
        n.id === nodeId ? { ...n, position } : n,
      ),
    }));
    setIsDirty(true);
  };

  // ─── 连线创建 ───

  const handleEdgeCreate = (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
  ) => {
    const eid = `e_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const edge: BlueprintEdge = {
      id: eid,
      source,
      source_port: sourcePort,
      target,
      target_port: targetPort,
    };
    setGraph((g) => ({ ...g, edges: [...g.edges, edge] }));
    setIsDirty(true);
    showToast('连线已创建', 'success', 1500);
  };

  // ─── 连线删除 ───

  const handleEdgeDelete = (edgeId: string) => {
    setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== edgeId) }));
    setIsDirty(true);
    showToast('连线已删除', 'info', 1500);
  };

  // ─── 画布平移 / 缩放 ───

  const handleGraphPan = (offset: Position) => {
    setViewTransform((v) => ({ ...v, offsetX: offset.x, offsetY: offset.y }));
  };
  const handleGraphZoom = (zoom: number) => {
    setViewTransform((v) => ({ ...v, zoom }));
  };

  // ─── 缩放按钮（以画布中心为锚点）───

  const zoomBy = (factor: number) => {
    const v = viewTransform();
    const oldZoom = v.zoom;
    const newZoom = clampZoom(oldZoom * factor);
    if (newZoom === oldZoom) return;
    // 以画布中心为锚点
    const rect = svgContainerRef?.getBoundingClientRect();
    if (!rect) {
      setViewTransform((vv) => ({ ...vv, zoom: newZoom }));
      return;
    }
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const graphX = (cx - v.offsetX) / oldZoom;
    const graphY = (cy - v.offsetY) / oldZoom;
    setViewTransform({
      zoom: newZoom,
      offsetX: cx - graphX * newZoom,
      offsetY: cy - graphY * newZoom,
    });
  };

  const resetView = () => {
    setViewTransform({ offsetX: 40, offsetY: 200, zoom: 1 });
  };

  // ─── 适应视图（把所有节点框入视口）───

  const fitView = () => {
    const g = graph();
    if (g.nodes.length === 0) {
      resetView();
      return;
    }
    const rect = svgContainerRef?.getBoundingClientRect();
    if (!rect) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of g.nodes) {
      minX = Math.min(minX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxX = Math.max(maxX, n.position.x + NODE_WIDTH);
      maxY = Math.max(maxY, n.position.y + 80);
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const padding = 40;
    const zoomX = (rect.width - padding * 2) / Math.max(w, 1);
    const zoomY = (rect.height - padding * 2) / Math.max(h, 1);
    const newZoom = clampZoom(Math.min(zoomX, zoomY));
    setViewTransform({
      zoom: newZoom,
      offsetX: padding - minX * newZoom,
      offsetY: padding - minY * newZoom,
    });
  };

  // ─── 添加节点 ───

  let svgContainerRef: HTMLDivElement | undefined;

  const hasStart = createMemo(() => graph().nodes.some((n) => n.type === 'start'));
  const hasEnd = createMemo(() => graph().nodes.some((n) => n.type === 'end'));

  const handleAddNode = (type: NodeType) => {
    // 唯一性校验
    if (type === 'start' && hasStart()) {
      showToast('每图只能有一个 Start 节点', 'error');
      return;
    }
    if (type === 'end' && hasEnd()) {
      showToast('每图只能有一个 End 节点', 'error');
      return;
    }
    // 在当前视口中心创建节点
    const rect = svgContainerRef?.getBoundingClientRect();
    const v = viewTransform();
    const centerGraphX = rect
      ? (rect.width / 2 - v.offsetX) / v.zoom
      : 200;
    const centerGraphY = rect
      ? (rect.height / 2 - v.offsetY) / v.zoom
      : 300;
    // 错开一点，避免完全重叠
    const offset = graph().nodes.length * 20;
    const position: Position = { x: centerGraphX - NODE_WIDTH / 2 + offset, y: centerGraphY - 40 + offset };
    const node = createNode(type, position);
    setGraph((g) => ({ ...g, nodes: [...g.nodes, node] }));
    setIsDirty(true);
    setIsAddSheetOpen(false);
    setSelectedNodeId(node.id);
    setDraftConfig({ type: node.type, config: structuredClone(node.config) } as NodeConfig);
    showToast(`已添加 ${type} 节点`, 'success', 1500);
  };

  // ─── 整理布局 ───

  const handleAutoLayout = () => {
    const g = graph();
    const positions = autoLayout(g.nodes, g.edges);
    setGraph((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => {
        const pos = positions.get(n.id);
        return pos ? { ...n, position: pos } : n;
      }),
    }));
    setIsDirty(true);
    showToast('节点已自动整理', 'success', 1500);
  };

  // ─── 保存整个蓝图 ───

  const handleSaveGraph = () => {
    const g = graph();
    // 基本校验：必须有 Start 和 End
    if (!g.nodes.some((n) => n.type === 'start')) {
      showToast('蓝图缺少 Start 节点', 'error');
      return;
    }
    if (!g.nodes.some((n) => n.type === 'end')) {
      showToast('蓝图缺少 End 节点', 'error');
      return;
    }
    props.onSave(g);
    setIsDirty(false);
  };

  // ─── 返回（有未保存改动时提示）───

  const handleBack = () => {
    if (isDirty()) {
      // 不阻塞，仅提示；父级可自行决定是否拦截
      showToast('有未保存的改动', 'warning', 2000);
    }
    props.onBack();
  };

  // ─── 节点 / 连线计数 ───

  const nodeCount = createMemo(() => graph().nodes.length);
  const edgeCount = createMemo(() => graph().edges.length);

  // ─── 渲染 ───

  return (
    <div class="h-[100dvh] w-full flex flex-col bg-xuanqing relative overflow-hidden">
      {/* 顶部工具栏 */}
      <header class="shrink-0 h-14 flex items-center gap-2 px-3 bg-xuanqing/90 backdrop-blur-md border-b border-white/5 z-20 safe-area-top">
        <button
          onClick={handleBack}
          class="shrink-0 p-2 text-mist-solid/70 hover:text-white transition-colors"
          aria-label="返回"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <div class="flex-1 min-w-0 flex flex-col">
          <span class="text-[13px] font-bold text-white truncate">{props.title}</span>
          <span class="text-[10px] text-mist-solid/45">
            {nodeCount()} 节点 · {edgeCount()} 连线{isDirty() ? ' · 未保存' : ''}
          </span>
        </div>
        <button
          onClick={handleAutoLayout}
          class="shrink-0 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-mist-solid/70 text-[12px] font-bold active:scale-95 transition-transform"
          aria-label="整理布局"
        >
          整理
        </button>
        <button
          onClick={() => setIsAddSheetOpen(true)}
          class="shrink-0 px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/30 text-accent text-[12px] font-bold active:scale-95 transition-transform"
        >
          + 添加
        </button>
        <button
          onClick={handleSaveGraph}
          class="shrink-0 px-3 py-1.5 rounded-lg bg-accent text-white text-[12px] font-bold active:scale-95 transition-transform shadow-[0_2px_8px_rgba(58,109,140,0.3)]"
        >
          保存
        </button>
      </header>

      {/* 画布 */}
      <div
        ref={(el) => { svgContainerRef = el; }}
        class="flex-1 min-h-0 relative"
      >
        <MobileBlueprintCanvas
          graph={graph()}
          viewTransform={viewTransform()}
          selectedNodeId={selectedNodeId()}
          onNodeSelect={handleNodeSelect}
          onNodeMove={handleNodeMove}
          onEdgeCreate={handleEdgeCreate}
          onEdgeDelete={handleEdgeDelete}
          onGraphPan={handleGraphPan}
          onGraphZoom={handleGraphZoom}
        />

        {/* 浮动缩放控件（右下角） */}
        <div class="absolute bottom-4 right-3 flex flex-col gap-1.5 z-10">
          <button
            onClick={() => zoomBy(1.2)}
            class="w-10 h-10 rounded-xl bg-xuanqing/90 border border-white/10 text-mist-solid flex items-center justify-center backdrop-blur-md active:scale-95 transition-transform shadow-lg"
            aria-label="放大"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button
            onClick={() => zoomBy(1 / 1.2)}
            class="w-10 h-10 rounded-xl bg-xuanqing/90 border border-white/10 text-mist-solid flex items-center justify-center backdrop-blur-md active:scale-95 transition-transform shadow-lg"
            aria-label="缩小"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14"/></svg>
          </button>
          <button
            onClick={fitView}
            class="w-10 h-10 rounded-xl bg-xuanqing/90 border border-white/10 text-mist-solid flex items-center justify-center backdrop-blur-md active:scale-95 transition-transform shadow-lg"
            aria-label="适应视图"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/></svg>
          </button>
          <button
            onClick={resetView}
            class="w-10 h-10 rounded-xl bg-xuanqing/90 border border-white/10 text-mist-solid/70 flex items-center justify-center backdrop-blur-md active:scale-95 transition-transform shadow-lg"
            aria-label="重置视图"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
          </button>
        </div>
      </div>

      {/* 底部配置抽屉 */}
      <MobileNodeConfigPanel
        node={selectedNode()}
        onConfigChange={handleConfigChange}
        onSave={handleSaveNode}
        onCancel={handleCancelNode}
        onDelete={handleDeleteNode}
      />

      {/* 添加节点底部表单 */}
      <Show when={isAddSheetOpen()}>
        <div class="fixed inset-0 z-[1600] flex flex-col justify-end">
          <div
            class="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => setIsAddSheetOpen(false)}
          />
          <div class="relative w-full bg-xuanqing rounded-t-3xl border-t border-white/10 shadow-2xl safe-area-bottom pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div class="w-full flex justify-center pt-3 pb-1">
              <div class="w-12 h-1.5 bg-white/20 rounded-full" />
            </div>
            <div class="px-5 pt-2 pb-4">
              <h3 class="text-[15px] font-bold text-white mb-3">添加节点</h3>
              <div class="grid grid-cols-2 gap-2.5">
                <For each={ADDABLE_NODE_TYPES}>
                  {(item) => (
                    <button
                      onClick={() => handleAddNode(item.type)}
                      class={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left active:scale-95 transition-transform ${
                        (item.type === 'start' && hasStart()) || (item.type === 'end' && hasEnd())
                          ? 'bg-white/5 border-white/5 opacity-40'
                          : 'bg-white/5 border-white/10 hover:border-accent/30'
                      }`}
                      disabled={
                        (item.type === 'start' && hasStart()) ||
                        (item.type === 'end' && hasEnd())
                      }
                    >
                      <span class="text-[13px] font-bold text-mist-solid">{item.label}</span>
                      <span class="text-[10px] text-mist-solid/50 leading-tight">{item.desc}</span>
                    </button>
                  )}
                </For>
              </div>
              <button
                onClick={() => setIsAddSheetOpen(false)}
                class="w-full mt-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-mist-solid/70 text-[13px] font-medium"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
};
