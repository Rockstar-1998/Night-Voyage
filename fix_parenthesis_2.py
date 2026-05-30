import os

files = [
    'src/components/RightDrawer.tsx',
    'src/components/NewChatModal.tsx',
    'src/components/CharacterSidebar.tsx',
    'src/components/CompletionParametersPanel.tsx',
    'src/components/SettingsArea.tsx',
    'src/components/SchemaConfigPanel.tsx',
    'src/components/CompletionDetailModal.tsx',
    'src/components/WorldBookEntryArea.tsx'
]

for filepath in files:
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # find lines ending with ` }` right before `options={[ `
    lines = content.split('\n')
    for i, line in enumerate(lines):
        if 'options={[' in line and i > 0:
            if not lines[i-1].strip().endswith(')}'):
                if lines[i-1].strip().endswith(')'):
                    # check if it is e.g. onChange={(val) => updateKey(index(), { type: val as SchemaKeyConfig['type'] })
                    lines[i-1] = lines[i-1] + '}'
                elif lines[i-1].strip().endswith('}'):
                    lines[i-1] = lines[i-1] + ')'
                
    
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
