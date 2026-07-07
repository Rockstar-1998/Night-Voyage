import { invokeCommand, toInvokeArgs } from './internal';
import type {
  ConversationCreateResult,
  ConversationListItem,
  ConversationMember,
  ConversationMode,
  CreateConversationPayload,
  TokenUsageReport,
  UpdateConversationBindingsPayload,
} from './types';

export async function conversationsList() {
  return invokeCommand<ConversationListItem[]>('conversations_list');
}

export async function conversationsCreate(payload: CreateConversationPayload) {
  return invokeCommand<ConversationCreateResult>('conversations_create', toInvokeArgs(payload));
}

export async function conversationsUpdateBindings(payload: UpdateConversationBindingsPayload) {
  return invokeCommand<ConversationListItem>('conversations_update_bindings', toInvokeArgs(payload));
}

export async function conversationsDelete(id: number) {
  return invokeCommand<void>('conversations_delete', { id });
}

export async function conversationMembersList(conversationId: number) {
  return invokeCommand<ConversationMember[]>('conversation_members_list', { conversationId });
}

export async function conversationMembersCreate(payload: {
  conversationId: number;
  displayName: string;
  playerCharacterId?: number;
}) {
  return invokeCommand<ConversationMember>('conversation_members_create', toInvokeArgs(payload));
}

export async function conversationMembersUpdate(payload: {
  memberId: number;
  displayName?: string;
  playerCharacterId?: number;
  isActive?: boolean;
}) {
  return invokeCommand<ConversationMember>('conversation_members_update', toInvokeArgs(payload));
}

export async function conversationMembersDelete(memberId: number) {
  return invokeCommand<void>('conversation_members_delete', { memberId });
}

export async function getConversationTokenUsage(conversationId: number): Promise<TokenUsageReport> {
  return invokeCommand<TokenUsageReport>('get_conversation_token_usage', { conversationId });
}

export async function updateConversationContextWindow(conversationId: number, contextWindowSize: number): Promise<void> {
  return invokeCommand<void>('update_conversation_context_window', { conversationId, contextWindowSize });
}

export async function conversationsFork(conversationId: number, upToMessageId: number) {
  return invokeCommand<number>('conversations_fork', { conversationId, upToMessageId });
}

/**
 * 解析会话的能力模式，返回与后端 `ConversationMode` 枚举对齐的 snake_case 字符串。
 *
 * single 模式可省略 `memberId`；online 模式必须提供 `memberId` 以区分房主/房客。
 * 返回值可直接传给 `selectProfile()` 获取 `CapabilityProfile` 驱动 UI 按钮显隐。
 */
export async function getConversationMode(
  conversationId: number,
  memberId?: number,
): Promise<ConversationMode> {
  return invokeCommand<ConversationMode>('resolve_conversation_mode', {
    conversationId,
    memberId,
  });
}
