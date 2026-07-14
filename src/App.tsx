import { For, createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js';
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
import { setSchemaToggleState, clearSchemaToggleState, setAllSchemaToggleState } from './components/MessageFormatRenderer';
import { SettingsSidebar } from './components/SettingsSidebar';
import { SettingsArea } from './components/SettingsArea';
import { AuroraBackground } from './components/AuroraBackground';
import { CompletionPresetArea } from './components/CompletionPresetArea';
import { BlueprintEditor } from './components/blueprint/BlueprintEditor';
import { NewChatModal } from './components/NewChatModal';
import { JoinRoomModal } from './components/JoinRoomModal';
import { WorkspaceTransitionStage } from './components/WorkspaceTransitionStage';
import { ConfirmDialog } from './components/ConfirmDialog';
import { NotificationContainer, showToast } from './components/Toast';
import { setMessageFormatConfig, messagesUpdateContent, messagesSwitchSwipe, messagesDelete, abortRoundStream, conversationsFork, retryFailedRound, rewindToRound, listenMessageReset, getConversationMode } from './lib/backend';
import { DEFAULT_FORMAT_CONFIG, type MessageFormatConfig } from './lib/messageFormatter';
import { selectProfile, FALLBACK_PROFILE } from './lib/capability-profile';
import {
  type ApiProviderSummary,
  type CapabilityProfile,
  type CharacterBaseSection,
  type CharacterBaseSectionInput,
  type CharacterCard,
  type ConversationListItem,
  type ConversationMember,
  type ConversationMode,
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
  conversationMembersUpdate,
  conversationsCreate,
  conversationsDelete,
  conversationsList,
  conversationsUpdateBindings,
  listenLlmStreamEvent,
  listenPlotSummaryError,
  listenPlotSummaryPending,
  listenPlotSummaryUpdated,
  listenRoundState,
  listenStreamError,
  listenStreamRetry,
  messagesList,
  mem0SnapshotWindowSet,
  plotSummariesList,
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
  characterCardsExport,
  worldBooksExport,
  exchangeImport,
  downloadJsonFile,
  sanitizeFileName,
  type WorldBookEntryRecord,
  type WorldBookSummary,
  toAssetUrl,
  roomSendMessage,
  listenRoomStreamChunk,
  listenRoomStreamEnd,
  listenRoomStreamRetry,
  listenRoomMessageReset,
  listenRoomStreamStructuredFieldDelta,
  listenRoomStreamObjectFieldComplete,
  listenRoomRoundStateUpdate,
  listenRoomError,
  listenRoomDisconnected,
  listenRoomMemberJoined,
  listenRoomMemberLeft,
  listenRoomPlayerMessage,
  listenRoomContextSnapshot,
  listenRoomSchemaToggle,
  listenRoomTokenUsage,
  listenRoomPlotSummaryUpdate,
  listenRoomMessageEdited,
  listenRoomMessageDeleted,
  listenRoomRewoundToRound,
  listenRoomContextWindowChanged,
  listenRoomGuestCharacterUpdated,
  listenRoomSwipeActivated,
  roomRequestContext,
  roomOpen,
  roomClose,
  roomBroadcastSchemaToggle,
  roomUpdateGuestCharacter,
  type RoomStreamChunkEvent,
  type RoomStreamEndEvent,
  type RoomStreamRetryEvent,
  type RoomStreamStructuredFieldDeltaEvent,
  type RoomStreamObjectFieldCompleteEvent,
  type RoomMessageResetEvent,
  type RoomRoundStateUpdateEvent,
  type RoomPlayerMessageEvent,
  type RoomContextSnapshotEvent,
  type RoomSchemaToggleEvent,
  type RoomTokenUsageEvent,
  type RoomPlotSummaryUpdateEvent,
  type RoomMessageEditedEvent,
  type RoomMessageDeletedEvent,
  type RoomRewoundToRoundEvent,
  type RoomContextWindowChangedEvent,
  type RoomGuestCharacterUpdatedEvent,
  type RoomSwipeActivatedEvent,
  type RoomHostCharacter,
  type RoomJoinResult,
  type TokenUsageReport,
  roomLeave,
  listenMemoryError,
  mem0InitStatus,
  type MemoryBackendErrorEvent,
} from './lib/backend';

const toChatMessage = (
  message: UiMessage,
  aiCharacter?: CharacterCard,
  playerCharacter?: CharacterCard,
  remoteHost?: RoomHostCharacter | null,
): ChatMessage => {
  const aiAvatar = remoteHost?.imageBase64 ?? toAssetUrl(aiCharacter?.imagePath);
  const playerAvatar = toAssetUrl(playerCharacter?.imagePath);
  return {
    id: String(message.id),
    backendId: message.id,
    sender: message.role === 'assistant' ? 'ai' : 'user',
    senderName:
      message.role === 'assistant'
        ? (aiCharacter?.name || remoteHost?.name || 'AI')
        : (playerCharacter?.name || message.displayName || '玩家'),
    avatar: message.role === 'assistant' ? aiAvatar : playerAvatar,
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
  };
};

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
// NOTE: overlay signals retained for backward compat but unused after three-mode refactor

type RoomClientSession = {
  roomId?: number;
  conversation: ConversationListItem;
  memberId: number;
  displayName: string;
  hostAddress: string;
  port: number;
  hostCharacter?: RoomHostCharacter | null;
  contextWindowSize?: number;
  tokenUsageReport?: TokenUsageReport;
  plotSummaries?: PlotSummaryRecord[];
  playerCharacterId?: number;
};

const DESKTOP_WORKSPACE_IDS = ['chat', 'settings', 'character', 'kb', 'workspace'] as const;

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
  onDeleteMessage?: (id: string) => void;
  onRetryFailed?: (id: string, roundId?: number) => void;
  onRewind?: (id: string, roundId?: number) => void;
  swipeInfo?: (messageId: string) => { current: number; total: number } | undefined;
  onSwitchSwipe?: (messageId: string, direction: 'prev' | 'next') => void;
  onSend: (content: string) => Promise<void> | void;
  onAbort?: () => void | Promise<void>;
  replyStatus?: 'idle' | 'connecting' | 'processing' | 'responding';
  activeModal: 'new_chat' | 'join_room' | null;
  setActiveModal: (modal: 'new_chat' | 'join_room' | null) => void;
  isFocusMode: boolean;
  toggleFocusMode: () => void;
  sessions: ConversationListItem[];
  selectedConversationId: number | null;
  selectedConversationMembers: ConversationMember[];
  sessionsLoading: boolean;
  roomActionLoading?: boolean;
  selectedConversationTitle?: string;
  currentRoundState?: RoundState | null;
  sending?: boolean;
  allowEmptySend?: boolean;
  onSelectConversation: (conversationId: number) => void;
  onDeleteConversation: (id: number) => Promise<void> | void;
  onOpenRoom?: (conversationId: number) => void;
  onCloseRoom?: (conversationId: number) => void;
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
  onImportExchange: (file: File) => Promise<void> | void;
  onExportCharacter: (character: CharacterCard) => Promise<void> | void;
  selectedCharacter?: CharacterCard | null;
  selectedPresetId?: number | null;
  selectedWorldBookId?: number | null;
  selectedProviderId?: number | null;
  selectedEmbeddingProviderId?: number | null;
  presetSummaries: PresetSummary[];
  characterStateOverlaySummary?: string | null;
  characterStateOverlayStatus?: CharacterStateOverlayUiStatus;
  characterStateOverlayError?: string | null;
  memoryMode?: 'stateless' | 'legacy' | 'mem0' | string;
  mem0SnapshotWindow?: number;
  onSnapshotWindowChange?: (window: number) => Promise<void> | void;
  onSaveConversationBindings: (payload: { presetId?: number; worldBookId?: number; providerId?: number; embeddingProviderId?: number | null }) => Promise<void> | void;
  currentPlayerCharacter?: CharacterCard;
  onSwitchPlayerCharacter: (playerCharacterId: number) => Promise<void> | void;
  worldBooks: WorldBookSummary[];
  activeWorldBookEntries: WorldBookEntryRecord[];
  worldBookEntriesLoading: boolean;
  onLoadWorldBookEntries: (worldBookId: number) => Promise<void> | void;
  onCreateWorldBook: (payload: { title: string; description?: string; imagePath?: string }) => Promise<void> | void;
  onUpdateWorldBook: (payload: { id: number; title?: string; description?: string; imagePath?: string }) => Promise<void> | void;
  onDeleteWorldBook: (id: number) => Promise<void> | void;
  onExportWorldBook: (book: WorldBookSummary) => Promise<void> | void;
  onUpsertWorldBookEntry: (payload: {
    worldBookId: number;
    entryId?: number;
    title: string;
    content: string;
    keywords: string[];
    triggerMode: 'any' | 'all' | 'always';
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
  profile: CapabilityProfile;
  onSchemaToggle?: (toggleKey: string, expanded: boolean) => void;
  onPresetsChanged?: () => void;
  /** mem0 startup error — forwarded to SettingsArea for display. */
  mem0InitError?: string | null;
  /** Runtime memory backend errors — forwarded to ChatArea for display. */
  memoryErrors?: import('./lib/backend').MemoryBackendErrorEvent[];
  /** Room guest token usage report (host-side data) — forwarded to ChatArea. */
  roomTokenUsageReport?: import('./lib/backend').TokenUsageReport | null;
  /** Room guest context window size (host-side data) — forwarded to ChatArea. */
  roomContextWindowSize?: number | null;
  /** Room guest host preset name (host-side data) — forwarded to RightDrawer. */
  hostPresetName?: string | null;
  /** Room guest host world book name (host-side data) — forwarded to RightDrawer. */
  hostWorldBookName?: string | null;
  /** Room guest host provider name (host-side data) — forwarded to RightDrawer. */
  hostProviderName?: string | null;
  /** Room guest plot summaries (host-side data) — forwarded to RightDrawer. */
  plotSummaries?: PlotSummaryRecord[];
}) => {
  const [activeSettingCategory, setActiveSettingCategory] = createSignal('api');
  const activePreset = createMemo(() => props.presetSummaries.find(p => p.id === props.selectedPresetId) ?? null);

  return (
    <div class="relative h-screen w-full bg-transparent font-sans overflow-hidden text-mist-solid">
      <div class="absolute top-0 left-0 w-full z-50 pointer-events-none">
        <div class="pointer-events-auto">
          <TitleBar />
        </div>
      </div>

      <div class={`flex h-full w-full overflow-hidden transition-all duration-500 bg-transparent`}>
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
              roomActionLoading={props.roomActionLoading}
              onSelect={props.onSelectConversation}
              onNewChat={() => props.setActiveModal('new_chat')}
              onJoinRoom={() => props.setActiveModal('join_room')}
              onDeleteConversation={props.onDeleteConversation}
              onOpenRoom={props.onOpenRoom}
              onCloseRoom={props.onCloseRoom}
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

        <div class="flex-1 flex flex-col min-w-0 relative h-full bg-transparent">
          <Show
            when={props.activeWorkspace === 'chat'}
            fallback={
              <div class="w-full h-full bg-transparent">
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
                    onImportExchange={props.onImportExchange}
                    onExportCharacter={props.onExportCharacter}
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
                    mem0InitError={props.mem0InitError}
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
                    onImportExchange={props.onImportExchange}
                    onExportWorldBook={props.onExportWorldBook}
                    onUpsertEntry={props.onUpsertWorldBookEntry}
                    onDeleteEntry={props.onDeleteWorldBookEntry}
                  />
                </Show>
                <Show when={props.activeWorkspace === 'workspace'}>
                  <div class="flex h-full w-full bg-transparent">
                    <CompletionPresetArea onPresetsChanged={props.onPresetsChanged} />
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
                <ChatArea messages={props.messages} conversationId={props.selectedConversationId ?? undefined} onRegenerate={props.isRoomClient ? () => {} : props.onRegenerate} onEdit={props.isRoomClient ? () => {} : props.onEdit} onFork={props.onFork} onDeleteMessage={props.onDeleteMessage} onRetryFailed={props.isRoomClient ? undefined : props.onRetryFailed} onRewind={props.isRoomClient ? undefined : props.onRewind} isRoomClient={props.isRoomClient} profile={props.profile} swipeInfo={props.swipeInfo} onSwitchSwipe={props.onSwitchSwipe} formatConfig={props.formatConfig} worldBookKeywords={props.worldBookKeywords} onChoiceSelect={(_key, value) => props.onSend(value)} onSchemaToggle={props.onSchemaToggle} structuredOutputDisplay={activePreset()?.structuredOutputDisplay} memoryErrors={props.memoryErrors} roomTokenUsageReport={props.roomTokenUsageReport} roomContextWindowSize={props.roomContextWindowSize} />
              </div>
              <div class="w-full shrink-0 px-6 pb-8 pt-2 bg-gradient-to-t from-xuanqing/40 via-xuanqing/20 to-transparent">
                <div class="max-w-4xl mx-auto">
                  <ChatInputBar
                    onSend={props.onSend}
                    onAbort={props.onAbort}
                    replyStatus={props.replyStatus}
                    allowEmptySend={props.allowEmptySend}
                    disabled={props.sending || !props.selectedConversationId}
                    placeholder={props.selectedConversationId ? '输入消息，联机会话可留空后发送表示本轮放弃发言' : '请先选择或创建会话'}
                    isRoomClient={props.isRoomClient}
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
              class="fixed top-[45%] right-0 -translate-y-1/2 z-30 bg-black/40 hover:bg-black/60 text-mist-solid/60 hover:text-accent p-2 rounded-l-xl border-l border-y border-white/10 backdrop-blur-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
              memoryMode={props.memoryMode ?? 'stateless'}
              mem0SnapshotWindow={props.mem0SnapshotWindow}
              onSnapshotWindowChange={props.onSnapshotWindowChange}
              playerCharacters={props.playerCharacters}
              currentPlayerCharacter={props.currentPlayerCharacter}
              onSwitchPlayerCharacter={props.onSwitchPlayerCharacter}
              providers={props.providers}
              selectedProviderId={props.selectedProviderId ?? null}
              selectedEmbeddingProviderId={props.selectedEmbeddingProviderId ?? null}
              isRoomClient={props.isRoomClient}
              hostPresetName={props.hostPresetName}
              hostWorldBookName={props.hostWorldBookName}
              hostProviderName={props.hostProviderName}
              plotSummaries={props.plotSummaries}
            />
          </div>
        </Show>
      </div>
    </div>
  );
};

const AnimatedDesktopView = (props: Parameters<typeof DesktopView>[0]) => {
  const [activeSettingCategory, setActiveSettingCategory] = createSignal('api');
  const [editingPresetId, setEditingPresetId] = createSignal<number | null>(null);
  const activePreset = createMemo(() => props.presetSummaries.find(p => p.id === props.selectedPresetId) ?? null);

  return (
    <div class="relative h-screen w-full bg-transparent font-sans overflow-hidden text-mist-solid">
      <div class="absolute top-0 left-0 w-full z-50 pointer-events-none">
        <div class="pointer-events-auto">
          <TitleBar />
        </div>
      </div>

      <div class={`flex h-full w-full overflow-hidden transition-all duration-500 bg-transparent`}>
        <Show when={!props.isFocusMode}>
          <WorkspaceSidebar
            activeWorkspace={props.activeWorkspace}
            onWorkspaceChange={props.onWorkspaceChange}
          />
        </Show>

        <div class="flex-1 min-w-0 h-full">
          <WorkspaceTransitionStage activeWorkspace={props.activeWorkspace} paneIds={DESKTOP_WORKSPACE_IDS}>
            {(workspaceId) => {
              switch (workspaceId) {
                case 'chat':
                  return (
                    <>
                      <Show when={!props.isFocusMode}>
                        <div class="flex-none">
                          <SessionSidebar
                            sessions={props.sessions}
                            npcCharacters={props.npcCharacters}
                            selectedConversationId={props.selectedConversationId}
                            selectedConversationMembers={props.selectedConversationMembers}
                            loading={props.sessionsLoading}
                            roomActionLoading={props.roomActionLoading}
                            onSelect={props.onSelectConversation}
                            onNewChat={() => props.setActiveModal('new_chat')}
                            onJoinRoom={() => props.setActiveModal('join_room')}
                            onDeleteConversation={props.onDeleteConversation}
                            onOpenRoom={props.onOpenRoom}
                            onCloseRoom={props.onCloseRoom}
                          />
                        </div>
                      </Show>

                      <div class="flex-1 flex flex-col min-w-0 relative h-full bg-transparent">
                        <WorkspaceTransitionStage
                          activeWorkspace={props.selectedConversationId != null ? String(props.selectedConversationId) : 'empty'}
                          paneIds={['empty', ...props.sessions.map((s) => String(s.id))]}
                        >
                          {(sessionId) => {
                            const safeTitle = createMemo((prev: string | undefined) => {
                              const selectedId = props.selectedConversationId;
                              if (selectedId != null && sessionId === String(selectedId)) return props.selectedConversationTitle;
                              return prev || 'No conversation selected';
                            });
                            const safeMessages = createMemo((prev: typeof props.messages | undefined) => {
                              const selectedId = props.selectedConversationId;
                              if (selectedId != null && sessionId === String(selectedId)) return props.messages;
                              return prev || [];
                            });
                            const safeRoundState = createMemo((prev: typeof props.currentRoundState | undefined) => {
                              const selectedId = props.selectedConversationId;
                              if (selectedId != null && sessionId === String(selectedId)) return props.currentRoundState;
                              return prev;
                            });

                            return (
                              <div class="h-full w-full flex flex-col relative bg-transparent overflow-hidden">
                                <div class="px-8 pt-12 pb-2 text-xs text-mist-solid/35 uppercase tracking-widest flex items-center justify-between" data-workspace-title>
                                  <span>{safeTitle()}</span>
                                  <Show when={safeRoundState()}>
                                    <span>
                                      {safeRoundState()?.status} / waiting {safeRoundState()?.waitingMemberIds.length ?? 0}
                                    </span>
                                  </Show>
                                </div>
                                <div class="flex-1 overflow-hidden flex flex-col pt-2">
                                  <ChatArea messages={safeMessages()} conversationId={props.selectedConversationId ?? undefined} onRegenerate={props.isRoomClient ? () => {} : props.onRegenerate} onEdit={props.isRoomClient ? () => {} : props.onEdit} onFork={props.onFork} onDeleteMessage={props.onDeleteMessage} onRetryFailed={props.isRoomClient ? undefined : props.onRetryFailed} onRewind={props.isRoomClient ? undefined : props.onRewind} isRoomClient={props.isRoomClient} profile={props.profile} swipeInfo={props.swipeInfo} onSwitchSwipe={props.onSwitchSwipe} formatConfig={props.formatConfig} worldBookKeywords={props.worldBookKeywords} onChoiceSelect={(_key, value) => props.onSend(value)} onSchemaToggle={props.onSchemaToggle} structuredOutputDisplay={activePreset()?.structuredOutputDisplay} memoryErrors={props.memoryErrors} roomTokenUsageReport={props.roomTokenUsageReport} roomContextWindowSize={props.roomContextWindowSize} />
                                </div>
                                <div class="w-full shrink-0 px-6 pb-8 pt-2 bg-gradient-to-t from-xuanqing/40 via-xuanqing/20 to-transparent">
                                  <div class="max-w-4xl mx-auto">
                                    <ChatInputBar
                                      onSend={props.onSend}
                                      onAbort={props.onAbort}
                                      replyStatus={props.replyStatus}
                                      allowEmptySend={props.allowEmptySend}
                                      disabled={props.sending || !props.selectedConversationId}
                                      placeholder={props.selectedConversationId ? 'Type a message. Leave empty in room chats to skip this turn.' : 'Select or create a conversation first.'}
                                      isRoomClient={props.isRoomClient}
                                    />
                                  </div>
                                </div>
                              </div>
                            );
                          }}
                        </WorkspaceTransitionStage>
                      </div>

                      <div class="flex flex-col relative">
                        <button
                          onClick={props.toggleFocusMode}
                          class="fixed top-[45%] right-0 -translate-y-1/2 z-30 bg-black/40 hover:bg-black/60 text-mist-solid/60 hover:text-accent p-2 rounded-l-xl border-l border-y border-white/10 backdrop-blur-md transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                          title={props.isFocusMode ? 'Exit focus mode' : 'Enter focus mode'}
                          aria-label={props.isFocusMode ? 'Exit focus mode' : 'Enter focus mode'}
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
                          memoryMode={props.memoryMode ?? 'stateless'}
                          mem0SnapshotWindow={props.mem0SnapshotWindow}
                          onSnapshotWindowChange={props.onSnapshotWindowChange}
                          playerCharacters={props.playerCharacters}
                          currentPlayerCharacter={props.currentPlayerCharacter}
                          onSwitchPlayerCharacter={props.onSwitchPlayerCharacter}
                          providers={props.providers}
                          selectedProviderId={props.selectedProviderId ?? null}
                          selectedEmbeddingProviderId={props.selectedEmbeddingProviderId ?? null}
                          isRoomClient={props.isRoomClient}
                          hostPresetName={props.hostPresetName}
                          hostWorldBookName={props.hostWorldBookName}
                          hostProviderName={props.hostProviderName}
                          plotSummaries={props.plotSummaries}
                        />
                      </div>
                    </>
                  );
                case 'settings':
                  return (
                    <>
                      <div class="flex-none">
                        <SettingsSidebar
                          activeCategory={activeSettingCategory()}
                          onCategoryChange={setActiveSettingCategory}
                        />
                      </div>
                      <div class="flex-1 flex flex-col min-w-0 relative h-full bg-transparent">
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
                          mem0InitError={props.mem0InitError}
                        />
                      </div>
                    </>
                  );
                case 'character':
                  return (
                    <div class="flex-1 min-w-0 h-full bg-transparent">
                      <CharacterSidebar
                        npcCharacters={props.npcCharacters}
                        playerCharacters={props.playerCharacters}
                        worldBooks={props.worldBooks}
                        providers={props.providers}
                        loading={props.characterLoading}
                        onCreateCharacter={props.onCreateCharacter}
                        onUpdateCharacter={props.onUpdateCharacter}
                        onDeleteCharacter={props.onDeleteCharacter}
                        onImportExchange={props.onImportExchange}
                        onExportCharacter={props.onExportCharacter}
                      />
                    </div>
                  );
                case 'kb':
                  return (
                    <div class="flex-1 min-w-0 h-full bg-transparent">
                      <WorldBookSidebar
                        worldBooks={props.worldBooks}
                        activeEntries={props.activeWorldBookEntries}
                        entriesLoading={props.worldBookEntriesLoading}
                        onLoadEntries={props.onLoadWorldBookEntries}
                        onCreateWorldBook={props.onCreateWorldBook}
                        onUpdateWorldBook={props.onUpdateWorldBook}
                        onDeleteWorldBook={props.onDeleteWorldBook}
                        onImportExchange={props.onImportExchange}
                        onExportWorldBook={props.onExportWorldBook}
                        onUpsertEntry={props.onUpsertWorldBookEntry}
                        onDeleteEntry={props.onDeleteWorldBookEntry}
                      />
                    </div>
                  );
                case 'workspace':
                  return (
                    <div class="flex h-full w-full bg-transparent">
                      <Show
                        when={editingPresetId()}
                        fallback={
                          <div class="flex-1 flex flex-col min-w-0 h-full">
                            <div class="px-8 pt-12 pb-2 text-xs text-mist-solid/35 uppercase tracking-widest flex items-center justify-between" data-workspace-title>
                              <span>预设蓝图</span>
                              <span class="text-[10px] normal-case tracking-normal text-mist-solid/25">
                                选择一个预设以编辑其蓝图
                              </span>
                            </div>
                            <div class="flex-1 overflow-auto px-8 pb-8">
                              <Show
                                when={props.presetSummaries.length > 0}
                                fallback={
                                  <div class="flex items-center justify-center h-full text-sm text-mist-solid/30">
                                    暂无预设
                                  </div>
                                }
                              >
                                <div class="grid gap-3" style={{ "grid-template-columns": "repeat(auto-fill, minmax(280px, 1fr))" }}>
                                  <For each={props.presetSummaries}>
                                    {(preset) => (
                                      <button
                                        type="button"
                                        class="group text-left p-4 rounded-xl border border-white/5 bg-night-water/30 hover:bg-night-water/60 hover:border-white/15 transition-all"
                                        onClick={() => setEditingPresetId(preset.id)}
                                      >
                                        <div class="flex items-center gap-2">
                                          <div class="text-sm font-bold text-mist-solid truncate flex-1">
                                            {preset.name}
                                          </div>
                                          <Show when={preset.blueprintGraph}>
                                            <span class="text-[9px] uppercase tracking-widest text-emerald-300/70 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
                                              蓝图
                                            </span>
                                          </Show>
                                        </div>
                                        <Show when={preset.description}>
                                          <div class="mt-1 text-xs text-mist-solid/50 line-clamp-2">
                                            {preset.description}
                                          </div>
                                        </Show>
                                        <div class="mt-3 text-[10px] uppercase tracking-widest text-mist-solid/30 group-hover:text-mist-solid/60 transition-colors">
                                          点击编辑蓝图
                                        </div>
                                      </button>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          </div>
                        }
                      >
                        {(id) => (
                          <BlueprintEditor
                            presetId={id()}
                            onClose={() => setEditingPresetId(null)}
                          />
                        )}
                      </Show>
                    </div>
                  );
                default:
                  return null;
              }
            }}
          </WorkspaceTransitionStage>
        </div>
      </div>
    </div>
  );
};

function App() {
  const [activeWorkspace, setActiveWorkspace] = createSignal('chat');
  const [activeModal, setActiveModal] = createSignal<'new_chat' | 'join_room' | null>(null);
  const [isFocusMode, setIsFocusMode] = createSignal(false);
  const [sessionsLoading, setSessionsLoading] = createSignal(true);
  const [providersLoading, setProvidersLoading] = createSignal(true);
  const [characterLoading, setCharacterLoading] = createSignal(true);
  const [worldBookEntriesLoading, setWorldBookEntriesLoading] = createSignal(false);
  const [sending, setSending] = createSignal(false);
  const [roomActionLoading, setRoomActionLoading] = createSignal(false);
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
  const [_plotSummaries, setPlotSummaries] = createStore<PlotSummaryRecord[]>([]);
  const [enableDynamicEffects, setEnableDynamicEffects] = createSignal(true);
  const [formatConfig, setFormatConfig] = createSignal<MessageFormatConfig>(DEFAULT_FORMAT_CONFIG);
  const [roomClientSession, setRoomClientSession] = createSignal<RoomClientSession | null>(null);
  const [replyStatus, setReplyStatus] = createSignal<'idle' | 'connecting' | 'processing' | 'responding'>('idle');
  const [abortingRoundId, setAbortingRoundId] = createSignal<number | null>(null);
  const [mem0InitError, setMem0InitError] = createSignal<string | null>(null);
  const [memoryBackendErrors, setMemoryBackendErrors] = createStore<MemoryBackendErrorEvent[]>([]);
  const [conversationMode, setConversationMode] = createSignal<ConversationMode | null>(null);
  // Auto-retry toast: shown whenever the backend emits llm-stream-retry.
  // Holds { error, attemptCount } for a short period, then auto-clears.
  const [retryNotice, setRetryNotice] = createSignal<{ error: string; attemptCount: number; autoRetryEnabled: boolean; roundId: number } | null>(null);
  let retryNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  // Rewind confirmation dialog: holds the target message/round when the user
  // clicks "回溯到此轮". Null = dialog closed.
  const [rewindTarget, setRewindTarget] = createSignal<{ messageId: string; roundId: number } | null>(null);

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
  const remoteHostCharacter = createMemo(() => activeRoomClientSession()?.hostCharacter ?? null);
  const selectedCharacter = createMemo(() => {
    const remote = remoteHostCharacter();
    if (remote) return remote as unknown as CharacterCard;
    const hostCharacterId = selectedConversation()?.hostCharacterId;
    if (hostCharacterId == null) return null;
    return [...npcCharacters, ...playerCharacters].find((character) => character.id === hostCharacterId) ?? null;
  });
  const hostMember = createMemo(() => selectedConversationMembers.find((member) => member.memberRole === 'host') ?? null);
  const currentAiCharacter = createMemo(() => {
    const hostCharacterId = selectedConversation()?.hostCharacterId;
    if (hostCharacterId == null) return undefined;
    return npcCharacters.find((c) => c.id === hostCharacterId);
  });
  const currentPlayerCharacter = createMemo(() => {
    const roomSession = roomClientSession();
    if (roomSession?.memberId) {
      // 房客模式：优先用 session 中保存的 playerCharacterId
      const playerCharId = roomSession.playerCharacterId ?? selectedConversationMembers.find((m) => m.id === roomSession.memberId)?.playerCharacterId;
      if (!playerCharId) return undefined;
      return playerCharacters.find((c) => c.id === playerCharId);
    }
    // 房主/单人模式：用 hostMember
    const hm = hostMember();
    if (!hm?.playerCharacterId) return undefined;
    return playerCharacters.find((c) => c.id === hm.playerCharacterId);
  });
  const allowEmptySend = createMemo(() => activeRoomClientSession() !== null || selectedConversation()?.conversationType === 'online');
  const worldBookKeywords = createMemo(() => {
    return activeWorldBookEntries.flatMap((entry) => entry.keywords ?? []);
  });
  const visibleMessages = createMemo(() =>
    messages.filter((message) => message.sender !== 'ai' || message.isActiveInRound !== false)
  );

  const profile = createMemo<CapabilityProfile>(() => {
    const mode = conversationMode();
    return mode ? selectProfile(mode) : FALLBACK_PROFILE;
  });

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
    // 房客模式下不查询本地 DB（房客本地无该 conversation 记录），
    // 房客的消息/成员/轮次状态/剧情总结全部由 room:* 事件与 ContextSnapshot 填充。
    if (activeRoomClientSession()) {
      return;
    }
    try {
      const [messageList, members, roundState, summaryList, conversationList] = await Promise.all([
        messagesList(conversationId),
        conversationMembersList(conversationId),
        roundStateGet(conversationId),
        plotSummariesList(conversationId),
        conversationsList(),
      ]);

      setMessages(messageList.map((m) => toChatMessage(m, currentAiCharacter(), currentPlayerCharacter(), remoteHostCharacter())));
      setSelectedConversationMembers(members);
      setCurrentRoundState(roundState);
      setPlotSummaries(summaryList);

      const updatedConversation = conversationList.find((c) => c.id === conversationId);
      if (updatedConversation) {
        setSessions(produce((list) => {
          const idx = list.findIndex((s) => s.id === conversationId);
          if (idx !== -1) {
            list[idx] = updatedConversation;
          }
        }));
      }
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
    const remoteHost = remoteHostCharacter();
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
      senderName: remoteHost?.name || currentAiCharacter()?.name || 'AI',
      avatar: remoteHost?.imageBase64 ?? toAssetUrl(currentAiCharacter()?.imagePath),
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
    setRetryNotice(null);
    const conversationId = selectedConversationId();
    const providerId = selectedConversation()?.providerId;
    if (!conversationId) return;

    setSending(true);
    setReplyStatus('connecting');
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
          upsertUserMessage(toChatMessage(result.visibleUserMessage, currentAiCharacter(), currentPlayerCharacter(), remoteHostCharacter()));
        }
        if (result.assistantMessage) {
          upsertAssistantMessage({
            ...toChatMessage(result.assistantMessage, currentAiCharacter(), currentPlayerCharacter(), remoteHostCharacter()),
            isStreaming: true,
          });
          queueCharacterStateOverlay();
        } else {
          console.warn('[handleSend] chatSubmitInput returned no assistantMessage — auto_dispatched may be false, round=', result.round?.status);
        }
        setCurrentRoundState(result.round);
      } else if (providerId) {
        const result = await sendMessage(conversationId, providerId, content);
        if (result.visibleUserMessage) {
          upsertUserMessage(toChatMessage(result.visibleUserMessage, currentAiCharacter(), currentPlayerCharacter(), remoteHostCharacter()));
        }
        if (result.assistantMessage) {
          upsertAssistantMessage({
            ...toChatMessage(result.assistantMessage, currentAiCharacter(), currentPlayerCharacter(), remoteHostCharacter()),
            isStreaming: true,
          });
          queueCharacterStateOverlay();
        } else {
          console.warn('[handleSend] sendMessage returned no assistantMessage — auto_dispatched may be false, round=', result.round?.status);
        }
        setCurrentRoundState(result.round);
      } else {
        console.error('[handleSend] Cannot send: no provider bound and no host member found. conversationId=', conversationId);
        return;
      }
      await refreshSessions();
    } catch (err) {
      console.error('[handleSend] Error sending message:', err);
      setReplyStatus('idle');
      showToast(`发送消息失败：${toErrorMessage(err)}`, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleAbortReply = async () => {
    const conversationId = selectedConversationId();
    const memberId = hostMember()?.id;
    if (!conversationId || !memberId) return;
    const roundId = abortingRoundId();
    if (!roundId) {
      const streamingMsg = messages.find((m) => m.sender === 'ai' && m.isStreaming);
      if (streamingMsg?.roundId) {
        setAbortingRoundId(streamingMsg.roundId);
        try {
          await abortRoundStream(conversationId, memberId, streamingMsg.roundId);
          setReplyStatus('idle');
          setAbortingRoundId(null);
          setMessages(
            (m) => m.roundId === streamingMsg.roundId && m.sender === 'ai',
            (m) => ({ ...m, isStreaming: false }),
          );
        } catch (error) {
          console.error('[conversation-debug] frontend:abort_reply:error', {
            roundId: streamingMsg.roundId,
            error,
          });
          showToast(`中断回复失败：${toErrorMessage(error)}`, 'error');
        }
      }
      return;
    }

    try {
      await abortRoundStream(conversationId, memberId, roundId);
      setReplyStatus('idle');
      setAbortingRoundId(null);
      setMessages(
        (m) => m.roundId === roundId && m.sender === 'ai',
        (m) => ({ ...m, isStreaming: false }),
      );
    } catch (error) {
      console.error('[conversation-debug] frontend:abort_reply:error', {
        roundId,
        error,
      });
      showToast(`中断回复失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleRegenerate = async (id: string, roundId?: number) => {
    const conversationId = selectedConversationId();
    const providerId = selectedConversation()?.providerId;
    const memberId = hostMember()?.id;
    if (!conversationId || !roundId) return;

    const msg = messages.find(m => m.id === id);
    const backendId = msg?.backendId;

    try {
      const result = (providerId && backendId && memberId)
        ? await regenerateMessage(conversationId, memberId, providerId, backendId)
        : await chatRegenerateRound(conversationId, memberId!, roundId);

      upsertAssistantMessage({
        ...toChatMessage(result.assistantMessage, currentAiCharacter(), currentPlayerCharacter()),
        isStreaming: true,
      });
      setCurrentRoundState(result.round);
      setReplyStatus('connecting');
      setAbortingRoundId(roundId);
      queueCharacterStateOverlay();
      try {
        const refreshedMessages = await messagesList(conversationId);
        const mapped = refreshedMessages.map((m) => toChatMessage(m, currentAiCharacter(), currentPlayerCharacter()));
        if (result.round.status === 'streaming' || result.round.status === 'queued') {
          const activeAi = mapped.find((m) => m.sender === 'ai' && m.roundId === roundId && m.isActiveInRound !== false);
          if (activeAi) {
            activeAi.isStreaming = true;
          }
        }
        setMessages(mapped);
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
      setReplyStatus('idle');
      setAbortingRoundId(null);
      showToast(`重新回复失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleRetryFailed = async (_id: string, roundId?: number) => {
    const conversationId = selectedConversationId();
    const memberId = hostMember()?.id;
    if (!conversationId || !roundId || !memberId) return;

    try {
      const result = await retryFailedRound(conversationId, memberId, roundId);

      updateMessageContent(result.assistantMessage.id, () => ({
        content: '',
        isStreaming: true,
        error: undefined,
        structuredFields: undefined,
      }));

      setCurrentRoundState(result.round);
      setReplyStatus('connecting');
      setAbortingRoundId(roundId);
    } catch (error) {
      console.error('[handleRetryFailed] error:', error);
      showToast(`自动重试失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleRewind = (_id: string, roundId?: number) => {
    if (roundId == null) return;
    setRewindTarget({ messageId: _id, roundId });
  };

  const confirmRewind = async () => {
    const target = rewindTarget();
    const conversationId = selectedConversationId();
    const memberId = hostMember()?.id ?? activeRoomClientSession()?.memberId;
    if (!target || !conversationId || !memberId) {
      setRewindTarget(null);
      return;
    }

    try {
      await rewindToRound(conversationId, memberId, target.roundId);
      setRewindTarget(null);
      await refreshConversationContext(conversationId);
    } catch (error) {
      console.error('[confirmRewind] error:', error);
      showToast(`回溯失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleEditMessage = async (id: string, content: string) => {
    const conversationId = selectedConversationId();
    const backendId = messages.find(m => m.id === id)?.backendId;
    if (!conversationId || !backendId) return;
    try {
      const hm = hostMember();
      if (!hm) {
        throw new Error('未找到当前会话的宿主成员，无法编辑消息。');
      }
      await messagesUpdateContent(conversationId, hm.id, backendId, content);
      setMessages(
        (m) => m.id === id,
        'content',
        content
      );
    } catch (error) {
      console.error('[handleEditMessage] error:', error);
      showToast(`编辑消息失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleForkMessage = async (id: string) => {
    if (selectedConversation()?.conversationType === 'online') return;
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
      showToast(`创建会话分支失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleDeleteMessage = async (id: string) => {
    const conversationId = selectedConversationId();
    const memberId = hostMember()?.id;
    const msg = messages.find(m => m.id === id);
    const backendId = msg?.backendId;
    if (!conversationId || !memberId || !backendId) return;

    try {
      await messagesDelete(conversationId, memberId, backendId);

      if (msg?.sender === 'ai' && msg?.roundId != null) {
        setMessages((list) => list.filter((m) => m.roundId !== msg.roundId));
        if (msg.isStreaming) {
          setReplyStatus('idle');
          setAbortingRoundId(null);
        }
      } else {
        setMessages((list) => list.filter((m) => m.id !== id));
        if (msg?.sender === 'user') {
          const streamingAi = messages.find((m) => m.sender === 'ai' && m.isStreaming && m.roundId === msg.roundId);
          if (streamingAi) {
            setReplyStatus('idle');
            setAbortingRoundId(null);
            setMessages((list) => list.filter((m) => m.id !== streamingAi.id));
          }
        }
      }
    } catch (error) {
      console.error('[conversation-debug] frontend:delete_message:error', {
        messageId: id,
        backendId,
        error,
      });
      showToast(`删除消息失败：${toErrorMessage(error)}`, 'error');
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
    const conversationId = selectedConversationId();
    const memberId = hostMember()?.id;
    const msg = messages.find(m => m.id === messageId);
    if (!conversationId || !memberId || !msg || msg.roundId == null) return;
    const roundMessages = messages.filter(m => m.sender === 'ai' && m.roundId === msg.roundId);
    const currentIndex = roundMessages.findIndex(m => m.id === messageId);
    if (currentIndex < 0) return;

    const targetIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= roundMessages.length) return;

    const targetMsg = roundMessages[targetIndex];
    const targetBackendId = targetMsg.backendId;
    if (!targetBackendId) return;

    try {
      const result = await messagesSwitchSwipe(conversationId, memberId, msg.roundId, targetBackendId);
      upsertAssistantMessage(toChatMessage(result, currentAiCharacter(), currentPlayerCharacter(), remoteHostCharacter()));
    } catch (error) {
      console.error('[conversation-debug] frontend:swipe_switch:error', {
        messageId,
        roundId: msg.roundId,
        direction,
        targetBackendId,
        error,
      });
      showToast(`切换回复版本失败：${toErrorMessage(error)}`, 'error');
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
      // If this is a remote room session, leave the room instead of deleting
      const remote = roomClientSession();
      if (remote && remote.conversation.id === id) {
        await roomLeave();
        handleRoomLeft();
        return;
      }

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
      showToast(`删除会话失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleOpenRoom = async (conversationId: number) => {
    setRoomActionLoading(true);
    try {
      await roomOpen({ conversationId });
      await refreshSessions();
    } catch (error) {
      console.error('[room] frontend:open_room:error', {
        conversationId,
        error,
      });
      await refreshSessions();
      showToast(`开启房间失败：${toErrorMessage(error)}`, 'error');
    } finally {
      setRoomActionLoading(false);
    }
  };

  const handleCloseRoom = async (conversationId: number) => {
    setRoomActionLoading(true);
    try {
      await roomClose();
      await refreshSessions();
    } catch (error) {
      console.error('[room] frontend:close_room:error', {
        conversationId,
        error,
      });
      await refreshSessions();
      showToast(`关闭房间失败：${toErrorMessage(error)}`, 'error');
    } finally {
      setRoomActionLoading(false);
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

  const handleImportExchange = async (file: File) => {
    try {
      const payloadJson = await file.text();
      const report = await exchangeImport(payloadJson);
      await Promise.all([refreshCharacters(), refreshWorldBooks()]);
      showToast(
        `导入完成：角色 ${report.characters} 个、世界书 ${report.worldBooks} 本、条目 ${report.worldBookEntries} 条、头像 ${report.avatars} 张。`,
        'success',
      );
    } catch (error) {
      console.error('[exchange] frontend:import:error', { fileName: file.name, error });
      showToast(`导入失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleExportCharacter = async (character: CharacterCard) => {
    try {
      const json = await characterCardsExport(character.id);
      const fileName = `${sanitizeFileName(character.name, 'character')}.nvexchange.json`;
      downloadJsonFile(fileName, json);
    } catch (error) {
      console.error('[exchange] frontend:export_character:error', { id: character.id, error });
      showToast(`导出角色卡失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleExportWorldBook = async (book: WorldBookSummary) => {
    try {
      const json = await worldBooksExport(book.id);
      const fileName = `${sanitizeFileName(book.title, 'worldbook')}.nvexchange.json`;
      downloadJsonFile(fileName, json);
    } catch (error) {
      console.error('[exchange] frontend:export_world_book:error', { id: book.id, error });
      showToast(`导出世界书失败：${toErrorMessage(error)}`, 'error');
    }
  };

  const handleSaveConversationBindings = async (payload: {
    presetId?: number;
    worldBookId?: number;
    providerId?: number;
    embeddingProviderId?: number | null;
  }) => {
    const conversationId = selectedConversationId();
    if (conversationId == null) {
      throw new Error('当前未选择会话，无法保存绑定。');
    }
    await conversationsUpdateBindings({
      conversationId,
      presetId: payload.presetId,
      worldBookId: payload.worldBookId,
      providerId: payload.providerId,
      embeddingProviderId: payload.embeddingProviderId,
    });
    await refreshSessions();
    await refreshConversationContext(conversationId);
  };

  const handleSwitchPlayerCharacter = async (playerCharacterId: number) => {
    const conversationId = selectedConversationId();
    if (conversationId == null) {
      throw new Error('当前未选择会话，无法切换玩家角色卡。');
    }

    const roomSession = activeRoomClientSession();
    if (roomSession) {
      const character = playerCharacters.find((c) => c.id === playerCharacterId);
      if (!character) {
        throw new Error(`未找到玩家角色卡（id=${playerCharacterId}），无法切换。`);
      }
      await roomUpdateGuestCharacter({
        conversationId,
        memberId: roomSession.memberId,
        character: {
          name: character.name,
          description: character.description,
          tags: character.tags,
          baseSections: character.baseSections.map((s) => ({
            sectionKey: s.sectionKey,
            title: s.title,
            content: s.content,
          })),
        },
      });
      return;
    }

    const hm = hostMember();
    if (!hm) {
      throw new Error('当前未选择会话或未找到宿主成员，无法切换玩家角色卡。');
    }
    await conversationMembersUpdate({
      memberId: hm.id,
      playerCharacterId,
    });
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
    triggerMode: 'any' | 'all' | 'always';
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

  const handleSnapshotWindowChange = async (window: number) => {
    const conversationId = selectedConversationId();
    if (conversationId == null) return;
    await mem0SnapshotWindowSet(conversationId, window);
    await refreshSessions();
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
    connection: { hostAddress: string; port: number; displayName: string; selectedCharacterId?: number },
  ) => {
    if (!result.conversation || result.memberId == null) {
      console.error('[room-join] missing room session metadata', result);
      return;
    }

    const hostCharacter: RoomHostCharacter | null =
      result.hostCharacterImageBase64 || result.hostCharacterName
        ? {
            name: result.hostCharacterName ?? '',
            description: result.hostCharacterDescription ?? '',
            imagePath: null,
            imageBase64: result.hostCharacterImageBase64 ?? null,
            baseSections: result.hostBaseSections
              ? (() => {
                  try {
                    const parsed = JSON.parse(result.hostBaseSections);
                    return Array.isArray(parsed) ? (parsed as CharacterBaseSection[]) : null;
                  } catch {
                    return null;
                  }
                })()
              : null,
            presetName: result.hostPresetName ?? null,
            worldBookName: result.hostWorldBookName ?? null,
            providerName: result.hostProviderName ?? null,
          }
        : null;

    setRoomClientSession({
      roomId: result.roomId,
      conversation: result.conversation,
      memberId: result.memberId,
      displayName: connection.displayName,
      hostAddress: connection.hostAddress,
      port: connection.port,
      hostCharacter,
      contextWindowSize: result.contextWindowSize,
      tokenUsageReport: result.tokenUsageReport,
      plotSummaries: result.plotSummaries ?? [],
      playerCharacterId: connection.selectedCharacterId,
    });
    setPlotSummaries(result.plotSummaries ?? []);
    if (result.schemaToggleState) {
      clearSchemaToggleState();
      setAllSchemaToggleState(result.schemaToggleState);
    }
    console.debug('[room-joined]', {
      conversationId: result.conversation.id,
      memberId: result.memberId,
      messageCount: result.fullMessages?.length ?? result.recentMessages?.length ?? 0,
      memberCount: result.members?.length ?? 0,
      hasHostCharacter: !!(result.hostCharacterImageBase64 || result.hostCharacterName),
      contextWindowSize: result.contextWindowSize,
      totalEstimatedTokens: result.tokenUsageReport?.totalEstimatedTokens,
    });
    setActiveWorkspace('chat');
    setSelectedConversationId(result.conversation.id);
    setSelectedConversationMembers(result.members ?? []);
    if (connection.selectedCharacterId != null) {
      setSelectedConversationMembers(produce((members) => {
        const ownMember = members.find((m) => m.id === result.memberId);
        if (ownMember) {
          ownMember.playerCharacterId = connection.selectedCharacterId;
        }
      }));
    }
    setMessages((result.fullMessages ?? result.recentMessages ?? []).map((m) => toChatMessage(m, currentAiCharacter(), currentPlayerCharacter(), remoteHostCharacter())));
    setCurrentRoundState(result.roundState ?? null);
    setActiveModal(null);
    // 主动拉取全量上下文（兜底处理 MemberJoined 广播失败的情况）
    void roomRequestContext();
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

    // Check mem0 init status at startup and surface any error to the UI.
    try {
      const initStatus = await mem0InitStatus();
      if (initStatus.error) {
        setMem0InitError(initStatus.error);
      }
    } catch (err) {
      console.error('[mem0] failed to query init status:', err);
    }

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

      // Stream lifecycle broadcasts (text_delta / message_stop / structured field
      // deltas) are emitted by the backend directly via host_server.broadcast_message,
      // so the host frontend only updates local UI here. Guests receive room:stream_*
      // events via the dedicated listeners below.

      switch (payload.eventKind) {
        case 'text_delta': {
          const delta = payload.textDelta ?? '';
          upsertStreamingAssistant(payload.messageId, payload.roundId);
          updateMessageContent(payload.messageId, (message) => ({
            content: `${message.content}${delta}`,
            isStreaming: true,
          }));
          setReplyStatus('responding');
          setAbortingRoundId(payload.roundId);
          break;
        }
        case 'string_field_delta': {
          const delta = payload.textDelta ?? '';
          const fieldKey = payload.partType ?? '';
          if (!delta || !fieldKey) break;
          const normalizedDelta = delta.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
          upsertStreamingAssistant(payload.messageId, payload.roundId);
          updateMessageContent(payload.messageId, (message) => {
            const existing = message.structuredFields ?? {};
            const field = existing[fieldKey] ?? '';
            return {
              structuredFields: { ...existing, [fieldKey]: field + normalizedDelta },
              isStreaming: true,
            } as any;
          });
          setReplyStatus('responding');
          setAbortingRoundId(payload.roundId);
          break;
        }
        case 'object_field_complete': {
          const fieldKey = payload.partType ?? '';
          const jsonStr = payload.jsonDelta ?? '';
          if (!fieldKey || !jsonStr) break;
          upsertStreamingAssistant(payload.messageId, payload.roundId);
          updateMessageContent(payload.messageId, (message) => {
            const existing = message.structuredFields ?? {};
            return {
              structuredFields: { ...existing, [fieldKey]: jsonStr },
              isStreaming: true,
            } as any;
          });
          setReplyStatus('responding');
          setAbortingRoundId(payload.roundId);
          break;
        }
        case 'message_stop': {
          upsertStreamingAssistant(payload.messageId, payload.roundId);
          updateMessageContent(payload.messageId, () => ({
            isStreaming: false,
          }));
          setReplyStatus('idle');
          setAbortingRoundId(null);
          setRetryNotice(null);
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
      console.error('[llm-stream-error]', payload.error, 'messageId=', payload.messageId, 'roundId=', payload.roundId);
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      updateMessageContent(payload.messageId, () => ({
        isStreaming: false,
        error: payload.error,
      }));
      setReplyStatus('idle');
      setAbortingRoundId(null);
      setRetryNotice(null);
    });

    const retryUnlisten = await listenStreamRetry((payload) => {
      if (payload.conversationId !== selectedConversationId()) return;
      console.warn('[llm-stream-retry] retry event:', payload.error, 'messageId=', payload.messageId, 'roundId=', payload.roundId, 'attemptCount=', payload.attemptCount, 'autoRetryEnabled=', payload.autoRetryEnabled);
      setRetryNotice({ error: payload.error, attemptCount: payload.attemptCount, autoRetryEnabled: payload.autoRetryEnabled, roundId: payload.roundId });
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      if (payload.autoRetryEnabled) {
        // 自动重试中：保持流式状态
        updateMessageContent(payload.messageId, () => ({
          content: '',
          isStreaming: true,
          error: undefined,
          structuredFields: undefined,
        }));
        setReplyStatus('connecting');
        setAbortingRoundId(payload.roundId);
      } else {
        // 首次失败：停止流式状态，等待用户操作
        updateMessageContent(payload.messageId, () => ({
          content: '',
          isStreaming: false,
          error: payload.error,
          structuredFields: undefined,
        }));
        setReplyStatus('idle');
        setAbortingRoundId(null);
      }
    });

    const messageResetUnlisten = await listenMessageReset((payload) => {
      if (payload.conversationId !== selectedConversationId()) return;
      updateMessageContent(payload.messageId, () => ({
        content: '',
        isStreaming: true,
        error: undefined,
        structuredFields: undefined,
      }));
      setReplyStatus('connecting');
      setAbortingRoundId(payload.roundId);
    });

    const roundUnlisten = await listenRoundState((payload) => {
      if (payload.round.conversationId !== selectedConversationId()) return;
      setCurrentRoundState(payload.round);
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
      console.debug('[room-stream_chunk] received', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        deltaLength: payload.delta?.length ?? 0,
      });
      if (payload.conversationId !== selectedConversationId()) return;
      // Host already receives stream data via llm-stream-event; skip to avoid duplicates
      if (!activeRoomClientSession()) return;
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      updateMessageContent(payload.messageId, (message) => ({
        content: `${message.content}${payload.delta}`,
        isStreaming: !payload.done,
      }));
    });

    const roomStreamEndUnlisten = await listenRoomStreamEnd((payload: RoomStreamEndEvent) => {
      console.debug('[room-stream_end] received', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        roundId: payload.roundId,
      });
      if (payload.conversationId !== selectedConversationId()) return;
      // Host already receives stream end via llm-stream-event; skip to avoid duplicates
      if (!activeRoomClientSession()) return;
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      updateMessageContent(payload.messageId, () => ({
        isStreaming: false,
      }));
      setReplyStatus('idle');
      setAbortingRoundId(null);
      setRetryNotice(null);
    });

    const roomStructuredDeltaUnlisten = await listenRoomStreamStructuredFieldDelta((payload: RoomStreamStructuredFieldDeltaEvent) => {
      if (payload.conversationId !== selectedConversationId()) return;
      // Host already receives structured deltas via llm-stream-event; skip to avoid duplicates
      if (!activeRoomClientSession()) return;
      const delta = payload.delta ?? '';
      const fieldKey = payload.fieldKey ?? '';
      if (!delta || !fieldKey) return;
      const normalizedDelta = delta.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      updateMessageContent(payload.messageId, (message) => {
        const existing = message.structuredFields ?? {};
        const field = existing[fieldKey] ?? '';
        return {
          structuredFields: { ...existing, [fieldKey]: field + normalizedDelta },
          isStreaming: true,
        } as any;
      });
      setReplyStatus('responding');
      setAbortingRoundId(payload.roundId);
    });

    const roomObjectCompleteUnlisten = await listenRoomStreamObjectFieldComplete((payload: RoomStreamObjectFieldCompleteEvent) => {
      if (payload.conversationId !== selectedConversationId()) return;
      if (!activeRoomClientSession()) return;
      const fieldKey = payload.fieldKey ?? '';
      const jsonStr = payload.json ?? '';
      if (!fieldKey || !jsonStr) return;
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      updateMessageContent(payload.messageId, (message) => {
        const existing = message.structuredFields ?? {};
        return {
          structuredFields: { ...existing, [fieldKey]: jsonStr },
          isStreaming: true,
        } as any;
      });
      setReplyStatus('responding');
      setAbortingRoundId(payload.roundId);
    });

    const roomStreamRetryUnlisten = await listenRoomStreamRetry((payload: RoomStreamRetryEvent) => {
      console.debug('[room-stream_retry] received', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        roundId: payload.roundId,
        autoRetryEnabled: payload.autoRetryEnabled,
      });
      if (payload.conversationId !== selectedConversationId()) return;
      // Host already receives retry via llm-stream-retry; skip to avoid duplicates
      if (!activeRoomClientSession()) return;
      setRetryNotice({ error: payload.error, attemptCount: payload.attemptCount, autoRetryEnabled: payload.autoRetryEnabled, roundId: payload.roundId });
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      if (payload.autoRetryEnabled) {
        updateMessageContent(payload.messageId, () => ({
          content: '',
          isStreaming: true,
        }));
        setReplyStatus('connecting');
        setAbortingRoundId(payload.roundId);
      } else {
        updateMessageContent(payload.messageId, () => ({
          content: '',
          isStreaming: false,
        }));
        setReplyStatus('idle');
        setAbortingRoundId(null);
      }
    });

    const roomMessageResetUnlisten = await listenRoomMessageReset((payload: RoomMessageResetEvent) => {
      console.debug('[room-message_reset] received', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        roundId: payload.roundId,
      });
      if (payload.conversationId !== selectedConversationId()) return;
      // Host already receives reset via llm-stream-event message_reset; skip to avoid duplicates
      if (!activeRoomClientSession()) return;
      upsertStreamingAssistant(payload.messageId, payload.roundId);
      updateMessageContent(payload.messageId, () => ({
        content: '',
        isStreaming: true,
      }));
      setReplyStatus('connecting');
      setAbortingRoundId(payload.roundId);
    });

    const roomContextSnapshotUnlisten = await listenRoomContextSnapshot((payload: RoomContextSnapshotEvent) => {
      console.debug('[room-context_snapshot] received', {
        conversationId: payload.conversationId,
        messageCount: payload.messages?.length ?? 0,
        memberCount: payload.members?.length ?? 0,
        hasHostCharacter: !!(payload.hostCharacterImageBase64 || payload.hostCharacterName),
      });
      if (payload.conversationId !== selectedConversationId()) return;
      // Host already has the data; skip to avoid duplicates
      if (!activeRoomClientSession()) return;
      console.debug('[room-context_snapshot] before update: messages.length=', messages.length, 'members.length=', selectedConversationMembers.length, 'roundState.status=', currentRoundState()?.status);
      setMessages(payload.messages.map((m) => toChatMessage(m, currentAiCharacter(), currentPlayerCharacter(), remoteHostCharacter())));
      setSelectedConversationMembers(payload.members ?? []);
      setCurrentRoundState(payload.roundState ?? null);
      if (payload.schemaToggleState) {
        setAllSchemaToggleState(payload.schemaToggleState);
      }
      // 同时更新 remoteHostCharacter（如果房主后发来了带图片的 ContextSnapshot）
      if (payload.hostCharacterImageBase64 || payload.hostCharacterName || payload.tokenUsageReport || payload.contextWindowSize != null || payload.hostBaseSections || payload.hostPresetName || payload.hostWorldBookName || payload.hostProviderName || payload.plotSummaries) {
        const remote = activeRoomClientSession();
        if (remote) {
          const nextSession: RoomClientSession = { ...remote };
          if (payload.hostCharacterImageBase64 || payload.hostCharacterName || payload.hostBaseSections || payload.hostPresetName || payload.hostWorldBookName || payload.hostProviderName) {
            const prevChar = remote.hostCharacter ?? {
              name: '',
              description: '',
              imagePath: null,
              imageBase64: null,
            };
            nextSession.hostCharacter = {
              ...prevChar,
              name: payload.hostCharacterName ?? prevChar.name,
              description: payload.hostCharacterDescription ?? prevChar.description,
              imageBase64: payload.hostCharacterImageBase64 ?? prevChar.imageBase64 ?? null,
              baseSections: payload.hostBaseSections
                ? (() => {
                    try {
                      const parsed = JSON.parse(payload.hostBaseSections);
                      return Array.isArray(parsed) ? (parsed as CharacterBaseSection[]) : prevChar.baseSections ?? null;
                    } catch {
                      return prevChar.baseSections ?? null;
                    }
                  })()
                : prevChar.baseSections ?? null,
              presetName: payload.hostPresetName ?? prevChar.presetName ?? null,
              worldBookName: payload.hostWorldBookName ?? prevChar.worldBookName ?? null,
              providerName: payload.hostProviderName ?? prevChar.providerName ?? null,
            };
          }
          if (payload.tokenUsageReport) {
            nextSession.tokenUsageReport = payload.tokenUsageReport;
          }
          if (payload.contextWindowSize != null) {
            nextSession.contextWindowSize = payload.contextWindowSize;
          }
          if (payload.plotSummaries) {
            nextSession.plotSummaries = payload.plotSummaries;
            setPlotSummaries(payload.plotSummaries);
          }
          setRoomClientSession(nextSession);
        }
      }
    });

    const roomSchemaToggleUnlisten = await listenRoomSchemaToggle((payload: RoomSchemaToggleEvent) => {
      console.debug('[room-schema_toggle] received', {
        conversationId: payload.conversationId,
        toggleKey: payload.toggleKey,
        expanded: payload.expanded,
      });
      setSchemaToggleState(payload.toggleKey, payload.expanded);
    });

    const roomTokenUsageUnlisten = await listenRoomTokenUsage((payload: RoomTokenUsageEvent) => {
      const remote = activeRoomClientSession();
      if (!remote) return;
      if (payload.tokenUsageReport == null) {
        // null 时保持旧 tokenUsageReport
        return;
      }
      const reportContextWindow = payload.tokenUsageReport.contextWindowSize ?? null;
      const nextContextWindow = reportContextWindow != null ? reportContextWindow : remote.contextWindowSize;
      setRoomClientSession({
        ...remote,
        contextWindowSize: nextContextWindow,
        tokenUsageReport: payload.tokenUsageReport,
      });
    });

    const roomPlotSummaryUnlisten = await listenRoomPlotSummaryUpdate((payload: RoomPlotSummaryUpdateEvent) => {
      console.debug('[room-plot_summary_update] received', {
        conversationId: payload.conversationId,
        summaryCount: payload.summaries?.length ?? 0,
      });
      setPlotSummaries(payload.summaries ?? []);
      const remote = activeRoomClientSession();
      if (remote && remote.conversation.id === payload.conversationId) {
        setRoomClientSession({ ...remote, plotSummaries: payload.summaries ?? [] });
      }
    });

    const roomRoundStateUnlisten = await listenRoomRoundStateUpdate((payload: RoomRoundStateUpdateEvent) => {
      console.debug('[room-round_state_update] received', {
        conversationId: payload.roundState.conversationId,
        status: payload.roundState.status,
      });
      if (payload.roundState.conversationId !== selectedConversationId()) return;
      console.debug('[room-round_state_update] before update: roundState.status=', currentRoundState()?.status);
      setCurrentRoundState(payload.roundState);
    });

    const roomPlayerMessageUnlisten = await listenRoomPlayerMessage((payload: RoomPlayerMessageEvent) => {
      console.debug('[room-player_message] received', {
        conversationId: payload.conversationId,
        memberId: payload.memberId,
        messageId: payload.messageId,
        actionType: payload.actionType,
      });
      const conversationId = payload.conversationId ?? selectedConversationId();
      if (conversationId !== selectedConversationId()) return;
      if (payload.actionType === 'skipped') return;

      // On the host side, skip the host's own messages (already displayed via chatSubmitInput result).
      // Other players' messages forwarded by the server must still be shown.
      const host = hostMember();
      if (!activeRoomClientSession() && host && payload.memberId === host.id) return;

      console.debug('[room-player_message] before upsert: messages.length=', messages.length);
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
      console.error('[room-error]', msg);
      console.debug('[room-error] payload', payload);
    });

    const roomDisconnectedUnlisten = await listenRoomDisconnected(() => {
      console.debug('[room-disconnected] received, before clear: roomClientSession.conversation.id=', roomClientSession()?.conversation?.id);
      setRoomClientSession(null);
      setSelectedConversationMembers([]);
      setCurrentRoundState(null);
      setMessages([]);
      clearSchemaToggleState();
      console.debug('[room-disconnected] cleared signals: messages, members, roundState, schemaToggleState');
    });

    // Refresh member list when a remote member joins or leaves the room
    const roomMemberJoinedUnlisten = await listenRoomMemberJoined((payload) => {
      console.debug('[room-member_joined] received', {
        memberId: payload.memberId,
        displayName: payload.displayName,
      });
      const remote = activeRoomClientSession();
      if (remote) {
        console.debug('[room-member_joined] before update: members.length=', selectedConversationMembers.length, 'roomClientSession.conversation.id=', remote.conversation.id);
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
      console.debug('[room-member_left] received', {
        memberId: payload.memberId,
      });
      const remote = activeRoomClientSession();
      if (remote) {
        console.debug('[room-member_left] before update: members.length=', selectedConversationMembers.length, 'roomClientSession.conversation.id=', remote.conversation.id);
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

    const memoryErrorUnlisten = await listenMemoryError((payload) => {
      console.error('[llm-memory-error]', payload.operation, payload.strategy, payload.error, 'conv=', payload.conversationId, 'round=', payload.roundId);
      setMemoryBackendErrors(produce((errs) => { errs.push(payload); }));
    });

    const roomMessageEditedUnlisten = await listenRoomMessageEdited((payload: RoomMessageEditedEvent) => {
      console.debug('[room-message_edited] received', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        contentLength: payload.content?.length ?? 0,
      });
      if (payload.conversationId !== selectedConversationId()) return;
      if (!activeRoomClientSession()) return;
      updateMessageContent(payload.messageId, () => ({
        content: payload.content,
        structuredFields: undefined,
        isStreaming: false,
      }));
    });

    const roomMessageDeletedUnlisten = await listenRoomMessageDeleted((payload: RoomMessageDeletedEvent) => {
      console.debug('[room-message_deleted] received', {
        conversationId: payload.conversationId,
        messageId: payload.messageId,
        roundDeleted: payload.roundDeleted,
      });
      if (payload.conversationId !== selectedConversationId()) return;
      if (!activeRoomClientSession()) return;
      if (payload.roundDeleted) {
        const target = messages.find((m) => m.backendId === payload.messageId);
        const roundId = target?.roundId;
        setMessages((list) =>
          roundId != null
            ? list.filter((m) => m.roundId !== roundId)
            : list.filter((m) => m.backendId !== payload.messageId),
        );
      } else {
        setMessages((list) => list.filter((m) => m.backendId !== payload.messageId));
      }
    });

    const roomRewoundToRoundUnlisten = await listenRoomRewoundToRound((payload: RoomRewoundToRoundEvent) => {
      console.debug('[room-rewound_to_round] received', {
        conversationId: payload.conversationId,
        targetRoundId: payload.targetRoundId,
      });
      if (payload.conversationId !== selectedConversationId()) return;
      if (!activeRoomClientSession()) return;
      setMessages((list) => list.filter((m) => m.roundId == null || m.roundId <= payload.targetRoundId));
      const current = currentRoundState();
      if (current && current.roundId > payload.targetRoundId) {
        setCurrentRoundState(null);
      }
    });

    const roomContextWindowChangedUnlisten = await listenRoomContextWindowChanged((payload: RoomContextWindowChangedEvent) => {
      console.debug('[room-context_window_changed] received', {
        conversationId: payload.conversationId,
        contextWindowSize: payload.contextWindowSize,
      });
      if (payload.conversationId !== selectedConversationId()) return;
      const remote = activeRoomClientSession();
      if (!remote) return;
      setRoomClientSession({
        ...remote,
        contextWindowSize: payload.contextWindowSize,
      });
    });

    const roomGuestCharacterUpdatedUnlisten = await listenRoomGuestCharacterUpdated((payload: RoomGuestCharacterUpdatedEvent) => {
      console.debug('[room-guest_character_updated] received', {
        conversationId: payload.conversationId,
        memberId: payload.memberId,
        characterName: payload.character?.name,
      });
      if (payload.conversationId !== selectedConversationId()) return;
      const characterJson = JSON.stringify(payload.character);
      setSelectedConversationMembers(produce((members) => {
        const member = members.find((m) => m.id === payload.memberId);
        if (member) {
          member.guestCharacterJson = characterJson;
        }
      }));
    });

    const roomSwipeActivatedUnlisten = await listenRoomSwipeActivated((payload: RoomSwipeActivatedEvent) => {
      const remote = activeRoomClientSession();
      if (!remote) return;
      setMessages(produce((list) => {
        for (const message of list) {
          if (message.roundId !== payload.roundId) continue;
          if (message.backendId === payload.messageId) {
            message.isActiveInRound = true;
          } else if (message.isActiveInRound) {
            message.isActiveInRound = false;
          }
        }
      }));
    });

    onCleanup(() => {
      chunkUnlisten();
      errorUnlisten();
      retryUnlisten();
      messageResetUnlisten();
      roundUnlisten();
      plotSummaryUpdatedUnlisten();
      plotSummaryErrorUnlisten();
      plotSummaryPendingUnlisten();
      roomChunkUnlisten();
      roomStreamEndUnlisten();
      roomStructuredDeltaUnlisten();
      roomObjectCompleteUnlisten();
      roomStreamRetryUnlisten();
      roomMessageResetUnlisten();
      roomContextSnapshotUnlisten();
      roomSchemaToggleUnlisten();
      roomTokenUsageUnlisten();
      roomPlotSummaryUnlisten();
      roomRoundStateUnlisten();
      roomPlayerMessageUnlisten();
      if (retryNoticeTimer) clearTimeout(retryNoticeTimer);
      roomErrorUnlisten();
      roomDisconnectedUnlisten();
      roomMemberJoinedUnlisten();
      roomMemberLeftUnlisten();
      roomMessageEditedUnlisten();
      roomMessageDeletedUnlisten();
      roomRewoundToRoundUnlisten();
      roomContextWindowChangedUnlisten();
      roomGuestCharacterUpdatedUnlisten();
      roomSwipeActivatedUnlisten();
      memoryErrorUnlisten();
    });
  });

  createEffect(() => {
    setRetryNotice(null);
    const conversationId = selectedConversationId();
    setCharacterStateOverlaySummary(null);
    setCharacterStateOverlayStatus(null);
    setCharacterStateOverlayError(null);
    setPlotSummaries([]);
    if (conversationId == null) return;
    if (activeRoomClientSession()) return;
    void refreshConversationContext(conversationId);
  });

  createEffect(() => {
    const conversationId = selectedConversationId();
    if (conversationId == null) {
      setConversationMode(null);
      return;
    }
    const roomSession = activeRoomClientSession();
    const memberId = roomSession?.memberId ?? hostMember()?.id;
    if (memberId == null) {
      setConversationMode(null);
      return;
    }
    void getConversationMode(conversationId, memberId)
      .then(setConversationMode)
      .catch((err) => {
        console.error('[conversation-mode] resolve failed:', err);
        setConversationMode(null);
      });
  });

  return (
    <>
      <AuroraBackground
        isActive={activeWorkspace() === 'chat' && selectedConversationId() !== null}
        characterImageUrl={
          activeRoomClientSession()?.hostCharacter?.imageBase64
          ?? toAssetUrl(selectedCharacter()?.imagePath)
        }
        enableAurora={enableDynamicEffects()}
      />
      <Show when={retryNotice()}>
        {(notice) => (
          <div
            style={{
              position: 'fixed',
              'top': '80px',
              'right': '24px',
              'z-index': 9999,
              'max-width': '360px',
              padding: '12px 16px',
              'background': 'rgba(30, 30, 40, 0.95)',
              'border-radius': '12px',
              'font-size': '13px',
              color: '#fff',
              'line-height': '1.5',
              'box-shadow': '0 8px 32px rgba(0, 0, 0, 0.45)',
              border: '1px solid rgba(255, 120, 120, 0.5)',
              display: 'flex',
              'flex-direction': 'column',
              gap: '8px',
            }}
          >
            <div style={{ 'font-weight': 600, color: '#ff9a9a' }}>
              {notice().autoRetryEnabled
                ? `自动重试中 · 第 ${notice().attemptCount} 次尝试`
                : `发送失败 · 第 ${notice().attemptCount} 次尝试`}
            </div>
            <div style={{ opacity: 0.85, 'word-break': 'break-word' }}>
              失败原因:{notice().error}
            </div>
            <Show when={!activeRoomClientSession()}>
              <div style={{ display: 'flex', gap: '8px' }}>
                <Show when={!notice().autoRetryEnabled}>
                  <button
                    onClick={() => void handleRetryFailed('', notice().roundId)}
                    style={{
                      padding: '4px 12px',
                      'font-size': '12px',
                      'border-radius': '6px',
                      border: '1px solid rgba(255, 120, 120, 0.5)',
                      background: 'rgba(255, 120, 120, 0.2)',
                      color: '#ff9a9a',
                      cursor: 'pointer',
                    }}
                  >
                    自动重试
                  </button>
                </Show>
                <Show when={notice().autoRetryEnabled}>
                  <button
                    onClick={() => void handleAbortReply()}
                    style={{
                      padding: '4px 12px',
                      'font-size': '12px',
                      'border-radius': '6px',
                      border: '1px solid rgba(255, 255, 255, 0.3)',
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: '#fff',
                      cursor: 'pointer',
                    }}
                  >
                    停止
                  </button>
                </Show>
              </div>
            </Show>
          </div>
        )}
      </Show>
      <AnimatedDesktopView
        messages={visibleMessages()}
        activeWorkspace={activeWorkspace()}
        onWorkspaceChange={setActiveWorkspace}
        onRegenerate={handleRegenerate}
        onEdit={handleEditMessage}
        onFork={handleForkMessage}
        onDeleteMessage={handleDeleteMessage}
        onRetryFailed={handleRetryFailed}
        onRewind={handleRewind}
        swipeInfo={getSwipeInfo}
        onSwitchSwipe={handleSwitchSwipe}
        onSend={handleSend}
        onAbort={handleAbortReply}
        replyStatus={replyStatus()}
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
        onOpenRoom={handleOpenRoom}
        onCloseRoom={handleCloseRoom}
        roomActionLoading={roomActionLoading()}
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
        onImportExchange={handleImportExchange}
        onExportCharacter={handleExportCharacter}
        selectedCharacter={selectedCharacter()}
        selectedPresetId={selectedConversation()?.presetId ?? null}
        selectedWorldBookId={selectedConversation()?.worldBookId ?? null}
        selectedProviderId={selectedConversation()?.providerId ?? null}
        selectedEmbeddingProviderId={selectedConversation()?.embeddingProviderId ?? null}
        presetSummaries={presetSummaries}
        characterStateOverlaySummary={characterStateOverlaySummary()}
        characterStateOverlayStatus={characterStateOverlayStatus()}
        characterStateOverlayError={characterStateOverlayError()}
        memoryMode={selectedConversation()?.memoryMode ?? 'stateless'}
        mem0SnapshotWindow={selectedConversation()?.mem0SnapshotWindow}
        onSnapshotWindowChange={handleSnapshotWindowChange}
        onSaveConversationBindings={handleSaveConversationBindings}
        currentPlayerCharacter={currentPlayerCharacter()}
        onSwitchPlayerCharacter={handleSwitchPlayerCharacter}
        worldBooks={worldBooks}
        activeWorldBookEntries={activeWorldBookEntries}
        worldBookEntriesLoading={worldBookEntriesLoading()}
        onLoadWorldBookEntries={loadWorldBookEntries}
        onCreateWorldBook={handleCreateWorldBook}
        onUpdateWorldBook={handleUpdateWorldBook}
        onDeleteWorldBook={handleDeleteWorldBook}
        onExportWorldBook={handleExportWorldBook}
        onUpsertWorldBookEntry={handleUpsertWorldBookEntry}
        onDeleteWorldBookEntry={handleDeleteWorldBookEntry}
        enableDynamicEffects={enableDynamicEffects()}
        onSetEnableDynamicEffects={handleSetEnableDynamicEffects}
        formatConfig={formatConfig()}
        worldBookKeywords={worldBookKeywords()}
        onSetFormatConfig={handleSetFormatConfig}
        isRoomClient={activeRoomClientSession() !== null}
        profile={profile()}
        onSchemaToggle={(toggleKey, expanded) => {
          if (activeRoomClientSession() !== null) return;
          if (selectedConversation()?.conversationType !== 'online') return;
          void roomBroadcastSchemaToggle(toggleKey, expanded);
        }}
        onPresetsChanged={refreshPresets}
        mem0InitError={mem0InitError()}
        memoryErrors={memoryBackendErrors}
        roomTokenUsageReport={activeRoomClientSession()?.tokenUsageReport ?? null}
        roomContextWindowSize={activeRoomClientSession()?.contextWindowSize ?? null}
        hostPresetName={remoteHostCharacter()?.presetName ?? null}
        hostWorldBookName={remoteHostCharacter()?.worldBookName ?? null}
        hostProviderName={remoteHostCharacter()?.providerName ?? null}
        plotSummaries={activeRoomClientSession()?.plotSummaries ?? _plotSummaries}
      />

      <NewChatModal
        isOpen={activeModal() === 'new_chat'}
        onClose={() => setActiveModal(null)}
        npcCharacters={npcCharacters}
        playerCharacters={playerCharacters}
        worldBooks={worldBooks}
        providers={providers}
        presetSummaries={presetSummaries}
        creating={sending()}
        onCreateConversation={handleCreateConversation}
      />
      <JoinRoomModal
        isOpen={activeModal() === 'join_room'}
        onClose={() => setActiveModal(null)}
        playerCharacters={playerCharacters}
        onJoined={handleRoomJoined}
        onLeft={handleRoomLeft}
      />
      <ConfirmDialog
        open={rewindTarget() !== null}
        title="回溯到该轮"
        message="将丢弃该轮之后的所有消息，回到该轮的用户指令。此操作不可撤销。"
        confirmText="回溯"
        cancelText="取消"
        onConfirm={() => void confirmRewind()}
        onCancel={() => setRewindTarget(null)}
      />
      <NotificationContainer />
    </>
  );
}

export default App;
