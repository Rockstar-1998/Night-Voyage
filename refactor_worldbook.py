import sys

def refactor_worldbook(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Modal container
    content = content.replace(
        'class="w-full max-w-2xl bg-xuanqing border border-white/10 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-300"',
        'class="w-full max-w-2xl bg-xuanqing border-y-2 border-white/10 p-8 shadow-2xl animate-in zoom-in-95 duration-300"'
    )

    # Inputs
    content = content.replace(
        'class="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"',
        'class="w-full bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"'
    )
    content = content.replace(
        'class="w-full bg-white/5 border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid min-h-24 custom-scrollbar"',
        'class="w-full bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid min-h-24 custom-scrollbar"'
    )

    # Image block
    content = content.replace(
        'class="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 flex flex-col gap-3"',
        'class="border-b border-dashed border-white/20 pb-4 flex flex-col gap-3"'
    )
    content = content.replace(
        'class="w-full h-40 object-cover rounded-xl bg-black/20"',
        'class="w-full h-40 object-cover bg-black/20"'
    )

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

refactor_worldbook('src/components/WorldBookSidebar.tsx')
