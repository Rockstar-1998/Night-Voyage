import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  CharacterStateOverlayErrorEvent,
  CharacterStateOverlayUpdatedEvent,
  ChatRoundStateEvent,
  LlmStreamEventPayload,
  MemoryBackendErrorEvent,
  MessageResetEvent,
  PlotSummaryErrorEvent,
  PlotSummaryPendingEvent,
  PlotSummaryUpdatedEvent,
  StreamChunkEvent,
  StreamErrorEvent,
  StreamRetryEvent,
} from './types';

export async function listenStreamChunk(
  handler: (payload: StreamChunkEvent) => void,
): Promise<UnlistenFn> {
  return listen<StreamChunkEvent>('llm-stream-chunk', (event) => handler(event.payload));
}

export async function listenLlmStreamEvent(
  handler: (payload: LlmStreamEventPayload) => void,
): Promise<UnlistenFn> {
  return listen<LlmStreamEventPayload>('llm-stream-event', (event) => handler(event.payload));
}

export async function listenStreamError(
  handler: (payload: StreamErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<StreamErrorEvent>('llm-stream-error', (event) => handler(event.payload));
}

export async function listenStreamRetry(
  handler: (payload: StreamRetryEvent) => void,
): Promise<UnlistenFn> {
  return listen<StreamRetryEvent>('llm-stream-retry', (event) => handler(event.payload));
}

export async function listenMessageReset(
  handler: (payload: MessageResetEvent) => void,
): Promise<UnlistenFn> {
  return listen<LlmStreamEventPayload>('llm-stream-event', (event) => {
    const payload = event.payload;
    if (payload.eventKind === 'message_reset') {
      handler({
        conversationId: payload.conversationId,
        roundId: payload.roundId,
        messageId: payload.messageId,
      });
    }
  });
}

export async function listenRoundState(
  handler: (payload: ChatRoundStateEvent) => void,
): Promise<UnlistenFn> {
  return listen<ChatRoundStateEvent>('chat-round-state', (event) => handler(event.payload));
}

export async function listenCharacterStateOverlayUpdated(
  handler: (payload: CharacterStateOverlayUpdatedEvent) => void,
): Promise<UnlistenFn> {
  return listen<CharacterStateOverlayUpdatedEvent>('character-state-overlay-updated', (event) =>
    handler(event.payload),
  );
}

export async function listenCharacterStateOverlayError(
  handler: (payload: CharacterStateOverlayErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<CharacterStateOverlayErrorEvent>('character-state-overlay-error', (event) =>
    handler(event.payload),
  );
}

export async function listenPlotSummaryUpdated(
  handler: (payload: PlotSummaryUpdatedEvent) => void,
): Promise<UnlistenFn> {
  return listen<PlotSummaryUpdatedEvent>('plot-summary-updated', (event) => handler(event.payload));
}

export async function listenPlotSummaryError(
  handler: (payload: PlotSummaryErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<PlotSummaryErrorEvent>('plot-summary-error', (event) => handler(event.payload));
}

export async function listenPlotSummaryPending(
  handler: (payload: PlotSummaryPendingEvent) => void,
): Promise<UnlistenFn> {
  return listen<PlotSummaryPendingEvent>('plot-summary-pending', (event) => handler(event.payload));
}

export async function listenMemoryError(
  handler: (payload: MemoryBackendErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<MemoryBackendErrorEvent>('llm-memory-error', (event) => handler(event.payload));
}
