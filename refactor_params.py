import sys

def refactor_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Generic inputs
    content = content.replace(
        'class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"',
        'class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"'
    )
    content = content.replace(
        'class="w-full min-h-24 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40 resize-none"',
        'class="w-full min-h-24 bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all resize-none"'
    )
    content = content.replace(
        'class="w-full min-h-28 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40 resize-none"',
        'class="w-full min-h-28 bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all resize-none"'
    )
    content = content.replace(
        'class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid font-mono focus:outline-none focus:border-accent/40 resize-y"',
        'class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid font-mono focus:outline-none focus:border-accent transition-all resize-y"'
    )
    
    # Generic block backgrounds
    content = content.replace(
        'class="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-4"',
        'class="border-b border-white/10 pb-6 space-y-4"'
    )
    content = content.replace(
        'class="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-3"',
        'class="border-b border-white/10 pb-6 space-y-3"'
    )
    content = content.replace(
        'class="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-4"',
        'class="border-l-2 border-white/10 pl-4 py-2 space-y-4"'
    )
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

refactor_file('src/components/CompletionParametersPanel.tsx')
