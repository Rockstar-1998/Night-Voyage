import { invokeCommand } from './internal';
import type {
  ChatSubmitInputResult,
  RegenerateRoundResult,
  RetryFailedRoundResult,
  RoundState,
  UiMessage,
} from './types';

export async function messagesList(conversationId: number, limit = 200) {
  return invokeCommand<UiMessage[]>('messages_list', { conversationId, limit });
}

export async function sendMessage(conversationId: number, providerId: number, content: string) {
  return invokeCommand<ChatSubmitInputResult>('send_message', { conversationId, providerId, content });
}

export async function chatSubmitInput(conversationId: number, memberId: number, content: string) {
  return invokeCommand<ChatSubmitInputResult>('chat_submit_input', { conversationId, memberId, content });
}

export async function regenerateMessage(conversationId: number, memberId: number, providerId: number, replyToId: number) {
  return invokeCommand<RegenerateRoundResult>('regenerate_message', { conversationId, memberId, providerId, replyToId });
}

export async function chatRegenerateRound(conversationId: number, memberId: number, roundId: number) {
  return invokeCommand<RegenerateRoundResult>('chat_regenerate_round', { conversationId, memberId, roundId });
}

export async function roundStateGet(conversationId: number) {
  return invokeCommand<RoundState>('round_state_get', { conversationId });
}

export async function messagesUpdateContent(conversationId: number, memberId: number, messageId: number, content: string) {
  return invokeCommand<void>('messages_update_content', { conversationId, memberId, messageId, content });
}

export async function messagesSwitchSwipe(conversationId: number, memberId: number, roundId: number, targetMessageId: number) {
  return invokeCommand<UiMessage>('messages_switch_swipe', { conversationId, memberId, roundId, targetMessageId });
}

export async function messagesDelete(conversationId: number, memberId: number, messageId: number) {
  return invokeCommand<void>('messages_delete', { conversationId, memberId, messageId });
}

export async function abortRoundStream(conversationId: number, memberId: number, roundId: number) {
  return invokeCommand<void>('abort_round_stream', { conversationId, memberId, roundId });
}

export async function retryFailedRound(conversationId: number, memberId: number, roundId: number) {
  return invokeCommand<RetryFailedRoundResult>('retry_failed_round', { conversationId, memberId, roundId });
}
