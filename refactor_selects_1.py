import os
import re

def replace_in_file(filepath, replacements):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Add import Select if needed
    if 'from "./ui/Select"' not in content and "from '../ui/Select'" not in content:
        if 'src/components/ui' in filepath:
            pass # Select is in ui
        else:
            # Figure out import path
            import_path = "'./ui/Select'" if filepath.count('/') == 2 else "'../ui/Select'"
            if filepath == 'src/components/WorldBookEntryArea.tsx':
                import_path = "'./ui/Select'"
            # insert import Select at the last import
            last_import_match = list(re.finditer(r'^import .*?;?\n', content, re.MULTILINE))
            if last_import_match:
                last_import = last_import_match[-1]
                content = content[:last_import.end()] + f'import {{ Select }} from {import_path};\n' + content[last_import.end():]

    for old, new in replacements:
        if old not in content:
            print(f"Warning: Chunk not found in {filepath}:\n{old[:50]}...")
        content = content.replace(old, new)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

replacements_rightdrawer = [
    (
        '''<select
                value={form().providerKind}
                onChange={(e) => setForm({ ...form(), providerKind: e.currentTarget.value })}
                class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
              >
                <option value="openai_compatible">OpenAI Compatible (Default)</option>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="google_gemini">Google Gemini</option>
              </select>''',
        '''<Select
                value={form().providerKind}
                onChange={(val) => setForm({ ...form(), providerKind: val })}
                options={[
                  { label: "OpenAI Compatible (Default)", value: "openai_compatible" },
                  { label: "Anthropic (Claude)", value: "anthropic" },
                  { label: "Google Gemini", value: "google_gemini" }
                ]}
              />'''
    ),
    (
        '''<select
                value={form().requestFormat}
                onChange={(e) => setForm({ ...form(), requestFormat: e.currentTarget.value })}
                class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
              >
                <option value="default">Default</option>
                <option value="anthropic_messages">Anthropic Messages API</option>
              </select>''',
        '''<Select
                value={form().requestFormat}
                onChange={(val) => setForm({ ...form(), requestFormat: val })}
                options={[
                  { label: "Default", value: "default" },
                  { label: "Anthropic Messages API", value: "anthropic_messages" }
                ]}
              />'''
    ),
    (
        '''<select
                  value={form().defaultPresetId ?? ''}
                  onChange={(e) => setForm({ ...form(), defaultPresetId: e.currentTarget.value ? parseInt(e.currentTarget.value, 10) : null })}
                  class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
                >
                  <option value="">（不使用预设）</option>
                  <For each={presetSummaries()}>
                    {(preset) => <option value={preset.id}>{preset.name}</option>}
                  </For>
                </select>''',
        '''<Select
                  value={form().defaultPresetId?.toString() ?? ''}
                  onChange={(val) => setForm({ ...form(), defaultPresetId: val ? parseInt(val, 10) : null })}
                  options={[
                    { label: "（不使用预设）", value: "" },
                    ...presetSummaries().map(p => ({ label: p.name, value: p.id.toString() }))
                  ]}
                />'''
    )
]

replacements_newchat = [
    (
        '''<select
                    value={draft().presetId ?? ''}
                    onChange={(e) => updateDraft({ presetId: e.currentTarget.value ? parseInt(e.currentTarget.value, 10) : null })}
                    class="w-full bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid disabled:opacity-40 appearance-none"
                    disabled={saving()}
                  >
                    <option value="">（继承模型默认预设）</option>
                    <For each={props.presetSummaries}>
                      {(preset) => <option value={preset.id}>{preset.name}</option>}
                    </For>
                  </select>''',
        '''<Select
                    disabled={saving()}
                    value={draft().presetId?.toString() ?? ''}
                    onChange={(val) => updateDraft({ presetId: val ? parseInt(val, 10) : null })}
                    options={[
                      { label: "（继承模型默认预设）", value: "" },
                      ...props.presetSummaries.map(p => ({ label: p.name, value: p.id.toString() }))
                    ]}
                  />'''
    ),
    (
        '''<select
                    value={draft().apiConfigId ?? ''}
                    onChange={(e) => updateDraft({ apiConfigId: e.currentTarget.value ? parseInt(e.currentTarget.value, 10) : null })}
                    class="w-full bg-transparent border-b-2 border-white/20 rounded-none py-3 px-1 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid disabled:opacity-40 appearance-none"
                    disabled={saving()}
                  >
                    <option value="">（请选择 API 配置）</option>
                    <For each={props.apiConfigs}>
                      {(config) => <option value={config.id}>{config.name}</option>}
                    </For>
                  </select>''',
        '''<Select
                    disabled={saving()}
                    value={draft().apiConfigId?.toString() ?? ''}
                    onChange={(val) => updateDraft({ apiConfigId: val ? parseInt(val, 10) : null })}
                    options={[
                      { label: "（请选择 API 配置）", value: "" },
                      ...props.apiConfigs.map(c => ({ label: c.name, value: c.id.toString() }))
                    ]}
                  />'''
    )
]

replacements_character = [
    (
        '''<select
                              value={file.role}
                              disabled={uploadingImage()}
                              onChange={(e) => updateLocalFile(file.id, { role: e.currentTarget.value })}
                              class="bg-transparent border-b border-white/20 rounded-none py-1 px-1 text-xs text-mist-solid focus:outline-none focus:border-accent transition-all w-24"
                            >
                              <option value="avatar">Avatar</option>
                              <option value="sprite">Sprite</option>
                              <option value="background">Background</option>
                            </select>''',
        '''<Select
                              disabled={uploadingImage()}
                              value={file.role}
                              onChange={(val) => updateLocalFile(file.id, { role: val })}
                              options={[
                                { label: "Avatar", value: "avatar" },
                                { label: "Sprite", value: "sprite" },
                                { label: "Background", value: "background" }
                              ]}
                              class="w-32"
                            />'''
    ),
    (
        '''<select
                    value={draft().presetId ?? ''}
                    onChange={(e) => updateDraft({ presetId: e.currentTarget.value ? parseInt(e.currentTarget.value, 10) : null })}
                    class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
                    disabled={saving()}
                  >
                    <option value="">（跟随全局）</option>
                    <For each={presetSummaries()}>
                      {(preset) => <option value={preset.id}>{preset.name}</option>}
                    </For>
                  </select>''',
        '''<Select
                    disabled={saving()}
                    value={draft().presetId?.toString() ?? ''}
                    onChange={(val) => updateDraft({ presetId: val ? parseInt(val, 10) : null })}
                    options={[
                      { label: "（跟随全局）", value: "" },
                      ...presetSummaries().map(p => ({ label: p.name, value: p.id.toString() }))
                    ]}
                  />'''
    ),
    (
        '''<select
                    value={draft().apiConfigId ?? ''}
                    onChange={(e) => updateDraft({ apiConfigId: e.currentTarget.value ? parseInt(e.currentTarget.value, 10) : null })}
                    class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
                    disabled={saving()}
                  >
                    <option value="">（跟随全局）</option>
                    <For each={apiConfigs()}>
                      {(config) => <option value={config.id}>{config.name}</option>}
                    </For>
                  </select>''',
        '''<Select
                    disabled={saving()}
                    value={draft().apiConfigId?.toString() ?? ''}
                    onChange={(val) => updateDraft({ apiConfigId: val ? parseInt(val, 10) : null })}
                    options={[
                      { label: "（跟随全局）", value: "" },
                      ...apiConfigs().map(c => ({ label: c.name, value: c.id.toString() }))
                    ]}
                  />'''
    )
]

replacements_completionparams = [
    (
        '''<select
                    value={draft().responseMode}
                    onChange={(e) => updateDraft({ responseMode: e.currentTarget.value })}
                    class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
                  >
                    <option value="pseudo_xml">伪 XML</option>
                    <option value="structured_json">结构化输出</option>
                  </select>''',
        '''<Select
                    value={draft().responseMode}
                    onChange={(val) => updateDraft({ responseMode: val })}
                    options={[
                      { label: "伪 XML", value: "pseudo_xml" },
                      { label: "结构化输出", value: "structured_json" }
                    ]}
                  />'''
    ),
    (
        '''<select
                            value={override.responseModeOverride}
                            onChange={(e) => updateProviderOverride(index(), { responseModeOverride: e.currentTarget.value })}
                            class="w-full bg-transparent border-b border-white/20 rounded-none py-3 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all"
                          >
                            <option value="">默认（继承预设）</option>
                            <option value="pseudo_xml">伪 XML</option>
                            <option value="structured_json">结构化输出</option>
                          </select>''',
        '''<Select
                            value={override.responseModeOverride}
                            onChange={(val) => updateProviderOverride(index(), { responseModeOverride: val })}
                            options={[
                              { label: "默认（继承预设）", value: "" },
                              { label: "伪 XML", value: "pseudo_xml" },
                              { label: "结构化输出", value: "structured_json" }
                            ]}
                          />'''
    )
]

replace_in_file('src/components/RightDrawer.tsx', replacements_rightdrawer)
replace_in_file('src/components/NewChatModal.tsx', replacements_newchat)
replace_in_file('src/components/CharacterSidebar.tsx', replacements_character)
replace_in_file('src/components/CompletionParametersPanel.tsx', replacements_completionparams)

