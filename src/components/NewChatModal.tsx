import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { ArrowLeft, ArrowRight, Book, CheckCircle2, Copy, Check, Link as LinkIcon, Loader2, Radio, User, Users, X } from '../lib/icons';
import { CharacterCard, ApiProviderSummary, ConversationType, CreateConversationPayload, WorldBookSummary, resolveImageSrc, roomCreate, roomClose } from '../lib/backend';
import { IconButton } from './ui/IconButton';

interface NewChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  npcCharacters: CharacterCard[];
  worldBooks: WorldBookSummary[];
  providers: ApiProviderSummary[];
  onCreateConversation: (payload: CreateConversationPayload) => Promise<void | number> | void;
  creating?: boolean;
}

export const NewChatModal: Component<NewChatModalProps> = (props) => {
  const [step, setStep] = createSignal(1);
  const [conversationType, setConversationType] = createSignal<ConversationType | null>(null);
  const [title, setTitle] = createSignal('');
  const [hostDisplayName, setHostDisplayName] = createSignal('主持人');
  const [selectedCharacterId, setSelectedCharacterId] = createSignal<number | undefined>();
  const [selectedWorldBookId, setSelectedWorldBookId] = createSignal<number | undefined>();
  const [selectedProviderId, setSelectedProviderId] = createSignal<number | undefined>();

  const [roomPort, setRoomPort] = createSignal('');
  const [roomPassphrase, setRoomPassphrase] = createSignal('');
  const [roomCreating, setRoomCreating] = createSignal(false);
  const [roomResult, setRoomResult] = createSignal<{ roomId: number; hostAddress: string; port: number } | null>(null);
  const [roomError, setRoomError] = createSignal('');
  const [copied, setCopied] = createSignal(false);

  const selectedCharacter = createMemo(() =>
    props.npcCharacters.find((character) => character.id === selectedCharacterId()),
  );

  createEffect(() => {
    if (props.isOpen && !selectedProviderId() && props.providers.length > 0) {
      setSelectedProviderId(props.providers[0].id);
    }
  });

  const reset = () => {
    setStep(1);
    setConversationType(null);
    setTitle('');
    setHostDisplayName('主持人');
    setSelectedCharacterId(undefined);
    setSelectedWorldBookId(undefined);
    setSelectedProviderId(props.providers[0]?.id);
    setRoomPort('');
    setRoomPassphrase('');
    setRoomResult(null);
    setRoomError('');
    setCopied(false);
  };

  const canGoNext = createMemo(() => Boolean(selectedCharacterId()));
  const conversationConfigError = createMemo(() => {
    if (!selectedCharacterId()) return '请先选择角色卡';
    if (!conversationType()) return '请选择会话模式';
    if (!selectedProviderId()) {
      if (props.providers.length === 0) {
        return '请先在设置中创建 API 档案；联机会话需要房主的 API 档案用于自动生成回复。';
      }
      return '请选择 API 档案；联机会话需要房主的 API 档案用于自动生成回复。';
    }
    return '';
  });
  const canSubmit = createMemo(() => conversationConfigError().length === 0);

  const handleSubmit = async () => {
    if (createdConversationId()) {
      reset();
      props.onClose();
      return;
    }
    if (!canSubmit() || !conversationType() || !selectedCharacterId()) return;
    const payload: CreateConversationPayload = {
      conversationType: conversationType()!,
      title: title().trim() || selectedCharacter()?.name || undefined,
      hostCharacterId: selectedCharacterId(),
      worldBookId: selectedWorldBookId(),
      providerId: selectedProviderId(),
      hostDisplayName: hostDisplayName().trim() || '主持人',
      chatMode: 'classic',
      agentProviderPolicy: 'shared_host_provider',
    };
    try {
      const conversationId = await props.onCreateConversation(payload);
      console.debug('[NewChatModal] handleSubmit: conversation created, id=', conversationId);
      if (conversationType() === 'online') {
        if (typeof conversationId === 'number') {
          setCreatedConversationId(conversationId);
        }
      } else {
        reset();
        props.onClose();
      }
    } catch (error) {
      console.error('[NewChatModal] handleSubmit: create conversation failed', error);
      window.alert(`创建会话失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const [createdConversationId, setCreatedConversationId] = createSignal<number | null>(null);

  const handleCreateRoom = async () => {
    let conversationId = createdConversationId();
    if (!conversationId) {
      if (!canSubmit() || !conversationType() || !selectedCharacterId()) {
        setRoomError(conversationConfigError() || '请先完善会话配置');
        return;
      }
      setRoomCreating(true);
      setRoomError('');
      const payload: CreateConversationPayload = {
        conversationType: conversationType()!,
        title: title().trim() || selectedCharacter()?.name || undefined,
        hostCharacterId: selectedCharacterId(),
        worldBookId: selectedWorldBookId(),
        providerId: selectedProviderId(),
        hostDisplayName: hostDisplayName().trim() || '主持人',
        chatMode: 'classic',
        agentProviderPolicy: 'shared_host_provider',
      };
      try {
        const result = await props.onCreateConversation(payload);
        if (typeof result === 'number') {
          conversationId = result;
          setCreatedConversationId(conversationId);
        } else {
          setRoomCreating(false);
          return;
        }
      } catch (error) {
        console.error('[NewChatModal] handleCreateRoom: create conversation failed', error);
        setRoomError(`创建会话失败：${error instanceof Error ? error.message : String(error)}`);
        setRoomCreating(false);
        return;
      }
    }

    const port = Number(roomPort());

    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      setRoomError('请输入有效的端口号（1-65535）');
      setRoomCreating(false);
      return;
    }
    setRoomCreating(true);
    setRoomError('');
    try {
      console.debug('[NewChatModal] handleCreateRoom: creating room on port', port, 'conversationId', conversationId);
      const result = await roomCreate({
        roomName: title().trim() || selectedCharacter()?.name || '未命名房间',
        conversationId,
        port,
        passphrase: roomPassphrase().trim() || undefined,
      });
      console.debug('[NewChatModal] handleCreateRoom: room created', result);
      setRoomResult(result);
    } catch (error) {
      console.error('[NewChatModal] handleCreateRoom: room create failed', error);
      setRoomError(error instanceof Error ? error.message : String(error));
    } finally {
      setRoomCreating(false);
    }
  };

  const handleCloseRoom = async () => {
    try {
      await roomClose();
    } catch { /* ignore */ }
    setRoomResult(null);
  };

  const copyRoomAddress = async () => {
    const r = roomResult();
    if (!r) return;
    const text = `${r.hostAddress}:${r.port}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-[2000] flex flex-col bg-xuanqing/98 backdrop-blur-3xl animate-in fade-in duration-500 overflow-hidden">
        <div class="h-20 flex items-center justify-between px-10 border-b border-white/5">
          <div>
            <h2 class="text-xl font-bold text-white leading-none mb-1">新建会话</h2>
            <p class="text-[10px] text-mist-solid/30 uppercase tracking-[0.2em]">Step {step()} of 2</p>
          </div>
          <IconButton
            onClick={() => {
              reset();
              props.onClose();
            }}
            label="关闭新建会话"
            size="lg"
          >
            <X size={20} />
          </IconButton>
        </div>

        <div class="h-1 w-full bg-white/5">
          <div class="h-full bg-accent transition-all duration-500" style={{ width: `${(step() / 2) * 100}%` }} />
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar p-8 md:p-10">
          <div class="max-w-5xl mx-auto flex flex-col gap-10">
            <Show when={step() === 1}>
              <div class="text-center mb-4">
                <h1 class="text-4xl md:text-5xl font-black text-white mb-4">选择对话角色</h1>
                <p class="text-mist-solid/40">会话是角色卡的实例，因此创建时必须先选择角色卡。</p>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                <For each={props.npcCharacters}>
                  {(character) => (
                    <button
                      onClick={() => {
                        setSelectedCharacterId(character.id);
                        if (!title().trim()) {
                          setTitle(character.name);
                        }
                      }}
                      class={`relative aspect-video rounded-3xl overflow-hidden border-2 text-left transition-all ${selectedCharacterId() === character.id
                        ? 'border-accent shadow-[0_0_30px_rgba(58,109,140,0.3)] scale-[1.02]'
                        : 'border-white/5 hover:border-white/20'}`}
                    >
                      <img
                        src={resolveImageSrc(character.imagePath, `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`)}
                        alt={character.name}
                        class="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"
                      />
                      <div class="absolute inset-0 bg-accent/5" />
                      <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                      <div class="absolute bottom-0 left-0 right-0 p-4">
                        <h3 class="text-xl font-bold text-white mb-2">{character.name}</h3>
                        <div class="flex flex-wrap gap-2">
                          <For each={character.tags.slice(0, 3)}>
                            {(tag) => <span class="text-[9px] px-2 py-0.5 rounded-md bg-accent text-white font-bold">{tag}</span>}
                          </For>
                        </div>
                      </div>
                      <Show when={selectedCharacterId() === character.id}>
                        <div class="absolute top-4 right-4 bg-accent p-2 rounded-full text-white shadow-lg">
                          <CheckCircle2 size={16} />
                        </div>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show when={step() === 2}>
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div class="space-y-4 p-6 rounded-3xl bg-white/5 border border-white/5">
                  <h3 class="text-xl font-bold text-white">角色实例</h3>
                  <Show when={selectedCharacter()}>
                    <div class="relative rounded-2xl overflow-hidden border border-white/10 bg-black/20 min-h-[220px]">
                      <img
                        src={resolveImageSrc(selectedCharacter()?.imagePath, `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(selectedCharacter()?.name || 'character')}`)}
                        alt={selectedCharacter()?.name}
                        class="absolute inset-0 w-full h-full object-cover opacity-45"
                      />
                      <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                      <div class="relative z-10 p-6 flex flex-col justify-end min-h-[220px]">
                        <h4 class="text-2xl font-black text-white mb-2">{selectedCharacter()?.name}</h4>
                        <p class="text-sm text-mist-solid/70 line-clamp-3">{selectedCharacter()?.description || '暂无描述'}</p>
                      </div>
                    </div>
                  </Show>
                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">会话标题</label>
                    <input
                      value={title()}
                      onInput={(e) => setTitle(e.currentTarget.value)}
                      placeholder={selectedCharacter()?.name || '请输入会话标题'}
                      class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40"
                    />
                  </div>
                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">房主显示名</label>
                    <input
                      value={hostDisplayName()}
                      onInput={(e) => setHostDisplayName(e.currentTarget.value)}
                      class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40"
                    />
                  </div>
                </div>

                <div class="space-y-4 p-6 rounded-3xl bg-white/5 border border-white/5">
                  <h3 class="text-xl font-bold text-white">实例配置</h3>
                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">会话模式</label>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div class={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${conversationType() === 'single'
                        ? 'bg-accent/10 border-accent text-white'
                        : 'bg-white/5 border-white/10 text-mist-solid/60 hover:bg-white/10'}`}>
                        <div>
                          <div class="font-bold">单人会话</div>
                          <div class="text-xs text-mist-solid/40 mt-2">私有单聊实例</div>
                        </div>
                        <IconButton
                          onClick={() => setConversationType('single')}
                          label="切换到单人会话"
                          tone={conversationType() === 'single' ? 'accent' : 'neutral'}
                          active={conversationType() === 'single'}
                          size="md"
                        >
                          <User size={16} />
                        </IconButton>
                      </div>
                      <div class={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${conversationType() === 'online'
                        ? 'bg-purple-500/10 border-purple-500 text-white'
                        : 'bg-white/5 border-white/10 text-mist-solid/60 hover:bg-white/10'}`}>
                        <div>
                          <div class="font-bold">联机会话</div>
                          <div class="text-xs text-mist-solid/40 mt-2">本地房间轮次实例</div>
                        </div>
                        <IconButton
                          onClick={() => setConversationType('online')}
                          label="切换到联机会话"
                          tone={conversationType() === 'online' ? 'accent' : 'neutral'}
                          active={conversationType() === 'online'}
                          size="md"
                        >
                          <Users size={16} />
                        </IconButton>
                      </div>
                    </div>
                  </div>

                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">世界书</label>
                    <select
                      value={selectedWorldBookId() ?? ''}
                      onChange={(e) => setSelectedWorldBookId(e.currentTarget.value ? Number(e.currentTarget.value) : undefined)}
                      class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40"
                    >
                      <option value="">不绑定世界书</option>
                      <For each={props.worldBooks}>{(book) => <option value={book.id}>{book.title}</option>}</For>
                    </select>
                  </div>

                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">API 档案</label>
                    <select
                      value={selectedProviderId() ?? ''}
                      onChange={(e) => setSelectedProviderId(e.currentTarget.value ? Number(e.currentTarget.value) : undefined)}
                      class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40"
                    >
                      <option value="">请选择 API 档案</option>
                      <For each={props.providers}>{(provider) => <option value={provider.id}>{provider.name} · {provider.modelName}</option>}</For>
                    </select>
                    <Show when={conversationType() === 'online' && !selectedProviderId()}>
                      <p class="text-[11px] leading-relaxed text-mist-solid/40">
                        联机会话会由房主端聚合成员发言并请求模型回复，因此需要先选择 API 档案。
                      </p>
                    </Show>
                  </div>

                  <div class="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-mist-solid/35 flex items-start gap-3">
                    <Book size={16} class="shrink-0 mt-0.5" />
                    <div>预设系统本轮尚未接后端，本入口当前仅保留结构位，不参与真实创建流程。</div>
                  </div>
                  <Show when={conversationType() === 'online'}>
                    <div class="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5 space-y-4">
                      <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400">
                          <Radio size={16} />
                        </div>
                        <div>
                          <h4 class="text-sm font-bold text-white">房间配置</h4>
                          <p class="text-[11px] text-mist-solid/40">创建联机会话后，可在此开启房间等待其他玩家加入。</p>
                        </div>
                      </div>

                      <Show
                        when={!roomResult()}
                        fallback={
                          <div class="space-y-4">
                            <div class="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3">
                              <div class="text-sm text-mist-solid/80">
                                {roomResult()?.hostAddress}:{roomResult()?.port}
                              </div>
                              <button
                                onClick={copyRoomAddress}
                                class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-mist-solid/70 hover:bg-white/10 transition-colors"
                              >
                                {copied() ? <Check size={12} /> : <Copy size={12} />}
                                {copied() ? '已复制' : '复制地址'}
                              </button>
                            </div>
                            <div class="flex items-center justify-between gap-3">
                              <p class="text-xs text-mist-solid/40">房间已开启，其他玩家可使用上方地址加入。</p>
                              <button
                                onClick={() => void handleCloseRoom()}
                                class="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/15 transition-colors text-xs font-medium"
                              >
                                关闭房间
                              </button>
                            </div>
                          </div>
                        }
                      >
                        <div class="space-y-3">
                          <div class="space-y-2">
                            <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">端口</label>
                            <input
                              type="number"
                              value={roomPort()}
                              onInput={(e) => setRoomPort(e.currentTarget.value)}
                              placeholder="例如 8080"
                              class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid placeholder-mist-solid/25"
                            />
                          </div>
                          <div class="space-y-2">
                            <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">房间密码（可选）</label>
                            <input
                              type="text"
                              value={roomPassphrase()}
                              onInput={(e) => setRoomPassphrase(e.currentTarget.value)}
                              placeholder="留空表示无密码"
                              class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid placeholder-mist-solid/25"
                            />
                          </div>
                          <Show when={roomError()}>
                            <div class="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2 text-xs text-red-200">
                              {roomError()}
                            </div>
                          </Show>
                          <div class="flex items-center justify-end gap-3">
                            <button
                              onClick={() => void handleCreateRoom()}
                              disabled={roomCreating()}
                              class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-purple-500/20 border border-purple-500/30 text-purple-200 text-sm font-medium hover:bg-purple-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {roomCreating() ? <Loader2 size={14} class="animate-spin" /> : <Radio size={14} />}
                              {roomCreating() ? '创建中...' : '创建房间'}
                            </button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <div class="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-mist-solid/35 flex items-start gap-3">
                    <Book size={16} class="shrink-0 mt-0.5" />
                    <div>预设系统本轮尚未接后端，本入口当前仅保留结构位，不参与真实创建流程。</div>
                  </div>
                  <div class="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-mist-solid/35 flex items-start gap-3">
                    <LinkIcon size={16} class="shrink-0 mt-0.5" />
                    <div>联机会话发送时，房间成员全部发言或放弃后，后端会自动聚合成一轮请求。</div>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </div>

        <div class="px-8 pb-8 pt-4 border-t border-white/5 flex justify-between items-center gap-6">
          <div>
            <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">步骤操作</div>
            <div class="text-sm text-mist-solid/40 mt-1">
              {step() === 1 ? '先选择角色，再进入实例配置。' : createdConversationId() ? '会话实例已创建，您可在此配置房间或直接进入会话。' : '确认配置后创建会话实例。'}
            </div>
          </div>

          <div class="flex items-center gap-3">
            <IconButton
              onClick={() => (step() === 1 ? props.onClose() : setStep(1))}
              label={step() === 1 ? '暂不创建' : '返回上一步'}
              size="lg"
            >
              <ArrowLeft size={18} />
            </IconButton>

            <IconButton
              onClick={() => {
                if (step() === 1) {
                  if (canGoNext()) {
                    console.debug('[NewChatModal] step transition: 1 -> 2');
                    setStep(2);
                  }
                  return;
                }
                void handleSubmit();
              }}
              disabled={step() === 1 ? !canGoNext() : !canSubmit() || props.creating}
              label={step() === 2 ? (props.creating ? '正在处理' : createdConversationId() ? '进入会话' : '启动航次') : '下一步'}
              tone="accent"
              size="lg"
            >
              {step() === 2 && createdConversationId() ? <Check size={18} /> : <ArrowRight size={18} class={step() === 2 && props.creating ? 'animate-pulse' : ''} />}
            </IconButton>
          </div>
        </div>
      </div>
    </Show>
  );
};
