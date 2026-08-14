import { Component, For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { Select } from './ui/Select';
import { AlertTriangle, ChevronLeft, ChevronRight, Layers3, Radio, Save, Sparkles, UserRound, Lock } from '../lib/icons';
import { animate } from '../lib/animate';
import type { ApiProviderSummary, CharacterCard, PlotSummaryRecord, PresetSummary, WorldBookSummary } from '../lib/backend';
import { toAssetUrl } from '../lib/backend';
import { IconButton } from './ui/IconButton';

interface RightDrawerProps {
  selectedConversationId?: number | null;
  selectedCharacter?: CharacterCard | null;
  selectedPresetId?: number | null;
  selectedWorldBookId?: number | null;
  presetSummaries: PresetSummary[];
  worldBooks: WorldBookSummary[];
  onSaveConversationBindings: (payload: { presetId?: number; worldBookId?: number; providerId?: number; embeddingProviderId?: number | null }) => Promise<void> | void;
  memoryMode: 'stateless' | 'legacy' | 'mem0' | string;
  mem0SnapshotWindow?: number;
  onSnapshotWindowChange?: (window: number) => Promise<void> | void;
  playerCharacters: CharacterCard[];
  currentPlayerCharacter?: CharacterCard;
  onSwitchPlayerCharacter: (playerCharacterId: number) => Promise<void> | void;
  providers: ApiProviderSummary[];
  selectedProviderId?: number | null;
  selectedEmbeddingProviderId?: number | null;
  isRoomClient?: boolean;
  hostPresetName?: string | null;
  hostWorldBookName?: string | null;
  hostProviderName?: string | null;
  plotSummaries?: PlotSummaryRecord[];
  conversationType?: 'single' | 'online' | string;
  isGuest?: boolean;
  roomPort?: number | null;
  roomIsOpen?: boolean;
  onUpdateRoomPort?: (port: number) => Promise<void> | void;
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

export const RightDrawer: Component<RightDrawerProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [localError, setLocalError] = createSignal<string | null>(null);
  const [bindingPresetId, setBindingPresetId] = createSignal<string>('');
  const [bindingWorldBookId, setBindingWorldBookId] = createSignal<string>('');
  const [bindingSaving, setBindingSaving] = createSignal(false);
  const [switchingPlayerCharacter, setSwitchingPlayerCharacter] = createSignal(false);
  const [bindingProviderId, setBindingProviderId] = createSignal('');
  const [bindingEmbeddingProviderId, setBindingEmbeddingProviderId] = createSignal('');
  const [snapshotWindowInput, setSnapshotWindowInput] = createSignal('');
  const [snapshotWindowSaving, setSnapshotWindowSaving] = createSignal(false);
  const [portInput, setPortInput] = createSignal('');
  const [portSaving, setPortSaving] = createSignal(false);
  let drawerRef: HTMLDivElement | undefined;

  const toggleDrawer = () => {
    setIsOpen(!isOpen());
    if (drawerRef) {
      animate(drawerRef as any, { x: isOpen() ? 0 : '100%' }, { duration: 0.3, ease: 'easeOut' });
    }
  };

  const baseSections = createMemo(() => props.selectedCharacter?.baseSections ?? []);
  const fallbackDescription = createMemo(() => props.selectedCharacter?.description?.trim() ?? '');
  const selectedPresetLabel = createMemo(() => {
    if (props.isRoomClient) {
      return props.hostPresetName ? `房主预设：${props.hostPresetName}` : '房主未绑定预设。';
    }
    const presetId = props.selectedPresetId;
    if (presetId == null) return '当前会话未绑定预设。';
    const preset = props.presetSummaries.find((item) => item.id === presetId);
    return preset ? `当前会话已绑定预设：${preset.name}` : `当前会话已绑定预设 #${presetId}`;
  });
  const selectedWorldBookLabel = createMemo(() => {
    if (props.isRoomClient) {
      return props.hostWorldBookName ? `房主世界书：${props.hostWorldBookName}` : '房主未绑定世界书。';
    }
    const worldBookId = props.selectedWorldBookId;
    if (worldBookId == null) return '当前会话未绑定世界书。';
    const worldBook = props.worldBooks.find((item) => item.id === worldBookId);
    return worldBook ? `当前会话已绑定世界书：${worldBook.title}` : `当前会话已绑定世界书 #${worldBookId}`;
  });
  const selectedProviderLabel = createMemo(() => {
    if (props.isRoomClient) {
      return props.hostProviderName ? `房主 API 档案：${props.hostProviderName}` : '房主未绑定 API 档案。';
    }
    const providerId = props.selectedProviderId;
    if (providerId == null) return '当前会话未绑定 API 档案。';
    const provider = props.providers.find((item) => item.id === providerId);
    return provider ? `当前会话已绑定 API 档案：${provider.name}` : `当前会话已绑定 API 档案 #${providerId}`;
  });

  // 仅列出用途为 embedding 的档案，与 LLM 档案彻底分离。
  const embeddingProviders = createMemo(() =>
    props.providers.filter((provider) => provider.purpose === 'embedding'),
  );

  const selectedEmbeddingProviderLabel = createMemo(() => {
    const providerId = props.selectedEmbeddingProviderId;
    if (providerId == null) return '当前会话未绑定 Embedding 档案。';
    const provider = embeddingProviders().find((item) => item.id === providerId);
    return provider
      ? `当前会话已绑定 Embedding 档案：${provider.name}`
      : '当前会话未绑定 Embedding 档案。';
  });

  const memoryModeLabel = createMemo(() => {
    switch (props.memoryMode) {
      case 'mem0': return 'Mem0 记忆托管';
      case 'legacy': return '传统（剧情总结+世界变量）';
      default: return '无状态（纯多轮对话）';
    }
  });

  const handleSnapshotWindowSave = async () => {
    const val = Number(snapshotWindowInput());
    if (!Number.isFinite(val) || val < 1 || val > 1000) {
      setLocalError('快照窗口值必须在 1-1000 之间。');
      return;
    }
    setSnapshotWindowSaving(true);
    setLocalError(null);
    try {
      await props.onSnapshotWindowChange?.(val);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setSnapshotWindowSaving(false);
    }
  };

  const handleSaveBindings = async () => {
    if (props.selectedConversationId == null) {
      setLocalError('当前未选择会话，无法保存绑定。');
      return;
    }

    const nextPresetId = bindingPresetId().trim() ? Number(bindingPresetId()) : undefined;
    const nextWorldBookId = bindingWorldBookId().trim() ? Number(bindingWorldBookId()) : undefined;
    const nextProviderId = bindingProviderId().trim() ? Number(bindingProviderId()) : undefined;
    // 三态：''=保持当前(undefined) / 'none'=清空(null) / 数字=设置(number)
    const embeddingRaw = bindingEmbeddingProviderId();
    const nextEmbeddingProviderId =
      embeddingRaw === '' ? undefined : embeddingRaw === 'none' ? null : Number(embeddingRaw);

    if (
      nextPresetId == null &&
      nextWorldBookId == null &&
      nextProviderId == null &&
      nextEmbeddingProviderId === undefined
    ) {
      setLocalError('请至少选择一项绑定变更后再保存。');
      return;
    }

    setBindingSaving(true);
    setLocalError(null);
    try {
      await props.onSaveConversationBindings({
        presetId: nextPresetId,
        worldBookId: nextWorldBookId,
        providerId: nextProviderId,
        embeddingProviderId: nextEmbeddingProviderId,
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBindingSaving(false);
    }
  };

  const handleSwitchPlayerCharacter = async (playerCharacterId: number) => {
    setSwitchingPlayerCharacter(true);
    setLocalError(null);
    try {
      await props.onSwitchPlayerCharacter(playerCharacterId);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setSwitchingPlayerCharacter(false);
    }
  };

  onMount(() => {
    if (drawerRef) {
      drawerRef.style.translate = '100%';
    }
  });

  createMemo(() => {
    setBindingPresetId(props.selectedPresetId != null ? String(props.selectedPresetId) : '');
    setBindingWorldBookId(props.selectedWorldBookId != null ? String(props.selectedWorldBookId) : '');
    setBindingProviderId(props.selectedProviderId != null ? String(props.selectedProviderId) : '');
    // Embedding 仅在 mem0 模式有意义；且只采纳真实存在于 embedding 档案列表中的 id，
    // 杜绝悬空/失效 id（如已删除 provider 残留的 0）污染下拉框（对应后端"无效状态不可表达"）。
    const embeddingId = props.selectedEmbeddingProviderId;
    const embeddingInit =
      props.memoryMode === 'mem0' && embeddingId != null && embeddingProviders().some((p) => p.id === embeddingId)
        ? String(embeddingId)
        : '';
    setBindingEmbeddingProviderId(embeddingInit);
    setSnapshotWindowInput(props.mem0SnapshotWindow != null ? String(props.mem0SnapshotWindow) : '20');
    return null;
  });

  return (
    <>
      <div
          class={`fixed inset-0 bg-xuanqing/40 z-40 transition-all duration-300 ease-out ${isOpen() ? 'opacity-100 backdrop-blur-sm pointer-events-auto' : 'opacity-0 backdrop-blur-none pointer-events-none'}`}
          onClick={toggleDrawer}
        />

      <button
        onClick={toggleDrawer}
        class={`fixed top-[55%] right-0 -translate-y-1/2 z-30 bg-black/40 hover:bg-black/60 text-mist-solid/60 hover:text-accent p-2 rounded-l-xl border-l border-y border-white/10 backdrop-blur-md transition-all hover:pr-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${isOpen() ? 'translate-x-full opacity-0' : ''}`}
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
            <p class="text-xs text-mist-solid/35 mt-1">预设规则层 / 角色基础层 / 世界变量 / 记忆模式</p>
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

          <section class="border-b border-white/10 pb-6 mb-6 space-y-5">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-200 flex items-center justify-center">
                <Layers3 size={18} />
              </div>
              <div>
                <p class="text-sm font-semibold text-white">会话绑定</p>
                <p class="text-xs text-mist-solid/40">在当前聊天上下文中直接切换预设与世界书绑定。</p>
              </div>
            </div>
            <div class="px-1 py-2 text-sm text-mist-solid/75 leading-6 space-y-1 border-l-2 border-white/20">
              <p>{selectedPresetLabel()}</p>
              <p>{selectedWorldBookLabel()}</p>
              <p>{selectedProviderLabel()}</p>
              <Show when={props.memoryMode === 'mem0'}>
                <p>{selectedEmbeddingProviderLabel()}</p>
              </Show>
            </div>
            <div class="space-y-2">
              <label class="text-xs uppercase tracking-widest text-mist-solid/35">预设绑定</label>
              <Select
  value={bindingPresetId()}
  onChange={(val) => setBindingPresetId(val)}
  options={[
  { label: "保持当前预设", value: "" },
  ...(props.presetSummaries).map(preset => ({ label: preset.name, value: (preset.id)?.toString() }))
  ]}
/>
            </div>
            <div class="space-y-2">
              <label class="text-xs uppercase tracking-widest text-mist-solid/35">世界书绑定</label>
              <Select
  value={bindingWorldBookId()}
  onChange={(val) => setBindingWorldBookId(val)}
  options={[
  { label: "保持当前世界书", value: "" },
  ...(props.worldBooks).map(worldBook => ({ label: worldBook.title, value: (worldBook.id)?.toString() }))
  ]}
/>
            </div>
            <div class="space-y-2">
  <label class="text-xs uppercase tracking-widest text-mist-solid/35">API 档案绑定（LLM）</label>
  <Select
    value={bindingProviderId()}
    onChange={(val) => setBindingProviderId(val)}
    options={[
      { label: "保持当前 API 档案", value: "" },
      ...(props.providers.filter((p) => p.purpose === 'llm')).map(provider => ({ label: provider.name, value: (provider.id)?.toString() }))
    ]}
  />
</div>
            <Show when={props.memoryMode === 'mem0'}>
              <div class="space-y-2">
                <label class="text-xs uppercase tracking-widest text-mist-solid/35">Embedding 档案绑定</label>
                <Select
                  value={bindingEmbeddingProviderId()}
                  onChange={(val) => setBindingEmbeddingProviderId(val)}
                  options={[
                    { label: "保持当前 Embedding 档案", value: "" },
                    { label: "不绑定 Embedding 档案", value: "none" },
                    ...(embeddingProviders()).map(provider => ({ label: provider.name, value: (provider.id)?.toString() }))
                  ]}
                />
                <Show when={embeddingProviders().length === 0}>
                  <p class="text-[11px] leading-relaxed text-amber-300/80">
                    未找到用途为 Embedding 的 API 档案。请先在设置中创建 purpose=Embedding 的档案（需支持 /v1/embeddings）。
                  </p>
                </Show>
                <p class="text-[11px] leading-relaxed text-mist-solid/40">
                  MEM0 模式按会话绑定 Embedding 档案；不同档案使用独立的向量集合，切换后旧向量不会复用。
                </p>
              </div>
            </Show>
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

          <section class="border-b border-white/10 pb-6 mb-6 space-y-5">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center">
                <UserRound size={18} />
              </div>
              <div>
                <p class="text-sm font-semibold text-white">玩家角色卡</p>
                <p class="text-xs text-mist-solid/40">切换当前会话中你扮演的角色卡。</p>
              </div>
            </div>
            <Show
              when={props.currentPlayerCharacter}
              fallback={<div class="text-sm text-mist-solid/45">当前会话未绑定玩家角色卡。</div>}
            >
              <div class="px-1 py-2 flex items-center gap-3 border-l-2 border-white/20">
                <Show when={props.currentPlayerCharacter?.imagePath} fallback={<div class="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center text-mist-solid/40"><UserRound size={16} /></div>}>
                  <img src={toAssetUrl(props.currentPlayerCharacter?.imagePath)} alt="" class="w-8 h-8 rounded-lg object-cover" />
                </Show>
                <p class="text-sm font-semibold text-white">{props.currentPlayerCharacter?.name}</p>
              </div>
            </Show>
            <Show when={props.playerCharacters.length > 0}>
              <div class="space-y-2">
                <label class="text-xs uppercase tracking-widest text-mist-solid/35">切换角色卡</label>
                <Select
  value={props.currentPlayerCharacter?.id?.toString() ?? ''}
  onChange={(val) => { if (val) handleSwitchPlayerCharacter(Number(val)); }} disabled={switchingPlayerCharacter()}
  options={[
  ...(props.playerCharacters).map(pc => ({ label: pc.name, value: (pc.id)?.toString() }))
  ]}
/>
              </div>
            </Show>
            <Show when={switchingPlayerCharacter()}>
              <p class="text-xs text-sky-200 animate-pulse">正在切换玩家角色卡…</p>
            </Show>
          </section>

          <section class="border-b border-white/10 pb-6 mb-6 space-y-4">
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

          <section class="border-b border-white/10 pb-6 mb-6 space-y-4">
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
                <div class="px-1 py-2 border-l-2 border-white/20">
                  <p class="text-xs uppercase tracking-widest text-mist-solid/35">角色</p>
                  <p class="text-sm font-semibold text-white mt-1">{props.selectedCharacter?.name}</p>
                </div>
                <Show
                  when={baseSections().length > 0}
                  fallback={
                    <div class="px-1 py-2 text-sm text-mist-solid/70 whitespace-pre-wrap border-l-2 border-dashed border-white/20">
                      {fallbackDescription() || '当前没有结构化基础层段落，也没有兼容描述回退文本。'}
                    </div>
                  }
                >
                  <div class="space-y-3">
                    <For each={baseSections()}>
                      {(section) => (
                        <div class="px-1 py-2 space-y-2 border-l-2 border-white/20">
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

          <section class="border-b border-white/10 pb-6 mb-6 space-y-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center">
                <Sparkles size={18} />
              </div>
              <div>
                <p class="text-sm font-semibold text-white">世界变量</p>
                <p class="text-xs text-mist-solid/40">由 Preset 控制的世界状态变量</p>
              </div>
            </div>
            <Show when={props.memoryMode === 'mem0'}>
              <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
                <p class="text-sm text-mist-solid/50">Mem0 模式下世界变量由记忆系统自动管理。</p>
              </div>
            </Show>
            <Show when={props.memoryMode !== 'mem0'}>
              <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
                <p class="text-sm text-mist-solid/75">世界变量由绑定的 Preset 控制开关，存储在每轮对话记录中。</p>
              </div>
            </Show>
          </section>

          <section class="border-b border-white/10 pb-6 mb-6 space-y-5">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-200 flex items-center justify-center">
                <Lock size={18} />
              </div>
              <div>
                <p class="text-sm font-semibold text-white">记忆模式</p>
                <p class="text-xs text-mist-solid/40 mt-1">模式在创建时锁定，不可切换。</p>
              </div>
            </div>
            <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-3">
              <p class="text-sm font-medium text-accent">{memoryModeLabel()}</p>
            </div>
            <Show when={props.memoryMode === 'mem0'}>
              <div class="space-y-2">
                <label class="text-xs uppercase tracking-widest text-mist-solid/35">快照窗口（轮数）</label>
                <div class="flex items-center gap-3">
                  <input
                    type="number"
                    value={snapshotWindowInput()}
                    onInput={(e) => setSnapshotWindowInput(e.currentTarget.value)}
                    min={1}
                    max={1000}
                    class="flex-1 bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
                  />
                  <IconButton
                    disabled={snapshotWindowSaving()}
                    onClick={() => void handleSnapshotWindowSave()}
                    label={snapshotWindowSaving() ? '保存中' : '保存快照窗口'}
                    tone="accent"
                    size="md"
                  >
                    <Save size={16} class={snapshotWindowSaving() ? 'animate-pulse' : ''} />
                  </IconButton>
                </div>
                <p class="text-[11px] text-mist-solid/40">每隔新轮次时自动创建快照，保留最近 X 轮。</p>
              </div>
            </Show>
          </section>

          <Show when={props.conversationType === 'online' && !props.isGuest && !props.isRoomClient}>
            <section class="border-b border-white/10 pb-6 mb-6 space-y-4">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-200 flex items-center justify-center">
                  <Radio size={18} />
                </div>
                <div>
                  <p class="text-sm font-semibold text-white">房间端口设置</p>
                  <p class="text-xs text-mist-solid/40">仅房主可修改联机房间端口</p>
                </div>
              </div>

              <div class="flex items-end gap-2">
                <div class="flex-1 space-y-1">
                  <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">端口</label>
                  <input
                    type="number"
                    value={portInput() || (props.roomPort != null ? String(props.roomPort) : '')}
                    onInput={(e) => setPortInput(e.currentTarget.value)}
                    placeholder="例如 8080"
                    min={1}
                    max={65535}
                    class="w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm focus:outline-none focus:border-accent transition-all text-white placeholder-mist-solid/30"
                  />
                </div>
                <IconButton
                  onClick={async () => {
                    const val = Number(portInput());
                    if (!Number.isFinite(val) || val <= 0 || val > 65535) {
                      setLocalError('端口必须在 1-65535 之间。');
                      return;
                    }
                    if (val === props.roomPort) {
                      setLocalError(null);
                      return;
                    }
                    setPortSaving(true);
                    setLocalError(null);
                    try {
                      await props.onUpdateRoomPort?.(val);
                      setPortInput('');
                    } catch (error) {
                      setLocalError(error instanceof Error ? error.message : String(error));
                    } finally {
                      setPortSaving(false);
                    }
                  }}
                  label={portSaving() ? '保存中' : '保存端口'}
                  tone="accent"
                  size="md"
                >
                  <Save size={16} class={portSaving() ? 'animate-pulse' : ''} />
                </IconButton>
              </div>

              <Show when={props.roomIsOpen}>
                <p class="text-[11px] text-amber-300/70">
                  房间正在开启，修改端口会让当前连接的房客断开，需重新以新端口加入。
                </p>
              </Show>
              <Show when={localError()}>
                <p class="text-[11px] text-red-300">{localError()}</p>
              </Show>
            </section>
          </Show>

          <Show when={props.isRoomClient}>
            <section class="border-b border-white/10 pb-6 mb-6 space-y-4">
              <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-200 flex items-center justify-center">
                  <Layers3 size={18} />
                </div>
                <div>
                  <p class="text-sm font-semibold text-white">剧情总结</p>
                  <p class="text-xs text-mist-solid/40">由房主同步</p>
                </div>
              </div>
              <Show
                when={(props.plotSummaries ?? []).length > 0}
                fallback={<div class="text-sm text-mist-solid/45">房主尚未生成剧情总结。</div>}
              >
                <div class="space-y-3">
                  <For each={props.plotSummaries}>
                    {(summary) => (
                      <div class="px-1 py-2 space-y-1 border-l-2 border-white/20">
                        <div class="flex items-center justify-between gap-3">
                          <p class="text-xs uppercase tracking-widest text-mist-solid/35">批次 #{summary.batchIndex}</p>
                          <span class="text-[10px] text-mist-solid/35">{summary.status}</span>
                        </div>
                        <p class="text-sm text-mist-solid/75 whitespace-pre-wrap leading-6">
                          {summary.summaryText || '（空总结）'}
                        </p>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </section>
          </Show>
        </div>

        <div class="mt-auto px-6 pt-4 text-center text-xs text-mist-solid/20">
          Night Voyage Layer Drawer
        </div>
      </div>
    </>
  );
};
