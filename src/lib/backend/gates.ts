/**
 * 预设级 Gate 选择 IPC 封装（spec 里程碑 C）。
 *
 * 4 个 Tauri command 包装，供 PC 与移动端 PresetDetailView 调用：
 * - `updatePresetGateSelection`：写入/更新某 Gate 节点的选择（空数组等同清除）
 * - `loadPresetGateSelections`：加载某预设下全部 Gate 选择
 * - `clearPresetGateSelection`：清除某 Gate 节点的选择（幂等）
 * - `loadBlueprintGates`：加载某预设蓝图中全部 Gate 节点定义
 *
 * 与后端 `src-tauri/src/commands/blueprint.rs` 中的命令一一对应。错误信息
 * 已在后端侧把反斜杠替换为正斜杠，前端可直接展示。
 */

import { invokeCommand } from './internal';
import type { BlueprintGate, PresetGateSelection } from './types';

/**
 * 更新（或清除）某预设下指定 Gate 节点的选择。
 *
 * 当 `selectedKeys` 为空时，仓库层会删除对应行，回到未配置状态——这与
 * `clearPresetGateSelection` 等效，但语义上"用户主动选了空"更自然走这里。
 */
export async function updatePresetGateSelection(
  presetId: number,
  nodeId: string,
  selectedKeys: string[],
): Promise<void> {
  return invokeCommand<void>('update_preset_gate_selection', {
    presetId,
    nodeId,
    selectedKeys,
  });
}

/**
 * 加载某预设下的全部 Gate 选择，按 node_id 升序返回。
 */
export async function loadPresetGateSelections(
  presetId: number,
): Promise<PresetGateSelection[]> {
  return invokeCommand<PresetGateSelection[]>('load_preset_gate_selections', {
    presetId,
  });
}

/**
 * 清除某预设下指定 Gate 节点的选择（用户取消选择时调用）。幂等。
 */
export async function clearPresetGateSelection(
  presetId: number,
  nodeId: string,
): Promise<void> {
  return invokeCommand<void>('clear_preset_gate_selection', {
    presetId,
    nodeId,
  });
}

/**
 * 加载某预设蓝图中的全部 Gate 节点定义，供预设详情视图渲染选择 UI。
 *
 * 仅返回 MutexGate / GroupGate 节点（kind 分别为 `"mutex"` / `"group"`）。
 * 蓝图 JSON 缺失或解析失败按 C2 零回退原则由后端显式报错。
 */
export async function loadBlueprintGates(
  presetId: number,
): Promise<BlueprintGate[]> {
  return invokeCommand<BlueprintGate[]>('load_blueprint_gates', {
    presetId,
  });
}

/** 归一化结果：改写后的图 JSON，以及是否发生了拓扑迁移。 */
export interface NormalizedBlueprintGraph {
  graphJson: string;
  migrated: boolean;
}

/**
 * 归一化蓝图图 JSON：把旧拓扑（Constant 串在 exec 链上）改写为
 * 「上游 → Branch(in)」+「Constant → Branch(value)」的 value 引脚数据流拓扑。
 *
 * 改写规则由后端裁定（C1 前端只渲染）。`migrated` 为 true 时前端必须可见地
 * 提示用户保存，禁止静默迁移（C2）。
 */
export async function normalizeBlueprintGraph(
  graphJson: string,
): Promise<NormalizedBlueprintGraph> {
  return invokeCommand<NormalizedBlueprintGraph>('normalize_blueprint_graph', {
    graphJson,
  });
}

export interface PresetConversationOption {
  id: number;
  title: string;
  conversationType: string;
  memoryMode: string;
  protocol: string;
  updatedAt: number;
}

export interface BlueprintPreviewBlock {
  sourceKind: string;
  nodeId?: string | null;
  nodeLabel?: string | null;
  identifier: string;
  content: string;
}

export interface BlueprintCompilePreview {
  blocks: BlueprintPreviewBlock[];
  structuredOutputSchema: Record<string, unknown>;
  fullPromptText: string;
}

export async function listPresetConversations(
  presetId: number,
): Promise<PresetConversationOption[]> {
  return invokeCommand<PresetConversationOption[]>('list_preset_conversations', {
    presetId,
  });
}

export async function previewBlueprintWithSession(
  presetId: number,
  graphJson: string,
  conversationId?: number | null,
): Promise<BlueprintCompilePreview> {
  return invokeCommand<BlueprintCompilePreview>('preview_blueprint_with_session', {
    presetId,
    graphJson,
    conversationId: conversationId ?? null,
  });
}
