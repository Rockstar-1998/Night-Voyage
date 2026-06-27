import { Component, For, Show, createMemo, createSignal, onMount } from 'solid-js';
import { Select } from './ui/Select';
import { AlertTriangle, ChevronLeft, ChevronRight, Layers3, Save, Sparkles, UserRound } from '../lib/icons';
import { animate } from '../lib/animate';
import type { ApiProviderSummary, CharacterCard, PresetSummary, WorldBookSummary } from '../lib/backend';
import { toAssetUrl } from '../lib/backend';
import { IconButton } from './ui/IconButton';

interface RightDrawerProps {
  selectedConversationId?: number | null;
  selectedCharacter?: CharacterCard | null;
  selectedPresetId?: number | null;
  selectedWorldBookId?: number | null;
  presetSummaries: PresetSummary[];
  worldBooks: WorldBookSummary[];
  onSaveConversationBindings: (payload: { presetId?: number; worldBookId?: number; providerId?: number }) => Promise<void> | void;
  overlaySummary?: string | null;
  overlayStatus?: 'queued' | 'completed' | 'failed' | null;
  overlayError?: string | null;
  memoryMode: 'stateless' | 'mem0' | string;
  mem0Available?: boolean;
  onUpdateMemoryMode: (mode: 'stateless' | 'mem0') => Promise<void> | void;
  playerCharacters: CharacterCard[];
  currentPlayerCharacter?: CharacterCard;
  onSwitchPlayerCharacter: (playerCharacterId: number) => Promise<void> | void;
  providers: ApiProviderSummary[];
  selectedProviderId?: number | null;
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
  const [modeUpdating, setModeUpdating] = createSignal(false);
  const [localError, setLocalError] = createSignal<string | null>(null);
  const [bindingPresetId, setBindingPresetId] = createSignal<string>('');
  const [bindingWorldBookId, setBindingWorldBookId] = createSignal<string>('');
  const [bindingSaving, setBindingSaving] = createSignal(false);
  const [switchingPlayerCharacter, setSwitchingPlayerCharacter] = createSignal(false);
  const [bindingProviderId, setBindingProviderId] = createSignal('');
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
  const selectedProviderLabel = createMemo(() => {
    const providerId = props.selectedProviderId;
    if (providerId == null) return '当前会话未绑定 API 档案。';
    const provider = props.providers.find((item) => item.id === providerId);
    return provider ? `当前会话已绑定 API 档案：${provider.name}` : `当前会话已绑定 API 档案 #${providerId}`;
  });

  const handleModeChange = async (mode: 'stateless' | 'mem0') => {
    if (modeUpdating() || props.memoryMode === mode) return;
    setModeUpdating(true);
    setLocalError(null);
    try {
      await props.onUpdateMemoryMode(mode);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setModeUpdating(false);
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

    if (nextPresetId == null && nextWorldBookId == null && nextProviderId == null) {
      setLocalError('请至少选择一个预设或世界书后再保存。');
      return;
    }

    setBindingSaving(true);
    setLocalError(null);
    try {
      await props.onSaveConversationBindings({
        presetId: nextPresetId,
        worldBookId: nextWorldBookId,
        providerId: nextProviderId,
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
  <label class="text-xs uppercase tracking-widest text-mist-solid/35">API 档案绑定</label>
  <Select
    value={bindingProviderId()}
    onChange={(val) => setBindingProviderId(val)}
    options={[
      { label: "保持当前 API 档案", value: "" },
      ...(props.providers).map(provider => ({ label: provider.name, value: (provider.id)?.toString() }))
    ]}
  />
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

          <section class="border-b border-white/10 pb-6 mb-6 space-y-5">
            <div>
              <p class="text-sm font-semibold text-white">记忆模式</p>
              <p class="text-xs text-mist-solid/40 mt-1">
                无状态：纯多轮对话，无记忆。Mem0：AI 自动提取与检索长期记忆，不保留原文窗口。
              </p>
            </div>
            <Show when={!props.mem0Available}>
              <div class="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-50 leading-6">
                记忆后端未就绪：请先配置 API 档案后重启。
              </div>
            </Show>
            <div class="flex gap-2">
              <button
                disabled={modeUpdating() || !props.mem0Available}
                onClick={() => void handleModeChange('stateless')}
                class={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${props.memoryMode === 'stateless' ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 bg-black/10 text-mist-solid/60 hover:text-mist-solid/90'}`}
              >
                无状态
              </button>
              <button
                disabled={modeUpdating() || !props.mem0Available}
                onClick={() => void handleModeChange('mem0')}
                class={`flex-1 rounded-xl border px-4 py-3 text-sm font-medium transition-all ${props.memoryMode === 'mem0' ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 bg-black/10 text-mist-solid/60 hover:text-mist-solid/90'}`}
              >
                Mem0 记忆
              </button>
            </div>
          </section>
        </div>

        <div class="mt-auto px-6 pt-4 text-center text-xs text-mist-solid/20">
          Night Voyage Layer Drawer
        </div>
      </div>
    </>
  );
};
