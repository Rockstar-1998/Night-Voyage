import { invoke } from '@tauri-apps/api/core';

export async function actionBridgeWhitelistGet(): Promise<string[]> {
  const result = await invoke<{ commands: string[] }>('action_bridge_whitelist_get', {});
  return result.commands ?? [];
}

export async function actionBridgeWhitelistSet(commands: string[]): Promise<void> {
  return invoke<void>('action_bridge_whitelist_set', { commands });
}

export async function actionBridgeInvoke(
  conversationId: number,
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return invoke<unknown>('action_bridge_invoke', { conversationId, command, args });
}
