import os
import re

def parse_selects_and_replace(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Add import if missing
    if 'from "./ui/Select"' not in content and "from '../ui/Select'" not in content:
        import_path = "'./ui/Select'" if filepath.count('/') == 2 else "'../ui/Select'"
        if filepath == 'src/components/WorldBookEntryArea.tsx':
            import_path = "'./ui/Select'"
        last_import_match = list(re.finditer(r'^import .*?;?\n', content, re.MULTILINE))
        if last_import_match:
            last_import = last_import_match[-1]
            content = content[:last_import.end()] + f'import {{ Select }} from {import_path};\n' + content[last_import.end():]

    def replacer(match):
        full_select = match.group(0)
        
        # Extract value
        value_match = re.search(r'value=\{([^}]+)\}', full_select)
        value = value_match.group(1) if value_match else '""'

        # Extract onChange body: e.g. onChange={(e) => updateDraft({ responseMode: e.currentTarget.value })}
        # onChange={(e) => setForm({ ...form(), providerKind: e.currentTarget.value })}
        # onChange={(e) => setForm({ ...form(), defaultPresetId: e.currentTarget.value ? parseInt(e.currentTarget.value, 10) : null })}
        onchange_match = re.search(r'onChange=\{\(e\) => (.*?)\}', full_select)
        if not onchange_match:
            onchange_match = re.search(r'onChange=\{\([^)]+\) => (.*?)\}', full_select)

        if onchange_match:
            onchange_body = onchange_match.group(1)
            # Replace e.currentTarget.value or e.target.value with `val`
            onchange_body = onchange_body.replace('e.currentTarget.value', 'val')
            onchange_body = onchange_body.replace('e.target.value', 'val')
            onchange_str = f'onChange={{(val) => {onchange_body}}}'
        else:
            onchange_str = 'onChange={() => {}}'

        # Extract disabled
        disabled_match = re.search(r'disabled={([^}]+)}', full_select)
        disabled_str = f' disabled={{{disabled_match.group(1)}}}' if disabled_match else ''

        # Extract options
        # <option value="pseudo_xml">伪 XML</option>
        # <For each={props.presetSummaries}>{(preset) => <option value={preset.id}>{preset.name}</option>}</For>
        options_list = []
        
        for option_match in re.finditer(r'<option[^>]*value="([^"]*)"[^>]*>(.*?)</option>', full_select):
            val = option_match.group(1)
            label = option_match.group(2)
            options_list.append(f'{{ label: "{label}", value: "{val}" }}')
            
        for for_match in re.finditer(r'<For each=\{([^\}]+)\}>.*?<option value=\{([^\}]+)\}>\{([^\}]+)\}</option>.*?</For>', full_select, re.DOTALL):
            arr = for_match.group(1)
            val_expr = for_match.group(2)
            label_expr = for_match.group(3)
            # e.g. arr = props.presetSummaries, val_expr = preset.id, label_expr = preset.name
            # need to figure out variable name used in For, usually preset
            var_match = re.search(r'\{\(([^)]+)\) =>', for_match.group(0))
            var_name = var_match.group(1) if var_match else 'item'
            
            # map to ...arr.map(var => ({ label: label_expr, value: val_expr.toString() }))
            options_list.append(f'...({arr}).map({var_name} => ({{ label: {label_expr}, value: ({val_expr})?.toString() }}))')

        options_str = ',\n  '.join(options_list)

        # Handle value string conversion if necessary
        # The Select component expects value to be a string.
        # If the original value is `form().defaultPresetId ?? ''`, we might want to do `form().defaultPresetId?.toString() ?? ''`
        if '?? \'\'' in value:
            # form().defaultPresetId ?? '' -> form().defaultPresetId?.toString() ?? ''
            # draft().presetId ?? '' -> draft().presetId?.toString() ?? ''
            value = value.replace(' ?? \'\'', '?.toString() ?? \'\'')
        
        # Build new tag
        new_tag = f'''<Select
  value={{{value}}}
  {onchange_str}{disabled_str}
  options={{[
  {options_str}
  ]}}
/>'''
        return new_tag

    # Match <select> ... </select> across multiple lines
    new_content = re.sub(r'<select[\s\S]*?</select>', replacer, content)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)

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

for file in files:
    parse_selects_and_replace(file)
    print(f"Refactored {file}")
