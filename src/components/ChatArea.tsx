import { Component, For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { MessageItem, ChatMessage } from './MessageItem';
import { animate } from '../lib/animate';
import type { MessageFormatConfig } from '../lib/messageFormatter';

interface ChatAreaProps {
  messages: ChatMessage[];
  onRegenerate: (id: string, roundId?: number) => void;
  onEdit: (id: string, content: string) => void;
  onFork: (id: string) => void;
  onDeleteMessage?: (id: string) => void;
  onRetryFailed?: (id: string, roundId?: number) => void;
  isRoomClient?: boolean;
  swipeInfo?: (messageId: string) => { current: number; total: number } | undefined;
  onSwitchSwipe?: (messageId: string, direction: 'prev' | 'next') => void;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
  onChoiceSelect?: (key: string, value: string) => void;
  structuredOutputDisplay?: string;
}

/** Threshold in pixels: if the user is within this distance from the bottom, consider them "at bottom". */
const STICKY_THRESHOLD_PX = 60;

export const ChatArea: Component<ChatAreaProps> = (props) => {
  let scrollContainerRef: HTMLDivElement | undefined;
  let thumbRef: HTMLDivElement | undefined;
  const [thumbHeight, setThumbHeight] = createSignal(0);
  const [thumbTop, setThumbTop] = createSignal(0);
  let isDragging = false;
  let startY = 0;
  let startScrollTop = 0;

  // ── Auto-scroll state ──
  // Whether we should auto-scroll to follow streaming content.
  // Starts true; becomes false when the user manually scrolls away from bottom.
  // Re-enabled when the user scrolls back to the bottom.
  const [isSticky, setIsSticky] = createSignal(true);
  // Track whether the last scroll event was programmatic (auto-scroll) vs user-initiated.
  let programmaticScroll = false;
  // RAF handle to batch auto-scroll calls for performance during high-frequency updates.
  let autoScrollRafId: number | null = null;

  const isStreaming = createMemo(() =>
    props.messages.some((msg) => msg.isStreaming),
  );

  const isAtBottom = (): boolean => {
    if (!scrollContainerRef) return true;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef;
    return scrollHeight - scrollTop - clientHeight <= STICKY_THRESHOLD_PX;
  };

  const scrollToBottom = () => {
    if (!scrollContainerRef) return;
    programmaticScroll = true;
    scrollContainerRef.scrollTop = scrollContainerRef.scrollHeight;
  };

  const scheduleAutoScroll = () => {
    if (autoScrollRafId !== null) return;
    autoScrollRafId = requestAnimationFrame(() => {
      autoScrollRafId = null;
      if (isSticky() && scrollContainerRef) {
        scrollToBottom();
        updateScrollbar();
      }
    });
  };

  const updateScrollbar = () => {
    if (!scrollContainerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef;
    const scrollRatio = clientHeight / scrollHeight;

    if (scrollRatio >= 1) {
      setThumbHeight(0);
    } else {
      setThumbHeight(scrollRatio * clientHeight);
      setThumbTop((scrollTop / scrollHeight) * clientHeight);
    }
  };

  const handleHover = (hover: boolean) => {
    if (!thumbRef) return;
    animate(
      thumbRef as any,
      {
        backgroundColor: hover || isDragging ? 'var(--color-accent)' : 'rgba(245, 245, 247, 0.15)',
        width: hover || isDragging ? '8px' : '4px',
        opacity: hover || isDragging ? 1 : 0.6,
      },
      { duration: 0.4, ease: 'easeOut' },
    );
  };

  const handleMouseDown = (e: MouseEvent) => {
    if (!scrollContainerRef) return;
    isDragging = true;
    startY = e.clientY;
    startScrollTop = scrollContainerRef.scrollTop;
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    handleHover(true);
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging || !scrollContainerRef) return;
    const deltaY = e.clientY - startY;
    const { scrollHeight, clientHeight } = scrollContainerRef;
    const scrollRatio = scrollHeight / clientHeight;
    scrollContainerRef.scrollTop = startScrollTop + deltaY * scrollRatio;
  };

  const handleMouseUp = () => {
    isDragging = false;
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
    handleHover(false);
  };

  const handleScroll = () => {
    updateScrollbar();

    // Distinguish programmatic scrolls from user-initiated ones.
    if (programmaticScroll) {
      programmaticScroll = false;
      return;
    }

    // User-initiated scroll: update sticky state based on position.
    if (isAtBottom()) {
      setIsSticky(true);
    } else {
      setIsSticky(false);
    }
  };

  // When the message list changes (new message added) and we should be at the bottom.
  createEffect(() => {
    const msgCount = props.messages.length;
    if (msgCount > 0 && scrollContainerRef) {
      // For new messages (user sends or AI starts), always scroll to bottom and re-enable sticky.
      scrollToBottom();
      setIsSticky(true);
      updateScrollbar();
    }
  });

  // When streaming content updates (message content changes), auto-scroll if sticky.
  // We use a ResizeObserver on the content container to detect height changes from streaming.
  onMount(() => {
    const resizeObserver = new ResizeObserver(() => {
      updateScrollbar();
      // During streaming, if sticky, schedule a scroll to bottom.
      if (isStreaming() && isSticky()) {
        scheduleAutoScroll();
      }
    });
    if (scrollContainerRef) {
      resizeObserver.observe(scrollContainerRef);
      const content = scrollContainerRef.firstElementChild;
      if (content) resizeObserver.observe(content);
    }
    onCleanup(() => {
      resizeObserver.disconnect();
      if (autoScrollRafId !== null) {
        cancelAnimationFrame(autoScrollRafId);
        autoScrollRafId = null;
      }
    });
  });

  const handleScrollToBottomClick = () => {
    setIsSticky(true);
    scrollToBottom();
    updateScrollbar();
  };

  return (
    <div class="flex-1 overflow-hidden relative group/area">
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        class="absolute inset-0 overflow-y-auto px-4 py-8 no-scrollbar"
      >
        <div class="flex flex-col gap-2 max-w-4xl mx-auto">
          <For each={props.messages}>
            {(msg) => (
              <MessageItem
                message={msg}
                onRegenerate={props.onRegenerate}
                onEdit={props.onEdit}
                onFork={props.onFork}
                onDelete={props.onDeleteMessage}
                onRetryFailed={props.onRetryFailed}
                isRoomClient={props.isRoomClient}
                swipeInfo={props.swipeInfo?.(msg.id)}
                onSwitchSwipe={props.onSwitchSwipe ? (direction) => props.onSwitchSwipe!(msg.id, direction) : undefined}
                formatConfig={props.formatConfig}
                worldBookKeywords={props.worldBookKeywords}
                onChoiceSelect={props.onChoiceSelect}
                structuredOutputDisplay={props.structuredOutputDisplay}
              />
            )}
          </For>

          <Show when={props.messages.length === 0}>
            <div class="h-full flex items-center justify-center text-mist-solid/40 mt-20">
              <div class="text-center">
                <div class="inline-flex w-16 h-16 bg-white/5 rounded-full items-center justify-center text-accent mb-4 shadow-inner">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <p class="text-lg font-medium text-mist-solid/60">No messages yet.</p>
                <p class="text-sm">Type a message below to start the conversation.</p>
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* Scroll-to-bottom floating button: visible during streaming when user scrolled away */}
      <Show when={isStreaming() && !isSticky()}>
        <button
          onClick={handleScrollToBottomClick}
          class="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-2 rounded-full bg-accent/80 hover:bg-accent text-white text-xs font-medium shadow-lg border border-white/10 backdrop-blur-sm transition-all hover:scale-105 active:scale-95"
          title="跟进最新内容"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
          跟进最新内容
        </button>
      </Show>

      <div
        class="absolute top-2 right-1.5 bottom-2 w-2 z-50 pointer-events-none"
        onMouseEnter={() => handleHover(true)}
        onMouseLeave={() => handleHover(false)}
      >
        <Show when={thumbHeight() > 0}>
          <div
            ref={thumbRef}
            onMouseDown={handleMouseDown}
            class="pointer-events-auto rounded-full cursor-pointer will-change-[transform,background-color,width]"
            style={{
              height: `${thumbHeight()}px`,
              transform: `translateY(${thumbTop()}px)`,
              width: '4px',
              'background-color': 'rgba(245, 245, 247, 0.15)',
              'margin-left': 'auto',
              opacity: 0.6,
            }}
          />
        </Show>
      </div>
    </div>
  );
};
