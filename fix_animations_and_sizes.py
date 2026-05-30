import os

def fix_session_sidebar():
    path = 'src/components/SessionSidebar.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replacing multiplayer & single session image classes
    # We replace the previous complex class logic with our new arbitrary filter tailwind classes.
    # Search for the img tag
    content = content.replace(
        '''class={`absolute top-0 right-0 h-full w-2/3 object-cover transition-all duration-700 ${props.selectedConversationId === session.id ? 'grayscale-0 opacity-40 blur-none translate-x-2' : 'opacity-20 blur-sm grayscale group-hover:grayscale-0 group-hover:opacity-40 group-hover:blur-none group-hover:translate-x-2'}`}''',
        '''class={`absolute top-0 right-0 h-full w-2/3 object-cover transition-all duration-500 ease-out ${props.selectedConversationId === session.id ? 'opacity-40 [filter:grayscale(0%)_blur(0px)] translate-x-2' : 'opacity-20 [filter:grayscale(100%)_blur(4px)] translate-x-0 group-hover:opacity-40 group-hover:[filter:grayscale(0%)_blur(0px)] group-hover:translate-x-2'}`}'''
    )

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_character_sidebar():
    path = 'src/components/CharacterSidebar.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replacing aspect-[3/4] with aspect-video and adding border-l-2 to match worldbook
    content = content.replace(
        'class="group relative aspect-[3/4] overflow-hidden border-b-2 border-white/5 cursor-pointer hover:border-accent transition-all"',
        'class="group relative aspect-video overflow-hidden border-b-2 border-l-2 border-white/10 cursor-pointer hover:border-accent/40 transition-all"'
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

fix_session_sidebar()
fix_character_sidebar()

print("done")
