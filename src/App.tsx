import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import { Maximize2, Minimize2 } from './lib/icons';
import { TitleBar } from './components/TitleBar';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { SessionSidebar } from './components/SessionSidebar';
import { CharacterSidebar } from './components/CharacterSidebar';
import { WorldBookSidebar } from './components/WorldBookSidebar';
import { ChatArea } from './components/ChatArea';
import { ChatInputBar } from './components/ChatInputBar';
import { RightDrawer } from './components/RightDrawer';
import { ChatMessage } from './components/MessageItem';
import { SettingsSidebar } from './components/SettingsSidebar';
import { SettingsArea } from './components/SettingsArea';
import { useMobile } from './hooks/useMobile';
import { BackdoorTestPanel } from './components/BackdoorTestPanel';
import { AuroraBackground } from './components/AuroraBackground';
import { CompletionPresetArea } from './components/CompletionPresetArea';
import { MobileView } from './components/MobileView';
import { NewChatModal } from './components/NewChatModal';
import { JoinRoomModal } from './components/JoinRoomModal';
import { setMessageFormatConfig, messagesUpdateContent, messagesSwitchSwipe, conversationsFork } from './lib/backend';
import { DEFAULT_FORMAT_CONFIG, type MessageFormatConfig } from './lib/messageFormatter';
import {
  type ApiProviderSummary,
  type CharacterBaseSectionInput,
  type CharacterCard,
  type ConversationListItem,
  type ConversationMember,
  type PlotSummaryRecord,
  type PresetSummary,
  type RemoteModel,
  type RoundState,
  type UiMessage,
  characterCardsCreate,
  characterCardsDelete,
  characterCardsList,
  characterCardsUpdate,
  chatRegenerateRound,
  chatSubmitInput,
  conversationMembersList,
  conversationsCreate,
  conversationsDelete,
  conversationsList,
  conversationsUpdateBindings,
  listenCharacterStateOverlayError,
  listenCharacterStateOverlayUpdated,
  listenLlmStreamEvent,
  listenPlotSummaryError,
  listenPlotSummaryPending,
  listenPlotSummaryUpdated,
  listenRoundState,
  listenStreamError,
  messagesList,
  plotSummariesList,
  plotSummariesUpdateMode,
  plotSummariesUpsertManual,
  presetsList,
  providersCreate,
  providersDelete,
  providersFetchModels,
  providersList,
  providersTestClaudeNative,
  providersUpdate,
  regenerateMessage,
  roundStateGet,
  sendMessage,
  settingsGetAll,
  settingsSet,
  worldBookEntriesDelete,
  worldBookEntriesList,
  worldBookEntriesUpsert,
  worldBooksCreate,
  worldBooksDelete,
  worldBooksList,
  worldBooksUpdate,
  type WorldBookEntryRecord,
  type WorldBookSummary,
  toAssetUrl,
  roomSendMessage,
  listenRoomStreamChunk,
  listenRoomStreamEnd,
  listenRoomRoundStateUpdate,
  listenRoomError,
  listenRoomDisconnected,
  listenRoomMemberJoined,
  listenRoomMemberLeft,
  listenRoomPlayerMessage,
  type RoomStreamChunkEvent,
  type RoomStreamEndEvent,
  type RoomRoundStateUpdateEvent,
  type RoomPlayerMessageEvent,
  type RoomJoinResult,
} from './lib/backend';

const toChatMessage = (message: UiMessage): ChatMessage => ({
  id: String(message.id),
  backendId: message.id,
  sender: message.role === 'assistant' ? 'ai' : 'user',
  senderName:
    message.role === 'assistant'
      ? 'CHAT A.I+'
      : message.displayName || '玩家',
  content: message.content,
  isStreaming: false,
  roundId: message.roundId,
  messageKind: message.messageKind,
  isSwipe: message.isSwipe,
  swipeIndex: message.swipeIndex,
  replyToId: message.replyToId,
  summaryBatchIndex: message.summaryBatchIndex,
  summaryEntryId: message.summaryEntryId,
  isActiveInRound: message.isActiveInRound,
});

type CharacterEditorPayload = {
  cardType: 'npc' | 'player';
  name: string;
  imagePath?: string;
  description: string;
  tags: string[];
  baseSections?: CharacterBaseSectionInput[];
  firstMessages?: string[];
  defaultWorldBookId?: number;
  defaultProviderId?: number;
};

type CharacterStateOverlayUiStatus = 'queued' | 'completed' | 'failed' | null;

type RoomClientSession = {
  roomId?: number;
  conversation: ConversationListItem;
  memberId: number;
  displayName: string;
  hostAddress: string;
  port: number;
};

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
};

const DesktopView = (props: {
  messages: ChatMessage[];
  activeWorkspace: string;
  onWorkspaceChange: (id: string) => void;
  onRegenerate: (id: string, roundId?: number) => void;
  onEdit: (id: string, content: string) => void;
  onFork: (id: string) => void;
  swipeInfo?: (messageId: string) => { current: number; total: number } | undefined;
  onSwitchSwipe?: (messageId: string, direction: 'prev' | 'next') => void;
  onSend: (content: string) => Promise<void> | void;
  activeModal: 'new_chat' | 'join_room' | null;
  setActiveModal: (modal: 'new_chat' | 'join_room' | null) => void;
  isFocusMode: boolean;
  toggleFocusMode: () => void;
  sessions: ConversationListItem[];
  selectedConversationId: number | null;
  selectedConversationMembers: ConversationMember[];
  sessionsLoading: boolean;
  selectedConversationTitle?: string;
  currentRoundState?: RoundState | null;
  sending?: boolean;
  allowEmptySend?: boolean;
  onSelectConversation: (conversationId: number) => void;
  onDeleteConversation: (id: number) => Promise<void> | void;
  providers: ApiProviderSummary[];
  providerModels: Record<number, RemoteModel[]>;
  providersLoading: boolean;
  fetchingModelsFor: number | null;
  onFetchModels: (providerId: number) => Promise<void> | void;
  onSaveProvider: (payload: {
    id?: number;
    name: string;
    providerKind: 'openai_compatible' | 'anthropic';
    baseUrl: string;
    apiKey?: string;
    modelName: string;
  }) => Promise<void> | void;
  onDeleteProvider: (id: number) => Promise<void> | void;
  onTestClaudeNative: (payload: {
    providerId: number;
    testModel: string;
    testPrompt?: string;
    timeoutSeconds?: number;
    degradedThresholdMs?: number;
    maxRetries?: number;
  }) => Promise<{
    ok: boolean;
    status: number;
    latencyMs: number;
    attemptCount: number;
    degraded: boolean;
    degradedThresholdMs: number;
    model: string;
    responsePreview: string;
  }> | {
    ok: boolean;
    status: number;
    latencyMs: number;
    attemptCount: number;
    degraded: boolean;
    degradedThresholdMs: number;
    model: string;
    responsePreview: string;
  };
  npcCharacters: CharacterCard[];
  playerCharacters: CharacterCard[];
  characterLoading: boolean;
  onCreateCharacter: (payload: CharacterEditorPayload) => Promise<void> | void;
  onUpdateCharacter: (payload: CharacterEditorPayload & { id: number }) => Promise<void> | void;
  onDeleteCharacter: (id: number) => Promise<void> | void;
  selectedCharacter?: CharacterCard | null;
  selectedPresetId?: number | null;
  selectedWorldBookId?: number | null;
  presetSummaries: PresetSummary[];
  characterStateOverlaySummary?: string | null;
  characterStateOverlayStatus?: CharacterStateOverlayUiStatus;
  characterStateOverlayError?: string | null;
  plotSummaryMode?: 'ai' | 'manual' | string;
  plotSummaries: PlotSummaryRecord[];
  onUpdatePlotSummaryMode: (mode: 'ai' | 'manual') => Promise<void> | void;
  onSavePlotSummary: (batchIndex: number, summaryText: string) => Promise<void> | void;
  onSaveConversationBindings: (payload: { presetId?: number; worldBookId?: number }) => Promise<void> | void;
  worldBooks: WorldBookSummary[];
  activeWorldBookEntries: WorldBookEntryRecord[];
  worldBookEntriesLoading: boolean;
  onLoadWorldBookEntries: (worldBookId: number) => Promise<void> | void;
  onCreateWorldBook: (payload: { title: string; description?: string; imagePath?: string }) => Promise<void> | void;
  onUpdateWorldBook: (payload: { id: number; title?: string; description?: string; imagePath?: string }) => Promise<void> | void;
  onDeleteWorldBook: (id: number) => Promise<void> | void;
  onUpsertWorldBookEntry: (payload: {
    worldBookId: number;
    entryId?: number;
    title: string;
    content: string;
    keywords: string[];
    triggerMode: 'any' | 'all';
    isEnabled: boolean;
    sortOrder?: number;
  }) => Promise<void> | void;
  onDeleteWorldBookEntry: (entryId: number) => Promise<void> | void;
  enableDynamicEffects: boolean;
  onSetEnableDynamicEffects: (enabled: boolean) => void;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
  onSetFormatConfig: (config: MessageFormatConfig) => void;
  isRoomClient?: boolean;
}) => {
  const [activeSettingCategory, setActiveSettingCategory] = createSignal('api');

  return (
    <div class="relative h-screen w-full bg-transparent font-sans overflow-hidden text-mist-solid">
      <div class="absolute top-0 left-0 w-full z-50 pointer-events-none">
        <div class="pointer-events-auto">
          <TitleBar />
        </div>
      </div>

      <div class={`flex h-full w-full overflow-hidden transition-all duration-500`}>
        <Show when={!props.isFocusMode}>
          <WorkspaceSidebar
            activeWorkspace={props.activeWorkspace}
            onWorkspaceChange={props.onWorkspaceChange}
          />
        </Show>

        <Show when={props.activeWorkspace === 'chat' && !props.isFocusMode}>
          <div class="flex-none">
            <SessionSidebar
              sessions={props.sessions}
              npcCharacters={props.npcCharacters}
              selectedConversationId={props.selectedConversationId}
              selectedConversationMembers={props.selectedConversationMembers}
              loading={props.sessionsLoading}
              onSelect={props.onSelectConversation}
              onNewChat={() => props.setActiveModal('new_chat')}
              onJoinRoom={() => props.setActiveModal('join_room')}
              onDeleteConversation={props.onDeleteConversation}
            />
          </div>
        </Show>

        <Show when={props.activeWorkspace === 'settings'}>
          <div class="flex-none">
            <SettingsSidebar
              activeCategory={activeSettingCategory()}
              onCategoryChange={setActiveSettingCategory}
            />
          </div>
        </Show>

        <div class="flex-1 flex flex-col min-w-0 relative h-full">
          <Show
            when={props.activeWorkspace === 'chat'}
            fallback={
              <div class="w-full h-full">
                <Show when={props.activeWorkspace === 'character'}>
                  <CharacterSidebar
                    npcCharacters={props.npcCharacters}
                    playerCharacters={props.playerCharacters}
                    worldBooks={props.worldBooks}
                    providers={props.providers}
                    loading={props.characterLoading}
                    onCreateCharacter={props.onCreateCharacter}
                    onUpdateCharacter={props.onUpdateCharacter}
                    onDeleteCharacter={props.onDeleteCharacter}
                  />
                </Show>
                <Show when={props.activeWorkspace === 'settings'}>
                  <SettingsArea
                    activeCategory={activeSettingCategory()}
                    providers={props.providers}
                    modelsByProvider={props.providerModels}
                    loading={props.providersLoading}
                    fetchingModelsFor={props.fetchingModelsFor}
                    onFetchModels={props.onFetchModels}
                    onSaveProvider={props.onSaveProvider}
                    onDeleteProvider={props.onDeleteProvider}
                    onTestClaudeNative={props.onTestClaudeNative}
                    enableDynamicEffects={props.enableDynamicEffects}
                    onSetEnableDynamicEffects={props.onSetEnableDynamicEffects}
                    formatConfig={props.formatConfig ?? DEFAULT_FORMAT_CONFIG}
                    onSetFormatConfig={props.onSetFormatConfig}
                  />
                </Show>
                <Show when={props.activeWorkspace === 'kb'}>
                  <WorldBookSidebar
                    worldBooks={props.worldBooks}
                    activeEntries={props.activeWorldBookEntries}
                    entriesLoading={props.worldBookEntriesLoading}
                    onLoadEntries={props.onLoadWorldBookEntries}
                    onCreateWorldBook={props.onCreateWorldBook}
                    onUpdateWorldBook={props.onUpdateWorldBook}
                    onDeleteWorldBook={props.onDeleteWorldBook}
                    onUpsertEntry={props.onUpsertWorldBookEntry}
                    onDeleteEntry={props.onDeleteWorldBookEntry}
                  />
                </Show>
                <Show when={props.activeWorkspace === 'workspace'}>
                  <div class="flex h-full w-full">
                    <CompletionPresetArea />
                  </div>
                </Show>
              </div>
            }
          >
            <div class="flex-1 flex flex-col relative h-full">
              <div class="px-8 pt-12 pb-2 text-xs text-mist-solid/35 uppercase tracking-widest flex items-center justify-between">
                <span>{props.selectedConversationTitle ?? '未选择会话'}</span>
                <Show when={props.currentRoundState}>
                  <span>
                    {props.currentRoundState?.status} · 等待 {props.currentRoundState?.waitingMemberIds.length ?? 0} 人
                  </span>
                </Show>
              </div>
              <div class="flex-1 overflow-hidden flex flex-col pt-2">
                <ChatArea messages={props.messages} onRegenerate={props.isRoomClient ? () => {} : props.onRegenerate} onEdit={props.isRoomClient ? () => {} : props.onEdit} onFork={props.onFork} swipeInfo={props.swipeInfo} onSwitchSwipe={props.onSwitchSwipe} formatConfig={props.formatConfig} worldBookKeywords={props.worldBookKeywords} />
              </div>
              <div class="w-full shrink-0 px-6 pb-8 pt-2 bg-gradient-to-t from-xuanqing/40 via-xuanqing/20 to-transparent">
                <div class="max-w-4xl mx-auto">
                  <ChatInputBar
                    onSend={props.onSend}
                    allowEmptySend={props.allowEmptySend}
                    disabled={props.sending || !props.selectedConversationId}
                    placeholder={props.selectedConversationId ? '输入消息，联机会话可留空后发送表示本轮放弃发言' : '请先选择或创建会话'}
                  />
                </div>
              </div>
            </div>
          </Show>
        </div>

        <Show when={props.activeWorkspace === 'chat'}>
          <div class="flex flex-col relative">
            <button
              onClick={props.toggleFocusMode}
              class="absolute -left-12 top-1/2 -translate-y-1/2 z-40 p-2.5 rounded-l-2xl bg-accent text-white shadow-xl border border-white/10 opacity-40 hover:opacity-100 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              title={props.isFocusMode ? '退出专注模式' : '进入专注模式'}
              aria-label={props.isFocusMode ? '退出专注模式' : '进入专注模式'}
            >
              <Show when={props.isFocusMode} fallback={<Maximize2 size={18} />}>
                <Minimize2 size={18} />
              </Show>
            </button>
            <RightDrawer
              selectedConversationId={props.selectedConversationId}
              selectedCharacter={props.selectedCharacter}
              selectedPresetId={props.selectedPresetId ?? null}
              selectedWorldBookId={props.selectedWorldBookId ?? null}
              presetSummaries={props.presetSummaries}
              worldBooks={props.worldBooks}
              onSaveConversationBindings={props.onSaveConversationBindings}
              overlaySummary={props.characterStateOverlaySummary}
              overlayStatus={props.characterStateOverlayStatus}
              overlayError={props.characterStateOverlayError}
              plotSummaryMode={props.plotSummaryMode ?? 'ai'}
              plotSummaries={props.plotSummaries}
              onUpdatePlotSummaryMode={props.onUpdatePlotSummaryMode}
              onSavePlotSummary={props.onSavePlotSummary}
            />
          </div>
        </Show>
      </div>
    </div>
  );
};

function App() {
  const isMobile = useMobile();
  const [activeWorkspace, setActiveWorkspace] = createSignal('chat');
  const [activeModal, setActiveModal] = createSignal<'new_chat' | 'join_room' | null>(null);
  const [isFocusMode, setIsFocusMode] = createSignal(false);
  const [sessionsLoading, setSessionsLoading] = createSignal(true);
  const [providersLoading, setProvidersLoading] = createSignal(true);
  const [characterLoading, setCharacterLoading] = createSignal(true);
  const [worldBookEntriesLoading, setWorldBookEntriesLoading] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [fetchingModelsFor, setFetchingModelsFor] = createSignal<number | null>(null);
  const [selectedConversationId, setSelectedConversationId] = createSignal<number | null>(null);
  const [messages, setMessages] = createStore<ChatMessage[]>([]);
  const [sessions, setSessions] = createStore<ConversationListItem[]>([]);
  const [selectedConversationMembers, setSelectedConversationMembers] = createStore<ConversationMember[]>([]);
  const [providers, setProviders] = createStore<ApiProviderSummary[]>([]);
  const [providerModels, setProviderModels] = createStore<Record<number, RemoteModel[]>>({});
  const [presetSummaries, setPresetSummaries] = createStore<PresetSummary[]>([]);
  const [npcCharacters, setNpcCharacters] = createStore<CharacterCard[]>([]);
  const [playerCharacters, setPlayerCharacters] = createStore<CharacterCard[]>([]);
  const [worldBooks, setWorldBooks] = createStore<WorldBookSummary[]>([]);
  const [activeWorldBookEntries, setActiveWorldBookEntries] = createStore<WorldBookEntryRecord[]>([]);
  const [currentRoundState, setCurrentRoundState] = createSignal<RoundState | null>(null);
  const [characterStateOverlaySummary, setCharacterStateOverlaySummary] = createSignal<string | null>(null);
  const [characterStateOverlayStatus, setCharacterStateOverlayStatus] = createSignal<CharacterStateOverlayUiStatus>(null);
  const [characterStateOverlayError, setCharacterStateOverlayError] = createSignal<string | null>(null);
  const [plotSummaries, setPlotSummaries] = createStore<PlotSummaryRecord[]>([]);
  const [enableDynamicEffects, setEnableDynamicEffects] = createSignal(true);
  const [formatConfig, setFormatConfig] = createSignal<MessageFormatConfig>(DEFAULT_FORMAT_CONFIG);
  const [roomClientSession, setRoomClientSession] = createSignal<RoomClientSession | null>(null);

  const activeRoomClientSession = createMemo(() => {
    const session = roomClientSession();
    return session && session.conversation.id === selectedConversationId() ? session : null;
  });
  const visibleSessions = createMemo(() => {
    const remote = roomClientSession()?.conversation;
    if (!remote || sessions.some((session) => session.id === remote.id)) return sessions;
    return [remote, ...sessions];
  });
  const selectedConversation = createMemo(() => {
    const local = sessions.find((session) => session.id === selectedConversationId());
    if (local) return local;
    const remote = roomClientSession()?.conversation;
    return remote?.id === selectedConversationId() ? remote : null;
  });
  const selectedCharacter = createMemo(() => {
    const hostCharacterId = selectedConversation()?.hostCharacterId;
    if (hostCharacterId == null) return null;
    return [...npcCharacters, ...playerCharacters].find((character) => character.id === hostCharacterId) ?? null;
  });
  const hostMember = createMemo(() => selectedConversationMembers.find((member) => member.memberRole === 'host') ?? null);
  const allowEmptySend = createMemo(() => activeRoomClientSession() !== null || selectedConversation()?.conversationType === 'online');
  const worldBookKeywords = createMemo(() => {
    return activeWorldBookEntries.flatMap((entry) => entry.keywords ?? []);
  });
  const visibleMessages = createMemo(() =>
    messages.filter((message) => message.sender !== 'ai' || message.isActiveInRound !== false)
  );

  const upsertAssistantMessage = (incoming: ChatMessage) => {
    setMessages(produce((list) => {
      if (incoming.roundId != null && incoming.backendId != null && incoming.isActiveInRound !== false) {
        for (const message of list) {
          if (message.sender === 'ai' && message.roundId === incoming.roundId && message.backendId !== incoming.backendId) {
            message.isActiveInRound = false;
          }
        }
      }

      const existing = incoming.backendId != null
        ? list.find((message) => message.backendId === incoming.backendId)
        : undefined;

      if (existing) {
        Object.assign(existing, incoming);
        return;
      }

      list.push(incoming);
    }));
  };

  const upsertUserMessage = (incoming: ChatMessage) => {
    setMessages(produce((list) => {
      const existing = incoming.backendId != null
        ? list.find((message) => message.backendId === incoming.backendId)
        : list.find((message) => message.id === incoming.id);

      if (existing) {
        Object.assign(existing, incoming);
        return;
      }

      list.push(incoming);
    }));
  };

  const refreshSessions = async () => {
    setSessionsLoading(true);
    try {
      const data = await conversationsList();
      setSessions(data);
      if (!selectedConversationId() && data.length > 0) {
        setSelectedConversationId(data[0].id);
      }
    } finally {
      setSessionsLoading(false);
    }
  };

  const refreshProviders = async () => {
    setProvidersLoading(true);
    try {
      const data = await providersList();
      setProviders(data);
    } finally {
      setProvidersLoading(false);
    }
  };

  const refreshPresets = async () => {
    const data = await presetsList();
    setPresetSummaries(data);
  };

  const refreshCharacters = async () => {
    setCharacterLoading(true);
    try {
      const [npc, player] = await Promise.all([characterCardsList('npc'), characterCardsList('player')]);
      setNpcCharacters(npc);
      setPlayerCharacters(player);
    } finally {
      setCharacterLoading(false);
    }
  };

  const refreshWorldBooks = async () => {
    const data = await worldBooksList();
    setWorldBooks(data);
  };

  const refreshConversationContext = async (conversationId: number) => {
    try {
      const [messageList, members, roundState, summaryList] = await Promise.all([
        messagesList(conversationId),
        conversationMembersList(conversationId),
        roundStateGet(conversationId),
        plotSummariesList(conversationId),
      ]);

      setMessages(messageList.map(toChatMessage));
      setSelectedConversationMembers(members);
      setCurrentRoundState(roundState);
      setPlotSummaries(summaryList);
    } catch (error) {
      console.error('[conversation-debug] refreshConversationContext:error', {
        conversationId,
        error,
      });
      setMessages([]);
      setCurrentRoundState(null);
    }
  };

  const loadWorldBookEntries = async (worldBookId: number) => {
    setWorldBookEntriesLoading(true);
    try {
      const entries = await worldBookEntriesList(worldBookId);
      setActiveWorldBookEntries(entries);
    } finally {
      setWorldBookEntriesLoading(false);
    }
  };

  const upsertStreamingAssistant = (messageId: number, roundId: number) => {
    const existing = messages.find((message) => message.backendId === messageId);
    if (existing) {
      upsertAssistantMessage({
        ...existing,
        isStreaming: true,
        isActiveInRound: true,
      });
      return;
    }

    upsertAssistantMessage({
      id: String(messageId),
      backendId: messageId,
      sender: 'ai',
      senderName: 'CHAT A.I+',
      content: '',
      isStreaming: true,
      roundId,
      isActiveInRound: true,
    });
  };

  const updateMessageContent = (messageId: number, updater: (message: ChatMessage) => Partial<ChatMessage>) => {
    setMessages(
      (message) => message.backendId === messageId,
      (message) => ({ ...message, ...updater(message) }),
    );
  };

  const queueCharacterStateOverlay = () => {
    setCharacterStateOverlayStatus('queued');
    setCharacterStateOverlayError(null);
  };

  const handleSend = async (content: string) => {
    const conversationId = selectedConversationId();
    const providerId = selectedConversation()?.providerId;
    if (!conversationId) return;

    setSending(true);
    try {
      const roomSession = activeRoomClientSession();
      if (roomSession) {
        await roomSendMessage({
          content,
          actionType: content.trim().length === 0 ? 'skipped' : 'spoken',
          displayName: roomSession.displayName,
          memberId: roomSession.memberId,
        });
        return;
      }

      if (allowEmptySend() && hostMember()) {
        const result = await chatSubmitInput(conversationId, hostMember()!.id, content);
        if (result.visibleUserMessage) {
          upsertUserMessage(toChatMessage(result.visibleUserMessage));
        }
        if (result.assistantMessage) {
          upsertAssistantMessage({
            ...toChatMessage(result.assistantMessage),
            isStreaming: true,
          });
          queueCharacterStateOverlay();
        }
        setCurrentRoundState(result.round);
      } else {
        if (!providerId) return;
        const result = await sendMessage(conversationId, providerId, content);
        if (result.visibleUserMessage) {
          upsertUserMessage(toChatMessage(result.visibleUserMessage));
        }
        if (result.assistantMessage) {
          upsertAssistantMessage({
            ...toChatMessage(result.assistantMessage),
            isStreaming: true,
          });
          queueCharacterStateOverlay();
        }
        setCurrentRoundState(result.round);
      }
      await refreshSessions();
    } finally {
      setSending(false);
    }
  };

  const handleRegenerate = async (id: string, roundId?: number) => {
    const conversationId = selectedConversationId();
    const providerId = selectedConversation()?.providerId;
    if (!conversationId || !roundId) return;

    const msg = messages.find(m => m.id === id);
    const backendId = msg?.backendId;

    try {
      const result = (providerId && backendId)
        ? await regenerateMessage(conversationId, providerId, backendId)
        : await chatRegenerateRound(conversationId, roundId);

      upsertAssistantMessage({
        ...toChatMessage(result.assistantMessage),
        isStreaming: true,
      });
      setCurrentRoundState(result.round);
      queueCharacterStateOverlay();
      try {
        const refreshedMessages = await messagesList(conversationId);
        setMessages(refreshedMessages.map(toChatMessage));
      } catch { /* keep current state */ }
    } catch (error) {
      console.error('[conversation-debug] frontend:regenerate:error', {
        conversationId,
        messageId: id,
        roundId,
        providerId: providerId ?? null,
        backendId: backendId ?? null,
        error,
      });
      window.alert(`重新回复失败：${toErrorMessage(error)}`);
    }
  };

  const handleEditMessage = async (id: string, content: string) => {
    const backendId = messages.find(m => m.id === id)?.backendId;
    if (!backendId) return;
    await messagesUpdateContent(backendId, content);
    setMessages(
      (m) => m.id === id,
      'content',
      content
    );
  };

  const handleForkMessage = async (id: string) => {
    const conversationId = selectedConversationId();
    const backendId = messages.find(m => m.id === id)?.backendId;
    if (!conversationId || !backendId) return;

    try {
      const newConversationId = await conversationsFork(conversationId, backendId);
      await refreshSessions();
      setSelectedConversationId(newConversationId);
    } catch (error) {
      console.error('[conversation-debug] frontend:fork:error', {
        conversationId,
        messageId: id,
        backendId,
        error,
      });
      window.alert(`创建会话分支失败：${toErrorMessage(error)}`);
    }
  };

  const SwipeInfoMap = createMemo(() => {
    const map = new Map<string, { current: number; total: number }>();
    const byRound = new Map<number, ChatMessage[]>();
    for (const msg of messages) {
      if (msg.sender === 'ai' && msg.roundId != null) {
        const list = byRound.get(msg.roundId) || [];
        list.push(msg);
        byRound.set(msg.roundId, list);
      }
    }
    for (const [, roundMsgs] of byRound) {
      const total = roundMsgs.length;
      for (let i = 0; i < roundMsgs.length; i++) {
        const current = i + 1;
        map.set(roundMsgs[i].id, { current, total });
      }
    }
    return map;
  });

  const getSwipeInfo = (messageId: string) => SwipeInfoMap().get(messageId);

  const handleSwitchSwipe = async (messageId: string, direction: 'prev' | 'next') => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg || msg.roundId == null) return;
    const roundMessages = messages.filter(m => m.sender === 'ai' && m.roundId === msg.roundId);
    const currentIndex = roundMessages.findIndex(m => m.id === messageId);
    if (currentIndex < 0) return;

    const targetIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= roundMessages.length) return;

    const targetMsg = roundMessages[targetIndex];
    const targetBackendId = targetMsg.backendId;
    if (!targetBackendId) return;

    try {
      const result = await messagesSwitchSwipe(msg.roundId, targetBackendId);
      upsertAssistantMessage(toChatMessage(result));
    } catch (error) {
      console.error('[conversation-debug] frontend:swipe_switch:error', {
        messageId,
        roundId: msg.roundId,
        direction,
        targetBackendId,
        error,
      });
      window.alert(`切换回复版本失败：${toErrorMessage(error)}`);
    }
  };

  const handleCreateConversation = async (payload: Parameters<typeof conversationsCreate>[0]) => {
    const result = await conversationsCreate(payload);
    await refreshSessions();
    setSelectedConversationId(result.conversation.id);
    setSelectedConversationMembers([result.hostMember]);
    setCurrentRoundState(result.round);
    setMessages([]);
    return result.conversation.id;
  };

  const handleDeleteConversation = async (id: number) => {
    try {
      await conversationsDelete(id);
      if (selectedConversationId() === id) {
        setSelectedConversationId(null);
        setMessages([]);
      }
      await refreshSessions();
    } catch (error) {
      console.error('[conversation-debug] frontend:delete_conversation:error', {
        conversationId: id,
        selectedConversationId: selectedConversationId(),
        error,
      });
      window.alert(`删除会话失败：${toErrorMessage(error)}`);
    }
  };

  const handleFetchModels = async (providerId: number) => {
    setFetchingModelsFor(providerId);
    try {
      console.debug('[provider-debug] frontend:fetch_models:start', { providerId });
      const models = await providersFetchModels(providerId);
      console.debug('[provider-debug] frontend:fetch_models:success', {
        providerId,
        modelCount: models.length,
      });
      setProviderModels(providerId, models);
    } catch (error) {
      console.error('[provider-debug] frontend:fetch_models:error', {
        providerId,
        error,
      });
      throw error;
    } finally {
      setFetchingModelsFor(null);
    }
  };

  const handleSaveProvider = async (payload: {
    id?: number;
    name: string;
    providerKind: 'openai_compatible' | 'anthropic';
    baseUrl: string;
    apiKey?: string;
    modelName: string;
  }) => {
    console.debug('[provider-debug] frontend:save_provider:start', {
      id: payload.id ?? null,
      providerKind: payload.providerKind,
      baseUrl: payload.baseUrl,
      modelName: payload.modelName || '<empty>',
      hasApiKey: Boolean(payload.apiKey?.trim()),
    });

    try {
      if (payload.id != null) {
        await providersUpdate({ ...payload, id: payload.id });
      } else if (payload.apiKey?.trim()) {
        await providersCreate({ ...payload, apiKey: payload.apiKey.trim() });
      } else {
        throw new Error('新建 API 档案时必须填写 API Key');
      }
      await refreshProviders();
      console.debug('[provider-debug] frontend:save_provider:success', {
        id: payload.id ?? null,
        providerKind: payload.providerKind,
        modelName: payload.modelName || '<empty>',
      });
    } catch (error) {
      console.error('[provider-debug] frontend:save_provider:error', {
        id: payload.id ?? null,
        providerKind: payload.providerKind,
        baseUrl: payload.baseUrl,
        modelName: payload.modelName || '<empty>',
        error,
      });
      throw error;
    }
  };

  const handleDeleteProvider = async (id: number) => {
    await providersDelete(id);
    await refreshProviders();
  };

  const handleTestClaudeNative = async (
    payload: Parameters<typeof providersTestClaudeNative>[0],
  ) => {
    return providersTestClaudeNative(payload);
  };

  const handleCreateCharacter = async (payload: CharacterEditorPayload) => {
    await characterCardsCreate(payload);
    await refreshCharacters();
  };

  const handleUpdateCharacter = async (payload: CharacterEditorPayload & { id: number }) => {
    await characterCardsUpdate(payload);
    await refreshCharacters();
  };

  const handleDeleteCharacter = async (id: number) => {
    await characterCardsDelete(id);
    await refreshCharacters();
  };

  const handleSaveConversationBindings = async (payload: {
    presetId?: number;
    worldBookId?: number;
  }) => {
    const conversationId = selectedConversationId();
    if (conversationId == null) {
      throw new Error('当前未选择会话，无法保存绑定。');
    }
    await conversationsUpdateBindings({
      conversationId,
      presetId: payload.presetId,
      worldBookId: payload.worldBookId,
    });
    await refreshSessions();
    await refreshConversationContext(conversationId);
  };

  const handleCreateWorldBook = async (payload: { title: string; description?: string; imagePath?: string }) => {
    await worldBooksCreate(payload);
    await refreshWorldBooks();
  };

  const handleUpdateWorldBook = async (payload: { id: number; title?: string; description?: string; imagePath?: string }) => {
    await worldBooksUpdate(payload);
    await refreshWorldBooks();
  };

  const handleDeleteWorldBook = async (id: number) => {
    await worldBooksDelete(id);
    await refreshWorldBooks();
  };

  const handleUpsertWorldBookEntry = async (payload: {
    worldBookId: number;
    entryId?: number;
    title: string;
    content: string;
    keywords: string[];
    triggerMode: 'any' | 'all';
    isEnabled: boolean;
    sortOrder?: number;
  }) => {
    await worldBookEntriesUpsert(payload);
    await loadWorldBookEntries(payload.worldBookId);
    await refreshWorldBooks();
  };

  const handleDeleteWorldBookEntry = async (entryId: number) => {
    const currentBookId = activeWorldBookEntries[0]?.worldBookId;
    await worldBookEntriesDelete(entryId);
    if (currentBookId != null) {
      await loadWorldBookEntries(currentBookId);
    }
    await refreshWorldBooks();
  };

  const handleUpdatePlotSummaryMode = async (mode: 'ai' | 'manual') => {
    const conversationId = selectedConversationId();
    if (conversationId == null) return;
    await plotSummariesUpdateMode({ conversationId, plotSummaryMode: mode });
    await refreshSessions();
    await refreshConversationContext(conversationId);
  };

  const handleSavePlotSummary = async (batchIndex: number, summaryText: string) => {
    const conversationId = selectedConversationId();
    if (conversationId == null) return;
    await plotSummariesUpsertManual({ conversationId, batchIndex, summaryText });
    await refreshConversationContext(conversationId);
  };

  const handleSetEnableDynamicEffects = async (enabled: boolean) => {
    await settingsSet('enableDynamicEffects', String(enabled));
    setEnableDynamicEffects(enabled);
  };

  const handleSetFormatConfig = async (config: MessageFormatConfig) => {
    await setMessageFormatConfig(JSON.stringify(config));
    setFormatConfig(config);
  };

  const handleRoomJoined = (
    result: RoomJoinResult,
    connection: { hostAddress: string; port: number; displayName: string },
  ) => {
    if (!result.conversation || result.memberId == null) {
      console.error('[room:join] missing room session metadata', result);
      return;
    }

    setRoomClientSession({
      roomId: result.roomId,
      conversation: result.conversation,
      memberId: result.memberId,
      displayName: connection.displayName,
      hostAddress: connection.hostAddress,
      port: connection.port,
    });
    setActiveWorkspace('chat');
    setSelectedConversationId(result.conversation.id);
    setSelectedConversationMembers(result.members ?? []);
    setMessages((result.recentMessages ?? []).map(toChatMessage));
    setCurrentRoundState(result.roundState ?? null);
    setActiveModal(null);
  };

  const handleRoomLeft = () => {
    setRoomClientSession(null);
    setSelectedConversationMembers([]);
    setCurrentRoundState(null);
    setMessages([]);
    setSelectedConversationId(sessions[0]?.id ?? null);
  };

  onMount(async () => {
    window.setTimeout(() => {
      const splash = document.getElementById('splash-screen');
      if (splash) {
        splash.style.opacity = '0';
        window.setTimeout(() => splash.remove(), 500);
      }
    }, 800);

    await Promise.all([refreshSessions(), refreshProviders(), refreshPresets(), refreshCharacters(), refreshWorldBooks()]);

    const settingsData = await settingsGetAll();
    const dynamicEffectSetting = settingsData.find((s: { key: string }) => s.key === 'enableDynamicEffects');
    if (dynamicEffectSetting !== undefined) {
      setEnableDynamicEffects(dynamicEffectSetting.value !== 'false');
    }

    const formatConfigSetting = settingsData.find((s: { key: string }) => s.key === 'messageFormatConfig');
    if (formatConfigSetting && formatConfigSetting.value) {
      try {
        const parsed = JSON.parse(formatConfigSetting.value);
        if (parsed.builtinRules?.pseudoXml && parsed.builtinRules.pseudoXml.defaultExpanded === undefined) {
          parsed.builtinRules.pseudoXml.defaultExpanded = true;
        }
        setFormatConfig(parsed);
      } catch { /* use default */ }
    }

    const chunkUnlisten = await listenLlmStreamEvent((payload) => {
      if (payload.conversationId !== selectedConversationId()) return;

      switch (payload.eventKind) {
        case 'text_delta': {
          const delta = payload.textDelta ?? '';
          upsertStreamingAssistant(payload.messageId, payload.roundId);
          updateMessageContent(payload.messageId, (message) => ({
            content: `${message.content}${delta}`,
            isStreaming: true,
          }));
          break;
        }
        case 'message_stop': {
          upsertStreamingAssistant(payload.messageId, payload.roundId);
          updateMessageContent(payload.messageId, () => ({
            isStreaming: false,
          }));
          break;
        }
        case 'thinking_delta': {
          console.debug('[llm-stream-event] hidden thinking delta', payload);
          break;
        }
        case 'content_block_start':
        case 'content_block_stop':
        case 'tool_use': {
          console.debug('[llm-stream-event] structural event', payload);
          break;
        }
        default: {
          console.debug('[llm-stream-event] ignored event', payload);
          break;
        }
      }
    });

    const errorUnlisten = await listenStreamError((payload) => {
      if (payload.conversationId !== selectedConversationId()) return;
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      updateMessageContent(payload.messageId, () => ({
        isStreaming: false,
        error: payload.error,
      }));
    });

    const roundUnlisten = await listenRoundState((payload) => {
      if (payload.round.conversationId !== selectedConversationId()) return;
      setCurrentRoundState(payload.round);
    });

    const overlayUpdatedUnlisten = await listenCharacterStateOverlayUpdated((payload) => {
      if (payload.conversationId !== selectedConversationId()) return;
      setCharacterStateOverlaySummary(payload.summaryText);
      setCharacterStateOverlayStatus('completed');
      setCharacterStateOverlayError(null);
    });

    const overlayErrorUnlisten = await listenCharacterStateOverlayError((payload) => {
      if (payload.conversationId !== selectedConversationId()) return;
      setCharacterStateOverlayStatus('failed');
      setCharacterStateOverlayError(payload.error);
    });

    const plotSummaryUpdatedUnlisten = await listenPlotSummaryUpdated((payload) => {
      if (payload.conversationId !== selectedConversationId()) return;
      void refreshConversationContext(payload.conversationId);
    });

    const plotSummaryErrorUnlisten = await listenPlotSummaryError((payload) => {
      if (payload.conversationId !== selectedConversationId()) return;
      void refreshConversationContext(payload.conversationId);
    });

    const plotSummaryPendingUnlisten = await listenPlotSummaryPending((payload) => {
      if (payload.conversationId !== selectedConversationId()) return;
      void refreshConversationContext(payload.conversationId);
    });

    const roomChunkUnlisten = await listenRoomStreamChunk((payload: RoomStreamChunkEvent) => {
      if (payload.conversationId !== selectedConversationId()) return;
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      updateMessageContent(payload.messageId, (message) => ({
        content: `${message.content}${payload.delta}`,
        isStreaming: !payload.done,
      }));
    });

    const roomStreamEndUnlisten = await listenRoomStreamEnd((payload: RoomStreamEndEvent) => {
      if (payload.conversationId !== selectedConversationId()) return;
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      updateMessageContent(payload.messageId, () => ({
        isStreaming: false,
      }));
    });

    const roomRoundStateUnlisten = await listenRoomRoundStateUpdate((payload: RoomRoundStateUpdateEvent) => {
      if (payload.roundState.conversationId !== selectedConversationId()) return;
      setCurrentRoundState(payload.roundState);
    });

    const roomPlayerMessageUnlisten = await listenRoomPlayerMessage((payload: RoomPlayerMessageEvent) => {
      const conversationId = payload.conversationId ?? selectedConversationId();
      if (conversationId !== selectedConversationId()) return;
      if (payload.actionType === 'skipped') return;

      upsertUserMessage({
        id: payload.messageId != null
          ? String(payload.messageId)
          : `room-${payload.memberId}-${Date.now()}`,
        backendId: payload.messageId,
        sender: 'user',
        senderName: payload.displayName,
        content: payload.content,
        isStreaming: false,
        roundId: payload.roundId,
        messageKind: 'user_visible',
        isActiveInRound: true,
      });
    });

    const roomErrorUnlisten = await listenRoomError((payload) => {
      const msg = typeof payload === 'string' ? payload : payload.message;
      console.error('[room:error]', msg);
    });

    const roomDisconnectedUnlisten = await listenRoomDisconnected(() => {
      setRoomClientSession(null);
    });

    // Refresh member list when a remote member joins or leaves the room
    const roomMemberJoinedUnlisten = await listenRoomMemberJoined((payload) => {
      const remote = activeRoomClientSession();
      if (remote) {
        const nextMemberCount = selectedConversationMembers.some((member) => member.id === payload.memberId)
          ? selectedConversationMembers.length
          : selectedConversationMembers.length + 1;
        setSelectedConversationMembers(produce((members) => {
          if (members.some((member) => member.id === payload.memberId)) return;
          members.push({
            id: payload.memberId,
            conversationId: remote.conversation.id,
            memberRole: 'member',
            displayName: payload.displayName,
            joinOrder: members.length,
            isActive: true,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
        }));
        setRoomClientSession({
          ...remote,
          conversation: {
            ...remote.conversation,
            memberCount: Math.max(remote.conversation.memberCount, nextMemberCount),
          },
        });
        return;
      }
      const cid = selectedConversationId();
      if (cid != null) {
        void refreshConversationContext(cid);
        void refreshSessions();
      }
    });

    const roomMemberLeftUnlisten = await listenRoomMemberLeft((payload) => {
      const remote = activeRoomClientSession();
      if (remote) {
        const nextMembers = selectedConversationMembers.filter((member) => member.id !== payload.memberId);
        setSelectedConversationMembers(nextMembers);
        setRoomClientSession({
          ...remote,
          conversation: {
            ...remote.conversation,
            memberCount: nextMembers.length,
          },
        });
        return;
      }
      const cid = selectedConversationId();
      if (cid != null) {
        void refreshConversationContext(cid);
        void refreshSessions();
      }
    });

    onCleanup(() => {
      chunkUnlisten();
      errorUnlisten();
      roundUnlisten();
      overlayUpdatedUnlisten();
      overlayErrorUnlisten();
      plotSummaryUpdatedUnlisten();
      plotSummaryErrorUnlisten();
      plotSummaryPendingUnlisten();
      roomChunkUnlisten();
      roomStreamEndUnlisten();
      roomRoundStateUnlisten();
      roomPlayerMessageUnlisten();
      roomErrorUnlisten();
      roomDisconnectedUnlisten();
      roomMemberJoinedUnlisten();
      roomMemberLeftUnlisten();
    });
  });

  createEffect(() => {
    const conversationId = selectedConversationId();
    setCharacterStateOverlaySummary(null);
    setCharacterStateOverlayStatus(null);
    setCharacterStateOverlayError(null);
    setPlotSummaries([]);
    if (conversationId == null) return;
    if (activeRoomClientSession()) return;
    void refreshConversationContext(conversationId);
  });

  return (
    <>
      <AuroraBackground
        isActive={selectedConversationId() !== null}
        characterImageUrl={toAssetUrl(selectedCharacter()?.imagePath)}
        enableAurora={enableDynamicEffects()}
      />
      <Show
        when={isMobile()}
        fallback={
          <DesktopView
            messages={visibleMessages()}
            activeWorkspace={activeWorkspace()}
            onWorkspaceChange={setActiveWorkspace}
            onRegenerate={handleRegenerate}
            onEdit={handleEditMessage}
            onFork={handleForkMessage}
            swipeInfo={getSwipeInfo}
            onSwitchSwipe={handleSwitchSwipe}
            onSend={handleSend}
            activeModal={activeModal()}
            setActiveModal={setActiveModal}
            isFocusMode={isFocusMode()}
            toggleFocusMode={() => setIsFocusMode(!isFocusMode())}
            sessions={visibleSessions()}
            selectedConversationId={selectedConversationId()}
            selectedConversationMembers={selectedConversationMembers}
            sessionsLoading={sessionsLoading()}
            selectedConversationTitle={selectedConversation()?.title ?? undefined}
            currentRoundState={currentRoundState()}
            sending={sending()}
            allowEmptySend={allowEmptySend()}
            onSelectConversation={setSelectedConversationId}
            onDeleteConversation={handleDeleteConversation}
            providers={providers}
            providerModels={providerModels}
            providersLoading={providersLoading()}
            fetchingModelsFor={fetchingModelsFor()}
            onFetchModels={handleFetchModels}
            onSaveProvider={handleSaveProvider}
            onDeleteProvider={handleDeleteProvider}
            onTestClaudeNative={handleTestClaudeNative}
            npcCharacters={npcCharacters}
            playerCharacters={playerCharacters}
            characterLoading={characterLoading()}
            onCreateCharacter={handleCreateCharacter}
            onUpdateCharacter={handleUpdateCharacter}
            onDeleteCharacter={handleDeleteCharacter}
            selectedCharacter={selectedCharacter()}
            selectedPresetId={selectedConversation()?.presetId ?? null}
            selectedWorldBookId={selectedConversation()?.worldBookId ?? null}
            presetSummaries={presetSummaries}
            characterStateOverlaySummary={characterStateOverlaySummary()}
            characterStateOverlayStatus={characterStateOverlayStatus()}
            characterStateOverlayError={characterStateOverlayError()}
            plotSummaryMode={selectedConversation()?.plotSummaryMode ?? 'ai'}
            plotSummaries={plotSummaries}
            onUpdatePlotSummaryMode={handleUpdatePlotSummaryMode}
            onSavePlotSummary={handleSavePlotSummary}
            onSaveConversationBindings={handleSaveConversationBindings}
            worldBooks={worldBooks}
            activeWorldBookEntries={activeWorldBookEntries}
            worldBookEntriesLoading={worldBookEntriesLoading()}
            onLoadWorldBookEntries={loadWorldBookEntries}
            onCreateWorldBook={handleCreateWorldBook}
            onUpdateWorldBook={handleUpdateWorldBook}
            onDeleteWorldBook={handleDeleteWorldBook}
            onUpsertWorldBookEntry={handleUpsertWorldBookEntry}
            onDeleteWorldBookEntry={handleDeleteWorldBookEntry}
            enableDynamicEffects={enableDynamicEffects()}
            onSetEnableDynamicEffects={handleSetEnableDynamicEffects}
            formatConfig={formatConfig()}
            worldBookKeywords={worldBookKeywords()}
            onSetFormatConfig={handleSetFormatConfig}
            isRoomClient={activeRoomClientSession() !== null}
          />
        }
      >
        <MobileView
          messages={visibleMessages()}
          sessions={visibleSessions()}
          npcCharacters={npcCharacters}
          selectedConversationId={selectedConversationId()}
          selectedConversationTitle={selectedConversation()?.title ?? undefined}
          selectedConversationMembers={selectedConversationMembers}
          currentRoundState={currentRoundState()}
          sessionsLoading={sessionsLoading()}
          sending={sending()}
          allowEmptySend={allowEmptySend()}
          selectedCharacter={selectedCharacter()}
          selectedPresetId={selectedConversation()?.presetId ?? null}
          selectedWorldBookId={selectedConversation()?.worldBookId ?? null}
          presetSummaries={presetSummaries}
          characterStateOverlaySummary={characterStateOverlaySummary()}
          characterStateOverlayStatus={characterStateOverlayStatus()}
          characterStateOverlayError={characterStateOverlayError()}
          plotSummaryMode={selectedConversation()?.plotSummaryMode ?? 'ai'}
          plotSummaries={plotSummaries}
          onUpdatePlotSummaryMode={handleUpdatePlotSummaryMode}
          onSavePlotSummary={handleSavePlotSummary}
          onSaveConversationBindings={handleSaveConversationBindings}
          worldBooks={worldBooks}
          onSend={handleSend}
          onRegenerate={handleRegenerate}
          onEdit={handleEditMessage}
          onFork={handleForkMessage}
          swipeInfo={getSwipeInfo}
          onSwitchSwipe={handleSwitchSwipe}
          onSelectConversation={setSelectedConversationId}
          onDeleteConversation={handleDeleteConversation}
          onOpenNewChat={() => setActiveModal('new_chat')}
          onOpenJoinRoom={() => setActiveModal('join_room')}
          formatConfig={formatConfig()}
          worldBookKeywords={worldBookKeywords()}
          isRoomClient={activeRoomClientSession() !== null}
        />
      </Show>

      <NewChatModal
        isOpen={activeModal() === 'new_chat'}
        onClose={() => setActiveModal(null)}
        npcCharacters={npcCharacters}
        worldBooks={worldBooks}
        providers={providers}
        creating={sending()}
        onCreateConversation={handleCreateConversation}
      />
      <JoinRoomModal
        isOpen={activeModal() === 'join_room'}
        onClose={() => setActiveModal(null)}
        onJoined={handleRoomJoined}
        onLeft={handleRoomLeft}
      />
      <BackdoorTestPanel />
    </>
  );
}

export default App;
