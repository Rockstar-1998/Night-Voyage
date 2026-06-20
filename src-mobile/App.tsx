import { createSignal, onMount, onCleanup, Show, createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import { invoke } from '@tauri-apps/api/core';
import { MessageSquare, Settings, Users, Book, LayoutGrid } from 'lucide-solid';
import { SessionList } from './components/SessionList';
import { NewChatModal } from './components/NewChatModal';
import { SettingsTab } from './components/settings/SettingsTab';
import { CharacterGallery } from './components/characters/CharacterGallery';
import {
    conversationsList,
    characterCardsList,
    worldBooksList,
    providersList,
    presetsList,
    conversationsCreate,
    conversationsDelete,
    CharacterCard,
    ConversationListItem,
    WorldBookSummary,
    ApiProviderSummary,
    PresetSummary,
    CreateConversationPayload
} from '../src/lib/backend';

type MobileTab = 'chat' | 'characters' | 'workspaces' | 'kb' | 'settings';
type MobileView = 'sessions' | 'chat';

function App() {
    const [activeTab, setActiveTab] = createSignal<MobileTab>('chat');
    const [activeView, setActiveView] = createSignal<MobileView>('sessions');
    
    // Core data state
    const [backendReady, setBackendReady] = createSignal(false);
    const [backendError, setBackendError] = createSignal<string | null>(null);
    const [sessionsLoading, setSessionsLoading] = createSignal(true);
    const [creatingConversation, setCreatingConversation] = createSignal(false);
    
    // Data stores
    const [sessions, setSessions] = createStore<ConversationListItem[]>([]);
    const [npcCharacters, setNpcCharacters] = createStore<CharacterCard[]>([]);
    const [playerCharacters, setPlayerCharacters] = createStore<CharacterCard[]>([]);
    const [worldBooks, setWorldBooks] = createStore<WorldBookSummary[]>([]);
    const [providers, setProviders] = createStore<ApiProviderSummary[]>([]);
    const [presetSummaries, setPresetSummaries] = createStore<PresetSummary[]>([]);
    
    // Modal states
    const [isNewChatModalOpen, setIsNewChatModalOpen] = createSignal(false);
    const [isJoinRoomModalOpen, setIsJoinRoomModalOpen] = createSignal(false);
    
    // Selected states
    const [selectedConversationId, setSelectedConversationId] = createSignal<number | null>(null);

    const refreshData = async () => {
        try {
            setSessionsLoading(true);
            const [
                sessionsData,
                npcData,
                playerData,
                worldBooksData,
                providersData,
                presetsData
            ] = await Promise.all([
                conversationsList(),
                characterCardsList('npc'),
                characterCardsList('player'),
                worldBooksList(),
                providersList(),
                presetsList()
            ]);
            
            setSessions(sessionsData);
            setNpcCharacters(npcData);
            setPlayerCharacters(playerData);
            setWorldBooks(worldBooksData);
            setProviders(providersData);
            setPresetSummaries(presetsData);
            setBackendReady(true);
        } catch (err) {
            setBackendError(err instanceof Error ? err.message : String(err));
        } finally {
            setSessionsLoading(false);
        }
    };

    onMount(async () => {
        try {
            await invoke('settings_get_all');
            await refreshData();
        } catch (err) {
            setBackendError(err instanceof Error ? err.message : String(err));
        }
    });

    const handleCreateConversation = async (payload: CreateConversationPayload) => {
        setCreatingConversation(true);
        try {
            const result = await conversationsCreate(payload);
            await refreshData();
            // Automatically switch to chat view for the new session
            const newConversationId = typeof result === 'number' ? result : (result as any).conversation?.id;
            if (newConversationId) {
                setSelectedConversationId(newConversationId);
                setActiveView('chat');
            }
        } catch (error) {
            throw error;
        } finally {
            setCreatingConversation(false);
        }
    };

    const handleDeleteConversation = async (id: number) => {
        try {
            await conversationsDelete(id);
            await refreshData();
            if (selectedConversationId() === id) {
                setSelectedConversationId(null);
                setActiveView('sessions');
            }
        } catch (error) {
            console.error('[App] delete conversation error:', error);
            window.alert('删除会话失败');
        }
    };

    const NavButton = (props: { id: MobileTab; icon: any; label: string }) => (
        <button
            onClick={() => setActiveTab(props.id)}
            class={`flex flex-col items-center justify-center gap-1 py-2 px-4 transition-all ${
                activeTab() === props.id
                    ? 'text-accent'
                    : 'text-mist-solid/40 hover:text-mist-solid/70'
            }`}
        >
            <props.icon size={22} />
            <span class="text-[10px]">{props.label}</span>
        </button>
    );

    const PlaceholderView = (props: { title: string; description: string; icon: any }) => (
        <div class="min-h-full w-full flex flex-col items-center justify-center px-6 text-center">
            <div class="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                <props.icon size={32} class="text-mist-solid/40" />
            </div>
            <h2 class="text-lg font-bold text-white mb-2">{props.title}</h2>
            <p class="text-sm text-mist-solid/50 leading-relaxed">{props.description}</p>
        </div>
    );

    return (
        <div class="h-[100dvh] max-h-[100dvh] min-h-0 w-full bg-xuanqing flex flex-col relative overflow-hidden safe-area-top safe-area-bottom">
            {/* Conditional header only for non-chat tabs or specific views, excluding settings and characters which have their own */}
            <Show when={(activeTab() !== 'chat' && activeTab() !== 'settings' && activeTab() !== 'characters') || activeView() === 'chat'}>
                <header class="h-14 shrink-0 flex items-center justify-between px-4 z-30 bg-xuanqing/80 backdrop-blur-md">
                    <div class="flex items-center gap-3 min-w-0">
                        <Show when={activeTab() === 'chat' && activeView() === 'chat'}>
                            <button
                                onClick={() => setActiveView('sessions')}
                                class="text-mist-solid/60 hover:text-white flex items-center gap-1"
                            >
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
                                <span class="text-xs">返回</span>
                            </button>
                        </Show>
                        <h1 class="font-bold text-lg select-none truncate">
                            {activeTab() === 'chat' ? (activeView() === 'chat' ? '对话中' : '会话') :
                             activeTab() === 'characters' ? '角色' :
                             activeTab() === 'workspaces' ? '工作台' :
                             activeTab() === 'kb' ? '世界书' :
                             '设置'}
                        </h1>
                    </div>
                    <Show when={activeTab() !== 'settings'}>
                        <button
                            onClick={() => setActiveTab('settings')}
                            class="p-2 text-mist-solid/60 hover:text-white transition-colors"
                        >
                            <Settings size={20} />
                        </button>
                    </Show>
                </header>
            </Show>

            <main class="min-h-0 flex-1 flex flex-col overflow-hidden relative">
                <Show when={backendReady()} fallback={
                    <div class="min-h-full w-full flex flex-col items-center justify-center px-6 text-center">
                        <Show when={backendError()} fallback={<p class="text-sm text-mist-solid/50">正在连接后端...</p>}>
                            {(err) => (
                                <div class="space-y-3">
                                    <p class="text-sm text-red-300">后端连接失败</p>
                                    <p class="text-xs text-mist-solid/35 break-all">{err()}</p>
                                </div>
                            )}
                        </Show>
                    </div>
                }>
                    <div class="min-h-0 flex-1 overflow-y-auto">
                        <Show when={activeTab() === 'chat'}>
                            <Show when={activeView() === 'sessions'}>
                                <SessionList
                                    sessions={sessions}
                                    npcCharacters={npcCharacters}
                                    loading={sessionsLoading()}
                                    onSelect={(id) => {
                                        setSelectedConversationId(id);
                                        setActiveView('chat');
                                    }}
                                    onNewChat={() => setIsNewChatModalOpen(true)}
                                    onJoinRoom={() => window.alert('移动端加入房间功能开发中')}
                                    onDeleteConversation={handleDeleteConversation}
                                />
                            </Show>
                            <Show when={activeView() === 'chat'}>
                                <div class="min-h-full w-full flex flex-col items-center justify-center px-6 text-center">
                                    <div class="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mb-4">
                                        <MessageSquare size={32} class="text-mist-solid/40" />
                                    </div>
                                    <h2 class="text-lg font-bold text-white mb-2">对话界面</h2>
                                    <p class="text-sm text-mist-solid/50 leading-relaxed">
                                        会话 ID: {selectedConversationId()}<br/>移动端单聊与群聊发消息界面正在开发中。
                                    </p>
                                </div>
                            </Show>
                        </Show>

                        <Show when={activeTab() === 'characters'}>
                            <CharacterGallery 
                                npcCharacters={npcCharacters}
                                playerCharacters={playerCharacters}
                                worldBooks={worldBooks}
                                providers={providers}
                                loading={sessionsLoading()}
                                onRefresh={refreshData}
                            />
                        </Show>

                        <Show when={activeTab() === 'workspaces'}>
                            <PlaceholderView
                                title="工作台"
                                description="移动端工作台功能正在开发中。请使用桌面版进行预设治理。"
                                icon={LayoutGrid}
                            />
                        </Show>

                        <Show when={activeTab() === 'kb'}>
                            <PlaceholderView
                                title="世界书"
                                description="移动端世界书管理功能正在开发中。请使用桌面版进行世界书的创建与编辑。"
                                icon={Book}
                            />
                        </Show>

                        <Show when={activeTab() === 'settings'}>
                            <SettingsTab providers={providers} onRefresh={refreshData} />
                        </Show>
                    </div>
                </Show>

                <NewChatModal
                    isOpen={isNewChatModalOpen()}
                    onClose={() => setIsNewChatModalOpen(false)}
                    npcCharacters={npcCharacters}
                    playerCharacters={playerCharacters}
                    worldBooks={worldBooks}
                    providers={providers}
                    presetSummaries={presetSummaries}
                    onCreateConversation={handleCreateConversation}
                    creating={creatingConversation()}
                />
            </main>

            <Show when={activeTab() !== 'chat' || activeView() === 'sessions'}>
                <nav class="shrink-0 h-16 border-t border-white/5 bg-xuanqing/90 backdrop-blur-md z-30 flex items-center justify-around pb-[env(safe-area-inset-bottom)]">
                    <NavButton id="chat" icon={MessageSquare} label="对话" />
                    <NavButton id="characters" icon={Users} label="角色" />
                    <NavButton id="workspaces" icon={LayoutGrid} label="工作台" />
                    <NavButton id="kb" icon={Book} label="世界书" />
                </nav>
            </Show>
        </div>
    );
}

export default App;
