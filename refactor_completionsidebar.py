import sys

with open('src/components/CompletionSidebar.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace(
    'class="w-full bg-xuanqing border border-white/5 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-accent/40 transition-all placeholder:text-mist-solid/20"',
    'class="w-full bg-transparent border-b border-white/20 rounded-none py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-accent transition-all placeholder:text-mist-solid/20"'
)

content = content.replace(
    'class="w-full flex items-center justify-between gap-4 py-3 px-4 rounded-xl bg-white/5 border border-white/5 text-mist-solid/60"',
    'class="w-full flex items-center justify-between gap-4 border-b border-white/10 pb-4 mb-4 text-mist-solid/60"'
)

content = content.replace(
    'class={`flex items-center justify-between p-4 rounded-2xl transition-all group ${props.activeGroup === group.id\n                                    ? \'bg-accent text-white shadow-lg shadow-accent/20\'\n                                    : \'text-mist-solid/40 hover:bg-white/5 hover:text-mist-solid/60\'\n                                    }`}',
    'class={`flex items-center justify-between p-4 border-l-2 transition-all group ${props.activeGroup === group.id ? \'border-accent text-white\' : \'border-transparent text-mist-solid/40 hover:border-white/10 hover:text-mist-solid/60\'}`}'
)

content = content.replace(
    'class={`text-[10px] px-1.5 py-0.5 rounded-md border ${props.activeGroup === group.id\n                                    ? \'bg-white/20 border-white/20\'\n                                    : \'bg-white/5 border-white/5\'\n                                    }`}',
    'class="text-[10px] px-1.5 py-0.5 rounded-none border border-current"'
)

with open('src/components/CompletionSidebar.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
