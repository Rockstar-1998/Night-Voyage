import sys

def refactor_modal(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Inputs and selects
    content = content.replace(
        'class="w-full bg-white/5 border border-white/5 rounded-2xl p-4 text-lg font-medium focus:outline-none focus:border-accent/40 text-mist-solid transition-all disabled:opacity-40"',
        'class="w-full bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-lg font-medium focus:outline-none focus:border-accent transition-all text-mist-solid disabled:opacity-40"'
    )
    content = content.replace(
        'class="w-full bg-white/5 border border-white/5 rounded-2xl p-4 text-sm focus:outline-none focus:border-accent/40 text-mist-solid transition-all disabled:opacity-40"',
        'class="w-full bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid disabled:opacity-40 appearance-none"'
    )
    content = content.replace(
        'class="w-full bg-black/20 border border-white/10 rounded-2xl p-4 text-sm text-mist-solid focus:outline-none focus:border-accent/40 disabled:opacity-40"',
        'class="w-full bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-40"'
    )
    content = content.replace(
        'class="w-full min-h-24 bg-black/20 border border-white/10 rounded-2xl p-4 text-sm text-mist-solid focus:outline-none focus:border-accent/40 disabled:opacity-40"',
        'class="w-full min-h-24 bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-40"'
    )
    content = content.replace(
        'class="w-full min-h-[280px] bg-white/5 border border-white/5 rounded-3xl p-5 text-sm focus:outline-none focus:border-accent/40 text-mist-solid transition-all resize-y font-mono disabled:opacity-40"',
        'class="w-full min-h-[280px] bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid resize-y font-mono disabled:opacity-40"'
    )
    
    # Generic block backgrounds
    content = content.replace(
        'class="rounded-3xl border border-white/5 bg-white/5 p-5 space-y-4"',
        'class="border-l-2 border-white/10 pl-5 py-2 space-y-4"'
    )
    content = content.replace(
        'class={`w-full rounded-2xl border px-4 py-4 flex items-center justify-between gap-4 transition-all ${form().isEnabled ? \'border-accent/40 bg-accent/15 text-accent\' : \'border-white/10 bg-white/5 text-mist-solid/60\'}`}',
        'class={`w-full border-b-2 py-3 px-1 flex items-center justify-between gap-4 transition-all ${form().isEnabled ? \'border-accent text-accent\' : \'border-white/20 text-mist-solid/60\'}`}'
    )

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

refactor_modal('src/components/CompletionDetailModal.tsx')
