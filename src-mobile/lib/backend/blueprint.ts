import { invoke } from '@tauri-apps/api/core';

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
