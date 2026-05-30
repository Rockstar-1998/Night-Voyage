import re

def process_settings_area():
    path = "src/components/SettingsArea.tsx"
    with open(path, "r", encoding="utf-8") as f:
        c = f.read()
    
    if "import { WorkspaceTransitionStage }" not in c:
        c = c.replace("import { IconButton } from './ui/IconButton';", "import { IconButton } from './ui/IconButton';\nimport { WorkspaceTransitionStage } from './WorkspaceTransitionStage';")
    
    c = c.replace("<Show when={props.activeCategory === 'api'}>", "<WorkspaceTransitionStage activeWorkspace={props.activeCategory} paneIds={['api', 'appearance']}>\n          {(categoryId) => <>\n            <Show when={categoryId === 'api'}>")
    c = c.replace("</Show>\n\n        <Show when={props.activeCategory === 'appearance'}>", "</Show>\n\n        <Show when={categoryId === 'appearance'}>")
    c = c.replace("</Show>\n      </div>\n    </div>", "</Show>\n          </>}\n        </WorkspaceTransitionStage>\n      </div>\n    </div>")
    
    c = c.replace('class="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500"', 'class="space-y-10"')
    c = c.replace('<div class="p-6 rounded-3xl border border-white/5 bg-white/5 space-y-6">', '<div class="space-y-6">')
    
    # Use re.sub for the rows in appearance
    # It replaces gap-4 with py-4 border-b border-white/5
    c = re.sub(r'(<div class="flex items-center justify-between gap-4(?! py-4)[^"]*")', r'\1 py-4 border-b border-white/5', c)
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(c)

def process_character_sidebar():
    path = "src/components/CharacterSidebar.tsx"
    with open(path, "r", encoding="utf-8") as f:
        c = f.read()
    
    if "import { WorkspaceTransitionStage }" not in c:
        c = c.replace("import { IconButton } from './ui/IconButton';", "import { IconButton } from './ui/IconButton';\nimport { WorkspaceTransitionStage } from './WorkspaceTransitionStage';")
    
    old_show = """        <Show
          when={viewMode() === 'npc'}
          fallback={
            <div class="space-y-6">
              <div class="flex items-center gap-3 relative">
                <Search class="absolute left-3 text-mist-solid/30" size={16} />
                <input
                  type="text"
                  placeholder="搜索我的角色..."
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  class="w-full bg-transparent border-b border-white/10 py-3 pl-10 pr-4 text-sm text-mist-solid focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                <For each={filteredPlayerCharacters()}>
                  {(character) => (
                    <button
                      onClick={() => void handleEditCharacter(character)}
                      class="relative aspect-video rounded-xl text-left transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent/20 group overflow-hidden border-b-2 border-l-2 border-white/5 hover:border-accent/30"
                    >
                      <img
                        src={resolveImageSrc(character.imagePath, `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`)}
                        alt={character.name}
                        class="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div class="absolute inset-0 bg-gradient-to-t from-xuanqing via-xuanqing/50 to-transparent" />
                      <div class="absolute bottom-0 left-0 right-0 p-4">
                        <h3 class="text-lg font-bold text-white mb-2 line-clamp-1">{character.name}</h3>
                        <div class="flex flex-wrap gap-2">
                          <span class="text-[9px] px-1.5 py-0.5 border border-white/20 text-mist-solid/60 uppercase tracking-widest">玩家角色</span>
                        </div>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </div>
          }
        >"""
    
    new_show = """        <WorkspaceTransitionStage activeWorkspace={viewMode()} paneIds={['npc', 'player']}>
          {(mode) => <>
        <Show
          when={mode === 'npc'}
          fallback={
            <div class="space-y-6">
              <div class="flex items-center gap-3 relative">
                <Search class="absolute left-3 text-mist-solid/30" size={16} />
                <input
                  type="text"
                  placeholder="搜索我的角色..."
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  class="w-full bg-transparent border-b border-white/10 py-3 pl-10 pr-4 text-sm text-mist-solid focus:outline-none focus:border-accent transition-colors"
                />
              </div>

              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                <For each={filteredPlayerCharacters()}>
                  {(character) => (
                    <button
                      onClick={() => void handleEditCharacter(character)}
                      class="relative aspect-video rounded-xl text-left transition-all hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent/20 group overflow-hidden border-b-2 border-l-2 border-white/5 hover:border-accent/30"
                    >
                      <img
                        src={resolveImageSrc(character.imagePath, `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(character.name)}`)}
                        alt={character.name}
                        class="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                      />
                      <div class="absolute inset-0 bg-gradient-to-t from-xuanqing via-xuanqing/50 to-transparent" />
                      <div class="absolute bottom-0 left-0 right-0 p-4">
                        <h3 class="text-lg font-bold text-white mb-2 line-clamp-1">{character.name}</h3>
                        <div class="flex flex-wrap gap-2">
                          <span class="text-[9px] px-1.5 py-0.5 border border-white/20 text-mist-solid/60 uppercase tracking-widest">玩家角色</span>
                        </div>
                      </div>
                    </button>
                  )}
                </For>
              </div>
            </div>
          }
        >"""
    
    if old_show in c:
        c = c.replace(old_show, new_show)
        c = c.replace("</Show>\n      </div>\n    </div>", "</Show>\n          </>}\n        </WorkspaceTransitionStage>\n      </div>\n    </div>")
    
    with open(path, "w", encoding="utf-8") as f:
        f.write(c)

def process_preset_drawers():
    path1 = "src/components/SchemaConfigPanel.tsx"
    with open(path1, "r", encoding="utf-8") as f: c1 = f.read()
    # Add blur overlay
    if "z-[890]" not in c1:
        c1 = c1.replace(
            '<div class={`fixed inset-y-0 right-0 w-[460px] bg-xuanqing/95 backdrop-blur-2xl border-l border-white/5 z-[900] shadow-2xl flex flex-col transition-all duration-300 ease-out ${props.isOpen ? "translate-x-0" : "translate-x-full"}`}>',
            '<>\n      <div class={`fixed inset-0 z-[890] bg-xuanqing/40 transition-all duration-300 ease-out ${props.isOpen ? "opacity-100 backdrop-blur-sm pointer-events-auto" : "opacity-0 backdrop-blur-none pointer-events-none"}`} onClick={props.onClose} />\n      <div class={`fixed inset-y-0 right-0 w-[460px] bg-xuanqing/95 backdrop-blur-2xl border-l border-white/5 z-[900] shadow-2xl flex flex-col transition-all duration-300 ease-out ${props.isOpen ? "translate-x-0" : "translate-x-full"}`}>'
        )
        c1 = c1.replace('  );\n};', '    </>\n  );\n};')
    with open(path1, "w", encoding="utf-8") as f: f.write(c1)

    path2 = "src/components/CompletionParametersPanel.tsx"
    with open(path2, "r", encoding="utf-8") as f: c2 = f.read()
    if "<Show when={props.isOpen}>" in c2:
        c2 = c2.replace('<Show when={props.isOpen}>\n      <div class="fixed inset-y-0 right-0 w-[460px] bg-xuanqing/95 backdrop-blur-2xl border-l border-white/5 z-[900] shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">',
                        '<>\n      <div class={`fixed inset-0 z-[890] bg-xuanqing/40 transition-all duration-300 ease-out ${props.isOpen ? "opacity-100 backdrop-blur-sm pointer-events-auto" : "opacity-0 backdrop-blur-none pointer-events-none"}`} onClick={props.onClose} />\n      <div class={`fixed inset-y-0 right-0 w-[460px] bg-xuanqing/95 backdrop-blur-2xl border-l border-white/5 z-[900] shadow-2xl flex flex-col transition-all duration-300 ease-out ${props.isOpen ? "translate-x-0" : "translate-x-full"}`}>')
        c2 = c2.replace('</div>\n    </Show>\n  );\n};', '</div>\n    </>\n  );\n};')
    with open(path2, "w", encoding="utf-8") as f: f.write(c2)

def process_world_book_animations():
    path1 = "src/components/WorldBookSidebar.tsx"
    with open(path1, "r", encoding="utf-8") as f: c1 = f.read()
    if "<Show when={props.isOpen}>" in c1:
        c1 = c1.replace('<Show when={props.isOpen}>\n      <div class="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">\n        <div class="w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl animate-in zoom-in-95 duration-300">',
                        '<div class={`fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm transition-all duration-300 ease-out ${props.isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}>\n        <div class={`w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl transition-all duration-300 ease-out delay-75 ${props.isOpen ? "scale-100 translate-y-0 opacity-100" : "scale-[0.98] translate-y-4 opacity-0"}`}>')
        c1 = c1.replace('</div>\n      </div>\n    </Show>\n  );\n};', '</div>\n      </div>\n    </div>\n  );\n};')
    with open(path1, "w", encoding="utf-8") as f: f.write(c1)

    path2 = "src/components/WorldBookEntryArea.tsx"
    with open(path2, "r", encoding="utf-8") as f: c2 = f.read()
    if "<Show when={props.isOpen}>" in c2:
        c2 = c2.replace('<Show when={props.isOpen}>\n      <div class="fixed inset-0 z-[2000] bg-xuanqing/98 backdrop-blur-3xl animate-in fade-in duration-500 overflow-hidden flex flex-col">',
                        '<div class={`fixed inset-0 z-[2000] bg-xuanqing/98 backdrop-blur-3xl transition-all duration-300 ease-out overflow-hidden flex flex-col ${props.isOpen ? "opacity-100 pointer-events-auto scale-100" : "opacity-0 pointer-events-none scale-105"}`}>')
        c2 = c2.replace('</div>\n    </Show>\n  );\n};', '</div>\n    </div>\n  );\n};')
    
    # Accordion animation for entries
    # The entries have `<Show when={expanded()}>` without animation, let's wrap the children in a grid transition
    c2 = c2.replace('<Show when={expanded()}>\n          <div class="px-6 pb-6 pt-2 border-t border-white/5 space-y-6">',
                    '<div class={`grid transition-all duration-300 ease-in-out ${expanded() ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>\n          <div class="overflow-hidden">\n            <div class="px-6 pb-6 pt-2 border-t border-white/5 space-y-6">')
    c2 = c2.replace('</div>\n        </Show>\n      </div>\n    </div>', '</div>\n            </div>\n          </div>\n      </div>\n    </div>')
    with open(path2, "w", encoding="utf-8") as f: f.write(c2)

try:
    process_settings_area()
    process_character_sidebar()
    process_preset_drawers()
    process_world_book_animations()
    print("All processed successfully")
except Exception as e:
    print(f"Error: {e}")
