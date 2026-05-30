import sys

with open('src/components/NewChatModal.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Step 1 Character Cards
content = content.replace(
    'class={`relative aspect-video rounded-3xl overflow-hidden border-2 text-left transition-all ${selectedCharacterId() === character.id\n                        ? \'border-accent shadow-[0_0_30px_rgba(58,109,140,0.3)] scale-[1.02]\'\n                        : \'border-white/5 hover:border-white/20\'}`}',
    'class={`relative aspect-video text-left transition-all group ${selectedCharacterId() === character.id ? \'scale-[1.02] shadow-2xl z-10\' : \'opacity-60 hover:opacity-100\'}`}'
)
content = content.replace(
    'class="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"',
    'class={`absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-105 ${selectedCharacterId() === character.id ? \'grayscale-0\' : \'grayscale group-hover:grayscale-0\'}`} style={{ "-webkit-mask-image": "linear-gradient(to top, black 10%, transparent 100%)", "mask-image": "linear-gradient(to top, black 10%, transparent 100%)" }}'
)
content = content.replace(
    '<div class="absolute inset-0 bg-accent/5" />\n                      <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />',
    ''
)
content = content.replace(
    '<h3 class="text-xl font-bold text-white mb-2">{character.name}</h3>',
    '<h3 class={`text-xl font-bold mb-2 transition-colors ${selectedCharacterId() === character.id ? \'text-accent\' : \'text-white\'}`}>{character.name}</h3>'
)
content = content.replace(
    '<span class="text-[9px] px-2 py-0.5 rounded-md bg-accent text-white font-bold">{tag}</span>',
    '<span class={`text-[9px] px-2 py-0.5 rounded-none border border-current font-bold uppercase tracking-widest ${selectedCharacterId() === character.id ? \'text-accent\' : \'text-mist-solid/60\'}`}>{tag}</span>'
)
content = content.replace(
    '<div class="absolute top-4 right-4 bg-accent p-2 rounded-full text-white shadow-lg">',
    '<div class="absolute top-4 right-4 text-accent drop-shadow-lg">'
)

# Step 1 Player Character Cards
content = content.replace(
    'class={`relative aspect-video rounded-3xl overflow-hidden border-2 text-left transition-all ${selectedPlayerCharacterId() === character.id\n                        ? \'border-purple-500 shadow-[0_0_30px_rgba(168,85,247,0.3)] scale-[1.02]\'\n                        : \'border-white/5 hover:border-white/20\'}`}',
    'class={`relative aspect-video text-left transition-all group ${selectedPlayerCharacterId() === character.id ? \'scale-[1.02] shadow-2xl z-10\' : \'opacity-60 hover:opacity-100\'}`}'
)
content = content.replace(
    'class={`absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-105 ${selectedCharacterId() === character.id ? \'grayscale-0\' : \'grayscale group-hover:grayscale-0\'}`} style={{ "-webkit-mask-image": "linear-gradient(to top, black 10%, transparent 100%)", "mask-image": "linear-gradient(to top, black 10%, transparent 100%)" }}',
    'class={`absolute inset-0 w-full h-full object-cover transition-all duration-700 group-hover:scale-105 ${selectedPlayerCharacterId() === character.id ? \'grayscale-0\' : \'grayscale group-hover:grayscale-0\'}`} style={{ "-webkit-mask-image": "linear-gradient(to top, black 10%, transparent 100%)", "mask-image": "linear-gradient(to top, black 10%, transparent 100%)" }}'
)
content = content.replace(
    '<div class="absolute inset-0 bg-purple-500/5" />\n                      <div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />',
    ''
)
content = content.replace(
    '<h3 class={`text-xl font-bold mb-2 transition-colors ${selectedCharacterId() === character.id ? \'text-accent\' : \'text-white\'}`}>{character.name}</h3>',
    '<h3 class={`text-xl font-bold mb-2 transition-colors ${selectedPlayerCharacterId() === character.id ? \'text-purple-400\' : \'text-white\'}`}>{character.name}</h3>'
)
content = content.replace(
    '<span class={`text-[9px] px-2 py-0.5 rounded-none border border-current font-bold uppercase tracking-widest ${selectedCharacterId() === character.id ? \'text-accent\' : \'text-mist-solid/60\'}`}>{tag}</span>',
    '<span class={`text-[9px] px-2 py-0.5 rounded-none border border-current font-bold uppercase tracking-widest ${selectedPlayerCharacterId() === character.id ? \'text-purple-400\' : \'text-mist-solid/60\'}`}>{tag}</span>'
)
content = content.replace(
    '<div class="absolute top-4 right-4 bg-purple-500 p-2 rounded-full text-white shadow-lg">',
    '<div class="absolute top-4 right-4 text-purple-400 drop-shadow-lg">'
)

# Step 2 Layout
content = content.replace(
    'class="grid grid-cols-1 lg:grid-cols-2 gap-6"',
    'class="grid grid-cols-1 lg:grid-cols-2 gap-12"'
)
content = content.replace(
    'class="space-y-4 p-6 rounded-3xl bg-white/5 border border-white/5"',
    'class="space-y-6"'
)
content = content.replace(
    '<h3 class="text-xl font-bold text-white">角色实例</h3>',
    '<div class="border-b border-white/10 pb-4"><h3 class="text-xl font-bold text-white">角色实例</h3></div>'
)
content = content.replace(
    '<h3 class="text-xl font-bold text-white">实例配置</h3>',
    '<div class="border-b border-white/10 pb-4"><h3 class="text-xl font-bold text-white">实例配置</h3></div>'
)

# Step 2 Character Instance Preview
content = content.replace(
    'class="relative rounded-2xl overflow-hidden border border-white/10 bg-black/20 min-h-[220px]"',
    'class="relative min-h-[200px] border-l border-white/10 pl-6"'
)
content = content.replace(
    'class="absolute inset-0 w-full h-full object-cover opacity-45"',
    'class="absolute inset-0 w-[400px] h-full object-cover grayscale opacity-30" style={{ "-webkit-mask-image": "linear-gradient(to right, black 0%, transparent 100%)", "mask-image": "linear-gradient(to right, black 0%, transparent 100%)" }}'
)
content = content.replace(
    '<div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />',
    ''
)
content = content.replace(
    'class="relative z-10 p-6 flex flex-col justify-end min-h-[220px]"',
    'class="relative z-10 flex flex-col justify-center min-h-[200px]"'
)
content = content.replace(
    'class="text-2xl font-black text-white mb-2"',
    'class="text-3xl font-black text-white mb-3"'
)
content = content.replace(
    'class="text-sm text-mist-solid/70 line-clamp-3"',
    'class="text-sm text-mist-solid/70 line-clamp-4 max-w-sm"'
)

# Step 2 Inputs
content = content.replace(
    'class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"'
)
content = content.replace(
    'class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid placeholder-mist-solid/25"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all placeholder-mist-solid/25"'
)

# Step 2 Opening messages
content = content.replace(
    'class={`w-full text-left p-3 rounded-xl border transition-all ${\n                                selectedOpeningIndex() === idx()\n                                  ? \'bg-accent/10 border-accent/40 text-white\'\n                                  : \'bg-white/5 border-white/5 text-mist-solid/60 hover:bg-white/10\'\n                              }`}',
    'class={`w-full text-left py-3 px-1 border-b transition-all ${\n                                selectedOpeningIndex() === idx()\n                                  ? \'border-accent text-white\'\n                                  : \'border-white/10 text-mist-solid/60 hover:text-mist-solid\'\n                              }`}'
)
content = content.replace(
    'class={`w-full text-left p-3 rounded-xl border transition-all ${\n                            selectedOpeningIndex() === -1\n                              ? \'bg-accent/10 border-accent/40 text-white\'\n                              : \'bg-white/5 border-white/5 text-mist-solid/40 hover:bg-white/10\'\n                          }`}',
    'class={`w-full text-left py-3 px-1 border-b transition-all ${\n                            selectedOpeningIndex() === -1\n                              ? \'border-accent text-white\'\n                              : \'border-white/10 text-mist-solid/40 hover:text-mist-solid/70\'\n                          }`}'
)

# Step 2 Mode switch
content = content.replace(
    'class={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${conversationType() === \'single\'\n                        ? \'bg-accent/10 border-accent text-white\'\n                        : \'bg-white/5 border-white/10 text-mist-solid/60 hover:bg-white/10\'}`}',
    'class={`py-4 border-l-2 pl-4 transition-all flex items-center justify-between gap-4 ${conversationType() === \'single\'\n                        ? \'border-accent text-white\'\n                        : \'border-white/10 text-mist-solid/60 hover:border-white/30\'}`}'
)
content = content.replace(
    'class={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 ${conversationType() === \'online\'\n                        ? \'bg-purple-500/10 border-purple-500 text-white\'\n                        : \'bg-white/5 border-white/10 text-mist-solid/60 hover:bg-white/10\'}`}',
    'class={`py-4 border-l-2 pl-4 transition-all flex items-center justify-between gap-4 ${conversationType() === \'online\'\n                        ? \'border-purple-500 text-white\'\n                        : \'border-white/10 text-mist-solid/60 hover:border-white/30\'}`}'
)
content = content.replace(
    'class="grid grid-cols-1 md:grid-cols-2 gap-4"',
    'class="grid grid-cols-1 md:grid-cols-2 gap-6"'
)

# Room config wrapper
content = content.replace(
    'class="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5 space-y-4"',
    'class="border-l-2 border-purple-500/30 pl-5 py-2 space-y-4"'
)
content = content.replace(
    'class="flex items-center justify-between gap-3 rounded-xl bg-white/5 border border-white/10 px-4 py-3"',
    'class="flex items-center justify-between gap-3 border-b border-white/10 px-1 py-3"'
)

with open('src/components/NewChatModal.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
