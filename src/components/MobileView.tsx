import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { SessionSidebar } from './SessionSidebar';
import { ChatArea } from './ChatArea';
import { ChatMessage } from './MessageItem';
import { ChatInputBar } from './ChatInputBar';
import { RightDrawer } from './RightDrawer';
import { MobileSettingsArea } from './MobileSettingsArea';
import { AlertTriangle, ChevronLeft, MessageSquare, Users, Book, Settings, LayoutGrid } from '../lib/icons';
import type { ApiProviderSummary, CharacterCard, ConversationListItem, ConversationMember, PlotSummaryRecord, PresetSummary, RemoteModel, RoundState, WorldBookSummary } from '../lib/backend';
import { IconButton } from './ui/IconButton';
import type { MessageFormatConfig } from '../lib/messageFormatter';

interface MobileViewProps {
  messages: ChatMessage[];
  sessions: ConversationListItem[];
  npcCharacters: CharacterCard[];
  selectedConversationId: number | null;
  selectedConversationTitle?: string;
  selectedConversationMembers: ConversationMember[];
  currentRoundState?: RoundState | null;
  sessionsLoading?: boolean;
  sending?: boolean;
  allowEmptySend?: boolean;
  selectedCharacter?: CharacterCard | null;
  selectedPresetId?: number | null;
  selectedWorldBookId?: number | null;
  presetSummaries: PresetSummary[];
  worldBooks: WorldBookSummary[];
  characterStateOverlaySummary?: string | null;
  characterStateOverlayStatus?: 'queued' | 'completed' | 'failed' | null;
  characterStateOverlayError?: string | null;
  plotSummaryMode?: 'ai' | 'manual' | string;
  plotSummaries: PlotSummaryRecord[];
  onUpdatePlotSummaryMode: (mode: 'ai' | 'manual') => Promise<void> | void;
  onSavePlotSummary: (batchIndex: number, summaryText: string) => Promise<void> | void;
  onSaveConversationBindings: (payload: { presetId?: number; worldBookId?: number }) => Promise<void> | void;
  playerCharacters: CharacterCard[];
  currentPlayerCharacter?: CharacterCard;
  onSwitchPlayerCharacter: (playerCharacterId: number) => Promise<void> | void;
  onSend: (content: string) => Promise<void> | void;
  onAbort?: () => void | Promise<void>;
  replyStatus?: 'idle' | 'connecting' | 'processing' | 'responding';
  onRegenerate: (id: string, roundId?: number) => void;
  onEdit: (id: string, content: string) => void;
  onFork: (id: string) => void;
  onDeleteMessage?: (id: string) => void;
  onRetryFailed?: (id: string, roundId?: number) => void;
  swipeInfo?: (messageId: string) => { current: number; total: number } | undefined;
  onSwitchSwipe?: (messageId: string, direction: 'prev' | 'next') => void;
  onSelectConversation: (conversationId: number) => void;
  onDeleteConversation?: (id: number) => Promise<void> | void;
  onOpenNewChat: () => void;
  onOpenJoinRoom: () => void;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
  isRoomClient?: boolean;
  providers: ApiProviderSummary[];
  providerModels?: Record<number, RemoteModel[]>;
  providersLoading?: boolean;
  fetchingModelsFor?: number | null;
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
  }) => Promise<{ ok: boolean; status: number; latencyMs: number; attemptCount: number; degraded: boolean; degradedThresholdMs: number; model: string; responsePreview: string }> | { ok: boolean; status: number; latencyMs: number; attemptCount: number; degraded: boolean; degradedThresholdMs: number; model: string; responsePreview: string };
  enableDynamicEffects: boolean;
  onSetEnableDynamicEffects: (enabled: boolean) => void;
  onSetFormatConfig: (config: MessageFormatConfig) => void;
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

export const MobileView: Component<MobileViewProps> = (props) => {
  const [activeView, setActiveView] = createSignal<'sessions' | 'chat' | 'characters' | 'kb' | 'workspaces' | 'settings'>('sessions');
  const [activeWorkspace, setActiveWorkspace] = createSignal<'chat' | 'characters' | 'kb' | 'workspaces' | 'settings'>('chat');
  const activePreset = createMemo(() => props.presetSummaries.find(p => p.id === props.selectedPresetId) ?? null);

  const handleWorkspaceChange = (ws: string) => {
    const workspace = ws as 'chat' | 'characters' | 'kb' | 'workspaces' | 'settings';
    setActiveWorkspace(workspace);
    if (workspace === 'chat') {
      setActiveView('sessions');
    } else {
      setActiveView(workspace);
    }
  };

  const overlayDescription = createMemo(() => {
    if (props.characterStateOverlayError) return props.characterStateOverlayError;
    if (props.characterStateOverlaySummary) return props.characterStateOverlaySummary;
    if (props.characterStateOverlayStatus === 'queued') return '后端正在异步生成最新角色状态覆盖层。';
    return '当前暂无可展示的角色状态覆盖层。';
  });

  const NavButton: Component<{ id: string; icon: any; label: string }> = (navProps) => (
    <button
      onClick={() => handleWorkspaceChange(navProps.id)}
      class={`flex flex-col items-center justify-center gap-1 py-2 px-4 transition-all ${
        activeWorkspace() === navProps.id
          ? 'text-accent'
          : 'text-mist-solid/40 hover:text-mist-solid/70'
      }`}
    >
      <navProps.icon size={22} />
      <span class="text-[10px]">{navProps.label}</span>
    </button>
  );

  return (
    <div class="h-[100dvh] max-h-[100dvh] min-h-0 w-full bg-xuanqing flex flex-col relative overflow-hidden">
      <header class="h-14 shrink-0 flex items-center justify-between px-4 border-b border-white/5 z-30 bg-xuanqing/80 backdrop-blur-md">
        <div class="flex items-center gap-3 min-w-0">
          <Show when={activeView() === 'chat' || (activeView() !== 'sessions' && activeView() !== 'chat')}>
            <IconButton onClick={() => setActiveView('sessions')} label="返回会话列表" size="md" class="-ml-2 bg-transparent border-transparent">
              <ChevronLeft size={20} />
            </IconButton>
          </Show>
          <div class="min-w-0">
            <h1 class="font-bold text-lg select-none truncate">
              {activeView() === 'sessions' ? '对话' :
               activeView() === 'chat' ? (props.selectedConversationTitle ?? '对话') :
               activeView() === 'characters' ? '角色展示柜' :
               activeView() === 'kb' ? '世界书' :
               activeView() === 'workspaces' ? '工作台' :
               activeView() === 'settings' ? '设置' : '对话'}
            </h1>
            <Show when={activeView() === 'chat' && props.currentRoundState}>
              <p class="text-[10px] text-mist-solid/35 uppercase tracking-widest truncate">
                {props.currentRoundState?.status} · 等待 {props.currentRoundState?.waitingMemberIds.length ?? 0} 人
              </p>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <IconButton onClick={() => handleWorkspaceChange('settings')} label="设置" size="md" class="bg-transparent border-transparent text-mist-solid/60 hover:text-white">
            <Settings size={20} />
          </IconButton>
        </div>
      </header>

      <main class="min-h-0 flex-1 flex flex-col overflow-hidden">
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Show when={activeView() === 'sessions'}>
            <div class="min-h-full w-full">
              <SessionSidebar
                layout="mobile"
                sessions={props.sessions}
                npcCharacters={props.npcCharacters}
                selectedConversationId={props.selectedConversationId}
                selectedConversationMembers={props.selectedConversationMembers}
                loading={props.sessionsLoading}
                onSelect={(conversationId) => {
                  props.onSelectConversation(conversationId);
                  setActiveView('chat');
                }}
                onNewChat={props.onOpenNewChat}
                onJoinRoom={props.onOpenJoinRoom}
                onDeleteConversation={props.onDeleteConversation}
              />
            </div>
          </Show>

          <Show when={activeView() === 'chat'}>
            <div class="min-h-full w-full flex flex-col bg-gradient-to-br from-xuanqing to-[#0a1018]">
              <div class="px-4 pt-3 space-y-3">
                <div class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 space-y-2">
                  <div class="flex items-center justify-between gap-3 text-[10px] uppercase tracking-widest text-mist-solid/35">
                    <span>第 1 层 · 预设规则层</span>
                    <span>{props.selectedPresetId ? `#${props.selectedPresetId}` : '未绑定'}</span>
                  </div>
                  <p class="text-xs text-mist-solid/65 leading-5">当前预设规则层已在工作台预设治理区接入。</p>
                </div>

                <Show when={props.selectedCharacter}>
                  <div class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 space-y-3">
                    <div>
                      <p class="text-[10px] uppercase tracking-widest text-mist-solid/35">第 2 层 · 角色基础层</p>
                      <p class="text-sm font-semibold text-white mt-1">{props.selectedCharacter?.name}</p>
                    </div>
                    <Show
                      when={(props.selectedCharacter?.baseSections.length ?? 0) > 0}
                      fallback={<p class="text-xs text-mist-solid/60 whitespace-pre-wrap leading-5">{props.selectedCharacter?.description || '暂无结构化基础层段落。'}</p>}
                    >
                      <div class="space-y-2">
                        <For each={props.selectedCharacter?.baseSections ?? []}>
                          {(section) => (
                            <div class="rounded-xl border border-white/10 bg-black/10 px-3 py-2">
                              <p class="text-xs font-semibold text-white">{section.title || getSectionLabel(section.sectionKey)}</p>
                              <p class="text-xs text-mist-solid/65 whitespace-pre-wrap leading-5 mt-1">{section.content}</p>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>

                <div class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 space-y-2">
                  <p class="text-[10px] uppercase tracking-widest text-mist-solid/35">第 3 层 · 角色状态覆盖层</p>
                  <Show when={props.characterStateOverlayError}>
                    <div class="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200 whitespace-pre-wrap leading-5 flex gap-2">
                      <AlertTriangle size={14} class="shrink-0 mt-0.5" />
                      <span>{props.characterStateOverlayError}</span>
                    </div>
                  </Show>
                  <p class="text-xs text-mist-solid/65 whitespace-pre-wrap leading-5">{overlayDescription()}</p>
                </div>
              </div>

              <div class="flex-1 overflow-hidden pt-3">
                <ChatArea messages={props.messages} onRegenerate={props.isRoomClient ? () => {} : props.onRegenerate} onEdit={props.isRoomClient ? () => {} : props.onEdit} onFork={props.onFork} onDeleteMessage={props.onDeleteMessage} onRetryFailed={props.onRetryFailed} isRoomClient={props.isRoomClient} swipeInfo={props.swipeInfo} onSwitchSwipe={props.onSwitchSwipe} formatConfig={props.formatConfig} worldBookKeywords={props.worldBookKeywords} onChoiceSelect={(_key, value) => props.onSend(value)} structuredOutputDisplay={activePreset()?.structuredOutputDisplay} />
              </div>
              <div class="px-4 pb-6 pt-2">
                <ChatInputBar
                  onSend={props.onSend}
                  onAbort={props.onAbort}
                  replyStatus={props.replyStatus}
                  allowEmptySend={props.allowEmptySend}
                  disabled={props.sending}
                />
              </div>
            </div>
          </Show>

          <Show when={activeView() === 'characters'}>
          <div class="min-h-full w-full flex flex-col items-center justify-center px-6 text-center">
            <div class="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-mist-solid/40"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </div>
            <h2 class="text-lg font-bold text-white mb-2">角色展示柜</h2>
            <p class="text-sm text-mist-solid/50 leading-relaxed">移动端角色管理功能正在开发中。<br/>请使用桌面版进行角色卡的创建与编辑。</p>
          </div>
        </Show>

        <Show when={activeView() === 'kb'}>
          <div class="min-h-full w-full flex flex-col items-center justify-center px-6 text-center">
            <div class="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-mist-solid/40"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/></svg>
            </div>
            <h2 class="text-lg font-bold text-white mb-2">世界书</h2>
            <p class="text-sm text-mist-solid/50 leading-relaxed">移动端世界书管理功能正在开发中。<br/>请使用桌面版进行世界书的创建与编辑。</p>
          </div>
        </Show>

        <Show when={activeView() === 'workspaces'}>
          <div class="min-h-full w-full flex flex-col items-center justify-center px-6 text-center">
            <div class="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-mist-solid/40"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            </div>
            <h2 class="text-lg font-bold text-white mb-2">工作台</h2>
            <p class="text-sm text-mist-solid/50 leading-relaxed">移动端工作台功能正在开发中。<br/>请使用桌面版进行预设治理。</p>
          </div>
        </Show>

        <Show when={activeView() === 'settings'}>
          <MobileSettingsArea
            activeCategory="api"
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
            formatConfig={props.formatConfig ?? { builtinRules: { pseudoXml: { enabled: false, defaultExpanded: false }, italicGray: { enabled: false }, cyanQuote: { enabled: false }, worldBookKeyword: { enabled: false } }, customRules: [] }}
            onSetFormatConfig={props.onSetFormatConfig}
          />
        </Show>
        </div>
      </main>

      <nav class="shrink-0 h-16 border-t border-white/5 bg-xuanqing/90 backdrop-blur-md z-30 flex items-center justify-around">
        <NavButton id="chat" icon={MessageSquare} label="对话" />
        <NavButton id="characters" icon={Users} label="角色" />
        <NavButton id="workspaces" icon={LayoutGrid} label="工作台" />
        <NavButton id="kb" icon={Book} label="世界书" />
      </nav>

      <Show when={activeView() === 'chat'}>
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
          playerCharacters={props.playerCharacters}
          currentPlayerCharacter={props.currentPlayerCharacter}
          onSwitchPlayerCharacter={props.onSwitchPlayerCharacter}
        />
      </Show>
    </div>
  );
};

const style = document.createElement('style');
style.textContent = `
  @keyframes slideInUp {
    from { opacity: 0; transform: translateY(1rem); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-in {
    animation: slideInUp 0.4s ease-out forwards;
  }
`;
document.head.appendChild(style);
