import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { CheckCircle2, ChevronDown, User, Users, AlertTriangle, MessageSquare, Brain } from 'lucide-solid';
import { CharacterCard, ApiProviderSummary, ConversationType, CreateConversationPayload, WorldBookSummary, resolveImageSrc, PresetSummary, ChatMode, updatePresetGateSelection } from '../../src/lib/backend';
import { showToast } from './Toast';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  npcCharacters: CharacterCard[];
  playerCharacters: CharacterCard[];
  worldBooks: WorldBookSummary[];
  providers: ApiProviderSummary[];
  presetSummaries: PresetSummary[];
  onCreateConversation: (payload: CreateConversationPayload) => Promise<void | number> | void;
  creating?: boolean;
}

export const NewChatModal: Component<NewChatModalProps> = (props) => {
  const [conversationType, setConversationType] = createSignal<ConversationType>('single');
  const [title, setTitle] = createSignal('');
  const [selectedPlayerCharacterId, setSelectedPlayerCharacterId] = createSignal<number | undefined>();
  const [selectedCharacterId, setSelectedCharacterId] = createSignal<number | undefined>();
  const [selectedWorldBookId, setSelectedWorldBookId] = createSignal<number | undefined>();
  const [selectedProviderId, setSelectedProviderId] = createSignal<number | undefined>();
  const [selectedPresetId, setSelectedPresetId] = createSignal<number | undefined>();
  const [selectedOpeningIndex, setSelectedOpeningIndex] = createSignal<number>(0);

  // 运行模式分类架构：传统对话（stateless / legacy）与 Agent 智能体（director_actor / scriptwriter）
  const [dialogueCategory, setDialogueCategory] = createSignal<'classic' | 'agent'>('classic');
  const [classicSubMode, setClassicSubMode] = createSignal<'stateless' | 'legacy'>('stateless');
  const [agentSubMode, setAgentSubMode] = createSignal<'director_actor' | 'scriptwriter'>('director_actor');
  // MEM0 长期记忆系统：作为独立二元开关（开启 vs 关闭）
  const [mem0Enabled, setMem0Enabled] = createSignal<boolean>(false);

  const selectedCharacter = createMemo(() =>
    props.npcCharacters.find((character) => character.id === selectedCharacterId()),
  );

  createEffect(() => {
    if (props.isOpen && !selectedProviderId() && props.providers.length > 0) {
      setSelectedProviderId(props.providers[0].id);
    }
  });

  const handleCategoryChange = (category: 'classic' | 'agent') => {
    setDialogueCategory(category);
    if (category === 'agent') {
      if (!selectedPresetId()) {
        const v2Preset = props.presetSummaries.find(
          (p) => p.name.includes('2.2') || p.name.includes('Agent') || p.name.includes('全能'),
        );
        if (v2Preset) {
          setSelectedPresetId(v2Preset.id);
        }
      }
    }
  };

  const reset = () => {
    setConversationType('single');
    setTitle('');
    setSelectedPlayerCharacterId(undefined);
    setSelectedCharacterId(undefined);
    setSelectedWorldBookId(undefined);
    setSelectedProviderId(props.providers[0]?.id);
    setSelectedPresetId(undefined);
    setSelectedOpeningIndex(0);
    setDialogueCategory('classic');
    setClassicSubMode('stateless');
    setAgentSubMode('director_actor');
    setMem0Enabled(false);
  };

  const conversationConfigError = createMemo(() => {
    if (!selectedCharacterId()) return '请先选择角色卡';
    if (!selectedPlayerCharacterId()) return '请先选择玩家角色';
    if (!conversationType()) return '请选择会话模式';
    if (!selectedProviderId()) {
      if (props.providers.length === 0) {
        return '请先在设置中创建 API 档案';
      }
      return '请选择 API 档案';
    }
    return '';
  });

  const canSubmit = createMemo(() => conversationConfigError().length === 0);

  const handleSubmit = async () => {
    if (!canSubmit() || !conversationType() || !selectedCharacterId() || !selectedPlayerCharacterId()) return;

    const isAgent = dialogueCategory() === 'agent';
    const effectiveChatMode: ChatMode = isAgent ? 'director_agents' : 'classic';
    const effectiveMemoryMode: 'stateless' | 'legacy' | 'mem0' = mem0Enabled()
      ? 'mem0'
      : (isAgent ? 'stateless' : classicSubMode());

    const payload: CreateConversationPayload = {
      conversationType: conversationType()!,
      title: title().trim() || selectedCharacter()?.name || undefined,
      hostCharacterId: selectedCharacterId(),
      worldBookId: selectedWorldBookId(),
      providerId: selectedProviderId(),
      presetId: selectedPresetId(),
      hostPlayerCharacterId: selectedPlayerCharacterId()!,
      chatMode: effectiveChatMode,
      agentProviderPolicy: 'shared_host_provider',
      openingMessageIndex: selectedOpeningIndex() >= 0 ? selectedOpeningIndex() : undefined,
      memoryMode: effectiveMemoryMode,
    };
    try {
      await props.onCreateConversation(payload);

      if (isAgent && selectedPresetId()) {
        const gateKey = agentSubMode() === 'scriptwriter' ? 'pipeline_agent' : 'dual_agent_drafter_critic';
        try {
          await updatePresetGateSelection(selectedPresetId()!, 'n_agent_gate', [gateKey]);
        } catch (gateErr) {
          console.warn('[Mobile NewChatModal] Failed to sync n_agent_gate selection', gateErr);
        }
      }

      reset();
      props.onClose();
    } catch (error) {
      console.error('[NewChatModal] handleSubmit: create conversation failed', error);
      showToast(`创建会话失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  return (
    <div class={`fixed inset-0 z-[2000] flex flex-col justify-end transition-all duration-300 ease-out ${props.isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      {/* Backdrop */}
      <div 
        class={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${props.isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={() => {
          reset();
          props.onClose();
        }}
      />

      {/* Drawer */}
      <div class={`relative w-full bg-xuanqing rounded-t-3xl max-h-[92vh] flex flex-col transition-transform duration-300 ease-out safe-area-bottom ${props.isOpen ? 'translate-y-0' : 'translate-y-full'}`}>
        
        {/* Handle */}
        <div class="w-full flex justify-center pt-4 pb-2 shrink-0">
          <div class="w-12 h-1.5 bg-white/20 rounded-full" />
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pb-32 pt-2 flex flex-col gap-8 relative z-0">
          
          <h2 class="text-2xl font-black text-white leading-tight">新建会话</h2>
          
          {/* NPC Character Selection */}
          <div class="flex flex-col gap-3">
            <div>
              <h3 class="text-sm font-bold text-mist-solid/60">选择主要角色</h3>
            </div>
            
            <div class="flex overflow-x-auto custom-scrollbar pb-4 -mx-6 px-6 gap-4 snap-x">
              <For each={props.npcCharacters}>
                {(character) => (
                  <button
                    onClick={() => {
                      setSelectedCharacterId(character.id);
                      if (!title().trim()) {
                        setTitle(character.name);
                      }
                    }}
                    class={`relative shrink-0 w-[4.5rem] flex flex-col items-center gap-2 transition-all snap-start ${selectedCharacterId() === character.id ? 'opacity-100 scale-105' : 'opacity-60 hover:opacity-100'}`}
                  >
                    <div class={`w-16 h-16 rounded-full overflow-hidden border-2 transition-colors relative shadow-lg ${selectedCharacterId() === character.id ? 'border-accent' : 'border-transparent'}`}>
                      <img
                        src={resolveImageSrc(character.imagePath, `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`)}
                        alt={character.name}
                        class="w-full h-full object-cover"
                      />
                      <Show when={selectedCharacterId() === character.id}>
                        <div class="absolute inset-0 bg-accent/20 flex items-center justify-center backdrop-blur-[1px]">
                          <CheckCircle2 size={24} class="text-white drop-shadow-md" />
                        </div>
                      </Show>
                    </div>
                    <span class={`text-[11px] font-bold truncate w-full text-center ${selectedCharacterId() === character.id ? 'text-accent' : 'text-mist-solid'}`}>
                      {character.name}
                    </span>
                  </button>
                )}
              </For>
              {/* Fake Add Button for mockup matching */}
              <button class="relative shrink-0 w-[4.5rem] flex flex-col items-center gap-2 transition-all snap-start opacity-60 hover:opacity-100">
                <div class="w-16 h-16 rounded-full overflow-hidden border border-dashed border-mist-solid/40 flex items-center justify-center text-mist-solid/60 hover:bg-white/5 transition-colors">
                  <span class="text-2xl font-light">+</span>
                </div>
                <span class="text-[11px] font-bold truncate w-full text-center text-mist-solid">新建</span>
              </button>
            </div>
          </div>

          {/* Player Character Selection */}
          <div class="flex flex-col gap-3">
            <div>
              <h3 class="text-sm font-bold text-mist-solid/60">选择玩家角色</h3>
            </div>
            
            <div class="flex overflow-x-auto custom-scrollbar pb-4 -mx-6 px-6 gap-4 snap-x">
              <For each={props.playerCharacters}>
                {(character) => (
                  <button
                    onClick={() => setSelectedPlayerCharacterId(character.id)}
                    class={`relative shrink-0 w-[4.5rem] flex flex-col items-center gap-2 transition-all snap-start ${selectedPlayerCharacterId() === character.id ? 'opacity-100 scale-105' : 'opacity-60 hover:opacity-100'}`}
                  >
                    <div class={`w-16 h-16 rounded-full overflow-hidden border-2 transition-colors relative shadow-lg ${selectedPlayerCharacterId() === character.id ? 'border-purple-400' : 'border-transparent'}`}>
                      <img
                        src={resolveImageSrc(character.imagePath, `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`)}
                        alt={character.name}
                        class="w-full h-full object-cover"
                      />
                      <Show when={selectedPlayerCharacterId() === character.id}>
                        <div class="absolute inset-0 bg-purple-500/20 flex items-center justify-center backdrop-blur-[1px]">
                          <CheckCircle2 size={24} class="text-white drop-shadow-md" />
                        </div>
                      </Show>
                    </div>
                    <span class={`text-[11px] font-bold truncate w-full text-center ${selectedPlayerCharacterId() === character.id ? 'text-purple-400' : 'text-mist-solid'}`}>
                      {character.name}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </div>

          {/* Bindings & Settings */}
          <div class="flex flex-col gap-1">
            <h3 class="text-sm font-bold text-mist-solid/60 mb-2">会话设置</h3>
            <div class="bg-white/5 border border-white/5 rounded-2xl overflow-hidden flex flex-col">
              
              <div class="flex items-center justify-between p-4 border-b border-white/5 relative">
                <label class="text-[13px] text-mist-solid font-medium">API 供应商</label>
                <div class="relative w-1/2">
                  <select
                    class="w-full appearance-none bg-transparent text-right text-accent font-medium text-[13px] focus:outline-none pr-5 truncate"
                    value={selectedProviderId()?.toString() ?? ''}
                    onChange={(e) => setSelectedProviderId(e.currentTarget.value ? Number(e.currentTarget.value) : undefined)}
                  >
                    <option value="" class="bg-xuanqing text-white">未选择</option>
                    <For each={props.providers}>
                      {(p) => <option value={p.id.toString()} class="bg-xuanqing text-white">{p.name}</option>}
                    </For>
                  </select>
                  <ChevronDown size={14} class="absolute right-0 top-1/2 -translate-y-1/2 text-accent/60 pointer-events-none" />
                </div>
              </div>

              <div class="flex items-center justify-between p-4 border-b border-white/5 relative">
                <label class="text-[13px] text-mist-solid font-medium">预设配置</label>
                <div class="relative w-1/2">
                  <select
                    class="w-full appearance-none bg-transparent text-right text-mist-solid/60 text-[13px] focus:outline-none pr-5 truncate"
                    value={selectedPresetId()?.toString() ?? ''}
                    onChange={(e) => setSelectedPresetId(e.currentTarget.value ? Number(e.currentTarget.value) : undefined)}
                  >
                    <option value="" class="bg-xuanqing text-white">不绑定预设</option>
                    <For each={props.presetSummaries}>
                      {(p) => <option value={p.id.toString()} class="bg-xuanqing text-white">{p.name}</option>}
                    </For>
                  </select>
                  <ChevronDown size={14} class="absolute right-0 top-1/2 -translate-y-1/2 text-mist-solid/40 pointer-events-none" />
                </div>
              </div>

              <div class="flex items-center justify-between p-4 relative">
                <label class="text-[13px] text-mist-solid font-medium">世界书绑定</label>
                <div class="relative w-1/2">
                  <select
                    class="w-full appearance-none bg-transparent text-right text-mist-solid/60 text-[13px] focus:outline-none pr-5 truncate"
                    value={selectedWorldBookId()?.toString() ?? ''}
                    onChange={(e) => setSelectedWorldBookId(e.currentTarget.value ? Number(e.currentTarget.value) : undefined)}
                  >
                    <option value="" class="bg-xuanqing text-white">不绑定世界书</option>
                    <For each={props.worldBooks}>
                      {(b) => <option value={b.id.toString()} class="bg-xuanqing text-white">{b.title}</option>}
                    </For>
                  </select>
                  <ChevronDown size={14} class="absolute right-0 top-1/2 -translate-y-1/2 text-mist-solid/40 pointer-events-none" />
                </div>
              </div>
            </div>
            
            {/* Title override in settings section */}
            <div class="bg-white/5 border border-white/5 rounded-2xl overflow-hidden flex flex-col mt-3">
              <div class="flex items-center justify-between p-4 relative">
                <label class="text-[13px] text-mist-solid font-medium shrink-0">会话标题</label>
                <input
                  value={title()}
                  onInput={(e) => setTitle(e.currentTarget.value)}
                  placeholder={selectedCharacter()?.name || '请输入会话标题'}
                  class="w-full text-right bg-transparent border-none text-[13px] text-mist-solid/80 focus:outline-none placeholder-mist-solid/30"
                />
              </div>
              <Show when={(selectedCharacter()?.firstMessages?.length ?? 0) > 0}>
                <div class="flex flex-col p-4 border-t border-white/5 gap-3">
                  <label class="text-[13px] text-mist-solid font-medium flex justify-between items-center">
                    <span>开场消息</span>
                    <span class="text-[11px] text-accent font-bold bg-accent/10 px-2 py-0.5 rounded-md">
                      {selectedOpeningIndex() === -1 ? '无' : `#${selectedOpeningIndex() + 1}`}
                    </span>
                  </label>
                  <div class="flex overflow-x-auto custom-scrollbar pb-2 gap-3 snap-x -mx-1 px-1">
                    <For each={selectedCharacter()?.firstMessages ?? []}>
                      {(msg, idx) => (
                        <button
                          onClick={() => setSelectedOpeningIndex(idx())}
                          class={`shrink-0 w-[200px] text-left p-3 rounded-xl border transition-all snap-start flex flex-col gap-2 ${
                            selectedOpeningIndex() === idx()
                              ? 'bg-accent/10 border-accent/40 shadow-lg'
                              : 'bg-black/20 border-white/10 hover:border-white/20'
                          }`}
                        >
                          <p class={`text-xs line-clamp-2 leading-relaxed ${selectedOpeningIndex() === idx() ? 'text-white' : 'text-mist-solid/60'}`}>{msg}</p>
                        </button>
                      )}
                    </For>
                    <button
                      onClick={() => setSelectedOpeningIndex(-1)}
                      class={`shrink-0 w-[100px] text-center p-3 rounded-xl border transition-all snap-start flex items-center justify-center ${
                        selectedOpeningIndex() === -1
                          ? 'bg-accent/10 border-accent/40 text-accent font-bold'
                          : 'bg-black/20 border-white/10 hover:border-white/20 text-mist-solid/40'
                      }`}
                    >
                      <span class="text-xs">不发送</span>
                    </button>
                  </div>
                </div>
              </Show>
            </div>
          </div>

          {/* 对话与运行模式 */}
          <div class="flex flex-col gap-2.5">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-mist-solid/60">对话与运行模式</h3>
              <span class="text-[11px] text-mist-solid/40">核心驱动引擎</span>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleCategoryChange('classic')}
                class={`p-3.5 rounded-2xl border flex flex-col items-start gap-1.5 transition-all text-left ${
                  dialogueCategory() === 'classic'
                    ? 'bg-accent/10 border-accent/40 shadow-[0_0_15px_rgba(58,109,140,0.2)]'
                    : 'bg-white/5 border-white/5 hover:bg-white/10'
                }`}
              >
                <div class="flex items-center gap-2">
                  <MessageSquare size={18} class={dialogueCategory() === 'classic' ? 'text-accent' : 'text-mist-solid/40'} />
                  <span class={`text-[13px] font-bold ${dialogueCategory() === 'classic' ? 'text-white' : 'text-mist-solid/70'}`}>传统对话</span>
                </div>
                <span class="text-[10px] text-mist-solid/40 leading-snug">单模型直接交互，轻量或滑动总结</span>
              </button>

              <button
                type="button"
                onClick={() => handleCategoryChange('agent')}
                class={`p-3.5 rounded-2xl border flex flex-col items-start gap-1.5 transition-all text-left ${
                  dialogueCategory() === 'agent'
                    ? 'bg-purple-500/10 border-purple-500/40 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                    : 'bg-white/5 border-white/5 hover:bg-white/10'
                }`}
              >
                <div class="flex items-center gap-2">
                  <Brain size={18} class={dialogueCategory() === 'agent' ? 'text-purple-400' : 'text-mist-solid/40'} />
                  <span class={`text-[13px] font-bold ${dialogueCategory() === 'agent' ? 'text-purple-300' : 'text-mist-solid/70'}`}>Agent 智能体</span>
                </div>
                <span class="text-[10px] text-mist-solid/40 leading-snug">多智能体分工、视界演出与规则引擎</span>
              </button>
            </div>

            {/* 子模式选择卡片 */}
            <div class="bg-white/5 border border-white/5 rounded-2xl p-3 flex flex-col gap-2">
              <span class="text-[11px] font-bold text-mist-solid/40 uppercase tracking-wider">
                {dialogueCategory() === 'classic' ? '传统对话子模式' : 'Agent 协作架构'}
              </span>

              <Show when={dialogueCategory() === 'classic'}>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setClassicSubMode('stateless')}
                    class={`p-2.5 rounded-xl border text-left transition-all ${
                      classicSubMode() === 'stateless'
                        ? 'border-accent/40 bg-accent/15 text-white'
                        : 'border-white/5 bg-black/20 text-mist-solid/60'
                    }`}
                  >
                    <div class="text-xs font-bold">无状态</div>
                    <div class="text-[10px] text-mist-solid/40 mt-0.5">纯多轮对话</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setClassicSubMode('legacy')}
                    class={`p-2.5 rounded-xl border text-left transition-all ${
                      classicSubMode() === 'legacy'
                        ? 'border-accent/40 bg-accent/15 text-white'
                        : 'border-white/5 bg-black/20 text-mist-solid/60'
                    }`}
                  >
                    <div class="text-xs font-bold">传统</div>
                    <div class="text-[10px] text-mist-solid/40 mt-0.5">剧情总结+变量</div>
                  </button>
                </div>
              </Show>

              <Show when={dialogueCategory() === 'agent'}>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAgentSubMode('director_actor')}
                    class={`p-2.5 rounded-xl border text-left transition-all ${
                      agentSubMode() === 'director_actor'
                        ? 'border-purple-500/40 bg-purple-500/15 text-white'
                        : 'border-white/5 bg-black/20 text-mist-solid/60'
                    }`}
                  >
                    <div class="text-xs font-bold">导演-演员</div>
                    <div class="text-[10px] text-mist-solid/40 mt-0.5">演员局部+导演质检</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAgentSubMode('scriptwriter')}
                    class={`p-2.5 rounded-xl border text-left transition-all ${
                      agentSubMode() === 'scriptwriter'
                        ? 'border-purple-500/40 bg-purple-500/15 text-white'
                        : 'border-white/5 bg-black/20 text-mist-solid/60'
                    }`}
                  >
                    <div class="text-xs font-bold">剧本流水线</div>
                    <div class="text-[10px] text-mist-solid/40 mt-0.5">初稿+质检+润色接力</div>
                  </button>
                </div>
              </Show>
            </div>
          </div>

          {/* MEM0 长期记忆 */}
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <h3 class="text-sm font-bold text-mist-solid/60">MEM0 长期记忆</h3>
              <span class="text-[11px] text-mist-solid/40">跨轮次向量库增强</span>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMem0Enabled(false)}
                class={`p-3 rounded-2xl border text-left transition-all ${
                  !mem0Enabled()
                    ? 'border-white/20 bg-white/10 text-white'
                    : 'border-white/5 bg-white/5 text-mist-solid/50'
                }`}
              >
                <div class="text-xs font-bold">关闭</div>
                <div class="text-[10px] text-mist-solid/40 mt-0.5">不启用向量提取</div>
              </button>
              <button
                type="button"
                onClick={() => setMem0Enabled(true)}
                class={`p-3 rounded-2xl border text-left transition-all ${
                  mem0Enabled()
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-white/5 bg-white/5 text-mist-solid/50'
                }`}
              >
                <div class="text-xs font-bold flex items-center justify-between">
                  <span>MEM0</span>
                  <Show when={mem0Enabled()}><span class="text-[9px] bg-emerald-500/20 text-emerald-300 px-1 py-0.5 rounded">开启</span></Show>
                </div>
                <div class="text-[10px] text-mist-solid/40 mt-0.5">AI 记忆自动提取检索</div>
              </button>
            </div>
          </div>

          {/* Mode Selection */}
          <div class="flex flex-col gap-2">
            <h3 class="text-sm font-bold text-mist-solid/60 mb-1">模式</h3>
            <div class="grid grid-cols-2 gap-3">
              <button
                onClick={() => setConversationType('single')}
                class={`p-4 rounded-2xl border flex flex-col items-center justify-center gap-2 transition-all ${
                  conversationType() === 'single'
                    ? 'bg-accent/10 border-accent/40 shadow-[0_0_15px_rgba(58,109,140,0.2)]'
                    : 'bg-white/5 border-white/5 hover:bg-white/10'
                }`}
              >
                <User size={24} class={conversationType() === 'single' ? 'text-accent' : 'text-mist-solid/40'} />
                <span class={`text-[13px] font-medium ${conversationType() === 'single' ? 'text-accent' : 'text-mist-solid/60'}`}>单人跑团</span>
              </button>
              
              <button
                onClick={() => setConversationType('online')}
                class={`p-4 rounded-2xl border flex flex-col items-center justify-center gap-2 transition-all ${
                  conversationType() === 'online'
                    ? 'bg-purple-500/10 border-purple-500/40 shadow-[0_0_15px_rgba(168,85,247,0.2)]'
                    : 'bg-white/5 border-white/5 hover:bg-white/10'
                }`}
              >
                <Users size={24} class={conversationType() === 'online' ? 'text-purple-400' : 'text-mist-solid/40'} />
                <span class={`text-[13px] font-medium ${conversationType() === 'online' ? 'text-purple-400' : 'text-mist-solid/60'}`}>多人联机</span>
              </button>
            </div>
          </div>

        </div>

        {/* Fixed Bottom Bar inside Drawer */}
        <div class="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-xuanqing via-xuanqing/95 to-transparent z-20 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <Show when={!canSubmit()}>
            <div class="mb-4 py-2 px-3 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-2 animate-in fade-in slide-in-from-bottom-2">
              <AlertTriangle size={14} class="text-red-400" />
              <span class="text-xs text-red-200">{conversationConfigError()}</span>
            </div>
          </Show>
          <button
            disabled={!canSubmit() || props.creating}
            onClick={() => void handleSubmit()}
            class="w-full py-4 rounded-2xl bg-accent text-white font-bold text-[15px] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_4px_20px_rgba(58,109,140,0.4)] active:scale-[0.98] transition-all"
          >
            {props.creating ? '启动中...' : '启航'}
          </button>
        </div>
      </div>
    </div>
  );
};
