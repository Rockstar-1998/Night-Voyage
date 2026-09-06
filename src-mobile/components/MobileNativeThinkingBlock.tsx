import { Component, Show, createSignal, createMemo, createEffect } from 'solid-js';
import { Brain, ChevronDown } from 'lucide-solid';

interface MobileNativeThinkingBlockProps {
  thinking: string;
  isStreaming?: boolean;
  defaultExpanded?: boolean;
}

export const MobileNativeThinkingBlock: Component<MobileNativeThinkingBlockProps> = (props) => {
  const [userToggled, setUserToggled] = createSignal(false);
  const [isExpanded, setIsExpanded] = createSignal(props.defaultExpanded ?? (props.isStreaming ?? false));

  createEffect(() => {
    if (props.isStreaming && !userToggled()) {
      setIsExpanded(true);
    }
  });

  const toggleExpand = () => {
    setUserToggled(true);
    setIsExpanded(!isExpanded());
  };

  const wordCount = createMemo(() => props.thinking ? props.thinking.length : 0);

  return (
    <div class="my-2 w-full rounded-xl border border-indigo-500/25 bg-gradient-to-b from-indigo-950/50 via-slate-900/60 to-slate-950/70 backdrop-blur-md overflow-hidden transition-colors shadow-sm">
      {/* Header */}
      <button
        type="button"
        onClick={toggleExpand}
        class="w-full flex items-center justify-between px-3 py-2 text-left active:bg-indigo-500/15 transition-colors select-none"
      >
        <div class="flex items-center gap-2 min-w-0">
          <div class="relative flex items-center justify-center w-5 h-5 rounded-md bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 shrink-0">
            <Brain size={12} />
            <Show when={props.isStreaming}>
              <span class="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
                <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-indigo-500" />
              </span>
            </Show>
          </div>

          <span class="text-xs font-medium text-indigo-200 truncate">
            {props.isStreaming ? '深度思考中…' : '思考过程'}
          </span>

          <Show when={wordCount() > 0}>
            <span class="text-[10px] text-indigo-300/50 font-mono shrink-0">
              {wordCount()}字
            </span>
          </Show>
        </div>

        <div class="flex items-center gap-1 text-indigo-300/60 shrink-0">
          <span class="text-[10px]">{isExpanded() ? '收起' : '展开'}</span>
          <span
            class="inline-flex transition-transform duration-200"
            style={{ transform: isExpanded() ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <ChevronDown size={14} />
          </span>
        </div>
      </button>

      {/* Content */}
      <Show when={isExpanded()}>
        <div class="px-3 pb-3 pt-1 border-t border-indigo-500/15 text-xs font-mono text-indigo-100/80 leading-relaxed break-words whitespace-pre-wrap max-h-60 overflow-y-auto">
          {props.thinking}
          <Show when={props.isStreaming}>
            <span class="inline-block w-1 h-3 bg-indigo-400/80 ml-0.5 align-middle animate-pulse rounded-sm" />
          </Show>
        </div>
      </Show>
    </div>
  );
};
