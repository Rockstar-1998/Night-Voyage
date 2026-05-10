import { Component, For, Show, createEffect, createSignal } from 'solid-js';
import { ArrowRightToLine, Plus, Save, SlidersHorizontal, Trash2 } from '../lib/icons';
import type { PresetDetail } from '../lib/backend';
import { IconButton } from './ui/IconButton';

export interface PresetProviderOverrideDraft {
  providerKind: string;
  temperatureOverride: string;
  maxOutputTokensOverride: string;
  topPOverride: string;
  presencePenaltyOverride: string;
  frequencyPenaltyOverride: string;
  responseModeOverride: string;
  stopSequencesOverrideText: string;
  disabledBlockTypesText: string;
}

export interface PresetSettingsDraft {
  name: string;
  description: string;
  category: string;
  temperature: string;
  maxOutputTokens: string;
  topP: string;
  presencePenalty: string;
  frequencyPenalty: string;
  responseMode: string;
  stopSequencesText: string;
  providerOverrides: PresetProviderOverrideDraft[];
}

const EMPTY_PROVIDER_OVERRIDE: PresetProviderOverrideDraft = {
  providerKind: '',
  temperatureOverride: '',
  maxOutputTokensOverride: '',
  topPOverride: '',
  presencePenaltyOverride: '',
  frequencyPenaltyOverride: '',
  responseModeOverride: '',
  stopSequencesOverrideText: '',
  disabledBlockTypesText: '',
};

const EMPTY_PRESET_SETTINGS_DRAFT: PresetSettingsDraft = {
  name: '',
  description: '',
  category: 'general',
  temperature: '',
  maxOutputTokens: '',
  topP: '',
  presencePenalty: '',
  frequencyPenalty: '',
  responseMode: '',
  stopSequencesText: '',
  providerOverrides: [],
};

const numberToString = (value?: number) => (value == null ? '' : String(value));

const buildDraftFromDetail = (detail: PresetDetail | null): PresetSettingsDraft => {
  if (!detail) {
    return { ...EMPTY_PRESET_SETTINGS_DRAFT, providerOverrides: [] };
  }

  return {
    name: detail.preset.name,
    description: detail.preset.description ?? '',
    category: detail.preset.category,
    temperature: numberToString(detail.preset.temperature),
    maxOutputTokens: numberToString(detail.preset.maxOutputTokens),
    topP: numberToString(detail.preset.topP),
    presencePenalty: numberToString(detail.preset.presencePenalty),
    frequencyPenalty: numberToString(detail.preset.frequencyPenalty),
    responseMode: detail.preset.responseMode ?? '',
    stopSequencesText: detail.stopSequences.map((item) => item.stopText).join('\n'),
    providerOverrides: detail.providerOverrides.map((override) => ({
      providerKind: override.providerKind,
      temperatureOverride: numberToString(override.temperatureOverride),
      maxOutputTokensOverride: numberToString(override.maxOutputTokensOverride),
      topPOverride: numberToString(override.topPOverride),
      presencePenaltyOverride: numberToString(override.presencePenaltyOverride),
      frequencyPenaltyOverride: numberToString(override.frequencyPenaltyOverride),
      responseModeOverride: override.responseModeOverride ?? '',
      stopSequencesOverrideText: override.stopSequencesOverride.join('\n'),
      disabledBlockTypesText: override.disabledBlockTypes.join('\n'),
    })),
  };
};

export const CompletionParametersPanel: Component<{
  isOpen: boolean;
  mode: 'create' | 'edit';
  detail: PresetDetail | null;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSave: (draft: PresetSettingsDraft) => void;
}> = (props) => {
  const [draft, setDraft] = createSignal<PresetSettingsDraft>({
    ...EMPTY_PRESET_SETTINGS_DRAFT,
    providerOverrides: [],
  });

  createEffect(() => {
    if (!props.isOpen) return;
    if (props.mode === 'create') {
      setDraft({
        ...EMPTY_PRESET_SETTINGS_DRAFT,
        providerOverrides: [],
      });
    } else {
      setDraft(buildDraftFromDetail(props.detail));
    }
  });

  const updateDraft = (patch: Partial<PresetSettingsDraft>) => {
    setDraft({ ...draft(), ...patch });
  };

  const updateProviderOverride = (index: number, patch: Partial<PresetProviderOverrideDraft>) => {
    setDraft({
      ...draft(),
      providerOverrides: draft().providerOverrides.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    });
  };

  const addProviderOverride = () => {
    setDraft({
      ...draft(),
      providerOverrides: [...draft().providerOverrides, { ...EMPTY_PROVIDER_OVERRIDE }],
    });
  };

  const removeProviderOverride = (index: number) => {
    setDraft({
      ...draft(),
      providerOverrides: draft().providerOverrides.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  const title = () => (props.mode === 'create' ? '创建预设' : '编辑预设设置');
  const saveLabel = () => (props.mode === 'create' ? '创建预设' : props.saving ? '保存中...' : '保存设置');

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-y-0 right-0 w-[460px] bg-xuanqing/95 backdrop-blur-2xl border-l border-white/5 z-[900] shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
        <div class="h-16 flex items-center justify-between px-6 border-b border-white/5 flex-shrink-0">
          <div class="flex items-center gap-2 text-mist-solid">
            <SlidersHorizontal size={18} class="text-accent" />
            <div>
              <h2 class="font-bold tracking-widest text-sm uppercase">{title()}</h2>
              <p class="text-[10px] text-mist-solid/35 mt-1">
                {props.mode === 'create' ? '新建 preset 及其基础参数' : '编辑当前 preset 的基础参数、停止序列和 provider override'}
              </p>
            </div>
          </div>
          <IconButton onClick={props.onClose} label="关闭预设设置面板" size="md">
            <ArrowRightToLine size={18} />
          </IconButton>
        </div>

        <div class="flex-1 overflow-y-auto px-6 py-6 custom-scrollbar relative">
          <div class="space-y-6 pb-24">
            <Show when={props.error}>
              <div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {props.error}
              </div>
            </Show>

            <div class="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-4">
              <div class="grid grid-cols-1 gap-4">
                <div class="space-y-2">
                  <label class="text-xs font-bold text-mist-solid/40 uppercase tracking-widest block">预设名称</label>
                  <input
                    type="text"
                    value={draft().name}
                    onInput={(e) => updateDraft({ name: e.currentTarget.value })}
                    class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                    placeholder="输入预设名称..."
                  />
                </div>
                <div class="space-y-2">
                  <label class="text-xs font-bold text-mist-solid/40 uppercase tracking-widest block">分类</label>
                  <input
                    type="text"
                    value={draft().category}
                    onInput={(e) => updateDraft({ category: e.currentTarget.value })}
                    class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                    placeholder="如 general / roleplay / creative"
                  />
                </div>
                <div class="space-y-2">
                  <label class="text-xs font-bold text-mist-solid/40 uppercase tracking-widest block">预设描述</label>
                  <textarea
                    value={draft().description}
                    onInput={(e) => updateDraft({ description: e.currentTarget.value })}
                    class="w-full min-h-24 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40 resize-none"
                    placeholder="简述该预设面向的用途与风格..."
                  />
                </div>
              </div>
            </div>

            <div class="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-4">
              <h3 class="text-xs font-bold text-mist-solid/40 uppercase tracking-widest">基础采样参数</h3>
              <div class="grid grid-cols-2 gap-4">
                <div class="space-y-2">
                  <label class="text-xs text-mist-solid/50">Temperature</label>
                  <input
                    type="text"
                    value={draft().temperature}
                    onInput={(e) => updateDraft({ temperature: e.currentTarget.value })}
                    class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                  />
                </div>
                <div class="space-y-2">
                  <label class="text-xs text-mist-solid/50">Max Output Tokens</label>
                  <input
                    type="text"
                    value={draft().maxOutputTokens}
                    onInput={(e) => updateDraft({ maxOutputTokens: e.currentTarget.value })}
                    class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                  />
                </div>
                <div class="space-y-2">
                  <label class="text-xs text-mist-solid/50">Top P</label>
                  <input
                    type="text"
                    value={draft().topP}
                    onInput={(e) => updateDraft({ topP: e.currentTarget.value })}
                    class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                  />
                </div>
                <div class="space-y-2">
                  <label class="text-xs text-mist-solid/50">Response Mode</label>
                  <select
                    value={draft().responseMode}
                    onChange={(e) => updateDraft({ responseMode: e.currentTarget.value })}
                    class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                  >
                    <option value="">默认</option>
                    <option value="text">text</option>
                    <option value="json_object">json_object</option>
                  </select>
                </div>
                <div class="space-y-2">
                  <label class="text-xs text-mist-solid/50">Presence Penalty</label>
                  <input
                    type="text"
                    value={draft().presencePenalty}
                    onInput={(e) => updateDraft({ presencePenalty: e.currentTarget.value })}
                    class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                  />
                </div>
                <div class="space-y-2">
                  <label class="text-xs text-mist-solid/50">Frequency Penalty</label>
                  <input
                    type="text"
                    value={draft().frequencyPenalty}
                    onInput={(e) => updateDraft({ frequencyPenalty: e.currentTarget.value })}
                    class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                  />
                </div>
              </div>
            </div>

            <div class="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-3">
              <h3 class="text-xs font-bold text-mist-solid/40 uppercase tracking-widest">停止序列</h3>
              <textarea
                value={draft().stopSequencesText}
                onInput={(e) => updateDraft({ stopSequencesText: e.currentTarget.value })}
                class="w-full min-h-28 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40 resize-none"
                placeholder="每行一个 stop sequence，或用逗号分隔..."
              />
              <p class="text-[11px] text-mist-solid/35 leading-5">基础编辑入口已接入。保存时会自动去重并交给后端做最终校验。</p>
            </div>

            <div class="bg-white/5 rounded-2xl p-4 border border-white/5 space-y-4">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <h3 class="text-xs font-bold text-mist-solid/40 uppercase tracking-widest">Provider Overrides</h3>
                  <p class="text-[11px] text-mist-solid/35 mt-2 leading-5">基础入口已接入，允许按 providerKind 做简单覆盖，不含高级调试面板。</p>
                </div>
                <IconButton onClick={addProviderOverride} label="添加 Provider Override" size="md">
                  <Plus size={16} />
                </IconButton>
              </div>

              <div class="space-y-4">
                <For each={draft().providerOverrides}>
                  {(override, index) => (
                    <div class="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-4">
                      <div class="flex items-center justify-between gap-4">
                        <div class="text-sm font-bold text-mist-solid">Provider Override #{index() + 1}</div>
                        <IconButton onClick={() => removeProviderOverride(index())} label="删除 Provider Override" tone="danger" size="md">
                          <Trash2 size={14} />
                        </IconButton>
                      </div>

                      <div class="grid grid-cols-2 gap-4">
                        <div class="space-y-2 col-span-2">
                          <label class="text-xs text-mist-solid/50">Provider Kind</label>
                          <input
                            type="text"
                            value={override.providerKind}
                            onInput={(e) => updateProviderOverride(index(), { providerKind: e.currentTarget.value })}
                            class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                            placeholder="如 openai_compatible"
                          />
                        </div>
                        <div class="space-y-2">
                          <label class="text-xs text-mist-solid/50">Temperature Override</label>
                          <input
                            type="text"
                            value={override.temperatureOverride}
                            onInput={(e) => updateProviderOverride(index(), { temperatureOverride: e.currentTarget.value })}
                            class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                          />
                        </div>
                        <div class="space-y-2">
                          <label class="text-xs text-mist-solid/50">Max Tokens Override</label>
                          <input
                            type="text"
                            value={override.maxOutputTokensOverride}
                            onInput={(e) => updateProviderOverride(index(), { maxOutputTokensOverride: e.currentTarget.value })}
                            class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                          />
                        </div>
                        <div class="space-y-2">
                          <label class="text-xs text-mist-solid/50">Top P Override</label>
                          <input
                            type="text"
                            value={override.topPOverride}
                            onInput={(e) => updateProviderOverride(index(), { topPOverride: e.currentTarget.value })}
                            class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                          />
                        </div>
                        <div class="space-y-2">
                          <label class="text-xs text-mist-solid/50">Response Mode Override</label>
                          <select
                            value={override.responseModeOverride}
                            onChange={(e) => updateProviderOverride(index(), { responseModeOverride: e.currentTarget.value })}
                            class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                          >
                            <option value="">默认</option>
                            <option value="text">text</option>
                            <option value="json_object">json_object</option>
                          </select>
                        </div>
                        <div class="space-y-2">
                          <label class="text-xs text-mist-solid/50">Presence Penalty Override</label>
                          <input
                            type="text"
                            value={override.presencePenaltyOverride}
                            onInput={(e) => updateProviderOverride(index(), { presencePenaltyOverride: e.currentTarget.value })}
                            class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                          />
                        </div>
                        <div class="space-y-2">
                          <label class="text-xs text-mist-solid/50">Frequency Penalty Override</label>
                          <input
                            type="text"
                            value={override.frequencyPenaltyOverride}
                            onInput={(e) => updateProviderOverride(index(), { frequencyPenaltyOverride: e.currentTarget.value })}
                            class="w-full bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                          />
                        </div>
                        <div class="space-y-2 col-span-2">
                          <label class="text-xs text-mist-solid/50">Stop Sequences Override</label>
                          <textarea
                            value={override.stopSequencesOverrideText}
                            onInput={(e) => updateProviderOverride(index(), { stopSequencesOverrideText: e.currentTarget.value })}
                            class="w-full min-h-24 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40 resize-none"
                            placeholder="每行一个 stop sequence，或用逗号分隔..."
                          />
                        </div>
                        <div class="space-y-2 col-span-2">
                          <label class="text-xs text-mist-solid/50">Disabled Block Types</label>
                          <textarea
                            value={override.disabledBlockTypesText}
                            onInput={(e) => updateProviderOverride(index(), { disabledBlockTypesText: e.currentTarget.value })}
                            class="w-full min-h-24 bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40 resize-none"
                            placeholder="每行一个 blockType，或用逗号分隔..."
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </For>
                <Show when={draft().providerOverrides.length === 0}>
                  <div class="rounded-2xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-mist-solid/35">
                    当前没有 provider override。
                  </div>
                </Show>
              </div>
            </div>
          </div>

          <div class="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-xuanqing via-xuanqing/90 to-transparent flex items-center justify-between gap-4 pointer-events-none">
            <div class="pointer-events-auto">
              <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">保存操作</div>
              <div class="text-sm text-mist-solid/40 mt-1">{saveLabel()}</div>
            </div>
            <IconButton
              class="pointer-events-auto"
              onClick={() => props.onSave(draft())}
              disabled={props.saving}
              label={saveLabel()}
              tone="accent"
              size="lg"
            >
              <Save size={18} class={props.saving ? 'animate-pulse' : ''} />
            </IconButton>
          </div>
        </div>
      </div>
    </Show>
  );
};
