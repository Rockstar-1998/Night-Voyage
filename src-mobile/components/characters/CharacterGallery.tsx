import { Component, createSignal, For, Show, createMemo } from 'solid-js';
import { Search, Plus } from 'lucide-solid';
import { CharacterCard, CharacterCardType, resolveImageSrc, WorldBookSummary, ApiProviderSummary } from '../../../src/lib/backend';
import { CharacterDrawer } from './CharacterDrawer';

interface CharacterGalleryProps {
  npcCharacters: CharacterCard[];
  playerCharacters: CharacterCard[];
  worldBooks: WorldBookSummary[];
  providers: ApiProviderSummary[];
  loading?: boolean;
  onRefresh: () => Promise<void>;
}

export const CharacterGallery: Component<CharacterGalleryProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<CharacterCardType>('npc');
  const [search, setSearch] = createSignal('');
  
  const [isDrawerOpen, setIsDrawerOpen] = createSignal(false);
  const [editingCharacter, setEditingCharacter] = createSignal<CharacterCard | null>(null);

  const currentCharacters = createMemo(() =>
    activeTab() === 'player' ? props.playerCharacters : props.npcCharacters
  );

  const filteredCharacters = createMemo(() => {
    const query = search().trim().toLowerCase();
    if (!query) return currentCharacters();
    return currentCharacters().filter((character) =>
      [
        character.name,
        character.description,
        character.tags.join(' ')
      ].join(' ').toLowerCase().includes(query)
    );
  });

  const handleOpenDrawer = (character?: CharacterCard) => {
    if (character) {
      setEditingCharacter(character);
    } else {
      setEditingCharacter(null);
    }
    setIsDrawerOpen(true);
  };

  return (
    <div class="h-full w-full flex flex-col bg-xuanqing relative overflow-hidden">
      
      {/* Header aligned with mobile mock */}
      <div class="px-5 pt-8 pb-4 flex items-center justify-between z-10 shrink-0">
        <h1 class="text-3xl font-black text-white tracking-tighter">角色库</h1>
        <button
          onClick={() => handleOpenDrawer()}
          class="w-10 h-10 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center text-accent hover:bg-accent/30 transition-colors shadow-[0_0_15px_rgba(58,109,140,0.3)]"
        >
          <Plus size={20} />
        </button>
      </div>

      {/* Segmented Control */}
      <div class="px-5 pb-4 z-10 shrink-0">
        <div class="flex p-1 bg-white/5 rounded-2xl border border-white/10">
          <button
            onClick={() => setActiveTab('npc')}
            class={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${
              activeTab() === 'npc' 
                ? 'bg-white/10 text-white shadow-sm' 
                : 'text-mist-solid/50 hover:text-mist-solid/80'
            }`}
          >
            NPC 角色卡
          </button>
          <button
            onClick={() => setActiveTab('player')}
            class={`flex-1 py-2.5 text-sm font-bold rounded-xl transition-all ${
              activeTab() === 'player' 
                ? 'bg-white/10 text-white shadow-sm' 
                : 'text-mist-solid/50 hover:text-mist-solid/80'
            }`}
          >
            玩家角色 (PC)
          </button>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-5 pb-24 custom-scrollbar relative z-0">
        <Show when={!props.loading} fallback={<div class="py-10 text-center text-sm text-mist-solid/40">正在加载角色...</div>}>
          <div class="grid grid-cols-2 gap-4">
            <Show when={filteredCharacters().length === 0}>
              <div class="col-span-2 text-sm text-mist-solid/35 text-center py-10">暂无匹配的角色</div>
            </Show>
            <For each={filteredCharacters()}>
              {(character) => (
                <div
                  onClick={() => handleOpenDrawer(character)}
                  class="group relative aspect-square sm:aspect-auto sm:h-64 overflow-hidden rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 active:scale-[0.98] transition-all cursor-pointer"
                >
                  <img
                    src={resolveImageSrc(
                      character.imagePath,
                      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`,
                    )}
                    alt={character.name}
                    class="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                  
                  {/* Dark gradient overlay */}
                  <div class="absolute inset-0 bg-gradient-to-t from-xuanqing via-xuanqing/50 to-transparent opacity-90" />
                  
                  <div class="absolute bottom-0 left-0 right-0 p-3 flex flex-col justify-end">
                    <h3 class="text-base font-bold text-white mb-1.5 drop-shadow-md truncate">{character.name}</h3>
                    <div class="flex flex-wrap gap-1.5 h-10 overflow-hidden">
                      <For each={character.tags.slice(0, 3)}>
                        {(tag) => (
                          <span class="text-[9px] px-1.5 py-0.5 rounded border border-white/20 font-bold text-mist-solid/80 bg-black/40 backdrop-blur-sm whitespace-nowrap">
                            {tag}
                          </span>
                        )}
                      </For>
                      <Show when={character.tags.length > 3}>
                         <span class="text-[9px] px-1.5 py-0.5 rounded border border-white/20 font-bold text-mist-solid/80 bg-black/40 backdrop-blur-sm">
                           +{character.tags.length - 3}
                         </span>
                      </Show>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <CharacterDrawer 
        isOpen={isDrawerOpen()}
        onClose={() => setIsDrawerOpen(false)}
        character={editingCharacter()}
        cardType={activeTab()}
        worldBooks={props.worldBooks}
        providers={props.providers}
        onRefresh={props.onRefresh}
      />
    </div>
  );
};
