import os
import re

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
        lines = f.readlines()
    
    cleaned_lines = []
    # Remove bad imports inserted in the middle of other multiline imports
    in_import = False
    for i, line in enumerate(lines):
        if line.startswith('import { Select }') and (i > 0 and 'import {' in lines[i-1] and not '}' in lines[i-1]):
            # skip it because it was inserted in the middle of a multiline import
            continue
        cleaned_lines.append(line)
        
    content = "".join(cleaned_lines)
    
    # Remove all 'import { Select } from ...' to easily put it at the very top
    content = re.sub(r'import \{ Select \} from [^\n]*;\n', '', content)
    
    import_path = "'./ui/Select'" if filepath.count('/') == 2 else "'../ui/Select'"
    if filepath == 'src/components/WorldBookEntryArea.tsx':
        import_path = "'./ui/Select'"
        
    # insert at the top after the first import { Component ... }
    first_import = content.find('\n')
    content = content[:first_import+1] + f"import {{ Select }} from {import_path};\n" + content[first_import+1:]

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)
