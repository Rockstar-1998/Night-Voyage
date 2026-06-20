import { Component, Show, createMemo, createSignal, createEffect } from 'solid-js';
import { RefreshCw, Pencil, GitFork, ChevronLeft, ChevronRight, Check, X, Trash2 } from '../lib/icons';
import { parseMessageContent, parseStructuredResponse, DEFAULT_FORMAT_CONFIG, type MessageFormatConfig, type StructuredField } from '../lib/messageFormatter';
import { clearStreamingRenderCache, MessageFormatRenderer } from './MessageFormatRenderer';

export interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  content: string;
  avatar?: string;
  senderName: string;
  isStreaming?: boolean;
  roundId?: number;
  backendId?: number;
  messageKind?: string;
  isSwipe?: boolean;
  swipeIndex?: number;
  replyToId?: number;
  summaryBatchIndex?: number;
  summaryEntryId?: number;
  isActiveInRound?: boolean;
  error?: string;
  structuredFields?: Record<string, string>;
}

interface MessageItemProps {
  message: ChatMessage;
  onRegenerate: (id: string, roundId?: number) => void;
  onEdit: (id: string, content: string) => void;
  onFork: (id: string) => void;
  onDelete?: (id: string) => void;
  onRetryFailed?: (id: string, roundId?: number) => void;
  isRoomClient?: boolean;
  swipeInfo?: { current: number; total: number };
  onSwitchSwipe?: (direction: 'prev' | 'next') => void;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
  onChoiceSelect?: (key: string, value: string) => void;
  structuredOutputDisplay?: string;
}

export const MessageItem: Component<MessageItemProps> = (props) => {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editContent, setEditContent] = createSignal('');

  const isUser = createMemo(() => props.message.sender === 'user');

  const streamingStructuredMode = createMemo(() => {
    const sf = props.message.structuredFields;
    return !!(sf && Object.keys(sf).length > 0);
  });

  const structuredResponse = createMemo(() => {
    let displayConfig: Record<string, { defaultCollapsed: boolean }> | undefined;
    if (props.structuredOutputDisplay) {
      try {
        displayConfig = JSON.parse(props.structuredOutputDisplay);
      } catch {
      }
    }

    if (streamingStructuredMode()) {
      const sf = props.message.structuredFields;
      if (!sf) return null;
      const fields: Record<string, StructuredField> = {};
      for (const [key, value] of Object.entries(sf)) {
        if (value.trimStart().startsWith('{')) {
          try {
            const parsed = JSON.parse(value);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
              const stringEntries: Record<string, string> = {};
              for (const [k, v] of Object.entries(parsed)) {
                if (typeof v === 'string') stringEntries[k] = v;
              }
              if (Object.keys(stringEntries).length > 0) {
                fields[key] = { kind: 'object', value: stringEntries };
              }
            }
          } catch { /* not valid JSON yet */ }
        } else {
          fields[key] = { kind: 'string', value };
        }
      }
      if (Object.keys(fields).length === 0) return null;
      return { kind: 'structured_response' as const, fields, displayConfig: displayConfig ?? {} };
    }

    const content = props.message.content;
    if (!content || !content.trimStart().startsWith('{')) return null;
    return parseStructuredResponse(content, displayConfig);
  });

  const defaultExpanded = createMemo(() =>
    props.formatConfig?.builtinRules.pseudoXml.defaultExpanded ?? true
  );

  createEffect(() => {
    if (!props.message.isStreaming) {
      clearStreamingRenderCache(props.message.id);
    }
  });

  const badgeText = createMemo(() => {
    if (props.message.sender !== 'ai') return null;
    if (props.message.isStreaming) return 'Streaming';
    if (props.message.isSwipe) return `版本 ${props.message.swipeIndex ?? 0}`;
    return 'Assistant';
  });

  const summaryBadgeText = createMemo(() => {
    if (props.message.summaryBatchIndex == null) return null;
    return `摘 ${props.message.summaryBatchIndex}`;
  });

  return (
    <div class="group relative flex flex-col gap-3 w-full max-w-4xl mx-auto py-8 transition-colors px-4">
      <div class={`flex items-start gap-4 ${isUser() ? 'flex-row-reverse' : ''}`}>
        <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-accent to-emerald-400 flex items-center justify-center text-white font-bold shrink-0 overflow-hidden shadow-sm">
          {props.message.avatar ? (
            <img src={props.message.avatar} alt="avatar" class="w-full h-full object-cover" />
          ) : (
            props.message.senderName.charAt(0) || (props.message.sender === 'user' ? 'U' : 'A')
          )}
        </div>

        <div class={`flex-1 min-w-0 ${isUser() ? 'items-end text-right' : 'items-start text-left'}`}>
          <h3 class={`text-sm font-semibold text-mist-solid mb-1 flex items-center gap-2 flex-wrap ${isUser() ? 'justify-end' : ''}`}>
            {props.message.senderName}
            <Show when={badgeText()}>
              <span class="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full font-medium border border-accent/20">
                {badgeText()}
              </span>
            </Show>
            <Show when={summaryBadgeText()}>
              <span
                class="text-xs bg-sky-500/15 text-sky-200 px-2 py-0.5 rounded-full font-medium border border-sky-500/20"
                title={props.message.summaryEntryId ? `对应剧情总结条目 #${props.message.summaryEntryId}` : '该轮已被剧情总结压缩'}
              >
                {summaryBadgeText()}
              </span>
            </Show>
            <Show when={props.message.error}>
              <span class="text-xs bg-red-500/15 text-red-300 px-2 py-0.5 rounded-full font-medium border border-red-500/20">
                Error
              </span>
            </Show>
          </h3>

          <Show
            when={isEditing()}
            fallback={
              <div class="text-mist-solid/80 leading-relaxed text-[15px] whitespace-pre-wrap font-sans break-words">
                <Show
                  when={structuredResponse()}
                  fallback={
                    <MessageFormatRenderer
                      nodes={parseMessageContent(
                        props.message.content,
                        props.formatConfig ?? DEFAULT_FORMAT_CONFIG,
                        props.worldBookKeywords ?? []
                      )}
                      defaultExpanded={defaultExpanded()}
                      onChoiceSelect={props.onChoiceSelect}
                      toggleScope={`${props.message.id}:content`}
                      streamKey={`${props.message.id}:content`}
                      formatConfig={props.formatConfig}
                      worldBookKeywords={props.worldBookKeywords}
                    />
                  }
                >
                  {(sr) => (
                    <MessageFormatRenderer
                      nodes={[sr()]}
                      defaultExpanded={defaultExpanded()}
                      onChoiceSelect={props.onChoiceSelect}
                      isStreaming={props.message.isStreaming}
                      toggleScope={`${props.message.id}:structured`}
                      streamKey={`${props.message.id}:structured`}
                      formatConfig={props.formatConfig}
                      worldBookKeywords={props.worldBookKeywords}
                    />
                  )}
                </Show>
                <Show when={props.message.isStreaming}>
                  <span class="inline-block w-[2px] h-[1em] bg-accent/70 ml-0.5 align-middle animate-pulse" />
                </Show>
              </div>
            }
          >
            <div class="w-full space-y-2">
              <textarea
                value={editContent()}
                onInput={(e) => setEditContent(e.currentTarget.value)}
                class="w-full bg-xuanqing border border-white/10 rounded-xl px-3 py-2 text-sm text-mist-solid resize-y min-h-[60px] focus:outline-none focus:border-accent/40"
              />
              <div class={`flex items-center gap-2 ${isUser() ? 'justify-end' : ''}`}>
                <button
                  onClick={() => {
                    props.onEdit(props.message.id, editContent());
                    setIsEditing(false);
                  }}
                  class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent/60 text-white text-xs font-medium hover:bg-accent/80 transition-colors"
                >
                  <Check size={12} />
                  保存
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-white/5 text-mist-solid/60 text-xs hover:bg-white/10 transition-colors"
                >
                  <X size={12} />
                  取消
                </button>
              </div>
            </div>
          </Show>

          <Show when={props.message.error}>
            <div class="mt-3 text-xs text-red-300/90 whitespace-pre-wrap">{props.message.error}</div>
          </Show>

          <Show when={props.message.sender === 'ai' && !!props.message.error && !!props.message.roundId && !props.isRoomClient}>
            <button
              onClick={() => props.onRetryFailed?.(props.message.id, props.message.roundId)}
              class="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium hover:bg-accent/30 transition-colors border border-accent/20"
              title="自动重试"
            >
              <RefreshCw size={13} />
              自动重试
            </button>
          </Show>

          <Show when={props.message.sender === 'ai' && props.swipeInfo && props.swipeInfo!.total > 1}>
            <div class="flex items-center gap-2 mt-1 text-xs text-mist-solid/40">
              <button
                onClick={() => props.onSwitchSwipe?.('prev')}
                disabled={props.swipeInfo!.current <= 1}
                class="p-1 rounded hover:bg-white/10 hover:text-mist-solid/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={14} />
              </button>
              <span>版本 {props.swipeInfo!.current}/{props.swipeInfo!.total}</span>
              <button
                onClick={() => props.onSwitchSwipe?.('next')}
                disabled={props.swipeInfo!.current >= props.swipeInfo!.total}
                class="p-1 rounded hover:bg-white/10 hover:text-mist-solid/70 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </Show>
        </div>
      </div>

      <Show when={!props.message.isStreaming}>
        <div
          class={`absolute top-2 ${isUser() ? 'left-2' : 'right-2'} flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}
        >
          <Show when={isUser()}>
            <button
              onClick={() => {
                setEditContent(props.message.content);
                setIsEditing(true);
              }}
              class="p-1.5 rounded-lg hover:bg-white/10 text-mist-solid/30 hover:text-mist-solid/80 transition-colors"
              title="编辑"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => props.onFork(props.message.id)}
              class="p-1.5 rounded-lg hover:bg-white/10 text-mist-solid/30 hover:text-mist-solid/80 transition-colors"
              title="分支"
            >
              <GitFork size={14} />
            </button>
            <button
              onClick={() => {
                if (window.confirm('确定要删除这条消息吗？此操作不可撤销。')) {
                  props.onDelete?.(props.message.id);
                }
              }}
              class="p-1.5 rounded-lg hover:bg-red-500/20 text-mist-solid/30 hover:text-red-300 transition-colors"
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </Show>
          <Show when={!isUser()}>
            <button
              onClick={() => {
                setEditContent(props.message.content);
                setIsEditing(true);
              }}
              class="p-1.5 rounded-lg hover:bg-white/10 text-mist-solid/30 hover:text-mist-solid/80 transition-colors"
              title="编辑"
            >
              <Pencil size={14} />
            </button>
            <button
              onClick={() => props.onRegenerate(props.message.id, props.message.roundId)}
              class="p-1.5 rounded-lg hover:bg-white/10 text-mist-solid/30 hover:text-mist-solid/80 transition-colors"
              title="重新生成"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={() => props.onFork(props.message.id)}
              class="p-1.5 rounded-lg hover:bg-white/10 text-mist-solid/30 hover:text-mist-solid/80 transition-colors"
              title="分支"
            >
              <GitFork size={14} />
            </button>
            <button
              onClick={() => {
                if (window.confirm('确定要删除这条消息吗？此操作不可撤销。')) {
                  props.onDelete?.(props.message.id);
                }
              }}
              class="p-1.5 rounded-lg hover:bg-red-500/20 text-mist-solid/30 hover:text-red-300 transition-colors"
              title="删除"
            >
              <Trash2 size={14} />
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
};
