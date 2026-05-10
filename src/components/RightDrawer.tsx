import { Component, For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { AlertTriangle, ChevronLeft, ChevronRight, Layers3, Pencil, Save, Sparkles, UserRound } from '../lib/icons';
import { animate } from '../lib/animate';
import type { CharacterCard, PlotSummaryRecord, PresetSummary, WorldBookSummary } from '../lib/backend';
import { IconButton } from './ui/IconButton';

interface RightDrawerProps {
  selectedConversationId?: number | null;
  selectedCharacter?: CharacterCard | null;
  selectedPresetId?: number | null;
  selectedWorldBookId?: number | null;
  presetSummaries: PresetSummary[];
  worldBooks: WorldBookSummary[];
  onSaveConversationBindings: (payload: { presetId?: number; worldBookId?: number }) => Promise<void> | void;
  overlaySummary?: string | null;
  overlayStatus?: 'queued' | 'completed' | 'failed' | null;
  overlayError?: string | null;
  plotSummaryMode: 'ai' | 'manual' | string;
  plotSummaries: PlotSummaryRecord[];
  onUpdatePlotSummaryMode: (mode: 'ai' | 'manual') => Promise<void> | void;
  onSavePlotSummary: (batchIndex: number, summaryText: string) => Promise<void> | void;
}

const getSectionLabel = (sectionKey: string) => {
  switch (sectionKey) {
    case 'identity':
      return '身份底座';
    case 'persona':
      return '人格底座';
    case 'background':
      return '背景事实';
    case 'rules':
      return '长期规则';
    case 'custom':
      return '自定义段落';
    default:
      return '基础段落';
  }
};

const getPlotSummarySourceLabel = (sourceKind?: string) => {
  switch (sourceKind) {
    case 'ai':
      return 'AI 总结';
    case 'manual':
      return '手动总结';
    case 'manual_override':
      return '手动覆盖';
    default:
      return '未知来源';
  }
};

const getPlotSummaryStatusLabel = (status?: string) => {
  switch (status) {
    case 'pending':
      return '待填写';
    case 'queued':
      return '生成中';
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    default:
      return '未知状态';
  }
};

export const RightDrawer: Component<RightDrawerProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [drafts, setDrafts] = createSignal<Record<number, string>>({});
  const [modeUpdating, setModeUpdating] = createSignal(false);
  const [savingBatchIndex, setSavingBatchIndex] = createSignal<number | null>(null);
  const [localError, setLocalError] = createSignal<string | null>(null);
  const [bindingPresetId, setBindingPresetId] = createSignal<string>('');
  const [bindingWorldBookId, setBindingWorldBookId] = createSignal<string>('');
  const [bindingSaving, setBindingSaving] = createSignal(false);
  let drawerRef: HTMLDivElement | undefined;

  const toggleDrawer = () => {
    setIsOpen(!isOpen());
    if (drawerRef) {
      animate(drawerRef as any, { x: isOpen() ? 0 : '100%' }, { duration: 0.3, ease: 'easeOut' });
    }
  };

  const baseSections = createMemo(() => props.selectedCharacter?.baseSections ?? []);
  const fallbackDescription = createMemo(() => props.selectedCharacter?.description?.trim() ?? '');
  const overlayDescription = createMemo(() => {
    if (props.overlayError) return props.overlayError;
    if (props.overlaySummary) return props.overlaySummary;
    if (props.overlayStatus === 'queued') return '当前轮主回复完成后，后端正在异步生成最新角色状态覆盖层。';
    return '当前会话还没有可展示的角色状态覆盖层。';
  });
  const sortedPlotSummaries = createMemo(() => [...props.plotSummaries].sort((a, b) => a.batchIndex - b.batchIndex));
  const pendingSummaries = createMemo(() => sortedPlotSummaries().filter((summary) => summary.status === 'pending'));
  const selectedPresetLabel = createMemo(() => {
    const presetId = props.selectedPresetId;
    if (presetId == null) return '当前会话未绑定预设。';
    const preset = props.presetSummaries.find((item) => item.id === presetId);
    return preset ? `当前会话已绑定预设：${preset.name}` : `当前会话已绑定预设 #${presetId}`;
  });
  const selectedWorldBookLabel = createMemo(() => {
    const worldBookId = props.selectedWorldBookId;
    if (worldBookId == null) return '当前会话未绑定世界书。';
    const worldBook = props.worldBooks.find((item) => item.id === worldBookId);
    return worldBook ? `当前会话已绑定世界书：${worldBook.title}` : `当前会话已绑定世界书 #${worldBookId}`;
  });

  const draftText = (summary: PlotSummaryRecord) => drafts()[summary.batchIndex] ?? summary.summaryText ?? '';
  const canEdit = (summary: PlotSummaryRecord) => summary.status !== 'queued';

  const handleDraftInput = (batchIndex: number, value: string) => {
    setDrafts((prev) => ({ ...prev, [batchIndex]: value }));
  };

  const handleModeChange = async (mode: 'ai' | 'manual') => {
    if (modeUpdating() || props.plotSummaryMode === mode) return;
    setModeUpdating(true);
    setLocalError(null);
    try {
      await props.onUpdatePlotSummaryMode(mode);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setModeUpdating(false);
    }
  };

  const handleSaveSummary = async (summary: PlotSummaryRecord) => {
    const nextText = draftText(summary).trim();
    if (!nextText) {
      setLocalError(`剧情总结 #${summary.batchIndex} 不能为空。`);
      return;
    }
    setSavingBatchIndex(summary.batchIndex);
    setLocalError(null);
    try {
      await props.onSavePlotSummary(summary.batchIndex, nextText);
      setDrafts((prev) => ({ ...prev, [summary.batchIndex]: nextText }));
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingBatchIndex(null);
    }
  };

  const handleSaveBindings = async () => {
    if (props.selectedConversationId == null) {
      setLocalError('当前未选择会话，无法保存绑定。');
      return;
    }

    const nextPresetId = bindingPresetId().trim() ? Number(bindingPresetId()) : undefined;
    const nextWorldBookId = bindingWorldBookId().trim() ? Number(bindingWorldBookId()) : undefined;

    if (nextPresetId == null && nextWorldBookId == null) {
      setLocalError('请至少选择一个预设或世界书后再保存。');
      return;
    }

    setBindingSaving(true);
    setLocalError(null);
    try {
      await props.onSaveConversationBindings({
        presetId: nextPresetId,
        worldBookId: nextWorldBookId,
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBindingSaving(false);
    }
  };

  onMount(() => {
    if (drawerRef) {
      drawerRef.style.transform = 'translateX(100%)';
    }
  });

  createMemo(() => {
    setBindingPresetId(props.selectedPresetId != null ? String(props.selectedPresetId) : '');
    setBindingWorldBookId(props.selectedWorldBookId != null ? String(props.selectedWorldBookId) : '');
    return null;
  });

  return (
    <>
      <Show when={isOpen()}>
        <div
          class="fixed inset-0 bg-xuanqing/40 backdrop-blur-sm z-40 transition-opacity"
          onClick={toggleDrawer}
        />
      </Show>

      <button
        onClick={toggleDrawer}
        class={`fixed top-1/2 right-0 -translate-y-1/2 z-30 bg-accent/80 hover:bg-accent text-white p-1.5 py-4 rounded-l-2xl shadow-[0_0_20px_rgba(0,0,0,0.3)] border-l border-y border-white/10 backdrop-blur-md transition-all hover:pr-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isOpen() ? 'translate-x-full opacity-0' : ''}`}
        title="打开层状态抽屉"
        aria-label="打开层状态抽屉"
      >
        <ChevronLeft size={20} />
      </button>

      <div
        ref={drawerRef}
        class="fixed top-0 right-0 h-full w-[28rem] max-w-[94vw] bg-mist backdrop-blur-xl border-l border-white/5 shadow-2xl z-50 flex flex-col pt-8 pb-4 will-change-transform text-mist-solid"
      >
        <div class="px-6 flex items-center justify-between mb-6">
          <div>
            <h2 class="text-xl font-bold">层状态与剧情总结</h2>
            <p class="text-xs text-mist-solid/35 mt-1">预设规则层 / 角色基础层 / 角色状态覆盖层 / 剧情总结时间线</p>
          </div>
          <IconButton onClick={toggleDrawer} label="关闭层状态抽屉" size="md">
            <ChevronRight size={18} />
          </IconButton>
        </div>

        <div class="flex-1 overflow-y-auto px-4 space-y-4 custom-scrollbar">
          <Show when={localError()}>
            <div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200 whitespace-pre-wrap leading-6 flex gap-3">
              <AlertTriangle size={18} class="shrink-0 mt-0.5" />
              <span>{localError()}</span>
            </div>
          </Show>

          <section class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-200 flex items-center justify-center">
                <Layers3 size={18} />
              </div>
              <div>
                <p class="text-sm font-semibold text-white">会话绑定</p>
                <p class="text-xs text-mist-solid/40">在当前聊天上下文中直接切换预设与世界书绑定。</p>
              </div>
            </div>
            <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3 text-sm text-mist-solid/75 leading-6 space-y-1">
              <p>{selectedPresetLabel()}</p>
              <p>{selectedWorldBookLabel()}</p>
            </div>
            <div class="space-y-2">
              <label class="text-xs uppercase tracking-widest text-mist-solid/35">预设绑定</label>
              <select
                value={bindingPresetId()}
                onChange={(event) => setBindingPresetId(event.currentTarget.value)}
                class="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-mist-solid outline-none focus:border-accent/40"
              >
                <option value="">保持当前预设</option>
                <For each={props.presetSummaries}>
                  {(preset) => <option value={preset.id}>{preset.name}</option>}
                </For>
              </select>
            </div>
            <div class="space-y-2">
              <label class="text-xs uppercase tracking-widest text-mist-solid/35">世界书绑定</label>
              <select
                value={bindingWorldBookId()}
                onChange={(event) => setBindingWorldBookId(event.currentTarget.value)}
                class="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-mist-solid outline-none focus:border-accent/40"
              >
                <option value="">保持当前世界书</option>
                <For each={props.worldBooks}>
                  {(worldBook) => <option value={worldBook.id}>{worldBook.title}</option>}
                </For>
              </select>
            </div>
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs text-mist-solid/40 leading-5">本轮支持绑定与切换；若要清空绑定，可后续补专用入口。</p>
              <IconButton
                disabled={bindingSaving()}
                onClick={() => void handleSaveBindings()}
                label={bindingSaving() ? '绑定保存中' : '保存会话绑定'}
                tone="accent"
                size="md"
              >
                <Save size={16} class={bindingSaving() ? 'animate-pulse' : ''} />
              </IconButton>
            </div>
          </section>

          <section class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center">
                <Layers3 size={18} />
              </div>
              <div>
                <p class="text-sm font-semibold text-white">第 1 层：预设规则层</p>
                <p class="text-xs text-mist-solid/40">当前宿主前端已接入 workspace 预设治理 UI</p>
              </div>
            </div>
            <div class="text-sm text-mist-solid/75 leading-6">
              <p>{selectedPresetLabel()}</p>
              <p class="text-xs text-mist-solid/40 mt-2">详细编辑入口：工作台 {'>'} 预设治理区。</p>
            </div>
          </section>

          <section class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-accent/20 text-accent flex items-center justify-center">
                <UserRound size={18} />
              </div>
              <div>
                <p class="text-sm font-semibold text-white">第 2 层：角色卡基础层</p>
                <p class="text-xs text-mist-solid/40">结构化 CharacterBase 段落</p>
              </div>
            </div>
            <Show
              when={props.selectedCharacter}
              fallback={<div class="text-sm text-mist-solid/45">当前会话未绑定可展示的角色卡。</div>}
            >
              <div class="space-y-3">
                <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
                  <p class="text-xs uppercase tracking-widest text-mist-solid/35">角色</p>
                  <p class="text-sm font-semibold text-white mt-1">{props.selectedCharacter?.name}</p>
                </div>
                <Show
                  when={baseSections().length > 0}
                  fallback={
                    <div class="rounded-xl border border-dashed border-white/10 bg-black/10 px-3 py-3 text-sm text-mist-solid/70 whitespace-pre-wrap">
                      {fallbackDescription() || '当前没有结构化基础层段落，也没有兼容描述回退文本。'}
                    </div>
                  }
                >
                  <div class="space-y-3">
                    <For each={baseSections()}>
                      {(section) => (
                        <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3 space-y-2">
                          <div class="flex items-center justify-between gap-3">
                            <p class="text-sm font-semibold text-white">{section.title || getSectionLabel(section.sectionKey)}</p>
                            <span class="text-[10px] uppercase tracking-widest text-mist-solid/35">#{section.sortOrder}</span>
                          </div>
                          <p class="text-sm text-mist-solid/75 whitespace-pre-wrap leading-6">{section.content}</p>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </section>

          <section class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
                <Sparkles size={18} />
              </div>
              <div>
                <p class="text-sm font-semibold text-white">第 3 层：角色状态覆盖层</p>
                <p class="text-xs text-mist-solid/40">AI 自动生成的软设定快照</p>
              </div>
            </div>
            <Show when={props.overlayError}>
              <div class="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-200 whitespace-pre-wrap leading-6 flex gap-3">
                <AlertTriangle size={18} class="shrink-0 mt-0.5" />
                <span>{props.overlayError}</span>
              </div>
            </Show>
            <Show when={!props.overlayError && props.overlayStatus === 'queued'}>
              <div class="rounded-xl border border-yellow-400/20 bg-yellow-400/10 px-3 py-3 text-sm text-yellow-100 leading-6">
                当前正在生成最新状态覆盖层，请等待后端异步总结完成。
              </div>
            </Show>
            <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
              <p class="text-xs uppercase tracking-widest text-mist-solid/35">最新摘要</p>
              <p class="text-sm text-mist-solid/75 whitespace-pre-wrap leading-6 mt-2">{overlayDescription()}</p>
            </div>
          </section>

          <section class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-white">第 5 层：剧情总结时间线</p>
                <p class="text-xs text-mist-solid/40 mt-1">已总结轮次仍在聊天区可见，但默认不再作为原文进入请求体。</p>
              </div>
              <div class="flex items-center gap-3 shrink-0">
                <div class="text-right">
                  <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">模式</div>
                  <div class="text-xs text-mist-solid/45 mt-1">{props.plotSummaryMode === 'manual' ? '手动' : 'AI'}</div>
                </div>
                <IconButton
                  disabled={modeUpdating()}
                  onClick={() => void handleModeChange('ai')}
                  label="切换到 AI 总结"
                  tone={props.plotSummaryMode === 'ai' ? 'accent' : 'neutral'}
                  size="sm"
                  active={props.plotSummaryMode === 'ai'}
                >
                  <Sparkles size={14} />
                </IconButton>
                <IconButton
                  disabled={modeUpdating()}
                  onClick={() => void handleModeChange('manual')}
                  label="切换到手动总结"
                  tone={props.plotSummaryMode === 'manual' ? 'accent' : 'neutral'}
                  size="sm"
                  active={props.plotSummaryMode === 'manual'}
                >
                  <Pencil size={14} />
                </IconButton>
              </div>
            </div>

            <div class="grid grid-cols-3 gap-2 text-center text-xs">
              <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
                <p class="text-mist-solid/35 uppercase tracking-widest">模式</p>
                <p class="text-white font-semibold mt-1">{props.plotSummaryMode === 'manual' ? '手动' : 'AI'}</p>
              </div>
              <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
                <p class="text-mist-solid/35 uppercase tracking-widest">总条目</p>
                <p class="text-white font-semibold mt-1">{sortedPlotSummaries().length}</p>
              </div>
              <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
                <p class="text-mist-solid/35 uppercase tracking-widest">待填写</p>
                <p class="text-white font-semibold mt-1">{pendingSummaries().length}</p>
              </div>
            </div>

            <Show when={props.plotSummaryMode === 'manual' && pendingSummaries().length > 0}>
              <div class="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-50 leading-6">
                当前有 {pendingSummaries().length} 个待总结窗口。未补写总结前，这些轮次会继续以原文进入请求体。
              </div>
            </Show>

            <Show
              when={sortedPlotSummaries().length > 0}
              fallback={<div class="rounded-xl border border-dashed border-white/10 bg-black/10 px-4 py-4 text-sm text-mist-solid/55">当前会话还没有剧情总结条目。</div>}
            >
              <div class="space-y-4">
                <For each={sortedPlotSummaries()}>
                  {(summary) => (
                    <div class="rounded-2xl border border-white/10 bg-black/10 px-4 py-4 space-y-3">
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <p class="text-sm font-semibold text-white">摘要 {summary.batchIndex}</p>
                          <p class="text-xs text-mist-solid/40 mt-1">
                            轮次 {summary.startRoundIndex}-{summary.endRoundIndex} · {getPlotSummarySourceLabel(summary.sourceKind)} · {getPlotSummaryStatusLabel(summary.status)}
                          </p>
                        </div>
                        <span class={`text-[10px] uppercase tracking-widest px-2 py-1 rounded-full border ${summary.status === 'completed' ? 'border-emerald-400/30 text-emerald-200 bg-emerald-400/10' : summary.status === 'queued' ? 'border-sky-400/30 text-sky-200 bg-sky-400/10' : summary.status === 'failed' ? 'border-red-400/30 text-red-200 bg-red-400/10' : 'border-amber-400/30 text-amber-100 bg-amber-400/10'}`}>
                          {getPlotSummaryStatusLabel(summary.status)}
                        </span>
                      </div>

                      <Show when={summary.errorMessage}>
                        <div class="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-3 text-sm text-red-200 whitespace-pre-wrap leading-6 flex gap-3">
                          <AlertTriangle size={16} class="shrink-0 mt-0.5" />
                          <span>{summary.errorMessage}</span>
                        </div>
                      </Show>

                      <Show when={summary.status === 'queued'}>
                        <div class="rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-3 text-sm text-sky-100 leading-6">
                          当前窗口正在生成剧情总结，请等待后端异步完成。
                        </div>
                      </Show>

                      <Show when={canEdit(summary)}>
                        <div class="space-y-2">
                          <textarea
                            class="w-full min-h-[8rem] rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-mist-solid/80 whitespace-pre-wrap leading-6 outline-none focus:border-accent/40 resize-y"
                            value={draftText(summary)}
                            onInput={(event) => handleDraftInput(summary.batchIndex, event.currentTarget.value)}
                            placeholder="输入条目式剧情总结，例如：主角一行人从酒馆出发，到达山谷。\n委托：已接受\nXX 的状态：犯困"
                          />
                          <div class="flex items-center justify-between gap-3">
                            <p class="text-xs text-mist-solid/40">
                              {summary.status === 'pending'
                                ? '保存后，该窗口对应轮次将不再以原文进入请求体。'
                                : '你可以在这里修改 AI 生成内容并覆盖当前条目。'}
                            </p>
                            <IconButton
                              disabled={savingBatchIndex() === summary.batchIndex}
                              onClick={() => void handleSaveSummary(summary)}
                              label={savingBatchIndex() === summary.batchIndex ? '剧情总结保存中' : summary.status === 'pending' ? '保存总结' : '覆盖保存'}
                              tone="accent"
                              size="md"
                            >
                              <Save size={16} class={savingBatchIndex() === summary.batchIndex ? 'animate-pulse' : ''} />
                            </IconButton>
                          </div>
                        </div>
                      </Show>

                      <Show when={!canEdit(summary) && summary.summaryText}>
                        <div class="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm text-mist-solid/80 whitespace-pre-wrap leading-6">
                          {summary.summaryText}
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </section>
        </div>

        <div class="mt-auto px-6 pt-4 text-center text-xs text-mist-solid/20">
          Night Voyage Layer Drawer
        </div>
      </div>
    </>
  );
};
