import sys

with open('src/components/CharacterSidebar.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Refactor the character cards list
content = content.replace(
    'class="group relative aspect-video rounded-2xl overflow-hidden bg-xuanqing border border-white/10 cursor-pointer hover:border-accent/40 transition-all shadow-2xl hover:shadow-accent/10"',
    'class="group relative aspect-[3/4] overflow-hidden border-b-2 border-white/5 cursor-pointer hover:border-accent transition-all"'
)
content = content.replace(
    '<div class="absolute inset-0 bg-accent/5" />',
    ''
)
content = content.replace(
    'class="w-full h-full object-cover opacity-50 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"',
    'class="absolute inset-0 w-full h-full object-cover grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700" style={{ "-webkit-mask-image": "linear-gradient(to top, black 20%, transparent 100%)", "mask-image": "linear-gradient(to top, black 20%, transparent 100%)" }}'
)
content = content.replace(
    '<div class="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/90 via-black/40 to-transparent pointer-events-none" />',
    ''
)
content = content.replace(
    '<span class="text-[10px] px-2 py-0.5 rounded-md bg-accent/20 text-accent/90 border border-accent/10 backdrop-blur-sm">',
    '<span class="text-[9px] px-2 py-0.5 rounded-none border border-current font-bold uppercase tracking-widest text-mist-solid/60 group-hover:text-accent transition-colors">'
)

# Modal container
content = content.replace(
    'class="w-full max-w-2xl bg-xuanqing border border-white/10 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-300"',
    'class="w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl animate-in zoom-in-95 duration-300"'
)

# Text inputs and textareas
content = content.replace(
    'class="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"'
)
content = content.replace(
    'class="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid min-h-24 custom-scrollbar"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid min-h-24 custom-scrollbar"'
)
content = content.replace(
    'class="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"'
)
content = content.replace(
    'class="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid min-h-24 custom-scrollbar"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid min-h-24 custom-scrollbar"'
)
content = content.replace(
    'class="flex-1 bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid min-h-20 custom-scrollbar"',
    'class="flex-1 bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid min-h-20 custom-scrollbar"'
)

# Select inputs
content = content.replace(
    'class="w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid appearance-none"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid appearance-none"'
)
content = content.replace(
    'class="w-full bg-white/5 border border-white/5 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-accent/40 text-mist-solid appearance-none"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-xs focus:outline-none focus:border-accent transition-all text-mist-solid appearance-none"'
)

# Search input
content = content.replace(
    'class="w-full bg-xuanqing border border-white/5 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-accent/40 transition-all placeholder:text-mist-solid/20"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-accent transition-all placeholder:text-mist-solid/20"'
)
content = content.replace(
    'class="flex items-center justify-between gap-4 rounded-xl border border-white/5 bg-xuanqing p-3"',
    'class="flex items-center justify-between gap-4 border-b border-white/10 pb-4 mb-4"'
)


# Image upload area
content = content.replace(
    'class="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 flex flex-col gap-3"',
    'class="border-b border-dashed border-white/20 pb-4 flex flex-col gap-3"'
)
content = content.replace(
    'class="w-full h-40 object-cover rounded-xl bg-black/20"',
    'class="w-full h-40 object-cover bg-black/20 border border-white/5"'
)

# Base sections wrappers
content = content.replace(
    'class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3"',
    'class="border-l-2 border-white/10 pl-4 py-2 space-y-4 mb-6"'
)
content = content.replace(
    'class="text-xs text-mist-solid/35 rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3"',
    'class="text-xs text-mist-solid/35 border-l-2 border-dashed border-white/20 pl-4 py-2 mb-4"'
)

with open('src/components/CharacterSidebar.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
