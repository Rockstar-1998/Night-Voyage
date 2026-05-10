import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { SessionSidebar } from './SessionSidebar';
import { ChatArea } from './ChatArea';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { ChatMessage } from './MessageItem';
import { ChatInputBar } from './ChatInputBar';
import { RightDrawer } from './RightDrawer';
import { AlertTriangle, ChevronLeft, Menu, MoreVertical } from '../lib/icons';
import { animate } from '../lib/animate';
import type { CharacterCard, ConversationListItem, ConversationMember, PlotSummaryRecord, PresetSummary, RoundState, WorldBookSummary } from '../lib/backend';
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
  onSend: (content: string) => Promise<void> | void;
  onRegenerate: (id: string, roundId?: number) => void;
  onEdit: (id: string, content: string) => void;
  onFork: (id: string) => void;
  swipeInfo?: (messageId: string) => { current: number; total: number } | undefined;
  onSwitchSwipe?: (messageId: string, direction: 'prev' | 'next') => void;
  onSelectConversation: (conversationId: number) => void;
  onDeleteConversation?: (id: number) => Promise<void> | void;
  onOpenNewChat: () => void;
  onOpenJoinRoom: () => void;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
  isRoomClient?: boolean;
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
  const [activeView, setActiveView] = createSignal<'sessions' | 'chat'>('sessions');
  const [isDrawerOpen, setIsDrawerOpen] = createSignal(false);

  let drawerRef: HTMLDivElement | undefined;
  let overlayRef: HTMLDivElement | undefined;

  const overlayDescription = createMemo(() => {
    if (props.characterStateOverlayError) return props.characterStateOverlayError;
    if (props.characterStateOverlaySummary) return props.characterStateOverlaySummary;
    if (props.characterStateOverlayStatus === 'queued') return '后端正在异步生成最新角色状态覆盖层。';
    return '当前暂无可展示的角色状态覆盖层。';
  });

  const toggleDrawer = () => {
    const nextState = !isDrawerOpen();
    setIsDrawerOpen(nextState);

    if (drawerRef && overlayRef) {
      if (nextState) {
        animate(drawerRef, { x: ['-100%', '0%'] }, { duration: 0.3, ease: 'easeOut' });
        animate(overlayRef, { opacity: [0, 1] }, { duration: 0.3 });
      } else {
        animate(drawerRef, { x: '-100%' }, { duration: 0.3, ease: 'easeIn' });
        animate(overlayRef, { opacity: 0 }, { duration: 0.3 });
      }
    }
  };

  return (
    <div class="h-full w-full bg-xuanqing flex flex-col relative overflow-hidden">
      <header class="h-14 shrink-0 flex items-center justify-between px-4 border-b border-white/5 z-30 bg-xuanqing/80 backdrop-blur-md">
        <div class="flex items-center gap-3 min-w-0">
          <Show
            when={activeView() === 'chat'}
            fallback={
              <IconButton onClick={toggleDrawer} label="打开工作区抽屉" size="md" class="-ml-2 bg-transparent border-transparent">
                <Menu size={20} />
              </IconButton>
            }
          >
            <IconButton onClick={() => setActiveView('sessions')} label="返回会话列表" size="md" class="-ml-2 bg-transparent border-transparent">
              <ChevronLeft size={20} />
            </IconButton>
          </Show>
          <div class="min-w-0">
            <h1 class="font-bold text-lg select-none truncate">
              {activeView() === 'sessions' ? '对话' : props.selectedConversationTitle ?? '对话'}
            </h1>
            <Show when={activeView() === 'chat' && props.currentRoundState}>
              <p class="text-[10px] text-mist-solid/35 uppercase tracking-widest truncate">
                {props.currentRoundState?.status} · 等待 {props.currentRoundState?.waitingMemberIds.length ?? 0} 人
              </p>
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <IconButton onClick={toggleDrawer} label="打开移动端工作区抽屉" size="md" class="bg-transparent border-transparent">
            <MoreVertical size={18} />
          </IconButton>
        </div>
      </header>

      <main class="flex-1 relative overflow-hidden">
        <Show when={activeView() === 'sessions'}>
          <div class="h-full w-full overflow-y-auto">
            <SessionSidebar
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
          <div class="h-full w-full flex flex-col bg-gradient-to-br from-xuanqing to-[#0a1018]">
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
              <ChatArea messages={props.messages} onRegenerate={props.isRoomClient ? () => {} : props.onRegenerate} onEdit={props.isRoomClient ? () => {} : props.onEdit} onFork={props.onFork} swipeInfo={props.swipeInfo} onSwitchSwipe={props.onSwitchSwipe} formatConfig={props.formatConfig} worldBookKeywords={props.worldBookKeywords} />
            </div>
            <div class="px-4 pb-6 pt-2">
              <ChatInputBar
                onSend={props.onSend}
                allowEmptySend={props.allowEmptySend}
                disabled={props.sending}
              />
            </div>
          </div>
        </Show>
      </main>

      <Show when={isDrawerOpen()}>
        <div
          ref={overlayRef}
          onClick={toggleDrawer}
          class="absolute inset-0 bg-black/60 z-40 backdrop-blur-sm"
        />
        <div
          ref={drawerRef}
          class="absolute inset-y-0 left-0 w-[280px] z-50 bg-xuanqing border-r border-white/5 -translate-x-full"
        >
          <WorkspaceSidebar />
        </div>
      </Show>

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
