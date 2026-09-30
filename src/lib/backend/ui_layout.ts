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

/** 把某个布局绑定为指定会话当前生效的常驻 HUD 布局。 */
export async function presetUiLayoutActivate(
  sessionId: number,
  layoutId: string,
): Promise<UILayoutDefinition> {
  return invoke<UILayoutDefinition>('preset_ui_layout_activate', { sessionId, layoutId });
}

/**
 * 取会话当前生效的布局。
 *
 * 未绑定 / 绑定的布局已删除时会**抛错**（后端刻意不返回默认模板）——
 * 调用方必须把错误显式呈现或退回到内置默认视图，不能假装"布局已生效"。
 */
export async function presetUiLayoutForConversation(
  conversationId: number,
): Promise<UILayoutDefinition> {
  return invoke<UILayoutDefinition>('preset_ui_layout_for_conversation', { conversationId });
}
