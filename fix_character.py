import re

with open('src/components/CharacterSidebar.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

if "import { WorkspaceTransitionStage }" not in c:
    c = c.replace("import { Component, For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';",
                  "import { Component, For, Show, Switch, Match, createMemo, createSignal, onCleanup, onMount } from 'solid-js';\nimport { WorkspaceTransitionStage } from './WorkspaceTransitionStage';")

grid_content = """          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <For each={filteredCharacters()}>
              {(character) => (
                <div class="group relative aspect-video overflow-hidden border-b-2 border-l-2 border-white/10 cursor-pointer hover:border-accent/40 transition-all">
                  
                  <img
                    src={resolveImageSrc(
                      character.imagePath,
                      `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`,
                    )}
                    alt={character.name}
                    class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-700" style={{ "-webkit-mask-image": "linear-gradient(to top, black 20%, transparent 100%)", "mask-image": "linear-gradient(to top, black 20%, transparent 100%)" }}
                  />
                  
                  <div class="absolute bottom-0 left-0 right-0 p-4">
                    <h3 class="text-lg font-bold text-white mb-2 drop-shadow-lg">{character.name}</h3>
                    <div class="flex flex-wrap gap-2">
                      <For each={character.tags}>
                        {(tag) => (
                          <span class="text-[9px] px-2 py-0.5 rounded-none border border-current font-bold uppercase tracking-widest text-mist-solid/60 group-hover:text-accent transition-colors">
                            {tag}
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                  <div class="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity translate-y-2 group-hover:translate-y-0 duration-300">
                    <IconButton
                      onClick={(event) => {
                        event.stopPropagation();
                        openModal(character);
                      }}
                      label={`编辑角色 ${character.name}`}
                      size="sm"
                      class="bg-white/10 text-white"
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      onClick={(event) => {
                        event.stopPropagation();
                        void props.onDeleteCharacter(character.id);
                      }}
                      label={`删除角色 ${character.name}`}
                      tone="danger"
                      size="sm"
                      class="bg-white/10"
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
              )}
            </For>
          </div>"""

new_grid_content = f"""          <WorkspaceTransitionStage activeWorkspace={{activeTab()}} paneIds={{['npc', 'player']}}>
            {{(tabId) => (
              <Switch fallback={{<div />}}>
                <Match when={{tabId === 'npc'}}>
                  <div class="h-full w-full">
                    {grid_content.replace('filteredCharacters()', 'filteredCharacters().filter(c => c.cardType === "npc")')}
                  </div>
                </Match>
                <Match when={{tabId === 'player'}}>
                  <div class="h-full w-full">
                    {grid_content.replace('filteredCharacters()', 'filteredCharacters().filter(c => c.cardType === "player")')}
                  </div>
                </Match>
              </Switch>
            )}}
          </WorkspaceTransitionStage>"""

c = c.replace(grid_content, new_grid_content)

with open('src/components/CharacterSidebar.tsx', 'w', encoding='utf-8') as f:
    f.write(c)

print("done character")
