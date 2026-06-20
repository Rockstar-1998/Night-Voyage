import { Component, Show, For, createSignal, createEffect, createMemo } from 'solid-js';
import { getConversationTokenUsage, updateConversationContextWindow } from '../lib/backend';
import type { TokenUsageReport, TokenLayerUsage } from '../lib/backend';
import { animate } from '../lib/animate';

interface TokenIslandProps {
  conversationId: number;
  refreshKey?: number;
  onRefresh?: () => void;
}

const KIND_LABELS: Record<string, string> = {
  PresetRule: '预设规则',
  MultiplayerProtocol: '多人协议',
  CharacterBase: '角色人设',
  PlayerBase: '玩家人设',
  WorldBookMatch: '世界书',
  WorldVariable: '世界变量',
  PlotSummary: '剧情摘要',
  RetrievedDetail: '检索细节',
  RecentHistory: '聊天记录',
  CurrentUser: '当前输入',
};

function kindToLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function formatTokenCount(n: number): string {
  if (n >= 1000) {
    const k = n / 1000;
    return k % 1 === 0 ? `${k}K` : `${k.toFixed(1)}K`;
  }
  return String(n);
}

export const TokenIsland: Component<TokenIslandProps> = (props) => {
  const [report, setReport] = createSignal<TokenUsageReport | null>(null);
  const [expanded, setExpanded] = createSignal(false);
  const [contextInput, setContextInput] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  let containerRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;
  let currentAnimation: Animation | null = null;

  const totalEstimated = createMemo(() => report()?.totalEstimatedTokens ?? 0);
  const contextWindow = createMemo(() => report()?.contextWindowSize ?? null);
  const usageRatio = createMemo(() => {
    const cw = contextWindow();
    if (!cw) return 0;
    return totalEstimated() / cw;
  });
  const isWarning = createMemo(() => usageRatio() > 0.8);
  const isOverflow = createMemo(() => usageRatio() > 1);

  const fetchUsage = async () => {
    setError(null);
    try {
      const data = await getConversationTokenUsage(props.conversationId);
      setReport(data);
      if (data.contextWindowSize) {
        setContextInput(String(data.contextWindowSize));
      }
      props.onRefresh?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  createEffect(() => {
    const id = props.conversationId;
    props.refreshKey;
    if (id) void fetchUsage();
  });

  const handleToggle = () => {
    const nextExpanded = !expanded();
    setExpanded(nextExpanded);

    if (containerRef && contentRef) {
      if (currentAnimation) {
        currentAnimation.cancel();
        currentAnimation = null;
      }

      const collapsedHeight = 28;
      const expandedHeight = contentRef.scrollHeight;

      if (nextExpanded) {
        currentAnimation = animate(
          containerRef,
          {
            height: [`${collapsedHeight}px`, `${expandedHeight}px`],
            borderRadius: ['9999px', '1rem'],
          },
          { duration: 0.3, ease: 'easeInOut' },
        );
      } else {
        currentAnimation = animate(
          containerRef,
          {
            height: [`${expandedHeight}px`, `${collapsedHeight}px`],
            borderRadius: ['1rem', '9999px'],
          },
          { duration: 0.3, ease: 'easeInOut' },
        );
      }
    }
  };

  const handleSaveContextWindow = async () => {
    const val = parseInt(contextInput(), 10);
    if (isNaN(val) || val <= 0) return;
    setSaving(true);
    try {
      await updateConversationContextWindow(props.conversationId, val);
      await fetchUsage();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const numberColor = createMemo(() => {
    if (isOverflow()) return 'text-red-400 animate-pulse';
    if (isWarning()) return 'text-red-400';
    return 'text-mist-solid/70';
  });

  return (
    <div class="flex justify-center px-4 pt-2 relative z-30">
      <div
        ref={containerRef}
        class="w-full max-w-4xl backdrop-blur-md bg-white/5 border border-white/10 rounded-full overflow-hidden cursor-pointer select-none"
        style={{ height: '28px' }}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('[data-no-toggle]')) return;
          handleToggle();
        }}
      >
        <div ref={contentRef}>
          <div class="flex items-center justify-between h-7 px-3 gap-3">
            <Show
              when={contextWindow()}
              fallback={
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-xs text-mist-solid/40 whitespace-nowrap">点击设定上下文窗口</span>
                  <Show when={totalEstimated() > 0}>
                    <span class={`text-xs font-mono ${numberColor()}`}>
                      {formatTokenCount(totalEstimated())}
                    </span>
                  </Show>
                </div>
              }
            >
              <div class="flex items-center gap-2 min-w-0">
                <span class={`text-xs font-mono whitespace-nowrap ${numberColor()}`}>
                  {formatTokenCount(totalEstimated())} / {formatTokenCount(contextWindow()!)}
                </span>
              </div>
            </Show>
            <div class="flex items-center gap-2 min-w-0 flex-1 justify-end">
              <Show when={contextWindow() && (report()?.layers ?? []).length > 0}>
                <div class="flex h-2.5 rounded-full overflow-hidden bg-white/5 flex-1 min-w-0 max-w-[200px] relative">
                  <For each={report()?.layers ?? []}>
                    {(layer: TokenLayerUsage) => {
                      const cw = contextWindow()!;
                      const pct = Math.min((layer.estimatedTokens / cw) * 100, 100);
                      return (
                        <Show when={pct > 0}>
                          <div
                            class="h-full"
                            style={{
                              width: `${pct}%`,
                              'background-color': layer.color,
                            }}
                          />
                        </Show>
                      );
                    }}
                  </For>
                  <Show when={isOverflow()}>
                    <div
                      class="h-full overflow-stripes"
                      style={{
                        width: `${Math.min((usageRatio() - 1) * 100, 100)}%`,
                        'background-color': 'rgba(239, 68, 68, 0.7)',
                      }}
                    />
                  </Show>
                  <Show when={isWarning() && !isOverflow()}>
                    <div
                      class="absolute right-0 top-0 bottom-0 w-6 pointer-events-none"
                      style={{
                        background: 'linear-gradient(to left, rgba(239, 68, 68, 0.4), transparent)',
                      }}
                    />
                  </Show>
                </div>
              </Show>
              <svg
                class={`w-3 h-3 text-mist-solid/30 transition-transform duration-300 ${expanded() ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          <Show when={expanded()}>
            <div class="px-4 pb-4 pt-2 border-t border-white/5" data-no-toggle>
              <div class="flex items-center gap-2 mb-3">
                <input
                  type="number"
                  value={contextInput()}
                  onInput={(e) => setContextInput(e.currentTarget.value)}
                  class="flex-1 bg-white/5 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-mist-solid font-mono outline-none focus:border-accent/50 transition-colors min-h-[32px]"
                  placeholder="上下文窗口大小"
                  min="1"
                  onClick={(e) => e.stopPropagation()}
                />
                <span class="text-[10px] text-mist-solid/30 whitespace-nowrap">tokens</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleSaveContextWindow();
                  }}
                  disabled={saving()}
                  class="px-3 py-1.5 text-[10px] font-medium rounded-lg bg-accent/20 hover:bg-accent/30 text-accent transition-colors disabled:opacity-50 min-h-[32px]"
                >
                  {saving() ? '...' : '确认'}
                </button>
              </div>

              <div class="flex flex-col gap-1.5 mb-3">
                <For each={report()?.layers ?? []}>
                  {(layer: TokenLayerUsage) => {
                    const cw = contextWindow();
                    const pct = cw ? ((layer.estimatedTokens / cw) * 100).toFixed(1) : '—';
                    return (
                      <div class="flex items-center gap-2 text-xs min-h-[24px]">
                        <div
                          class="w-2 h-2 rounded-full shrink-0"
                          style={{ 'background-color': layer.color }}
                        />
                        <span class="text-mist-solid/60 flex-1 truncate">{kindToLabel(layer.kind)}</span>
                        <Show when={layer.title}>
                          <span class="text-mist-solid/30 truncate max-w-[120px]">{layer.title}</span>
                        </Show>
                        <span class="text-mist-solid/50 font-mono tabular-nums">{formatTokenCount(layer.estimatedTokens)}</span>
                        <span class="text-mist-solid/30 font-mono tabular-nums w-12 text-right">{pct}%</span>
                      </div>
                    );
                  }}
                </For>
              </div>

              <div class="flex items-center justify-between text-xs border-t border-white/5 pt-2">
                <div class="flex items-center gap-3">
                  <span class="text-mist-solid/50">
                    总计: <span class={`font-mono ${numberColor()}`}>{formatTokenCount(totalEstimated())}</span>
                  </span>
                  <Show when={contextWindow()}>
                    <span class="text-mist-solid/30">
                      剩余: <span class="font-mono text-mist-solid/50">{formatTokenCount(Math.max(0, contextWindow()! - totalEstimated()))}</span>
                    </span>
                  </Show>
                </div>
                <Show when={report()?.totalActualTokens != null}>
                  <span class="text-mist-solid/30">
                    实际: <span class="font-mono">{formatTokenCount(report()!.totalActualTokens!)}</span>
                  </span>
                </Show>
              </div>

              <Show when={error()}>
                <div class="mt-2 text-[10px] text-red-400/80">{error()}</div>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};
