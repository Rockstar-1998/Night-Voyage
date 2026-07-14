import { invokeCommand, toInvokeArgs } from './internal';
import type {
  CreatePresetPayload,
  PresetCompilePreview,
  PresetDetail,
  PresetSummary,
} from './types';

export async function presetsList() {
  return invokeCommand<PresetSummary[]>('presets_list');
}

export async function presetsGet(id: number) {
  return invokeCommand<PresetDetail>('presets_get', { id });
}

export async function presetsCompilePreview(id: number, providerKind?: string) {
  return invokeCommand<PresetCompilePreview>('presets_compile_preview', { id, providerKind });
}

export async function presetsCreate(payload: CreatePresetPayload) {
  return invokeCommand<PresetDetail>('presets_create', toInvokeArgs(payload));
}

export async function presetsUpdate(payload: CreatePresetPayload & { id: number }) {
  return invokeCommand<PresetDetail>('presets_update', toInvokeArgs(payload));
}

export async function presetsExport(id: number) {
  return invokeCommand<string>('presets_export', { id });
}

export async function presetsImport(payloadJson: string) {
  return invokeCommand<PresetDetail>('presets_import', { payloadJson });
}

export async function presetsDelete(id: number) {
  return invokeCommand<void>('presets_delete', { id });
}

export async function presetsRename(id: number, newName: string) {
  return invokeCommand<PresetDetail>('presets_rename', { id, newName });
}

export async function presetsDuplicate(id: number, newName: string) {
  return invokeCommand<PresetDetail>('presets_duplicate', { id, newName });
}
