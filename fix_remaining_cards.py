import os

def fix_completion_preset_area():
    path = 'src/components/CompletionPresetArea.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace(
        'rounded-2xl border border-white/10 bg-white/5',
        'border-l-2 border-white/10 bg-transparent'
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_world_book_sidebar():
    path = 'src/components/WorldBookSidebar.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # search input
    content = content.replace(
        'w-full bg-xuanqing border border-white/5 rounded-xl py-3 pl-12 pr-4',
        'w-full bg-transparent border-b-2 border-white/10 py-3 pl-12 pr-4 rounded-none'
    )
    
    # world book cards
    content = content.replace(
        'rounded-2xl overflow-hidden bg-xuanqing border border-white/10',
        'overflow-hidden bg-transparent border-b-2 border-l-2 border-white/10 rounded-none'
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_world_book_entry_area():
    path = 'src/components/WorldBookEntryArea.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # search input
    content = content.replace(
        'w-full bg-xuanqing border border-white/5 rounded-xl py-2.5 pl-11 pr-4',
        'w-full bg-transparent border-b border-white/20 rounded-none py-2.5 pl-11 pr-4'
    )
    
    # new entry operation block
    content = content.replace(
        'rounded-2xl border border-white/5 bg-white/5',
        'border-l-2 border-white/10 bg-transparent'
    )
    
    # V2 logic alert
    content = content.replace(
        'rounded-2xl border border-accent/20 bg-accent/5 p-4 text-sm text-mist-solid/80 shadow-lg shadow-accent/5',
        'border-l-2 border-accent/40 bg-transparent p-4 text-sm text-mist-solid/80 mb-2'
    )
    
    # entry items
    content = content.replace(
        "flex flex-col rounded-xl border transition-all ${expandedEntryId() === item.id ? 'bg-xuanqing/80 border-accent/40 shadow-xl' : 'bg-xuanqing/40 border-white/5 hover:border-white/10 hover:bg-xuanqing/60 cursor-pointer'}",
        "flex flex-col border-b border-white/10 transition-all ${expandedEntryId() === item.id ? 'bg-black/20 border-accent/40' : 'bg-transparent border-transparent hover:bg-white/5 cursor-pointer'}"
    )
    
    # chevron bg
    content = content.replace(
        'p-1 rounded-md bg-white/5 text-mist-solid/20 group-hover:text-mist-solid/40',
        'p-1 text-mist-solid/20 group-hover:text-mist-solid/40'
    )
    
    # expanded body bg
    content = content.replace(
        'p-4 pt-0 border-t border-white/5 mt-1 bg-black/10',
        'p-4 pt-0 mt-1'
    )
    
    # inner inputs
    content = content.replace(
        'w-full bg-xuanqing border border-white/5 rounded-xl px-4 py-2',
        'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1'
    )
    content = content.replace(
        'w-full flex-1 min-h-[160px] bg-xuanqing border border-white/5 rounded-xl px-4 py-3',
        'w-full flex-1 min-h-[160px] bg-transparent border-b border-white/20 rounded-none px-1 py-3'
    )
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

fix_completion_preset_area()
fix_world_book_sidebar()
fix_world_book_entry_area()

print('done')
