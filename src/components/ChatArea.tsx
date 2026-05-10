import { Component, For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { MessageItem, ChatMessage } from './MessageItem';
import { animate } from '../lib/animate';
import type { MessageFormatConfig } from '../lib/messageFormatter';

interface ChatAreaProps {
  messages: ChatMessage[];
  onRegenerate: (id: string, roundId?: number) => void;
  onEdit: (id: string, content: string) => void;
  onFork: (id: string) => void;
  swipeInfo?: (messageId: string) => { current: number; total: number } | undefined;
  onSwitchSwipe?: (messageId: string, direction: 'prev' | 'next') => void;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
}

export const ChatArea: Component<ChatAreaProps> = (props) => {
  let scrollContainerRef: HTMLDivElement | undefined;
  let thumbRef: HTMLDivElement | undefined;
  const [thumbHeight, setThumbHeight] = createSignal(0);
  const [thumbTop, setThumbTop] = createSignal(0);
  let isDragging = false;
  let startY = 0;
  let startScrollTop = 0;

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

  createEffect(() => {
    if (props.messages.length > 0 && scrollContainerRef) {
      scrollContainerRef.scrollTop = scrollContainerRef.scrollHeight;
      updateScrollbar();
    }
  });

  onMount(() => {
    const resizeObserver = new ResizeObserver(updateScrollbar);
    if (scrollContainerRef) {
      resizeObserver.observe(scrollContainerRef);
      const content = scrollContainerRef.firstElementChild;
      if (content) resizeObserver.observe(content);
    }
    onCleanup(() => resizeObserver.disconnect());
  });

  return (
    <div class="flex-1 overflow-hidden relative group/area">
      <div
        ref={scrollContainerRef}
        onScroll={updateScrollbar}
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
                swipeInfo={props.swipeInfo?.(msg.id)}
                onSwitchSwipe={props.onSwitchSwipe ? (direction) => props.onSwitchSwipe!(msg.id, direction) : undefined}
                formatConfig={props.formatConfig}
                worldBookKeywords={props.worldBookKeywords}
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
