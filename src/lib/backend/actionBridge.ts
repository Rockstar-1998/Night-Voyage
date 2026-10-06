import { invokeCommand } from './internal';

/**
 * action_bridge 前端封装（spec：L3 动作通道 / L4 产物通道）。
 *
 * 白名单是设置数据（settings 表），动作件（HUD ActionButton / 产物卡按钮）
 * 点击时经 `action_bridge_invoke` 走白名单校验 + 后端分发；未注册命令显式报错（I2）。
 */

export async function actionBridgeWhitelistGet(): Promise<string[]> {
  const result = await invokeCommand<{ commands: string[] }>('action_bridge_whitelist_get', {});
  return result.commands ?? [];
}

export async function actionBridgeWhitelistSet(commands: string[]): Promise<void> {
  return invokeCommand<void>('action_bridge_whitelist_set', { commands });
}

/** 点击动作：白名单校验 + 分发到既有命令实现，返回结果 JSON。 */
export async function actionBridgeInvoke(
  conversationId: number,
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  return invokeCommand<unknown>('action_bridge_invoke', { conversationId, command, args });
}
