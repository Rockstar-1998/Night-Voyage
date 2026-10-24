import { invoke } from '@tauri-apps/api/core';

export interface ContractValidationResultDto {
  is_valid: boolean;
  missing_stats: string[];
  missing_inventory: boolean;
  missing_flags: string[];
  errors: string[];
}

export async function blueprintValidateUiContract(
  graphJson: string,
  presetId?: number,
): Promise<ContractValidationResultDto> {
  return invoke<ContractValidationResultDto>('blueprint_validate_ui_contract', {
    presetId: presetId ?? 0,
    graphJson,
  });
}
