import { Component, Show, createMemo, createSignal } from 'solid-js';
import { RefreshCw, Pencil, GitFork, ChevronLeft, ChevronRight, Check, X } from '../lib/icons';
import { parseMessageContent, DEFAULT_FORMAT_CONFIG, type MessageFormatConfig } from '../lib/messageFormatter';
import { MessageFormatRenderer } from './MessageFormatRenderer';

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
}

interface MessageItemProps {
  message: ChatMessage;
  onRegenerate: (id: string, roundId?: number) => void;
  onEdit: (id: string, content: string) => void;
  onFork: (id: string) => void;
  swipeInfo?: { current: number; total: number };
  onSwitchSwipe?: (direction: 'prev' | 'next') => void;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
}

export const MessageItem: Component<MessageItemProps> = (props) => {
  const [isEditing, setIsEditing] = createSignal(false);
  const [editContent, setEditContent] = createSignal('');

  const isUser = createMemo(() => props.message.sender === 'user');

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
    <div class="group relative flex flex-col gap-2 w-full max-w-4xl mx-auto py-6 border-b border-white/5 hover:bg-white/5 transition-colors px-4 rounded-xl">
      <div class={`flex items-start gap-4 ${isUser() ? 'flex-row-reverse' : ''}`}>
        <div class="w-10 h-10 rounded-full bg-gradient-to-tr from-accent to-emerald-400 flex items-center justify-center text-white font-bold shrink-0 overflow-hidden shadow-sm">
          {props.message.avatar ? (
            <img src={props.message.avatar} alt="avatar" class="w-full h-full object-cover" />
          ) : props.message.sender === 'user' ? (
            'U'
          ) : (
            'AI'
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
                <MessageFormatRenderer
                  nodes={parseMessageContent(
                    props.message.content,
                    props.formatConfig ?? DEFAULT_FORMAT_CONFIG,
                    props.worldBookKeywords ?? []
                  )}
                  defaultExpanded={props.formatConfig?.builtinRules.pseudoXml.defaultExpanded ?? true}
                />
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
          </Show>
        </div>
      </Show>
    </div>
  );
};
