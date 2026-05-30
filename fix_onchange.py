import os

def fix_settings():
    filepath = 'src/components/SettingsArea.tsx'
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace(
        '  onChange={() => {}})',
        '  onChange={(val) => setForm({ ...form(), providerKind: val })}'
    )
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_schema():
    filepath = 'src/components/SchemaConfigPanel.tsx'
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace(
        "  value={key.objectKind ?? 'additional_properties'}\n  onChange={() => {}})",
        "  value={key.objectKind ?? 'additional_properties'}\n  onChange={(val) => updateKey(index(), { objectKind: val })}"
    )
    content = content.replace(
        "  onChange={(val) => updateKey(index(), { additionalPropertiesType: val })\n  options={[",
        "  onChange={(val) => updateKey(index(), { additionalPropertiesType: val })}\n  options={["
    )
    content = content.replace(
        "  value={subKey.type}\n  onChange={() => {}})",
        "  value={subKey.type}\n  onChange={(val) => {\n    const newProps = [...(key.properties ?? [])];\n    newProps[subIndex()] = { ...subKey, type: val };\n    updateKey(index(), { properties: newProps });\n  }}"
    )
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

def fix_rightdrawer():
    filepath = 'src/components/RightDrawer.tsx'
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    content = content.replace(
        "  onChange={() => {}} disabled={switchingPlayerCharacter()}",
        "  onChange={(val) => { if (val) switchPlayerCharacter(Number(val)); }} disabled={switchingPlayerCharacter()}"
    )
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

fix_settings()
fix_schema()
fix_rightdrawer()
