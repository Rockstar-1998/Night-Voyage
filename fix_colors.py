import os

def fix_session_sidebar():
    path = 'src/components/SessionSidebar.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Replacing multiplayer session image classes
    content = content.replace(
        '''class="absolute top-0 right-0 h-full w-2/3 object-cover opacity-20 blur-sm transition-all duration-700 grayscale group-hover:grayscale-0 group-hover:opacity-40 group-hover:blur-none group-hover:translate-x-2"''',
        '''class={`absolute top-0 right-0 h-full w-2/3 object-cover transition-all duration-700 ${props.selectedConversationId === session.id ? 'grayscale-0 opacity-40 blur-none translate-x-2' : 'opacity-20 blur-sm grayscale group-hover:grayscale-0 group-hover:opacity-40 group-hover:blur-none group-hover:translate-x-2'}`}'''
    )

    # Note that single and multiplayer use the exact same class string. So replacing it globally works for both.

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_character_sidebar():
    path = 'src/components/CharacterSidebar.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replacing character image classes
    content = content.replace(
        'class="absolute inset-0 w-full h-full object-cover grayscale opacity-40 group-hover:grayscale-0 group-hover:opacity-100 group-hover:scale-105 transition-all duration-700"',
        'class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-all duration-700"'
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_worldbook_sidebar():
    path = 'src/components/WorldBookSidebar.tsx'
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Replacing worldbook image classes
    content = content.replace(
        'class="absolute inset-0 w-full h-full object-cover opacity-35 group-hover:opacity-60 group-hover:scale-105 transition-all duration-700"',
        'class="absolute inset-0 w-full h-full object-cover opacity-80 group-hover:scale-105 transition-all duration-700"'
    )
    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)


fix_session_sidebar()
fix_character_sidebar()
fix_worldbook_sidebar()

print("done")
