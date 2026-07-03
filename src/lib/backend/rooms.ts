import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeCommand, toInvokeArgs } from './internal';
import type {
  GuestCharacterCardPayload,
  RoomContextSnapshotEvent,
  RoomCreateResult,
  RoomErrorEvent,
  RoomJoinResult,
  RoomMemberJoinedEvent,
  RoomMemberLeftEvent,
  RoomMessageResetEvent,
  RoomOpenResult,
  RoomPlayerMessageEvent,
  RoomRoundStateUpdateEvent,
  RoomStatusResult,
  RoomStreamChunkEvent,
  RoomStreamEndEvent,
  RoomStreamObjectFieldCompleteEvent,
  RoomStreamRetryEvent,
  RoomStreamStructuredFieldDeltaEvent,
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
