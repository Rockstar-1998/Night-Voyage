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
  createEffect,
  createMemo,
  createSignal,
} from 'solid-js';
import type {
  BlueprintComment,
  BlueprintEdge,
  BlueprintGraph,
  BlueprintMacro,
  BlueprintNode,
  NodeConfig,
  NodePositionPatch,
  NodeType,
  Position,
} from '../../lib/blueprint/types';
import {
  actionBridgeWhitelistGet,
  blueprintValidateUiContract,
  mcpToolNames,
  type ContractValidationResultDto,
} from '../../lib/backend/blueprint';
import {
  clampZoom,
  createNode,
  isNodeLocked,
  NODE_WIDTH,
  ViewTransform,
  autoLayout,
} from './mobileNodeLayout';
import { MobileBlueprintCanvas } from './MobileBlueprintCanvas';
import { MobileNodeConfigPanel } from './MobileNodeConfigPanel';
import { MobileMacroDrawer } from './MobileMacroDrawer';
import type { MobileToolItem } from './MobileToolPermissionsModal';
import { showToast } from '../Toast';

// ─── Props ───

export interface BlueprintEditorProps {
  /** 初始图（父级加载 / 迁移后传入） */
  initialGraph: BlueprintGraph;
  /** 预设 ID（用于 UI 数据契约静态校验） */
  presetId?: number | null;
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
  { type: 'initial_state_config', label: 'InitialState', desc: '流派中立开局属性、背包与标记配置' },
  { type: 'macro_instance', label: 'MacroInstance', desc: '调用宏子图实例' },
  { type: 'macro_inputs', label: 'MacroInputs', desc: '宏输入代理引脚（宏子图内）' },
  { type: 'macro_outputs', label: 'MacroOutputs', desc: '宏输出代理引脚（宏子图内）' },
  { type: 'start', label: 'Start', desc: '链表起点（每图唯一）' },
  { type: 'end', label: 'End', desc: '链表终点（每图唯一）' },
];

// ─── 组件 ───

export const BlueprintEditor: Component<BlueprintEditorProps> = (props) => {
  const [graph, setGraph] = createSignal<BlueprintGraph>({
    ...props.initialGraph,
    macros: props.initialGraph.macros ?? [],
  });
  const [selectedNodeId, setSelectedNodeId] = createSignal<string | null>(null);
  // 框选 / 批量操作的多选集合（含单选场景）。
  const [selectedNodeIds, setSelectedNodeIds] = createSignal<Set<string>>(new Set());
  const [selectedCommentId, setSelectedCommentId] = createSignal<string | null>(null);
  // 框选模式：背景单指拖动从平移切换为框选。
  const [boxSelectMode, setBoxSelectMode] = createSignal(false);
  const [draftConfig, setDraftConfig] = createSignal<NodeConfig | null>(null);
  const [viewTransform, setViewTransform] = createSignal<ViewTransform>({
    offsetX: 40,
    offsetY: 200,
    zoom: 1,
  });
  const [isAddSheetOpen, setIsAddSheetOpen] = createSignal(false);
  const [isDirty, setIsDirty] = createSignal(false);
  const [contractValidation, setContractValidation] = createSignal<ContractValidationResultDto | null>(null);

  const errorNodeIds = createMemo<Set<string>>(() => {
    const set = new Set<string>();
    const res = contractValidation();
    if (!res || res.isValid) return set;
    for (const err of res.errors) {
      const match = err.match(/^\[(.*?)\]/);
      if (match && match[1]) {
        set.add(match[1]);
      }
    }
    if (res.missingStats.length > 0 || res.missingFlags.length > 0 || res.missingInventory) {
      const initNode = graph().nodes.find((n) => n.type === 'initial_state_config');
      if (initNode) set.add(initNode.id);
    }
    return set;
  });
  const [activeMacroId, setActiveMacroId] = createSignal<string | null>(null);
  const [isMacroDrawerOpen, setIsMacroDrawerOpen] = createSignal(false);

  const activeMacro = () => (graph().macros || []).find((m) => m.id === activeMacroId());

  const displayGraph = createMemo<BlueprintGraph>(() => {
    const macro = activeMacro();
    if (!macro) return graph();
    return {
      version: 2,
      nodes: macro.nodes || [],
      edges: macro.edges || [],
      comments: [],
      macros: graph().macros || [],
    };
  });

  // 全局能力池（Local Tools + ActionBridge + MCP，Spec §4 & lines 157-158）
  const [mcpTools, setMcpTools] = createSignal<Array<{ name: string; description: string }>>([]);
  const [actionBridgeCommands, setActionBridgeCommands] = createSignal<string[]>([]);
  const [isContractDrawerOpen, setIsContractDrawerOpen] = createSignal(false);

  createEffect(() => {
    mcpToolNames()
      .then((tools) => setMcpTools(tools || []))
      .catch((err) => {
        console.error('Failed to load mobile MCP tools:', err);
        showToast(`加载 MCP 工具失败: ${err}`, 'error');
      });

    actionBridgeWhitelistGet()
      .then((cmds) => setActionBridgeCommands(cmds || []))
      .catch((err) => {
        console.error('Failed to load mobile ActionBridge whitelist:', err);
        showToast(`加载 ActionBridge 白名单失败: ${err}`, 'error');
      });
  });

  const availableTools = createMemo<MobileToolItem[]>(() => {
    const list: MobileToolItem[] = [];
    const seen = new Set<string>();

    // 1. 本地蓝图工具定义 (ToolDefinition)
    for (const n of graph().nodes) {
      if (n.type === 'tool_definition') {
        const cfg = n.config as any;
        const name = cfg?.tool_name || n.id;
        if (name && !seen.has(name)) {
          seen.add(name);
          list.push({
            name,
            type: 'local',
            description: cfg?.description || '本地蓝图 ToolDefinition 契约',
          });
        }
      }
    }

    // 2. ActionBridge 跨域查询原语 (动态从白名单读取，C11 杜绝硬编码)
    for (const cmd of actionBridgeCommands()) {
      if (!seen.has(cmd)) {
        seen.add(cmd);
        list.push({
          name: cmd,
          type: 'action_bridge',
          description: `ActionBridge 跨域原语: ${cmd}`,
        });
      }
    }

    // 3. MCP 工具
    for (const mcp of mcpTools()) {
      if (mcp.name && !seen.has(mcp.name)) {
        seen.add(mcp.name);
        list.push({
          name: mcp.name,
          type: 'mcp',
          description: mcp.description || 'MCP 服务器动态工具',
        });
      }
    }

    return list;
  });

  const runContractValidation = async () => {
    if (!props.presetId) return;
    try {
      const json = JSON.stringify(graph());
      const res = await blueprintValidateUiContract(props.presetId, json);
      setContractValidation(res);
    } catch (err: any) {
      console.error('Failed to validate UI contract on mobile:', err);
      const msg = typeof err === 'string' ? err : err?.message || '契约校验接口异常';
      setContractValidation({
        isValid: false,
        missingStats: [],
        missingFlags: [],
        missingInventory: false,
        errors: [`UI 契约校验调用失败: ${msg}`],
      });
      showToast(`UI 契约校验失败: ${msg}`, 'error');
    }
  };

  createEffect(() => {
    // 监听图结构与预设变动
    const _g = graph();
    if (props.presetId) {
      void runContractValidation();
    }
  });

  // ─── 选中节点（含草稿配置）───

  const selectedNode = createMemo<BlueprintNode | null>(() => {
    const id = selectedNodeId();
    if (!id) return null;
    const n = displayGraph().nodes.find((x) => x.id === id);
    if (!n) return null;
    const draft = draftConfig();
    if (draft) {
      return { ...n, config: draft.config } as BlueprintNode;
    }
    return n;
  });

  // ─── 选中节点时初始化草稿 ───

  const handleNodeSelect = (nodeId: string | null) => {
    setSelectedCommentId(null);
    if (nodeId === null) {
      setSelectedNodeId(null);
      setSelectedNodeIds(new Set<string>());
      setDraftConfig(null);
      return;
    }
    const node = displayGraph().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    setSelectedNodeId(nodeId);
    setSelectedNodeIds(new Set([nodeId]));
    // 深拷贝 config 作为草稿
    setDraftConfig({ type: node.type, config: structuredClone(node.config) } as NodeConfig);
  };

  // ─── 注释框选中 ───

  const handleCommentSelect = (commentId: string | null) => {
    setSelectedNodeId(null);
    setSelectedNodeIds(new Set<string>());
    setDraftConfig(null);
    setSelectedCommentId(commentId);
  };

  // ─── 框选结束：整体替换多选集合 ───

  const handleNodesBoxSelected = (nodeIds: string[]) => {
    setSelectedCommentId(null);
    setSelectedNodeIds(new Set(nodeIds));
    if (nodeIds.length === 1) {
      handleNodeSelect(nodeIds[0]);
    } else {
      setSelectedNodeId(null);
      setDraftConfig(null);
    }
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
    const mId = activeMacroId();
    if (mId) {
      setGraph((g) => ({
        ...g,
        macros: (g.macros || []).map((m) => {
          if (m.id !== mId) return m;
          const updatedNodes = (m.nodes || []).map((n) =>
            n.id === nodeId ? ({ ...n, config: draft.config } as BlueprintNode) : n,
          );
          let inputs = m.inputs;
          let outputs = m.outputs;
          if (draft.type === 'macro_inputs') {
            inputs = (draft.config as any).pins || [];
          } else if (draft.type === 'macro_outputs') {
            outputs = (draft.config as any).pins || [];
          }
          return { ...m, nodes: updatedNodes, inputs, outputs };
        }),
      }));
    } else {
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === nodeId ? ({ ...n, config: draft.config } as BlueprintNode) : n,
        ),
      }));
    }
    setDraftConfig({ type: draft.type, config: structuredClone(draft.config) } as NodeConfig);
    showToast('节点配置已保存到当前蓝图', 'success', 2000);
  };

  // ─── 取消（丢弃草稿）───

  const handleCancelNode = (_nodeId: string) => {
    handleNodeSelect(null);
  };

  // ─── 删除节点 ───

  const handleDeleteNode = (nodeId: string) => {
    const mId = activeMacroId();
    if (mId) {
      setGraph((g) => ({
        ...g,
        macros: (g.macros || []).map((m) =>
          m.id === mId
            ? {
                ...m,
                nodes: (m.nodes || []).filter((n) => n.id !== nodeId),
                edges: (m.edges || []).filter((e) => e.source !== nodeId && e.target !== nodeId),
              }
            : m,
        ),
      }));
    } else {
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.filter((n) => n.id !== nodeId),
        edges: g.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
      }));
    }
    setSelectedNodeId(null);
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });
    setDraftConfig(null);
    setIsDirty(true);
    showToast('节点已删除', 'info', 2000);
  };

  // ─── 批量删除（框选结果；跳过锁定 / Start / End，与抽屉删除规则一致）───

  const handleDeleteSelectedNodes = () => {
    const ids = [...selectedNodeIds()];
    if (ids.length === 0) return;
    const currentNodes = displayGraph().nodes;
    const byId = new Map(currentNodes.map((n) => [n.id, n]));
    const blocked = ids.filter((id) => {
      const n = byId.get(id);
      return !n || isNodeLocked(n) || n.type === 'start' || n.type === 'end';
    });
    const deletable = ids.filter((id) => !blocked.includes(id));
    if (deletable.length === 0) {
      showToast('选中节点均不可删除（锁定 / Start / End）', 'warning');
      return;
    }
    if (blocked.length > 0) {
      showToast(`${blocked.length} 个节点未删除（锁定 / Start / End 不可删除）`, 'warning');
    }
    const deleteSet = new Set(deletable);
    const mId = activeMacroId();
    if (mId) {
      setGraph((g) => ({
        ...g,
        macros: (g.macros || []).map((m) =>
          m.id === mId
            ? {
                ...m,
                nodes: (m.nodes || []).filter((n) => !deleteSet.has(n.id)),
                edges: (m.edges || []).filter((e) => !deleteSet.has(e.source) && !deleteSet.has(e.target)),
              }
            : m,
        ),
      }));
    } else {
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.filter((n) => !deleteSet.has(n.id)),
        edges: g.edges.filter((e) => !deleteSet.has(e.source) && !deleteSet.has(e.target)),
      }));
    }
    setSelectedNodeIds(new Set<string>());
    setSelectedNodeId(null);
    setDraftConfig(null);
    setIsDirty(true);
    showToast(`已删除 ${deletable.length} 个节点`, 'info', 2000);
  };

  // ─── 批量断开连线（断开所有选中节点的全部引脚连线）───

  const handleDisconnectSelectedNodes = () => {
    const ids = [...selectedNodeIds()];
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const currentEdges = displayGraph().edges;
    const removed = currentEdges.filter(
      (e) => idSet.has(e.source) || idSet.has(e.target),
    ).length;
    if (removed === 0) {
      showToast('选中节点没有连线可断开', 'info', 2000);
      return;
    }
    const mId = activeMacroId();
    if (mId) {
      setGraph((g) => ({
        ...g,
        macros: (g.macros || []).map((m) =>
          m.id === mId
            ? {
                ...m,
                edges: (m.edges || []).filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
              }
            : m,
        ),
      }));
    } else {
      setGraph((g) => ({
        ...g,
        edges: g.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target)),
      }));
    }
    setIsDirty(true);
    showToast(`已断开 ${removed} 条连线`, 'success', 2000);
  };

  // ─── 批量移动（注释框拖动携带框内节点）───

  const handleNodesMoveBatch = (moves: NodePositionPatch[]) => {
    if (moves.length === 0) return;
    const byId = new Map(moves.map((m) => [m.id, m.position]));
    const mId = activeMacroId();
    if (mId) {
      setGraph((g) => ({
        ...g,
        macros: (g.macros || []).map((m) =>
          m.id === mId
            ? {
                ...m,
                nodes: (m.nodes || []).map((n) => {
                  const pos = byId.get(n.id);
                  return pos ? { ...n, position: pos } : n;
                }),
              }
            : m,
        ),
      }));
    } else {
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.map((n) => {
          const pos = byId.get(n.id);
          return pos ? { ...n, position: pos } : n;
        }),
      }));
    }
    setIsDirty(true);
  };

  // ─── 注释框 CRUD ───

  const patchComment = (commentId: string, patch: Partial<BlueprintComment>) => {
    setGraph((g) => ({
      ...g,
      comments: (g.comments ?? []).map((c) =>
        c.id === commentId ? { ...c, ...patch } : c,
      ),
    }));
    setIsDirty(true);
  };

  const handleAddComment = () => {
    const rect = svgContainerRef?.getBoundingClientRect();
    const v = viewTransform();
    const centerGraphX = rect ? (rect.width / 2 - v.offsetX) / v.zoom : 200;
    const centerGraphY = rect ? (rect.height / 2 - v.offsetY) / v.zoom : 300;
    const comment: BlueprintComment = {
      id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      text: '注释',
      position: { x: Math.round(centerGraphX - 180), y: Math.round(centerGraphY - 120) },
      width: 360,
      height: 240,
    };
    setGraph((g) => ({ ...g, comments: [...(g.comments ?? []), comment] }));
    handleCommentSelect(comment.id);
    setIsDirty(true);
    showToast('已添加注释框', 'success', 1500);
  };

  const handleCommentMove = (commentId: string, position: Position) => {
    patchComment(commentId, { position });
  };

  const handleCommentTextChange = (commentId: string, text: string) => {
    patchComment(commentId, { text });
  };

  const handleDeleteComment = (commentId: string) => {
    setGraph((g) => ({
      ...g,
      comments: (g.comments ?? []).filter((c) => c.id !== commentId),
    }));
    setSelectedCommentId(null);
    setIsDirty(true);
    showToast('注释框已删除', 'info', 2000);
  };

  // ─── 节点移动 ───

  const handleNodeMove = (nodeId: string, position: Position) => {
    const mId = activeMacroId();
    if (mId) {
      setGraph((g) => ({
        ...g,
        macros: (g.macros || []).map((m) =>
          m.id === mId
            ? {
                ...m,
                nodes: (m.nodes || []).map((n) =>
                  n.id === nodeId ? { ...n, position } : n,
                ),
              }
            : m,
        ),
      }));
    } else {
      setGraph((g) => ({
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === nodeId ? { ...n, position } : n,
        ),
      }));
    }
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
    const mId = activeMacroId();
    if (mId) {
      setGraph((g) => ({
        ...g,
        macros: (g.macros || []).map((m) =>
          m.id === mId
            ? { ...m, edges: [...(m.edges || []), edge] }
            : m,
        ),
      }));
    } else {
      setGraph((g) => ({ ...g, edges: [...g.edges, edge] }));
    }
    setIsDirty(true);
    showToast('连线已创建', 'success', 1500);
  };

  // ─── 连线删除 ───

  const handleEdgeDelete = (edgeId: string) => {
    const mId = activeMacroId();
    if (mId) {
      setGraph((g) => ({
        ...g,
        macros: (g.macros || []).map((m) =>
          m.id === mId
            ? { ...m, edges: (m.edges || []).filter((e) => e.id !== edgeId) }
            : m,
        ),
      }));
    } else {
      setGraph((g) => ({ ...g, edges: g.edges.filter((e) => e.id !== edgeId) }));
    }
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
    const g = displayGraph();
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

  // ─── 宏管理逻辑 ───

  const handleCreateMacro = (name: string, category: string) => {
    const macroId = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(-3)}`;
    const inNodeId = `in_${macroId}`;
    const outNodeId = `out_${macroId}`;
    const inPin = { id: 'exec_in', name: 'Exec In', pin_type: 'exec' as const };
    const outPin = { id: 'exec_out', name: 'Exec Out', pin_type: 'exec' as const };
    const newMacro: BlueprintMacro = {
      id: macroId,
      name,
      description: '',
      category: category || '通用',
      inputs: [inPin],
      outputs: [outPin],
      nodes: [
        {
          id: inNodeId,
          type: 'macro_inputs',
          position: { x: 50, y: 200 },
          config: { pins: [inPin] },
        },
        {
          id: outNodeId,
          type: 'macro_outputs',
          position: { x: 550, y: 200 },
          config: { pins: [outPin] },
        },
      ],
      edges: [],
    };
    setGraph((g) => ({ ...g, macros: [...(g.macros || []), newMacro] }));
    setIsDirty(true);
    setActiveMacroId(macroId);
    showToast(`已创建宏「${name}」并打开子图`, 'success');
  };

  const handleDeleteMacro = (macroId: string) => {
    if (activeMacroId() === macroId) {
      setActiveMacroId(null);
    }
    setGraph((g) => ({
      ...g,
      macros: (g.macros || []).filter((m) => m.id !== macroId),
      nodes: g.nodes.filter((n) => !(n.type === 'macro_instance' && (n.config as any)?.macro_id === macroId)),
    }));
    setIsDirty(true);
    showToast('宏已删除', 'info');
  };

  const handlePlaceMacroInstance = (macroId: string) => {
    const macro = (graph().macros || []).find((m) => m.id === macroId);
    if (!macro) return;
    setActiveMacroId(null);
    const rect = svgContainerRef?.getBoundingClientRect();
    const v = viewTransform();
    const centerGraphX = rect
      ? (rect.width / 2 - v.offsetX) / v.zoom
      : 200;
    const centerGraphY = rect
      ? (rect.height / 2 - v.offsetY) / v.zoom
      : 300;
    const position: Position = { x: Math.round(centerGraphX - NODE_WIDTH / 2), y: Math.round(centerGraphY - 40) };
    const instanceNode: BlueprintNode = {
      id: `n_macro_inst_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(-3)}`,
      type: 'macro_instance',
      position,
      config: {
        macro_id: macro.id,
        name: macro.name,
      },
    };
    setGraph((g) => ({ ...g, nodes: [...g.nodes, instanceNode] }));
    setIsDirty(true);
    setIsMacroDrawerOpen(false);
    handleNodeSelect(instanceNode.id);
    showToast(`已放置宏实例「${macro.name}」`, 'success');
  };

  // ─── 添加节点 ───

  let svgContainerRef: HTMLDivElement | undefined;

  const hasStart = createMemo(() => displayGraph().nodes.some((n) => n.type === 'start'));
  const hasEnd = createMemo(() => displayGraph().nodes.some((n) => n.type === 'end'));

  const handleAddNode = (type: NodeType) => {
    const mId = activeMacroId();
    // 唯一性校验（仅在主蓝图中）
    if (!mId) {
      if (type === 'start' && hasStart()) {
        showToast('每图只能有一个 Start 节点', 'error');
        return;
      }
      if (type === 'end' && hasEnd()) {
        showToast('每图只能有一个 End 节点', 'error');
        return;
      }
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
    const currentNodes = displayGraph().nodes;
    const offset = currentNodes.length * 20;
    const position: Position = { x: centerGraphX - NODE_WIDTH / 2 + offset, y: centerGraphY - 40 + offset };
    const node = createNode(type, position);
    if (mId) {
      setGraph((g) => ({
        ...g,
        macros: (g.macros || []).map((m) =>
          m.id === mId
            ? { ...m, nodes: [...(m.nodes || []), node] }
            : m,
        ),
      }));
    } else {
      setGraph((g) => ({ ...g, nodes: [...g.nodes, node] }));
    }
    setIsDirty(true);
    setIsAddSheetOpen(false);
    handleNodeSelect(node.id);
    showToast(`已添加 ${type} 节点`, 'success', 1500);
  };

  // ─── 整理布局 ───

  const handleAutoLayout = () => {
    const g = displayGraph();
    const positions = autoLayout(g.nodes, g.edges);
    const mId = activeMacroId();
    if (mId) {
      setGraph((prev) => ({
        ...prev,
        macros: (prev.macros || []).map((m) =>
          m.id === mId
            ? {
                ...m,
                nodes: (m.nodes || []).map((n) => {
                  const pos = positions.get(n.id);
                  return pos ? { ...n, position: pos } : n;
                }),
              }
            : m,
        ),
      }));
    } else {
      setGraph((prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) => {
          const pos = positions.get(n.id);
          return pos ? { ...n, position: pos } : n;
        }),
      }));
    }
    setIsDirty(true);
    showToast('节点已自动整理', 'success', 1500);
  };

  // ─── 保存整个蓝图 ───

  const handleSaveGraph = () => {
    const g = graph();
    if (contractValidation() && !contractValidation()!.isValid) {
      showToast(
        contractValidation()!.errors[0] || 'UI 数据契约未对齐，存在缺失属性，无法保存',
        'error',
      );
      return;
    }
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

  const nodeCount = createMemo(() => displayGraph().nodes.length);
  const edgeCount = createMemo(() => displayGraph().edges.length);

  // ─── 当前选中注释框 ───

  const selectedComment = createMemo<BlueprintComment | null>(() => {
    const id = selectedCommentId();
    if (!id) return null;
    return graph().comments?.find((c) => c.id === id) ?? null;
  });

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
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="text-[13px] font-bold text-white truncate">{props.title}</span>
            <Show when={contractValidation()}>
              <Show
                when={contractValidation()!.isValid}
                fallback={
                  <button
                    type="button"
                    onClick={() => setIsContractDrawerOpen(true)}
                    class="shrink-0 text-[9px] font-semibold text-rose-300 border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 px-1.5 py-0.2 rounded-full animate-pulse flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                  >
                    <span class="w-1 h-1 rounded-full bg-rose-400"></span>
                    缺少字段 ({contractValidation()!.missingStats.length + contractValidation()!.missingFlags.length + (contractValidation()!.missingInventory ? 1 : 0)})
                  </button>
                }
              >
                <button
                  type="button"
                  onClick={() => setIsContractDrawerOpen(true)}
                  class="shrink-0 text-[9px] font-semibold text-emerald-300 border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 px-1.5 py-0.2 rounded-full flex items-center gap-1 active:scale-95 transition-all cursor-pointer"
                >
                  <span class="w-1 h-1 rounded-full bg-emerald-400"></span>
                  契约对齐
                </button>
              </Show>
            </Show>
          </div>
          <span class="text-[10px] text-mist-solid/45">
            {nodeCount()} 节点 · {edgeCount()} 连线{isDirty() ? ' · 未保存' : ''}
          </span>
        </div>
        <button
          onClick={() => setIsMacroDrawerOpen(true)}
          class="shrink-0 px-2 py-1.5 rounded-lg bg-accent/20 border border-accent/40 text-accent text-[12px] font-bold active:scale-95 transition-transform"
          aria-label="宏库"
        >
          宏库 ({graph().macros?.length || 0})
        </button>
        <button
          onClick={() => {
            setBoxSelectMode((v) => !v);
            handleNodesBoxSelected([]);
          }}
          class={`shrink-0 px-2 py-1.5 rounded-lg border text-[12px] font-bold active:scale-95 transition-transform ${
            boxSelectMode()
              ? 'bg-accent/25 border-accent/50 text-accent'
              : 'bg-white/5 border-white/10 text-mist-solid/70'
          }`}
          aria-label="框选模式"
        >
          框选
        </button>
        <button
          onClick={handleAddComment}
          class="shrink-0 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-mist-solid/70 text-[12px] font-bold active:scale-95 transition-transform"
          aria-label="添加注释框"
        >
          注释
        </button>
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
          disabled={contractValidation() !== null && !contractValidation()!.isValid}
          class={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-bold active:scale-95 transition-transform ${
            contractValidation() && !contractValidation()!.isValid
              ? 'bg-rose-500/20 text-rose-300/60 border border-rose-500/30 cursor-not-allowed'
              : 'bg-accent text-white shadow-[0_2px_8px_rgba(58,109,140,0.3)]'
          }`}
        >
          保存
        </button>
      </header>

      {/* 宏子图面包屑导航栏 */}
      <Show when={activeMacroId()}>
        <div class="px-4 py-2 border-b border-accent/30 bg-accent/10 flex items-center justify-between text-xs shrink-0 z-20">
          <div class="flex items-center gap-1.5 min-w-0">
            <button
              onClick={() => setActiveMacroId(null)}
              class="text-accent hover:underline font-bold shrink-0"
            >
              主蓝图
            </button>
            <span class="text-mist-solid/40">&gt;</span>
            <span class="font-bold text-white truncate">
              宏: {activeMacro()?.name}
            </span>
          </div>
          <button
            onClick={() => setActiveMacroId(null)}
            class="px-2.5 py-1 rounded-lg bg-accent/20 text-accent font-semibold text-[11px] shrink-0 active:bg-accent/30"
          >
            返回主蓝图
          </button>
        </div>
      </Show>

      {/* UI 契约错误横幅 */}
      <Show when={contractValidation() && !contractValidation()!.isValid}>
        <div class="px-4 py-2 border-b border-rose-500/30 bg-rose-950/40 text-[11px] text-rose-200 shrink-0 z-20">
          <div class="font-bold text-rose-400 mb-0.5">UI 数据契约未对齐（禁止保存）：</div>
          <For each={contractValidation()!.errors}>
            {(err) => <div class="truncate">• {err}</div>}
          </For>
        </div>
      </Show>

      {/* 画布 */}
      <div
        ref={(el) => { svgContainerRef = el; }}
        class="flex-1 min-h-0 relative"
      >
        <MobileBlueprintCanvas
          graph={displayGraph()}
          viewTransform={viewTransform()}
          selectedNodeIds={selectedNodeIds()}
          selectedCommentId={selectedCommentId()}
          boxSelectMode={boxSelectMode()}
          onNodeSelect={handleNodeSelect}
          onCommentSelect={handleCommentSelect}
          onNodesBoxSelected={handleNodesBoxSelected}
          onNodeMove={handleNodeMove}
          onNodesMoveBatch={handleNodesMoveBatch}
          onCommentMove={handleCommentMove}
          onEdgeCreate={handleEdgeCreate}
          onEdgeDelete={handleEdgeDelete}
          onGraphPan={handleGraphPan}
          onGraphZoom={handleGraphZoom}
          onOpenMacro={setActiveMacroId}
          errorNodeIds={errorNodeIds()}
        />

        {/* 框选模式提示 */}
        <Show when={boxSelectMode()}>
          <div class="absolute top-2 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-full bg-accent/15 border border-accent/30 text-accent text-[11px] font-bold backdrop-blur-md pointer-events-none">
            框选模式：拖动空白框选节点，再点一次退出
          </div>
        </Show>

        {/* 批量操作栏（框选 / 多选结果） */}
        <Show when={selectedNodeIds().size > 0}>
          <div class="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-2 rounded-2xl bg-xuanqing/95 border border-white/10 backdrop-blur-md shadow-xl">
            <span class="text-[12px] font-bold text-white px-1">已选 {selectedNodeIds().size}</span>
            <button
              onClick={handleDisconnectSelectedNodes}
              class="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-mist-solid text-[12px] font-bold active:scale-95 transition-transform"
            >
              断开连线
            </button>
            <button
              onClick={handleDeleteSelectedNodes}
              class="px-2.5 py-1.5 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-[12px] font-bold active:scale-95 transition-transform"
            >
              删除
            </button>
            <button
              onClick={() => handleNodesBoxSelected([])}
              class="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-mist-solid/60 text-[12px] font-bold active:scale-95 transition-transform"
            >
              清除
            </button>
          </div>
        </Show>

        {/* 注释框编辑栏（选中注释框时显示） */}
        <Show when={selectedComment()}>
          {(comment) => (
            <div class="absolute bottom-20 left-3 right-3 z-20 flex items-center gap-2 px-3 py-2 rounded-2xl bg-xuanqing/95 border border-white/10 backdrop-blur-md shadow-xl">
              <input
                type="text"
                value={comment().text}
                onInput={(e) => handleCommentTextChange(comment().id, e.currentTarget.value)}
                class="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[13px] text-white outline-none focus:border-accent/50"
                placeholder="注释文字"
              />
              <button
                onClick={() => handleDeleteComment(comment().id)}
                class="shrink-0 px-2.5 py-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-300 text-[12px] font-bold active:scale-95 transition-transform"
              >
                删除
              </button>
              <button
                onClick={() => handleCommentSelect(null)}
                class="shrink-0 px-2.5 py-2 rounded-lg bg-accent/15 border border-accent/30 text-accent text-[12px] font-bold active:scale-95 transition-transform"
              >
                完成
              </button>
            </div>
          )}
        </Show>

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
        macros={graph().macros || []}
        onOpenMacro={setActiveMacroId}
        availableTools={availableTools()}
        onConfigChange={handleConfigChange}
        onSave={handleSaveNode}
        onCancel={handleCancelNode}
        onDelete={handleDeleteNode}
      />

      {/* 移动端宏库底部抽屉 */}
      <MobileMacroDrawer
        isOpen={isMacroDrawerOpen()}
        onClose={() => setIsMacroDrawerOpen(false)}
        macros={graph().macros || []}
        activeMacroId={activeMacroId()}
        onSelectMacro={setActiveMacroId}
        onCreateMacro={handleCreateMacro}
        onDeleteMacro={handleDeleteMacro}
        onPlaceMacroInstance={handlePlaceMacroInstance}
      />

      {/* 移动端 UI 契约检查器底部抽屉 (Spec Line 102) */}
      <Show when={isContractDrawerOpen()}>
        <div class="fixed inset-0 z-[1600] flex flex-col justify-end animate-fade-in">
          <div
            class="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setIsContractDrawerOpen(false)}
          />
          <div class="relative w-full max-h-[80dvh] bg-xuanqing rounded-t-3xl border-t border-white/10 shadow-2xl flex flex-col safe-area-bottom pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div class="w-full flex justify-center pt-3 pb-1">
              <div class="w-12 h-1.5 bg-white/20 rounded-full" />
            </div>
            <div class="px-5 pt-2 pb-3 border-b border-white/5 flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class={`w-2.5 h-2.5 rounded-full ${contractValidation()?.isValid ? 'bg-emerald-400' : 'bg-rose-400'}`}></span>
                <h3 class="text-[15px] font-bold text-white">UI 契约检查器 (Inspector)</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsContractDrawerOpen(false)}
                class="text-[12px] text-mist-solid/60 px-2.5 py-1 rounded bg-white/5"
              >
                关闭
              </button>
            </div>
            <div class="p-5 overflow-y-auto space-y-3.5 text-xs">
              <Show
                when={contractValidation() && !contractValidation()!.isValid}
                fallback={
                  <div class="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300">
                    <div class="font-bold mb-0.5">✅ 契约已完整对齐</div>
                    <p class="text-[11px] text-emerald-400/80">当前蓝图完全满足 UI 布局所需的全部属性与标志位。</p>
                  </div>
                }
              >
                <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300">
                  <div class="font-bold">⚠️ 缺少必需的 UI 契约声明</div>
                  <p class="text-[11px] text-rose-300/80 mt-0.5">
                    请在 InitialStateConfig 中声明以下字段，否则无法保存：
                  </p>
                </div>

                <Show when={contractValidation()!.missingStats.length > 0}>
                  <div class="space-y-1">
                    <span class="font-bold text-mist-solid">缺失数值属性 (Stats)</span>
                    <div class="space-y-1">
                      <For each={contractValidation()!.missingStats}>
                        {(stat) => (
                          <div class="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5 font-mono text-[11px]">
                            <span class="text-rose-300">stats.{stat}</span>
                            <span class="text-[10px] text-mist-solid/40">number</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={contractValidation()!.missingFlags.length > 0}>
                  <div class="space-y-1">
                    <span class="font-bold text-mist-solid">缺失剧情标志 (Flags)</span>
                    <div class="space-y-1">
                      <For each={contractValidation()!.missingFlags}>
                        {(flag) => (
                          <div class="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/5 font-mono text-[11px]">
                            <span class="text-amber-300">flags.{flag}</span>
                            <span class="text-[10px] text-mist-solid/40">string</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <Show when={contractValidation()!.missingInventory}>
                  <div class="space-y-1">
                    <span class="font-bold text-mist-solid">背包支持 (Inventory)</span>
                    <div class="p-2 rounded-lg bg-white/5 border border-white/5 text-rose-300 text-[11px]">
                      UI 包含背包槽位，需在 InitialStateConfig 中配置背包
                    </div>
                  </div>
                </Show>

                <Show when={contractValidation()!.errors.length > 0}>
                  <div class="space-y-1">
                    <span class="font-bold text-mist-solid">错误清单</span>
                    <div class="p-2.5 rounded-lg bg-black/40 border border-white/5 font-mono text-[11px] text-rose-300/90 space-y-0.5">
                      <For each={contractValidation()!.errors}>
                        {(err) => <div>• {err}</div>}
                      </For>
                    </div>
                  </div>
                </Show>
              </Show>
            </div>
          </div>
        </div>
      </Show>

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
