import { Component, Show, For, Index, createMemo, createSignal, createEffect } from 'solid-js';
import { RefreshCw, Pencil, GitFork, ChevronLeft, ChevronRight, Check, X, Trash2 } from '../lib/icons';
import { parseMessageContent, parseStructuredResponse, DEFAULT_FORMAT_CONFIG, type MessageFormatConfig } from '../lib/messageFormatter';
import { clearStreamingRenderCache, MessageFormatRenderer } from './MessageFormatRenderer';
import { animate } from '../lib/animate';

// Per-message toggle state to avoid cross-message pollution
const userToggleState = new Map<string, Map<string, boolean>>();

function getToggleState(messageId: string, fieldKey: string): boolean | undefined {
  return userToggleState.get(messageId)?.get(fieldKey);
}

function setToggleState(messageId: string, fieldKey: string, value: boolean) {
  if (!userToggleState.has(messageId)) {
    userToggleState.set(messageId, new Map());
  }
  userToggleState.get(messageId)!.set(fieldKey, value);
}

/** Streaming field tag that reads value reactively to avoid re-mounting on every delta. */
const StreamingFieldTag: Component<{
  fieldKey: string;
  message: ChatMessage;
  structuredOutputDisplay?: string;
  defaultExpandedGlobal: boolean;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
  onChoiceSelect?: (key: string, value: string) => void;
}> = (props) => {
  const text = createMemo(() => props.message.structuredFields?.[props.fieldKey] ?? '');
  const fieldScope = createMemo(() => `${props.message.id}:field:${props.fieldKey}`);

  // Compute defaultExpanded reactively so config changes are picked up even though
  // <Index> preserves this component instance.
  const defaultExpanded = createMemo(() => {
    if (props.structuredOutputDisplay) {
      try {
        const config = JSON.parse(props.structuredOutputDisplay);
        if (config[props.fieldKey] && typeof config[props.fieldKey].defaultCollapsed === 'boolean') {
          return !config[props.fieldKey].defaultCollapsed;
        }
      } catch {
        // ignore
      }
    }
    return props.defaultExpandedGlobal;
  });

  const [isExpanded, setIsExpanded] = createSignal(() => {
    const persisted = getToggleState(props.message.id, props.fieldKey);
    return persisted !== undefined ? persisted : defaultExpanded();
  });

  let contentRef: HTMLDivElement | undefined;

  // Sync from computed defaultExpanded only when user has never toggled this tag.
  createEffect(() => {
    const persisted = getToggleState(props.message.id, props.fieldKey);
    if (persisted === undefined) {
      setIsExpanded(defaultExpanded());
    }
  });

  let isFirstRun = true;

  createEffect(() => {
    const expanded = isExpanded();
    if (!contentRef) return;
    if (expanded) {
      if (isFirstRun) {
        contentRef.style.height = 'auto';
        contentRef.style.opacity = '1';
      } else {
        contentRef.style.height = '0px';
        contentRef.style.opacity = '0';
        animate(contentRef, { height: 'auto', opacity: 1 }, { duration: 0.25, ease: 'easeOut' });
      }
    } else {
      if (isFirstRun) {
        contentRef.style.height = '0px';
        contentRef.style.opacity = '0';
      } else {
        animate(contentRef, { height: 0, opacity: 0 }, { duration: 0.25, ease: 'easeIn' });
      }
    }
    isFirstRun = false;
  });

  const handleToggle = () => {
    const next = !isExpanded();
    setToggleState(props.message.id, props.fieldKey, next);
    setIsExpanded(next);
  };

  const parsedNodes = createMemo(() =>
    parseMessageContent(text(), props.formatConfig ?? DEFAULT_FORMAT_CONFIG, props.worldBookKeywords ?? [])
  );

  return (
    <div class="my-1">
      <div
        class="flex items-center gap-2 px-3 py-1.5 bg-white/[0.04] border-l-2 border-accent/40 cursor-pointer hover:bg-white/[0.07] transition-colors rounded-r-md"
        onClick={handleToggle}
      >
        <span
          class="text-xs transition-transform duration-200"
          style={{ transform: isExpanded() ? 'rotate(90deg)' : 'rotate(0deg)', 'display': 'inline-block' }}
        >
          ▶
        </span>
        <span class="text-[11px] font-semibold uppercase tracking-wider text-accent/70">
          {props.fieldKey}
        </span>
      </div>
      <Show when={isExpanded()}>
        <div ref={contentRef} style={{ overflow: 'hidden', height: '0px', opacity: 0 }}>
          <div class="pl-4 pt-1">
            <MessageFormatRenderer
              nodes={parsedNodes()}
              defaultExpanded={defaultExpanded()}
              onChoiceSelect={props.onChoiceSelect}
              isStreaming={props.message.isStreaming}
              toggleScope={fieldScope()}
              streamKey={fieldScope()}
              formatConfig={props.formatConfig}
              worldBookKeywords={props.worldBookKeywords}
            />
          </div>
        </div>
      </Show>
    </div>
  );
};

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

  // --- Streaming structured fields: use stable keyed rendering to avoid re-mounting ---
  // StreamingFieldTag reads values reactively so only text updates, not component structure.

  /** Whether the message is using streaming structured fields (string_field_delta events). */
  const streamingStructuredMode = createMemo(() => {
    const sf = props.message.structuredFields;
    return !!(sf && Object.keys(sf).length > 0);
  });

  const streamingObjectFields = createMemo(() => {
    const sf = props.message.structuredFields;
    if (!sf) return [];
    return Object.entries(sf)
      .filter(([key, value]) => key !== 'content' && value.trimStart().startsWith('{'))
      .map(([key, value]) => {
        try {
          const parsed = JSON.parse(value);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const stringEntries: Record<string, string> = {};
            for (const [k, v] of Object.entries(parsed)) {
              if (typeof v === 'string') stringEntries[k] = v;
            }
            return [key, stringEntries] as [string, Record<string, string>];
          }
        } catch { /* not valid JSON yet */ }
        return null;
      })
      .filter((entry): entry is [string, Record<string, string>] => entry !== null);
  });

  const streamingStringAuxFieldKeys = createMemo(() => {
    const sf = props.message.structuredFields;
    if (!sf) return [];
    return Object.keys(sf).filter((key) => key !== 'content' && !sf[key].trimStart().startsWith('{'));
  });

  /** The streaming content text (from text_delta, stored in message.content). */
  const streamingContentText = createMemo(() => {
    if (!streamingStructuredMode()) return '';
    const sf = props.message.structuredFields;
    // If structuredFields itself has a 'content' key, use that; otherwise use message.content
    return sf?.['content'] ?? props.message.content ?? '';
  });

  /** Structured response from full JSON (used for DB-loaded messages, not streaming). */
  const structuredResponse = createMemo(() => {
    if (streamingStructuredMode()) return null;
    const content = props.message.content;
    if (!content || !content.trimStart().startsWith('{')) return null;
    let displayConfig: Record<string, { defaultCollapsed: boolean }> | undefined;
    if (props.structuredOutputDisplay) {
      try {
        displayConfig = JSON.parse(props.structuredOutputDisplay);
      } catch {
        // ignore
      }
    }
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

  const getIsKeyExpandedByDefault = (key: string) => {
    if (props.structuredOutputDisplay) {
      try {
        const config = JSON.parse(props.structuredOutputDisplay);
        if (config[key] && typeof config[key].defaultCollapsed === 'boolean') {
          return !config[key].defaultCollapsed;
        }
      } catch {
        // ignore
      }
    }
    return defaultExpanded();
  };

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
                  when={streamingStructuredMode()}
                  fallback={
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
                          toggleScope={`${props.message.id}:structured`}
                          streamKey={`${props.message.id}:structured`}
                          formatConfig={props.formatConfig}
                          worldBookKeywords={props.worldBookKeywords}
                        />
                      )}
                    </Show>
                  }
                >
                  {/* Streaming structured mode: render each field with stable identity
                      so that content delta updates don't re-mount field tags */}
                  <div class="structured-response">
                    <Index each={streamingStringAuxFieldKeys()}>
                      {(keySignal) => (
                        <StreamingFieldTag
                          fieldKey={keySignal()}
                          message={props.message}
                          structuredOutputDisplay={props.structuredOutputDisplay}
                          defaultExpandedGlobal={defaultExpanded()}
                          formatConfig={props.formatConfig}
                          worldBookKeywords={props.worldBookKeywords}
                          onChoiceSelect={props.onChoiceSelect}
                        />
                      )}
                    </Index>
                    <Show when={streamingContentText()}>
                      <div class="whitespace-pre-wrap">
                        <MessageFormatRenderer
                          nodes={parseMessageContent(
                            streamingContentText(),
                            props.formatConfig ?? DEFAULT_FORMAT_CONFIG,
                            props.worldBookKeywords ?? []
                          )}
                          defaultExpanded={defaultExpanded()}
                          onChoiceSelect={props.onChoiceSelect}
                          isStreaming={props.message.isStreaming}
                          toggleScope={`${props.message.id}:content`}
                          streamKey={`${props.message.id}:content`}
                          formatConfig={props.formatConfig}
                          worldBookKeywords={props.worldBookKeywords}
                        />
                      </div>
                    </Show>
                    <For each={streamingObjectFields()}>
                      {([_key, entries]) => (
                        <div class="flex flex-wrap gap-2 mt-3">
                          <For each={Object.entries(entries)}>
                            {([optKey, optValue]) => (
                              <button
                                class="px-4 py-2 bg-accent/20 border border-accent/30 rounded-lg text-sm text-mist-solid hover:bg-accent/30 transition-colors"
                                onClick={() => {
                                  props.onChoiceSelect?.(optKey, optValue);
                                }}
                              >
                                <span class="text-accent/80 font-semibold mr-1">{optKey}</span>
                                <span class="text-mist-solid/70">{optValue}</span>
                              </button>
                            )}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
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
