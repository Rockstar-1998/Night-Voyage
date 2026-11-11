import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface ContractValidationResultDto {
  isValid: boolean;
  missingStats: string[];
  missingInventory: boolean;
  missingFlags: string[];
  errors: string[];
}

export interface McpToolNameDto {
  name: string;
  description: string;
}

export async function blueprintValidateUiContract(
  presetId: number,
  graphJson: string,
): Promise<ContractValidationResultDto> {
  return invoke<ContractValidationResultDto>('blueprint_validate_ui_contract', {
    presetId,
    graphJson,
  });
}

export async function mcpToolNames(): Promise<McpToolNameDto[]> {
  return invoke<McpToolNameDto[]>('mcp_tool_names');
}

export async function actionBridgeWhitelistGet(): Promise<string[]> {
  const res = await invoke<{ commands?: string[] } | string[]>('action_bridge_whitelist_get');
  return Array.isArray(res) ? res : (res?.commands ?? []);
}

/** 归一化结果：改写后的图 JSON，以及是否发生了拓扑迁移。 */
export interface NormalizedBlueprintGraph {
  graphJson: string;
  migrated: boolean;
}

/** 归一化蓝图图 JSON：旧拓扑改写规则由后端裁定（C1），`migrated` 为 true 时必须可见提示（C2）。 */
export async function normalizeBlueprintGraph(
  graphJson: string,
): Promise<NormalizedBlueprintGraph> {
  return invoke<NormalizedBlueprintGraph>('normalize_blueprint_graph', { graphJson });
}

/** `.nv.ts` 导入结果 DTO（与后端 `ImportedPresetCodeDto` camelCase 对齐）。 */
export interface ImportedPresetCode {
  message: string;
  bytes: number;
  migrated: boolean;
  graphJson: string;
}

/** 蓝图编辑器重载所需的最小预设详情视图。 */
export interface BlueprintPresetDetail {
  preset: { blueprintGraph: string | null };
}

/**
 * 读取预设详情中蓝图编辑器重载所需的最小字段（presets_get）。
 *
 * 移动端本地绑定：编辑器重载不引用 PC 端绑定模块（C5 目录隔离）。
 */
export async function presetsGetBlueprint(presetId: number): Promise<BlueprintPresetDetail> {
  return invoke<BlueprintPresetDetail>('presets_get', { id: presetId });
}

/**
 * 导出预设蓝图图为 `.nv.ts` 代码（spec §4 / 工单 05 前端挂载入口）。
 * 与 MCP 工具 `nv_preset_export_code` 调用同一条后端服务路径（C10）。
 */
export async function blueprintExportPresetCode(presetId: number): Promise<string> {
  return invoke<string>('blueprint_export_preset_code', { presetId });
}

/**
 * 把 `.nv.ts` 源码导入为预设蓝图图（spec §4 / 工单 05 前端挂载入口）。
 * 与 MCP 工具 `nv_preset_import_code` 调用同一条后端服务路径（C10）；成功后
 * 后端广播 `blueprint:refreshed`，编辑器监听该事件重载当前图。
 */
export async function blueprintImportPresetCode(
  presetId: number,
  code: string,
): Promise<ImportedPresetCode> {
  return invoke<ImportedPresetCode>('blueprint_import_preset_code', { presetId, code });
}

/** blueprint:refreshed 事件载荷：`.nv.ts` 导入落库后广播，携带目标预设 id。 */
export interface BlueprintRefreshedEvent {
  presetId: number;
}

/** 订阅 blueprint:refreshed：蓝图编辑器据此重载当前图（spec §4 / C10 前端挂载）。 */
export async function listenBlueprintRefreshed(
  handler: (payload: BlueprintRefreshedEvent) => void,
): Promise<UnlistenFn> {
  return listen<BlueprintRefreshedEvent>('blueprint:refreshed', (event) =>
    handler(event.payload),
  );
}
