import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { Search, Plus, UserPlus, Trash2, Users } from 'lucide-solid';
import { CharacterCard, ConversationListItem, resolveImageSrc } from '../../src/lib/backend';

interface SessionListProps {
  sessions: ConversationListItem[];
  npcCharacters: CharacterCard[];
  loading?: boolean;
  onSelect: (id: number) => void;
  onNewChat: () => void;
  onJoinRoom: () => void;
  onDeleteConversation?: (id: number) => void;
}

const formatTime = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

export const SessionList: Component<SessionListProps> = (props) => {
  const [search, setSearch] = createSignal('');

  const filteredSessions = createMemo(() => {
    const query = search().trim().toLowerCase();
    if (!query) return props.sessions;
    return props.sessions.filter((session) => (session.title ?? '').toLowerCase().includes(query));
  });

  const getSessionImage = (session: ConversationListItem) => {
    const boundCharacter = props.npcCharacters.find((character) => character.id === session.hostCharacterId);
    return resolveImageSrc(
      boundCharacter?.imagePath,
      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(boundCharacter?.name || session.title || 'session')}`,
    );
  };

  return (
    <div class="h-full w-full flex flex-col bg-xuanqing relative overflow-hidden">
      {/* Header aligned with mobile mock but features aligned with PC */}
      <div class="px-5 pt-8 pb-4 flex items-center justify-between z-10 shrink-0">
        <h1 class="text-3xl font-black text-white tracking-tighter">会话</h1>
      </div>

      <div class="px-5 pb-4 z-10 shrink-0">
        <div class="relative group">
          <Search class="absolute left-4 top-1/2 -translate-y-1/2 text-mist-solid/40 group-focus-within:text-accent transition-colors" size={18} />
          <input
            type="text"
            placeholder="搜索会话..."
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="w-full bg-white/5 border border-white/10 rounded-2xl py-3.5 pl-11 pr-4 text-sm focus:outline-none focus:border-accent/50 focus:bg-white/10 transition-all placeholder:text-mist-solid/30"
          />
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-5 pb-20 custom-scrollbar relative z-0">
        <Show when={!props.loading} fallback={<div class="py-10 text-center text-sm text-mist-solid/40">正在加载会话...</div>}>
          <div class="flex flex-col gap-3">
            <Show when={filteredSessions().length === 0}>
              <div class="text-sm text-mist-solid/35 text-center py-10">暂无匹配会话</div>
            </Show>
            <For each={filteredSessions()}>
              {(session) => (
                <div
                  onClick={() => props.onSelect(session.id)}
                  class="group relative overflow-hidden rounded-2xl bg-white/5 border border-white/5 hover:border-white/10 active:scale-[0.98] transition-all cursor-pointer min-h-[96px]"
                >
                  <div class="absolute inset-0 z-0 overflow-hidden pointer-events-none">
                    <img
                      src={getSessionImage(session)}
                      alt={session.title ?? 'session'}
                      class="absolute top-0 right-0 h-full w-2/3 object-cover opacity-20 [filter:grayscale(80%)_blur(2px)] group-hover:opacity-30 group-hover:[filter:grayscale(0%)_blur(0px)] transition-all duration-500 ease-out translate-x-4 group-hover:translate-x-0"
                      style={{ "-webkit-mask-image": "linear-gradient(to left, black 20%, transparent 100%)", "mask-image": "linear-gradient(to left, black 20%, transparent 100%)" }}
                    />
                  </div>
                  
                  <div class="relative z-10 p-4 flex gap-4 h-full">
                    <div class="shrink-0 relative">
                      <img
                        src={getSessionImage(session)}
                        class="w-12 h-12 rounded-full object-cover border border-white/10"
                      />
                      {session.conversationType === 'online' && (
                        <div class="absolute -bottom-1 -right-1 bg-purple-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full border border-xuanqing flex items-center gap-0.5 shadow-[0_0_8px_rgba(168,85,247,0.5)]">
                          <Users size={8} />
                          {session.memberCount}
                        </div>
                      )}
                    </div>
                    
                    <div class="flex-1 min-w-0 flex flex-col justify-center">
                      <div class="flex items-start justify-between gap-2">
                        <h3 class="text-base font-bold text-white truncate">{session.title ?? '未命名会话'}</h3>
                        <span class="text-[10px] text-mist-solid/40 shrink-0 whitespace-nowrap mt-1">{formatTime(session.updatedAt)}</span>
                      </div>
                      
                      <div class="flex items-center justify-between mt-1">
                        <p class="text-[11px] text-mist-solid/50 truncate pr-4">
                          {session.conversationType === 'online' 
                            ? (session.pendingMemberCount > 0 ? `等待 ${session.pendingMemberCount} 人发言` : '本轮已齐')
                            : '个人航行实例'}
                        </p>
                        
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`确定要删除会话「${session.title ?? '未命名会话'}」吗？`)) {
                              props.onDeleteConversation?.(session.id);
                            }
                          }}
                          class="p-1.5 rounded-lg text-mist-solid/30 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* Vertical FAB Container */}
      <div class="absolute right-5 bottom-8 z-20 flex flex-col gap-3 items-end pointer-events-none">
        <button
          onClick={props.onJoinRoom}
          class="w-11 h-11 rounded-full bg-xuanqing/80 backdrop-blur-md border border-white/10 flex items-center justify-center text-mist-solid/60 hover:text-white transition-colors pointer-events-auto shadow-lg active:scale-95"
        >
          <UserPlus size={20} />
        </button>
        <button
          onClick={props.onNewChat}
          class="w-14 h-14 rounded-full bg-accent text-white flex items-center justify-center transition-all pointer-events-auto shadow-[0_4px_20px_rgba(58,109,140,0.6)] hover:bg-accent/90 active:scale-95"
        >
          <Plus size={28} />
        </button>
      </div>
    </div>
  );
};
