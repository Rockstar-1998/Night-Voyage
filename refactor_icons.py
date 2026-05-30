import sys

with open('src/components/CompletionPresetArea.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_icons = """<span class={`mt-0.5 text-lg leading-none ${option.isSelected ? 'text-accent' : 'text-mist-solid/25'}`}>
                      {item.isChoice ? (option.isSelected ? '◉' : '○') : (option.isSelected ? '☑' : '☐')}
                    </span>"""

new_icons = """<div class={`mt-1 shrink-0 flex items-center justify-center w-4 h-4 border transition-colors ${item.isChoice ? 'rounded-full' : 'rounded-sm'} ${option.isSelected ? 'border-accent bg-accent/20' : 'border-mist-solid/30'}`}>
                      {option.isSelected && (
                        item.isChoice ? <div class="w-2 h-2 rounded-full bg-accent" /> : <div class="w-2 h-2 bg-accent" style={{ "clip-path": "polygon(14% 44%, 0 65%, 50% 100%, 100% 16%, 80% 0%, 43% 62%)" }} />
                      )}
                    </div>"""

content = content.replace(old_icons, new_icons)

old_block_icons = """<Show when={block.isEnabled} fallback={<span class="text-2xl leading-none">◯</span>}>
                  <span class="text-2xl leading-none">⬤</span>
                </Show>"""

new_block_icons = """<div class={`flex items-center justify-center w-4 h-4 border rounded-full transition-colors ${block.isEnabled ? 'border-accent bg-accent/20' : 'border-mist-solid/30'}`}>
                  {block.isEnabled && <div class="w-2 h-2 rounded-full bg-accent" />}
                </div>"""

content = content.replace(old_block_icons, new_block_icons)

with open('src/components/CompletionPresetArea.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
