import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { Search, Plus, UserPlus, Users, User, Trash2 } from '../lib/icons';
import { CharacterCard, ConversationListItem, ConversationMember, resolveImageSrc } from '../lib/backend';
import { IconButton } from './ui/IconButton';

interface SessionSidebarProps {
  sessions: ConversationListItem[];
  npcCharacters: CharacterCard[];
  selectedConversationId?: number | null;
  selectedConversationMembers?: ConversationMember[];
  loading?: boolean;
  onSelect?: (conversationId: number) => void;
  onNewChat?: () => void;
  onJoinRoom?: () => void;
  onDeleteConversation?: (id: number) => void;
}

const formatTime = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const SessionSidebar: Component<SessionSidebarProps> = (props) => {
  const [search, setSearch] = createSignal('');
  const [expandedRoomId, setExpandedRoomId] = createSignal<number | null>(null);

  const filteredSessions = createMemo(() => {
    const query = search().trim().toLowerCase();
    if (!query) return props.sessions;
    return props.sessions.filter((session) => (session.title ?? '').toLowerCase().includes(query));
  });

  const grouped = createMemo(() => ({
    single: filteredSessions().filter((session) => session.conversationType === 'single'),
    online: filteredSessions().filter((session) => session.conversationType === 'online'),
  }));

  const getSessionImage = (session: ConversationListItem) => {
    const boundCharacter = props.npcCharacters.find((character) => character.id === session.hostCharacterId);
    return resolveImageSrc(
      boundCharacter?.imagePath,
      '',
    );
  };

  return (
    <div class="w-80 border-r flex flex-col bg-night-water/30 backdrop-blur-sm border-white/5 h-full relative pt-10">
      <div class="p-6 flex flex-col gap-6">
        <h1 data-workspace-title class="text-3xl font-black text-white tracking-tighter uppercase italic">Sessions</h1>

        <div class="relative group">
          <Search class="absolute left-0 top-1/2 -translate-y-1/2 text-mist-solid/20 group-focus-within:text-accent transition-colors" size={20} />
          <input
            type="text"
            placeholder="搜索航次..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="w-full bg-transparent border-b border-white/20 rounded-none py-3.5 pl-8 pr-4 text-sm focus:outline-none focus:border-accent transition-all placeholder:text-mist-solid/20"
          />
        </div>

        <div class="flex items-center justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">快速操作</div>
            <div class="text-sm text-mist-solid/40 mt-1">创建或加入会话</div>
          </div>
          <div class="flex items-center gap-3">
            <IconButton onClick={props.onNewChat} label="新建会话" tone="accent" size="lg">
              <Plus size={18} />
            </IconButton>
            <IconButton onClick={props.onJoinRoom} label="加入房间" size="lg">
              <UserPlus size={18} />
            </IconButton>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-20 custom-scrollbar">
        <Show when={!props.loading} fallback={<div class="px-4 text-sm text-mist-solid/40">正在加载会话...</div>}>
          <div class="flex flex-col gap-8 px-4 pb-8">
            <Show when={grouped().online.length > 0}>
              <div class="flex flex-col gap-4">
                <h2 class="text-[10px] font-black text-mist-solid/30 uppercase tracking-[0.3em] flex items-center gap-2">
                  <div class="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-[0_0_8px_rgba(168,85,247,0.5)]" />
                  联机会话
                </h2>
                <For each={grouped().online}>
                  {(session) => (
                    <div class="flex flex-col gap-2">
                      <div
                        onClick={() => props.onSelect?.(session.id)}
                        class={`group px-4 py-5 -mx-4 text-left transition-all cursor-pointer relative overflow-hidden border-b ${props.selectedConversationId === session.id
                          ? 'border-accent/40 bg-white/[0.02]'
                          : 'border-white/5 hover:border-white/10 hover:bg-white/[0.01]'}`}
                      >
                        <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                          <Show when={getSessionImage(session)}>
                            <img
                              src={getSessionImage(session)}
                              alt={session.title ?? 'session'}
                              class={`absolute top-0 right-0 h-full w-2/3 object-cover transition-all duration-500 ease-out ${props.selectedConversationId === session.id ? 'opacity-40 [filter:grayscale(0%)_blur(0px)] translate-x-2' : 'opacity-20 [filter:grayscale(100%)_blur(4px)] translate-x-0 group-hover:opacity-40 group-hover:[filter:grayscale(0%)_blur(0px)] group-hover:translate-x-2'}`}
                              style={{ "-webkit-mask-image": "linear-gradient(to left, black 20%, transparent 100%)", "mask-image": "linear-gradient(to left, black 20%, transparent 100%)" }}
                            />
                          </Show>
                        </div>
                        <div class="relative z-10 flex items-start justify-between gap-3 mb-2">
                          <div>
                            <h3 class="text-sm font-bold text-white transition-transform duration-500 group-hover:translate-x-1">{session.title ?? '未命名会话'}</h3>
                            <p class="text-[11px] text-mist-solid/40 mt-1 transition-transform duration-500 delay-75 group-hover:translate-x-1">
                              {session.memberCount} 人 · {session.pendingMemberCount > 0 ? `等待 ${session.pendingMemberCount} 人` : '本轮已齐'}
                            </p>
                          </div>
                          <div class="flex items-center gap-1">
                            <span class="text-[10px] text-mist-solid/30 whitespace-nowrap">{formatTime(session.updatedAt)}</span>
                            <button
                              type="button"
                              class="p-1.5 rounded-lg hover:bg-red-500/20 text-mist-solid/30 hover:text-red-300 transition-colors opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={(e) => {
                                e.stopPropagation();
                                const title = session.title ?? '未命名会话';
                                if (window.confirm(`确定要删除会话「${title}」吗？此操作不可撤销。`)) {
                                  props.onDeleteConversation?.(session.id);
                                }
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                        <div class="relative z-10 flex items-center justify-between">
                          <span class="text-[9px] uppercase tracking-widest font-black text-purple-400">Multiplayer</span>
                          <IconButton
                            onClick={(event) => {
                              event.stopPropagation();
                              setExpandedRoomId(expandedRoomId() === session.id ? null : session.id);
                              props.onSelect?.(session.id);
                            }}
                            label={expandedRoomId() === session.id ? '收起房间详情' : '查看房间详情'}
                            size="sm"
                            active={expandedRoomId() === session.id}
                            class="bg-white/10"
                          >
                            <Users size={14} />
                          </IconButton>
                        </div>
                      </div>

                      <div class={`grid transition-all duration-300 ease-in-out ${expandedRoomId() === session.id && props.selectedConversationId === session.id ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                        <div class="overflow-hidden">
                          <div class="px-5 py-4 rounded-[1.5rem] bg-xuanqing border border-white/10 shadow-2xl">
                            <div class="flex flex-col gap-3">
                              <div class="flex items-center justify-between">
                                <span class="text-[10px] font-black uppercase tracking-tighter text-mist-solid/40">房间成员</span>
                                <span class="text-[9px] font-bold text-accent px-2 py-0.5 bg-accent/10 rounded-full border border-accent/20">
                                  {props.selectedConversationMembers?.length ?? 0} 人
                                </span>
                              </div>
                              <Show
                                when={(props.selectedConversationMembers?.length ?? 0) > 0}
                                fallback={<div class="text-xs text-mist-solid/30">暂无成员数据</div>}
                              >
                                <div class="flex flex-col gap-2">
                                  <For each={props.selectedConversationMembers ?? []}>
                                    {(member) => (
                                      <div class="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 border border-white/5">
                                        <div class="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center">
                                          <User size={14} />
                                        </div>
                                        <div class="min-w-0">
                                          <div class="text-sm text-white truncate">{member.displayName}</div>
                                          <div class="text-[10px] text-mist-solid/35 uppercase tracking-widest">{member.memberRole}</div>
                                        </div>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={grouped().single.length > 0}>
              <div class="flex flex-col gap-4">
                <h2 class="text-[10px] font-black text-mist-solid/30 uppercase tracking-[0.3em] flex items-center gap-2">
                  <div class="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(58,109,140,0.5)]" />
                  单人会话
                </h2>
                <For each={grouped().single}>
                  {(session) => (
                    <button
                      onClick={() => props.onSelect?.(session.id)}
                      class={`group px-4 py-5 -mx-4 text-left transition-all relative overflow-hidden border-b ${props.selectedConversationId === session.id
                        ? 'border-accent/40 bg-white/[0.02]'
                        : 'border-white/5 hover:border-white/10 hover:bg-white/[0.01]'}`}
                    >
                      <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                        <Show when={getSessionImage(session)}>
                          <img
                            src={getSessionImage(session)}
                            alt={session.title ?? 'session'}
                            class={`absolute top-0 right-0 h-full w-2/3 object-cover transition-all duration-500 ease-out ${props.selectedConversationId === session.id ? 'opacity-40 [filter:grayscale(0%)_blur(0px)] translate-x-2' : 'opacity-20 [filter:grayscale(100%)_blur(4px)] translate-x-0 group-hover:opacity-40 group-hover:[filter:grayscale(0%)_blur(0px)] group-hover:translate-x-2'}`}
                            style={{ "-webkit-mask-image": "linear-gradient(to left, black 20%, transparent 100%)", "mask-image": "linear-gradient(to left, black 20%, transparent 100%)" }}
                          />
                        </Show>
                      </div>
                      <div class="relative z-10 flex items-start justify-between gap-3 mb-2">
                        <div>
                          <h3 class="text-sm font-bold text-white transition-transform duration-500 group-hover:translate-x-1">{session.title ?? '未命名会话'}</h3>
                          <p class="text-[11px] text-mist-solid/40 mt-1 transition-transform duration-500 delay-75 group-hover:translate-x-1">个人航行</p>
                        </div>
                        <div class="flex items-center gap-1">
                          <span class="text-[10px] text-mist-solid/30 whitespace-nowrap">{formatTime(session.updatedAt)}</span>
                          <span
                            role="button"
                            tabindex={0}
                            class="p-1.5 rounded-lg hover:bg-red-500/20 text-mist-solid/30 hover:text-red-300 transition-colors opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              const title = session.title ?? '未命名会话';
                              if (window.confirm(`确定要删除会话「${title}」吗？此操作不可撤销。`)) {
                              props.onDeleteConversation?.(session.id);
                            }
                            }}
                          >
                            <Trash2 size={14} />
                          </span>
                        </div>
                      </div>
                      <span class="relative z-10 text-[9px] uppercase tracking-widest font-black text-accent">Single</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            <Show when={!props.loading && filteredSessions().length === 0}>
              <div class="text-sm text-mist-solid/35 text-center py-10">暂无匹配会话</div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};
