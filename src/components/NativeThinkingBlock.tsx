import { Component, Show, createSignal, createMemo, createEffect } from 'solid-js';
import { Brain, ChevronDown } from '../lib/icons';
import { animate } from '../lib/animate';

interface NativeThinkingBlockProps {
  thinking: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
}

export const NativeThinkingBlock: Component<NativeThinkingBlockProps> = (props) => {
  const [userToggled, setUserToggled] = createSignal(false);
  const [isExpanded, setIsExpanded] = createSignal(props.defaultExpanded ?? (props.isStreaming ?? false));

  createEffect(() => {
    if (props.isStreaming && !userToggled()) {
      setIsExpanded(true);
    }
  });

  let contentRef: HTMLDivElement | undefined;
  let chevronRef: HTMLSpanElement | undefined;

  const toggleExpand = () => {
    setUserToggled(true);
    const nextState = !isExpanded();
    setIsExpanded(nextState);

    if (chevronRef) {
      animate(chevronRef, {
        rotate: nextState ? 180 : 0,
      }, { duration: 0.25, ease: 'easeOut' });
    }

    if (contentRef && nextState) {
      animate(contentRef, {
        opacity: [0, 1],
        y: [-4, 0],
      }, { duration: 0.25, ease: 'easeOut' });
    }
  };

  const wordCount = createMemo(() => {
    return props.thinking ? props.thinking.length : 0;
  });

  return (
    <div class="my-2 w-full rounded-xl border border-indigo-500/20 bg-gradient-to-b from-indigo-950/40 via-slate-900/50 to-slate-950/60 backdrop-blur-md shadow-[0_4px_20px_-4px_rgba(79,70,229,0.15)] overflow-hidden transition-all duration-300 hover:border-indigo-500/35">
      {/* Header */}
      <button
        type="button"
        onClick={toggleExpand}
        class="w-full flex items-center justify-between px-3.5 py-2.5 text-left transition-colors hover:bg-indigo-500/10 select-none group"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <div class="relative flex items-center justify-center w-6 h-6 rounded-lg bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 group-hover:text-indigo-300 group-hover:scale-105 transition-all">
            <Brain size={14} class="shrink-0" />
            <Show when={props.isStreaming}>
              <span class="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span class="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
              </span>
            </Show>
          </div>

          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold tracking-wide bg-gradient-to-r from-indigo-200 via-indigo-300 to-indigo-100 bg-clip-text text-transparent">
              {props.isStreaming ? '深度思考中...' : '思考过程'}
            </span>

            <Show when={wordCount() > 0}>
              <span class="text-[11px] text-indigo-300/50 font-mono">
                {wordCount()} 字
              </span>
            </Show>
          </div>
        </div>

        <div class="flex items-center gap-2 text-indigo-300/60 group-hover:text-indigo-200 transition-colors">
          <span class="text-[11px] font-medium hidden sm:inline">
            {isExpanded() ? '收起' : '展开'}
          </span>
          <span
            ref={chevronRef}
            class="inline-flex transition-transform duration-200"
            style={{ transform: isExpanded() ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <ChevronDown size={14} />
          </span>
        </div>
      </button>

      {/* Expandable Content */}
      <Show when={isExpanded()}>
        <div
          ref={contentRef}
          class="px-3.5 pb-3.5 pt-1 border-t border-indigo-500/10 text-xs font-mono text-indigo-100/80 leading-relaxed break-words whitespace-pre-wrap selection:bg-indigo-500/30 selection:text-indigo-100 max-h-[420px] overflow-y-auto"
        >
          {props.thinking}
          <Show when={props.isStreaming}>
            <span class="inline-block w-1.5 h-3.5 bg-indigo-400/80 ml-0.5 align-middle animate-pulse rounded-sm shadow-[0_0_8px_rgba(129,140,248,0.8)]" />
          </Show>
        </div>
      </Show>
    </div>
  );
};
