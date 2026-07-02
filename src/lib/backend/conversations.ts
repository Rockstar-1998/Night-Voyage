import { invokeCommand, toInvokeArgs } from './internal';
import type {
  ConversationCreateResult,
  ConversationListItem,
  ConversationMember,
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
