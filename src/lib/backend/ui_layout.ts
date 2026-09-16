import { invoke } from '@tauri-apps/api/core';
import type { UILayoutDefinition } from './types';

export async function presetUiLayoutList(presetId: number): Promise<UILayoutDefinition[]> {
  return invoke<UILayoutDefinition[]>('preset_ui_layout_list', { presetId });
}

export async function presetUiLayoutGet(layoutId: string): Promise<UILayoutDefinition> {
  return invoke<UILayoutDefinition>('preset_ui_layout_get', { layoutId });
}

export async function presetUiLayoutSave(layout: UILayoutDefinition): Promise<UILayoutDefinition> {
  return invoke<UILayoutDefinition>('preset_ui_layout_save', { layout });
}

export async function presetUiLayoutDelete(layoutId: string): Promise<void> {
  return invoke<void>('preset_ui_layout_delete', { layoutId });
}
