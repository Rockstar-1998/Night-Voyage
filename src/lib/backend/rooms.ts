import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeCommand, toInvokeArgs } from './internal';
import type {
  GuestCharacterCardPayload,
  RoomContextSnapshotEvent,
  RoomContextWindowChangedEvent,
  RoomCreateResult,
  RoomErrorEvent,
  RoomGuestCharacterUpdatedEvent,
  RoomJoinResult,
  RoomMemberJoinedEvent,
  RoomMemberLeftEvent,
  RoomMessageDeletedEvent,
  RoomMessageEditedEvent,
  RoomMessageResetEvent,
  RoomOpenResult,
  RoomPlayerMessageEvent,
  RoomPlotSummaryUpdateEvent,
  RoomRewoundToRoundEvent,
  RoomRoundStateUpdateEvent,
  RoomSchemaToggleEvent,
  RoomStatusResult,
  RoomStreamChunkEvent,
  RoomStreamEndEvent,
  RoomStreamObjectFieldCompleteEvent,
  RoomStreamRetryEvent,
  RoomStreamStructuredFieldDeltaEvent,
  RoomSwipeActivatedEvent,
  RoomTokenUsageEvent,
} from './types';

// ─── Room Commands ───

export async function roomCreate(payload: {
  roomName: string;
  conversationId: number;
  port: number;
  passphrase?: string;
}) {
  return invokeCommand<RoomCreateResult>('room_create', toInvokeArgs(payload));
}

export async function roomOpen(payload: {
  conversationId: number;
}) {
  return invokeCommand<RoomOpenResult>('room_open', toInvokeArgs(payload));
}

export async function roomGetStatus(payload: {
  conversationId: number;
}) {
  return invokeCommand<RoomStatusResult>('room_get_status', toInvokeArgs(payload));
}

export async function roomJoin(payload: {
  hostAddress: string;
  port: number;
  displayName: string;
  character?: GuestCharacterCardPayload;
}) {
  return invokeCommand<RoomJoinResult>('room_join', toInvokeArgs(payload));
}

export async function roomLeave() {
  return invokeCommand<void>('room_leave');
}

export async function roomClose() {
  return invokeCommand<void>('room_close');
}

export async function roomSendMessage(payload: {
  content: string;
  actionType: string;
  displayName: string;
  memberId: number;
}) {
  return invokeCommand<void>('room_send_message', toInvokeArgs(payload));
}

export async function roomRequestContext() {
  return invokeCommand<void>('room_request_context');
}

export async function roomBroadcastSchemaToggle(toggleKey: string, expanded: boolean) {
  return invokeCommand<void>('room_broadcast_schema_toggle', toInvokeArgs({ toggleKey, expanded }));
}

export async function roomBroadcastTokenUsage(conversationId: number) {
  return invokeCommand<void>('room_broadcast_token_usage', toInvokeArgs({ conversationId }));
}

export async function roomBroadcastPlotSummary(conversationId: number) {
  return invokeCommand<void>('room_broadcast_plot_summary', toInvokeArgs({ conversationId }));
}

// Stream lifecycle broadcasts are now emitted by the backend (stream_processor.rs +
// chat_service.rs) directly via host_server.broadcast_message, so the frontend no
// longer triggers room_broadcast_stream_* commands. See room-stream-sync spec.

// ─── Room Events ───

export async function listenRoomMemberJoined(
  handler: (payload: RoomMemberJoinedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMemberJoinedEvent>('room:member_joined', (event) => {
    console.debug('[room-member_joined]', {
      memberId: event.payload.memberId,
      displayName: event.payload.displayName,
    });
    handler(event.payload);
  });
}

export async function listenRoomMemberLeft(
  handler: (payload: RoomMemberLeftEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMemberLeftEvent>('room:member_left', (event) => {
    console.debug('[room-member_left]', {
      memberId: event.payload.memberId,
      displayName: event.payload.displayName,
    });
    handler(event.payload);
  });
}

export async function listenRoomPlayerMessage(
  handler: (payload: RoomPlayerMessageEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomPlayerMessageEvent>('room:player_message', (event) => {
    console.debug('[room-player_message]', {
      memberId: event.payload.memberId,
      displayName: event.payload.displayName,
      actionType: event.payload.actionType,
      conversationId: event.payload.conversationId,
      roundId: event.payload.roundId,
      messageId: event.payload.messageId,
      contentLength: event.payload.content?.length ?? 0,
    });
    handler(event.payload);
  });
}

export async function listenRoomDisconnected(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen<void>('room:disconnected', () => {
    console.debug('[room-disconnected]');
    handler();
  });
}

export async function listenRoomError(
  handler: (payload: string | RoomErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<string | RoomErrorEvent>('room:error', (event) => {
    console.debug('[room-error]', event.payload);
    handler(event.payload);
  });
}

export async function listenRoomStreamChunk(
  handler: (payload: RoomStreamChunkEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamChunkEvent>('room:stream_chunk', (event) => {
    console.debug('[room-stream_chunk]', {
      conversationId: event.payload.conversationId,
      messageId: event.payload.messageId,
      deltaLength: event.payload.delta?.length ?? 0,
    });
    handler(event.payload);
  });
}

export async function listenRoomStreamEnd(
  handler: (payload: RoomStreamEndEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamEndEvent>('room:stream_end', (event) => {
    console.debug('[room-stream_end]', {
      conversationId: event.payload.conversationId,
      roundId: event.payload.roundId,
      messageId: event.payload.messageId,
    });
    handler(event.payload);
  });
}

export async function listenRoomStreamStructuredFieldDelta(
  handler: (payload: RoomStreamStructuredFieldDeltaEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamStructuredFieldDeltaEvent>('room:stream_structured_field_delta', (event) => {
    console.debug('[room-stream_structured_field_delta]', {
      conversationId: event.payload.conversationId,
      messageId: event.payload.messageId,
      fieldKey: event.payload.fieldKey,
      deltaLength: event.payload.delta?.length ?? 0,
    });
    handler(event.payload);
  });
}

export async function listenRoomStreamObjectFieldComplete(
  handler: (payload: RoomStreamObjectFieldCompleteEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamObjectFieldCompleteEvent>('room:stream_object_field_complete', (event) => {
    console.debug('[room-stream_object_field_complete]', {
      conversationId: event.payload.conversationId,
      messageId: event.payload.messageId,
      fieldKey: event.payload.fieldKey,
    });
    handler(event.payload);
  });
}

export async function listenRoomStreamRetry(
  handler: (payload: RoomStreamRetryEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamRetryEvent>('room:stream_retry', (event) => {
    console.debug('[room-stream_retry]', {
      conversationId: event.payload.conversationId,
      roundId: event.payload.roundId,
      messageId: event.payload.messageId,
      error: event.payload.error,
      attemptCount: event.payload.attemptCount,
    });
    handler(event.payload);
  });
}

export async function listenRoomMessageReset(
  handler: (payload: RoomMessageResetEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMessageResetEvent>('room:message_reset', (event) => {
    console.debug('[room-message_reset]', {
      conversationId: event.payload.conversationId,
      roundId: event.payload.roundId,
      messageId: event.payload.messageId,
    });
    handler(event.payload);
  });
}

export async function listenRoomRoundStateUpdate(
  handler: (payload: RoomRoundStateUpdateEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomRoundStateUpdateEvent>('room:round_state_update', (event) => {
    console.debug('[room-round_state_update]', {
      roundState: event.payload.roundState,
    });
    handler(event.payload);
  });
}

export async function listenRoomContextSnapshot(
  handler: (payload: RoomContextSnapshotEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomContextSnapshotEvent>('room:context_snapshot', (event) => {
    console.debug('[room-context_snapshot]', {
      conversationId: event.payload.conversationId,
      messageCount: event.payload.messages?.length ?? 0,
      memberCount: event.payload.members?.length ?? 0,
      hostCharacterName: event.payload.hostCharacterName ?? null,
    });
    handler(event.payload);
  });
}

export async function listenRoomSchemaToggle(
  handler: (payload: RoomSchemaToggleEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomSchemaToggleEvent>('room:schema_toggle', (event) => {
    console.debug('[room-schema_toggle]', {
      conversationId: event.payload.conversationId,
      toggleKey: event.payload.toggleKey,
      expanded: event.payload.expanded,
    });
    handler(event.payload);
  });
}

export async function listenRoomTokenUsage(
  handler: (payload: RoomTokenUsageEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomTokenUsageEvent>('room:token_usage', (event) => {
    console.debug('[room-token_usage] received', {
      conversationId: event.payload.conversationId,
      totalEstimatedTokens: event.payload.tokenUsageReport?.totalEstimatedTokens,
    });
    handler(event.payload);
  });
}

export async function listenRoomPlotSummaryUpdate(
  handler: (payload: RoomPlotSummaryUpdateEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomPlotSummaryUpdateEvent>('room:plot_summary_update', (event) => {
    console.debug('[room-plot_summary_update] received', {
      conversationId: event.payload.conversationId,
      summaryCount: event.payload.summaries?.length ?? 0,
    });
    handler(event.payload);
  });
}

export async function listenRoomMessageEdited(
  handler: (payload: RoomMessageEditedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMessageEditedEvent>('room:message_edited', (event) => {
    console.debug('[room-message_edited] received', {
      conversationId: event.payload.conversationId,
      messageId: event.payload.messageId,
      contentLength: event.payload.content?.length ?? 0,
    });
    handler(event.payload);
  });
}

export async function listenRoomMessageDeleted(
  handler: (payload: RoomMessageDeletedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMessageDeletedEvent>('room:message_deleted', (event) => {
    console.debug('[room-message_deleted] received', {
      conversationId: event.payload.conversationId,
      messageId: event.payload.messageId,
      roundDeleted: event.payload.roundDeleted,
    });
    handler(event.payload);
  });
}

export async function listenRoomRewoundToRound(
  handler: (payload: RoomRewoundToRoundEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomRewoundToRoundEvent>('room:rewound_to_round', (event) => {
    console.debug('[room-rewound_to_round] received', {
      conversationId: event.payload.conversationId,
      targetRoundId: event.payload.targetRoundId,
    });
    handler(event.payload);
  });
}

export async function listenRoomContextWindowChanged(
  handler: (payload: RoomContextWindowChangedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomContextWindowChangedEvent>('room:context_window_changed', (event) => {
    console.debug('[room-context_window_changed] received', {
      conversationId: event.payload.conversationId,
      contextWindowSize: event.payload.contextWindowSize,
    });
    handler(event.payload);
  });
}

export async function listenRoomGuestCharacterUpdated(
  handler: (payload: RoomGuestCharacterUpdatedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomGuestCharacterUpdatedEvent>('room:guest_character_updated', (event) => {
    console.debug('[room-guest_character_updated] received', {
      conversationId: event.payload.conversationId,
      memberId: event.payload.memberId,
      characterName: event.payload.character?.name,
    });
    handler(event.payload);
  });
}

export async function listenRoomSwipeActivated(
  handler: (payload: RoomSwipeActivatedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomSwipeActivatedEvent>('room:swipe_activated', (event) => {
    console.debug('[room-swipe_activated] received', {
      conversationId: event.payload.conversationId,
      roundId: event.payload.roundId,
      messageId: event.payload.messageId,
    });
    handler(event.payload);
  });
}

export async function roomUpdateGuestCharacter(payload: {
  conversationId: number;
  memberId: number;
  character: GuestCharacterCardPayload;
}): Promise<void> {
  return invokeCommand<void>('room_update_guest_character', toInvokeArgs(payload));
}
