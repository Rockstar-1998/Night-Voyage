import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import {
  messagesList,
  sendMessage,
  listenLlmStreamEvent,
  listenStreamError,
  listenStreamRetry,
  presetsGet,
} from '../../src/lib/backend';
import type { UiMessage, LlmStreamEventPayload, StreamErrorEvent, StreamRetryEvent } from '../../src/lib/backend/types';
import { parseStructuredResponse, parseStreamingFields, type StructuredDisplayConfig, deriveStructuredOutputDisplayFromGraphJson } from '../lib/structured';
import { MobileStructuredRenderer } from './MobileStructuredRenderer';
import { MobileNativeThinkingBlock } from './MobileNativeThinkingBlock';
import { showToast } from './Toast';

interface MobileChatViewProps {
  conversationId: number;
  providerId?: number;
  presetId?: number;
  onBack: () => void;
}

interface MobileMessage extends UiMessage {
  isStreaming?: boolean;
  error?: string;
  compatibilityMode?: boolean;
  structuredFields?: Record<string, string>;
}

const isRenderable = (m: UiMessage) =>
  m.messageKind === 'user_visible' ||
  m.messageKind === 'assistant_visible' ||
  m.messageKind === 'system';

export const MobileChatView: Component<MobileChatViewProps> = (props) => {
  const [messages, setMessages] = createStore<MobileMessage[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [sending, setSending] = createSignal(false);
  const [inputText, setInputText] = createSignal('');
  const [replyStatus, setReplyStatus] = createSignal<'idle' | 'connecting' | 'responding'>('idle');
  const [presetDisplayConfig, setPresetDisplayConfig] = createSignal<Record<string, StructuredDisplayConfig>>({});
  let scrollRef: HTMLDivElement | undefined;

  createEffect(() => {
    const pid = props.presetId;
    if (!pid) {
      setPresetDisplayConfig({});
      return;
    }
    presetsGet(pid).then((detail) => {
      const raw = detail.preset.structuredOutputDisplay;
      if (raw) {
        try {
          setPresetDisplayConfig(JSON.parse(raw));
          return;
        } catch {}
      }
      if (detail.preset.blueprintGraph) {
        const derived = deriveStructuredOutputDisplayFromGraphJson(detail.preset.blueprintGraph);
        if (derived) {
          try {
            setPresetDisplayConfig(JSON.parse(derived));
            return;
          } catch {}
        }
      }
      setPresetDisplayConfig({});
    }).catch(() => {
      setPresetDisplayConfig({});
    });
  });

  const providerId = () => props.providerId;

  // ─── 消息 upsert 辅助 ───
  const upsertMessage = (msg: MobileMessage) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === msg.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...msg };
        return next;
      }
      return [...prev, msg];
    });
  };

  const upsertAssistantByEvent = (payload: LlmStreamEventPayload) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === payload.messageId);
      if (idx >= 0) return prev;
      return [
        ...prev,
        {
          id: payload.messageId,
          conversationId: payload.conversationId,
          roundId: payload.roundId,
          role: 'assistant',
          messageKind: 'assistant_visible',
          content: '',
          isSwipe: false,
          swipeIndex: 0,
          isActiveInRound: true,
          createdAt: Date.now(),
          isStreaming: true,
          structuredFields: {},
        } as MobileMessage,
      ];
    });
  };

  const patchMessage = (messageId: number, patch: Partial<MobileMessage>) => {
    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === messageId);
      if (idx < 0) return prev;
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  // ─── 流式事件处理（对齐 PC 端 App.tsx 逻辑） ───
  const handleStreamEvent = (payload: LlmStreamEventPayload) => {
    if (payload.conversationId !== props.conversationId) return;

    switch (payload.eventKind) {
      case 'text_delta': {
        const delta = payload.textDelta ?? '';
        upsertAssistantByEvent(payload);
        patchMessage(payload.messageId, {
          content: `${messages.find((m) => m.id === payload.messageId)?.content ?? ''}${delta}`,
          isStreaming: true,
        });
        setReplyStatus('responding');
        break;
      }
      case 'string_field_delta': {
        const delta = payload.textDelta ?? '';
        const fieldKey = payload.partType ?? '';
        if (!delta || !fieldKey) break;
        const normalizedDelta = delta.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
        upsertAssistantByEvent(payload);
        patchMessage(payload.messageId, (() => {
          const existing = messages.find((m) => m.id === payload.messageId)?.structuredFields ?? {};
          return {
            structuredFields: { ...existing, [fieldKey]: `${existing[fieldKey] ?? ''}${normalizedDelta}` },
            isStreaming: true,
          };
        })());
        setReplyStatus('responding');
        break;
      }
      case 'object_field_complete': {
        const fieldKey = payload.partType ?? '';
        const jsonStr = payload.jsonDelta ?? '';
        if (!fieldKey || !jsonStr) break;
        upsertAssistantByEvent(payload);
        patchMessage(payload.messageId, (() => {
          const existing = messages.find((m) => m.id === payload.messageId)?.structuredFields ?? {};
          return { structuredFields: { ...existing, [fieldKey]: jsonStr }, isStreaming: true };
        })());
        setReplyStatus('responding');
        break;
      }
      case 'message_stop': {
        upsertAssistantByEvent(payload);
        patchMessage(payload.messageId, { isStreaming: false });
        setReplyStatus('idle');
        break;
      }
      case 'compatibility_mode': {
        patchMessage(payload.messageId, { compatibilityMode: true });
        break;
      }
      case 'thinking_delta': {
        const delta = payload.textDelta ?? '';
        if (!delta) break;
        upsertAssistantByEvent(payload);
        patchMessage(payload.messageId, {
          thinking: `${messages.find((m) => m.id === payload.messageId)?.thinking ?? ''}${delta}`,
          isStreaming: true,
        });
        setReplyStatus('responding');
        break;
      }
      default:
        break;
    }
  };

  // ─── 加载历史消息 ───
  const loadMessages = async () => {
    setLoading(true);
    try {
      const list = await messagesList(props.conversationId);
      setMessages(
        list
          .filter(isRenderable)
          .map((m) => ({ ...m, structuredFields: {}, isStreaming: false } as MobileMessage)),
      );
    } catch (err) {
      showToast(`加载消息失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  // ─── 发送消息 ───
  const handleSend = async (rawContent: string) => {
    const content = rawContent.trim();
    if (!content) return;
    const pid = providerId();
    if (!pid) {
      showToast('当前会话未绑定供应商，无法发送', 'error');
      return;
    }

    setSending(true);
    setReplyStatus('connecting');
    try {
      const result = await sendMessage(props.conversationId, pid, content);
      if (result.visibleUserMessage) {
        upsertMessage({ ...(result.visibleUserMessage as UiMessage), structuredFields: {}, isStreaming: false } as MobileMessage);
      }
      if (result.assistantMessage) {
        upsertMessage({
          ...(result.assistantMessage as UiMessage),
          structuredFields: {},
          isStreaming: true,
        } as MobileMessage);
      } else {
        showToast('未生成回复（可能 auto_dispatched 关闭）', 'info');
      }
      setInputText('');
    } catch (err) {
      showToast(`发送失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      setReplyStatus('idle');
    } finally {
      setSending(false);
    }
  };

  // ─── 滚动到底 ───
  createEffect(() => {
    // 依赖消息数量与最后一条内容，触发滚动
    const count = messages.length;
    const last = messages[count - 1];
    const _sig = last ? `${last.content.length}:${last.isStreaming}:${Object.keys(last.structuredFields ?? {}).length}` : '';
    void _sig;
    if (scrollRef) {
      scrollRef.scrollTop = scrollRef.scrollHeight;
    }
  });

  // ─── 生命周期：监听流式事件 ───
  onMount(async () => {
    const unlistenStream = await listenLlmStreamEvent(handleStreamEvent);
    const unlistenError = await listenStreamError((payload: StreamErrorEvent) => {
      if (payload.conversationId !== props.conversationId) return;
      patchMessage(payload.messageId, { isStreaming: false, error: payload.error });
      setReplyStatus('idle');
      showToast(`流式错误：${payload.error}`, 'error');
    });
    const unlistenRetry = await listenStreamRetry((payload: StreamRetryEvent) => {
      if (payload.conversationId !== props.conversationId) return;
      showToast(`正在重试（${payload.attemptCount}）：${payload.error}`, 'info');
    });

    await loadMessages();

    onCleanup(() => {
      unlistenStream();
      unlistenError();
      unlistenRetry();
    });
  });

  // ─── 单条消息渲染 ───
  const renderAssistantBody = (m: MobileMessage) => {
    const streamingFields = createMemo(() => {
      const sf = m.structuredFields;
      return sf && Object.keys(sf).length > 0 ? parseStreamingFields(sf) : null;
    });
    const fullResponse = createMemo(() => {
      const content = m.content;
      if (!content || !content.trimStart().startsWith('{')) return null;
      return parseStructuredResponse(content, presetDisplayConfig());
    });

    return (
      <div class="space-y-1.5">
        <Show when={m.thinking || (m.isStreaming && !m.content)}>
          <MobileNativeThinkingBlock
            thinking={m.thinking ?? ''}
            isStreaming={m.isStreaming && !m.content}
          />
        </Show>
        <Show
          when={!streamingFields() && !fullResponse()}
          fallback={
            <Show when={streamingFields()} fallback={
              <MobileStructuredRenderer response={fullResponse()!} onChoiceSelect={(_i, v) => handleSend(v)} />
            }>
              {(sf) => <MobileStructuredRenderer response={{ fields: sf(), displayConfig: presetDisplayConfig() }} onChoiceSelect={(_i, v) => handleSend(v)} />}
            </Show>
          }
        >
          <div class="whitespace-pre-wrap text-sm text-mist-solid/90 leading-relaxed">
            {m.content || (m.isStreaming && !m.thinking ? '思考中…' : '')}
          </div>
        </Show>
      </div>
    );
  };

  return (
    <div class="min-h-0 flex-1 flex flex-col overflow-hidden">
      {/* 消息列表 */}
      <div ref={scrollRef} class="min-h-0 flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-3">
        <Show when={loading()}>
          <div class="text-center text-xs text-mist-solid/40 py-8">加载消息中…</div>
        </Show>
        <Show when={!loading() && messages.length === 0}>
          <div class="text-center text-xs text-mist-solid/40 py-8">还没有消息，发送第一条吧</div>
        </Show>
        <For each={messages}>
          {(m) => (
            <div class={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                class={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
                  m.role === 'user'
                    ? 'bg-accent/20 border border-accent/30'
                    : 'bg-white/[0.04] border border-white/5'
                }`}
              >
                <Show when={m.role === 'user'}>
                  <div class="whitespace-pre-wrap text-sm text-mist-solid leading-relaxed">{m.content}</div>
                </Show>
                <Show when={m.role === 'assistant'}>
                  {renderAssistantBody(m)}
                  <Show when={m.compatibilityMode}>
                    <div class="mt-2 text-[10px] text-amber-300/70">⚠ 兼容模式（结构化解析未触发）</div>
                  </Show>
                  <Show when={m.error}>
                    <div class="mt-2 text-[11px] text-red-300/80">{m.error}</div>
                  </Show>
                </Show>
                <Show when={m.messageKind === 'system'}>
                  <div class="whitespace-pre-wrap text-xs text-mist-solid/50 italic">{m.content}</div>
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* 输入栏 */}
      <div class="shrink-0 border-t border-white/5 bg-xuanqing/90 backdrop-blur-md p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <Show when={replyStatus() !== 'idle'}>
          <div class="text-[10px] text-accent/60 mb-1 px-1">
            {replyStatus() === 'connecting' ? '连接中…' : '回复中…'}
          </div>
        </Show>
        <div class="flex items-end gap-2">
          <textarea
            class="flex-1 max-h-32 min-h-[40px] resize-none rounded-xl bg-white/[0.05] border border-white/10 px-3 py-2 text-sm text-mist-solid placeholder:text-mist-solid/30 focus:outline-none focus:border-accent/40"
            placeholder="输入消息…"
            value={inputText()}
            onInput={(e) => setInputText(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend(inputText());
              }
            }}
          />
          <button
            class="shrink-0 h-10 px-4 rounded-xl bg-accent/80 hover:bg-accent text-xuanqing font-semibold text-sm disabled:opacity-40"
            disabled={sending() || replyStatus() !== 'idle'}
            onClick={() => handleSend(inputText())}
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
};
