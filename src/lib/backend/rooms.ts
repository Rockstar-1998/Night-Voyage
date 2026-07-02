import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invokeCommand, toInvokeArgs } from './internal';
import type {
  RoomCreateResult,
  RoomErrorEvent,
  RoomJoinResult,
  RoomMemberJoinedEvent,
  RoomMemberLeftEvent,
  RoomMessageResetEvent,
  RoomPlayerMessageEvent,
  RoomRoundStateUpdateEvent,
  RoomStreamChunkEvent,
  RoomStreamEndEvent,
  RoomStreamRetryEvent,
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

export async function roomJoin(payload: {
  hostAddress: string;
  port: number;
  displayName: string;
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

// ─── Room Events ───

export async function listenRoomMemberJoined(
  handler: (payload: RoomMemberJoinedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMemberJoinedEvent>('room:member_joined', (event) => handler(event.payload));
}

export async function listenRoomMemberLeft(
  handler: (payload: RoomMemberLeftEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMemberLeftEvent>('room:member_left', (event) => handler(event.payload));
}

export async function listenRoomPlayerMessage(
  handler: (payload: RoomPlayerMessageEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomPlayerMessageEvent>('room:player_message', (event) => handler(event.payload));
}

export async function listenRoomDisconnected(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen<void>('room:disconnected', () => handler());
}

export async function listenRoomError(
  handler: (payload: string | RoomErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<string | RoomErrorEvent>('room:error', (event) => handler(event.payload));
}

export async function listenRoomStreamChunk(
  handler: (payload: RoomStreamChunkEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamChunkEvent>('room:stream_chunk', (event) => handler(event.payload));
}

export async function listenRoomStreamEnd(
  handler: (payload: RoomStreamEndEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamEndEvent>('room:stream_end', (event) => handler(event.payload));
}

export async function listenRoomStreamRetry(
  handler: (payload: RoomStreamRetryEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamRetryEvent>('room:stream_retry', (event) => handler(event.payload));
}

export async function listenRoomMessageReset(
  handler: (payload: RoomMessageResetEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMessageResetEvent>('room:message_reset', (event) => handler(event.payload));
}

export async function listenRoomRoundStateUpdate(
  handler: (payload: RoomRoundStateUpdateEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomRoundStateUpdateEvent>('room:round_state_update', (event) => handler(event.payload));
}
