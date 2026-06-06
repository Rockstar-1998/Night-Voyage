import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Select } from './ui/Select';
import { Save, RefreshCw, CheckCircle2, ChevronDown, Plus, Trash2, Pencil } from '../lib/icons';
import type { ApiProviderSummary, RemoteModel } from '../lib/backend';
import { type MessageFormatConfig, type CustomFormatRule } from '../lib/messageFormatter';

interface ProviderFormState {
  id?: number;
  name: string;
  providerKind: 'openai_compatible' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

interface ClaudeNativeTestFormState {
  testModel: string;
  timeoutSeconds: string;
  testPrompt: string;
  degradedThresholdMs: string;
  maxRetries: string;
}

interface ProviderClaudeNativeTestResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  attemptCount: number;
  degraded: boolean;
  degradedThresholdMs: number;
  model: string;
  responsePreview: string;
}

export interface MobileSettingsAreaProps {
  activeCategory: string;
  providers: ApiProviderSummary[];
  modelsByProvider?: Record<number, RemoteModel[]>;
  loading?: boolean;
  fetchingModelsFor?: number | null;
  onFetchModels: (providerId: number) => Promise<void> | void;
  onSaveProvider: (payload: {
    id?: number;
    name: string;
    providerKind: 'openai_compatible' | 'anthropic';
    baseUrl: string;
    apiKey?: string;
    modelName: string;
  }) => Promise<void> | void;
  onDeleteProvider: (id: number) => Promise<void> | void;
  onTestClaudeNative: (payload: {
    providerId: number;
    testModel: string;
    testPrompt?: string;
    timeoutSeconds?: number;
    degradedThresholdMs?: number;
    maxRetries?: number;
  }) => Promise<ProviderClaudeNativeTestResult> | ProviderClaudeNativeTestResult;
  enableDynamicEffects: boolean;
  onSetEnableDynamicEffects: (enabled: boolean) => void;
  formatConfig: MessageFormatConfig;
  onSetFormatConfig: (config: MessageFormatConfig) => void;
}

const EMPTY_FORM: ProviderFormState = {
  name: '',
  providerKind: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  modelName: '',
};

const DEFAULT_CLAUDE_TEST_FORM: ClaudeNativeTestFormState = {
  testModel: 'claude-opus-4-6',
  timeoutSeconds: '45',
  testPrompt: 'Who are you?',
  degradedThresholdMs: '6000',
  maxRetries: '2',
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return '操作失败，请查看控制台或后端日志。';
}

function requireNonEmpty(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} 不能为空`);
  }
  return trimmed;
}

function parsePositiveIntegerField(label: string, value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} 必须是正整数`);
  }
  return Number(trimmed);
}

function countCapturingGroups(pattern: string): number {
  let count = 0;
  let escaped = false;
  let inCharacterClass = false;

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[') {
      inCharacterClass = true;
      continue;
    }
    if (char === ']' && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass || char !== '(') {
      continue;
    }

    if (pattern[index + 1] !== '?') {
      count++;
      continue;
    }

    if (pattern[index + 2] === '<' && pattern[index + 3] !== '=' && pattern[index + 3] !== '!') {
      count++;
    }
  }

  return count;
}

function validateCustomRulePattern(pattern: string, groupIndex: number): string | null {
  if (!pattern.trim()) return null;
  if (!Number.isInteger(groupIndex) || groupIndex < 0) {
    return '匹配组索引必须是大于等于 0 的整数';
  }

  try {
    new RegExp(pattern, 'd');
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  const captureCount = countCapturingGroups(pattern);
  if (groupIndex > captureCount) {
    return `匹配组 ${groupIndex} 不存在；当前正则只有 0-${captureCount} 组`;
  }

  return null;
}

export const MobileSettingsArea: Component<MobileSettingsAreaProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<'api' | 'appearance'>('api');
  const [selectedProviderId, setSelectedProviderId] = createSignal<number | null>(null);
  const [form, setForm] = createSignal<ProviderFormState>(EMPTY_FORM);
  const [isSaved, setIsSaved] = createSignal(false);
  const [isCreatingNew, setIsCreatingNew] = createSignal(false);
  const [isSaving, setIsSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  const [claudeTestForm, setClaudeTestForm] =
    createSignal<ClaudeNativeTestFormState>(DEFAULT_CLAUDE_TEST_FORM);
  const [isTestingClaudeNative, setIsTestingClaudeNative] = createSignal(false);
  const [claudeTestError, setClaudeTestError] = createSignal<string | null>(null);
  const [claudeTestResult, setClaudeTestResult] =
    createSignal<ProviderClaudeNativeTestResult | null>(null);
  const [editingCustomRule, setEditingCustomRule] = createSignal<CustomFormatRule | null>(null);
  const [isAddingCustomRule, setIsAddingCustomRule] = createSignal(false);
  const [customRuleDraft, setCustomRuleDraft] = createSignal({
    name: '',
    pattern: '',
    groupIndex: 0,
    color: '#A78BFA',
    italic: false,
    bold: false,
  });
  const [patternError, setPatternError] = createSignal<string | null>(null);
  const [showProviderForm, setShowProviderForm] = createSignal(false);

  const updateCustomRuleDraft = (patch: Partial<ReturnType<typeof customRuleDraft>>) => {
    const next = { ...customRuleDraft(), ...patch };
    setCustomRuleDraft(next);
    setPatternError(validateCustomRulePattern(next.pattern, next.groupIndex));
  };

  createEffect(() => {
    const providers = props.providers;
    const currentSelected = selectedProviderId();
    if (providers.length === 0) {
      setSelectedProviderId(null);
      setForm(EMPTY_FORM);
      return;
    }
    if (isCreatingNew()) {
      return;
    }
    if (currentSelected == null || !providers.some((provider) => provider.id === currentSelected)) {
      const next = providers[0];
      setSelectedProviderId(next.id);
    }
  });

  createEffect(() => {
    const providerId = selectedProviderId();
    if (providerId == null || isCreatingNew()) return;
    const provider = props.providers.find((item) => item.id === providerId);
    if (!provider) return;
    setForm({
      id: provider.id,
      name: provider.name,
      providerKind: provider.providerKind === 'anthropic' ? 'anthropic' : 'openai_compatible',
      baseUrl: provider.baseUrl,
      apiKey: '',
      modelName: provider.modelName,
    });
  });

  createEffect(() => {
    const currentForm = form();
    if (currentForm.providerKind !== 'anthropic') {
      setClaudeTestError(null);
      setClaudeTestResult(null);
      return;
    }

    const provider = currentForm.id == null
      ? null
      : props.providers.find((item) => item.id === currentForm.id) ?? null;
    const suggestedModel = provider?.modelName?.trim() || DEFAULT_CLAUDE_TEST_FORM.testModel;
    setClaudeTestForm((previous) => ({
      ...previous,
      testModel: previous.testModel.trim() ? previous.testModel : suggestedModel,
    }));
  });

  const currentModels = createMemo(() => {
    const providerId = selectedProviderId();
    if (providerId == null || !props.modelsByProvider) return [];
    return props.modelsByProvider[providerId] ?? [];
  });

  const isFetchingCurrentProvider = createMemo(() => {
    const providerId = selectedProviderId();
    return providerId != null && props.fetchingModelsFor === providerId;
  });

  const canRunClaudeNativeTest = createMemo(
    () => form().providerKind === 'anthropic' && form().id != null,
  );

  const handleNew = () => {
    setIsCreatingNew(true);
    setSelectedProviderId(null);
    setSaveError(null);
    setIsSaved(false);
    setClaudeTestError(null);
    setClaudeTestResult(null);
    setClaudeTestForm(DEFAULT_CLAUDE_TEST_FORM);
    setForm({ ...EMPTY_FORM });
    setShowProviderForm(true);
  };

  const handleSelectProvider = (providerId: number) => {
    setIsCreatingNew(false);
    setSelectedProviderId(providerId);
    setSaveError(null);
    setIsSaved(false);
    setClaudeTestError(null);
    setClaudeTestResult(null);
    setShowProviderForm(true);
  };

  const handleBackToList = () => {
    setShowProviderForm(false);
    setIsCreatingNew(false);
    setSaveError(null);
    setIsSaved(false);
    setClaudeTestError(null);
    setClaudeTestResult(null);
  };

  const handleSave = async () => {
    const value = form();
    const payload = {
      id: value.id,
      name: value.name,
      providerKind: value.providerKind,
      baseUrl: value.baseUrl,
      apiKey: value.apiKey.trim() ? value.apiKey : undefined,
      modelName: value.modelName,
    };

    setIsSaving(true);
    setSaveError(null);
    setIsSaved(false);

    try {
      await props.onSaveProvider(payload);
      setIsCreatingNew(false);
      setIsSaved(true);
      window.setTimeout(() => setIsSaved(false), 1800);
    } catch (error) {
      const message = toErrorMessage(error);
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClaudeNativeTest = async () => {
    const providerId = form().id;
    if (providerId == null) {
      setClaudeTestError('请先保存档案后再执行 Claude 原生测试。');
      return;
    }

    let payload: {
      providerId: number;
      testModel: string;
      testPrompt?: string;
      timeoutSeconds?: number;
      degradedThresholdMs?: number;
      maxRetries?: number;
    };

    try {
      const config = claudeTestForm();
      payload = {
        providerId,
        testModel: requireNonEmpty('测试模型', config.testModel),
        testPrompt: config.testPrompt.trim() || undefined,
        timeoutSeconds: parsePositiveIntegerField('超时时间', config.timeoutSeconds),
        degradedThresholdMs: parsePositiveIntegerField('降级阈值', config.degradedThresholdMs),
        maxRetries: parsePositiveIntegerField('最大重试次数', config.maxRetries),
      };
    } catch (error) {
      setClaudeTestError(toErrorMessage(error));
      setClaudeTestResult(null);
      return;
    }

    setIsTestingClaudeNative(true);
    setClaudeTestError(null);
    setClaudeTestResult(null);

    try {
      const result = await props.onTestClaudeNative(payload);
      setClaudeTestResult(result);
    } catch (error) {
      const message = toErrorMessage(error);
      setClaudeTestError(message);
    } finally {
      setIsTestingClaudeNative(false);
    }
  };

  const ToggleSwitch: Component<{ checked: boolean; onChange: () => void; label?: string }> = (p) => (
    <button
      onClick={() => p.onChange()}
      class={`relative w-12 h-7 rounded-full transition-all duration-300 shrink-0 ${
        p.checked
          ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
          : 'bg-white/10'
      }`}
      role="switch"
      aria-checked={p.checked}
    >
      <div
        class={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
          p.checked ? 'left-6' : 'left-0.5'
        }`}
      />
    </button>
  );

  const SectionLabel: Component<{ children: string }> = (p) => (
    <label class="text-[10px] font-bold text-mist-solid/30 uppercase tracking-wider">
      {p.children}
    </label>
  );

  const MobileInput: Component<{
    type?: string;
    value: string;
    onInput: (e: InputEvent & { currentTarget: HTMLInputElement }) => void;
    placeholder?: string;
  }> = (p) => (
    <input
      type={p.type || 'text'}
      value={p.value}
      onInput={p.onInput}
      placeholder={p.placeholder}
      class="w-full bg-transparent border-b border-white/20 rounded-none px-0 py-2.5 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid placeholder:text-mist-solid/20"
    />
  );

  return (
    <div class="flex-1 flex flex-col h-full bg-transparent overflow-hidden">
      {/* Tab Bar */}
      <div class="flex border-b border-white/5 shrink-0">
        <button
          onClick={() => setActiveTab('api')}
          class={`flex-1 py-3 text-sm font-medium transition-all ${
            activeTab() === 'api'
              ? 'text-accent border-b-2 border-accent'
              : 'text-mist-solid/40'
          }`}
        >
          API 档案
        </button>
        <button
          onClick={() => setActiveTab('appearance')}
          class={`flex-1 py-3 text-sm font-medium transition-all ${
            activeTab() === 'appearance'
              ? 'text-accent border-b-2 border-accent'
              : 'text-mist-solid/40'
          }`}
        >
          外观
        </button>
      </div>

      <div class="flex-1 overflow-y-auto custom-scrollbar">
        <Show when={activeTab() === 'api'}>
          <div class="px-4 py-4 space-y-4">
            {/* Provider List */}
            <Show when={!showProviderForm()}>
              <div class="flex items-center justify-between">
                <div>
                  <h2 class="text-lg font-bold text-mist-solid">API 档案</h2>
                  <p class="text-xs text-mist-solid/40 mt-0.5">
                    管理 OpenAI 兼容与 Anthropic 原生 API 档案
                  </p>
                </div>
                <button
                  onClick={handleNew}
                  class="flex items-center gap-1 px-3 py-2 rounded-xl bg-accent/20 text-accent text-xs font-medium border border-accent/20 hover:bg-accent/30 transition-colors"
                >
                  <Plus size={14} />
                  新建
                </button>
              </div>

              <Show when={props.loading}>
                <div class="text-sm text-mist-solid/35 py-4">正在加载档案...</div>
              </Show>

              <div class="space-y-2">
                <For each={props.providers}>
                  {(provider) => (
                    <button
                      onClick={() => handleSelectProvider(provider.id)}
                      class={`w-full text-left p-3 rounded-xl border transition-all ${
                        selectedProviderId() === provider.id && !isCreatingNew()
                          ? 'border-accent/30 bg-accent/5'
                          : 'border-white/5 bg-white/[0.02] hover:border-white/10'
                      }`}
                    >
                      <div class="flex items-center justify-between gap-2 mb-1">
                        <h3 class="text-sm font-bold text-white truncate">{provider.name}</h3>
                        <span class="text-[10px] text-mist-solid/35 uppercase tracking-wider shrink-0">
                          {provider.providerKind}
                        </span>
                      </div>
                      <p class="text-xs text-mist-solid/40 truncate">{provider.modelName}</p>
                      <p class="text-[10px] text-mist-solid/25 mt-1">
                        {provider.apiKeyPreview ?? '未配置密钥'}
                      </p>
                    </button>
                  )}
                </For>
              </div>
            </Show>

            {/* Provider Form */}
            <Show when={showProviderForm()}>
              <button
                onClick={handleBackToList}
                class="text-xs text-mist-solid/40 hover:text-mist-solid transition-colors flex items-center gap-1"
              >
                <ChevronDown size={14} class="-rotate-90" />
                返回列表
              </button>

              <div class="space-y-5 pt-2">
                <div class="space-y-1.5">
                  <SectionLabel>档案名称</SectionLabel>
                  <MobileInput
                    value={form().name}
                    onInput={(e) => setForm({ ...form(), name: e.currentTarget.value })}
                  />
                </div>

                <div class="space-y-1.5">
                  <SectionLabel>Provider 类型</SectionLabel>
                  <Select
                    value={form().providerKind}
                    onChange={(val) => setForm({ ...form(), providerKind: val as 'openai_compatible' | 'anthropic' })}
                    options={[
                      { label: 'openai_compatible', value: 'openai_compatible' },
                      { label: 'anthropic', value: 'anthropic' },
                      { label: 'google_gemini', value: 'google_gemini' },
                    ]}
                  />
                </div>

                <div class="space-y-1.5">
                  <SectionLabel>接口地址 (Base URL)</SectionLabel>
                  <MobileInput
                    value={form().baseUrl}
                    onInput={(e) => setForm({ ...form(), baseUrl: e.currentTarget.value })}
                  />
                </div>

                <div class="space-y-1.5">
                  <SectionLabel>API Key</SectionLabel>
                  <MobileInput
                    type="password"
                    value={form().apiKey}
                    onInput={(e) => setForm({ ...form(), apiKey: e.currentTarget.value })}
                    placeholder={form().id ? '留空表示不更新密钥' : 'sk-...'}
                  />
                </div>

                <div class="rounded-xl border border-dashed border-white/10 px-3 py-2.5 text-xs text-mist-solid/35">
                  MAX TOKENS 与 TEMPERATURE 已从 API 档案中移除，后续由聊天预设统一定义。
                </div>

                {/* Model Selection */}
                <div class="space-y-3 pt-2 border-t border-white/5">
                  <div class="flex items-center justify-between gap-3 py-2 border-b border-white/5">
                    <div>
                      <SectionLabel>模型选择</SectionLabel>
                      <p class="text-[11px] text-mist-solid/25 mt-0.5">
                        从当前档案对应服务端拉取模型列表
                      </p>
                    </div>
                    <button
                      onClick={() =>
                        selectedProviderId() != null && props.onFetchModels(selectedProviderId()!)
                      }
                      disabled={selectedProviderId() == null || isFetchingCurrentProvider()}
                      class={`p-2.5 rounded-xl border border-white/10 text-mist-solid/40 transition-all ${
                        isFetchingCurrentProvider()
                          ? 'text-accent'
                          : selectedProviderId() == null
                            ? 'opacity-30'
                            : 'hover:bg-white/5 hover:text-mist-solid'
                      }`}
                      title={
                        isFetchingCurrentProvider()
                          ? '正在拉取模型列表'
                          : selectedProviderId() == null
                            ? '请先保存档案'
                            : '拉取模型列表'
                      }
                    >
                      <RefreshCw
                        size={16}
                        class={isFetchingCurrentProvider() ? 'animate-spin' : ''}
                      />
                    </button>
                  </div>

                  <Show
                    when={currentModels().length > 0}
                    fallback={
                      <div class="space-y-2">
                        <div class="flex items-center gap-2">
                          <MobileInput
                            value={form().modelName}
                            onInput={(e) => setForm({ ...form(), modelName: e.currentTarget.value })}
                            placeholder="输入自定义模型名"
                          />
                          <Show when={form().modelName}>
                            <button
                              onClick={() => setForm({ ...form(), modelName: '' })}
                              class="px-2 py-2 text-mist-solid/30 hover:text-mist-solid/60 transition-all shrink-0"
                              title="清除"
                            >
                              <Trash2 size={16} />
                            </button>
                          </Show>
                        </div>
                        <p class="text-[11px] text-mist-solid/25">
                          无可用模型列表，请手动输入模型名称。
                        </p>
                      </div>
                    }
                  >
                    <div class="space-y-2">
                      <Select
                        value={form().modelName}
                        onChange={(val) => setForm({ ...form(), modelName: val })}
                        options={currentModels().map((model) => ({
                          label: model.id,
                          value: model.id,
                        }))}
                      />
                      <div class="flex items-center gap-2">
                        <input
                          type="text"
                          value={form().modelName}
                          onInput={(e) => setForm({ ...form(), modelName: e.currentTarget.value })}
                          placeholder="或直接输入自定义模型名"
                          class="flex-1 bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-xs focus:outline-none focus:border-accent transition-all text-mist-solid placeholder:text-mist-solid/20"
                        />
                        <Show when={form().modelName}>
                          <button
                            onClick={() => setForm({ ...form(), modelName: '' })}
                            class="px-2 py-2 text-mist-solid/30 hover:text-mist-solid/60 transition-all shrink-0"
                            title="清除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>

                {/* Claude Native Test */}
                <Show when={form().providerKind === 'anthropic'}>
                  <div class="space-y-3 pt-3 border-t border-white/5">
                    <div class="flex items-center justify-between gap-3 py-2 border-b border-white/5">
                      <div>
                        <SectionLabel>Claude 原生测试</SectionLabel>
                        <p class="text-[11px] text-mist-solid/25 mt-0.5">
                          参考 CC Switch 的测试参数，直接走 Claude 原生 Messages API
                        </p>
                      </div>
                      <button
                        onClick={() => void handleClaudeNativeTest()}
                        disabled={!canRunClaudeNativeTest() || isTestingClaudeNative()}
                        class={`p-2.5 rounded-xl border transition-all ${
                          !canRunClaudeNativeTest() || isTestingClaudeNative()
                            ? 'border-white/5 text-mist-solid/20'
                            : 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/20'
                        }`}
                        title={
                          isTestingClaudeNative()
                            ? 'Claude 原生测试中'
                            : canRunClaudeNativeTest()
                              ? 'Claude 原生测试'
                              : '请先保存档案'
                        }
                      >
                        <RefreshCw
                          size={16}
                          class={isTestingClaudeNative() ? 'animate-spin' : ''}
                        />
                      </button>
                    </div>

                    <Show when={!canRunClaudeNativeTest()}>
                      <div class="rounded-xl border border-dashed border-white/10 px-3 py-2.5 text-xs text-mist-solid/35">
                        Claude 原生测试使用已保存档案里的 base URL 与 API Key；请先保存档案。
                      </div>
                    </Show>

                    <div class="space-y-3">
                      <div class="space-y-1.5">
                        <SectionLabel>测试模型</SectionLabel>
                        <MobileInput
                          value={claudeTestForm().testModel}
                          onInput={(e) =>
                            setClaudeTestForm({
                              ...claudeTestForm(),
                              testModel: e.currentTarget.value,
                            })
                          }
                        />
                      </div>

                      <div class="grid grid-cols-2 gap-3">
                        <div class="space-y-1.5">
                          <SectionLabel>超时时间（秒）</SectionLabel>
                          <MobileInput
                            value={claudeTestForm().timeoutSeconds}
                            onInput={(e) =>
                              setClaudeTestForm({
                                ...claudeTestForm(),
                                timeoutSeconds: e.currentTarget.value,
                              })
                            }
                          />
                        </div>
                        <div class="space-y-1.5">
                          <SectionLabel>降级阈值（毫秒）</SectionLabel>
                          <MobileInput
                            value={claudeTestForm().degradedThresholdMs}
                            onInput={(e) =>
                              setClaudeTestForm({
                                ...claudeTestForm(),
                                degradedThresholdMs: e.currentTarget.value,
                              })
                            }
                          />
                        </div>
                      </div>

                      <div class="space-y-1.5">
                        <SectionLabel>测试提示词</SectionLabel>
                        <MobileInput
                          value={claudeTestForm().testPrompt}
                          onInput={(e) =>
                            setClaudeTestForm({
                              ...claudeTestForm(),
                              testPrompt: e.currentTarget.value,
                            })
                          }
                        />
                      </div>

                      <div class="space-y-1.5">
                        <SectionLabel>最大重试次数</SectionLabel>
                        <MobileInput
                          value={claudeTestForm().maxRetries}
                          onInput={(e) =>
                            setClaudeTestForm({
                              ...claudeTestForm(),
                              maxRetries: e.currentTarget.value,
                            })
                          }
                        />
                      </div>
                    </div>

                    <Show when={claudeTestError()}>
                      <div class="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                        {claudeTestError()}
                      </div>
                    </Show>

                    <Show when={claudeTestResult()}>
                      {(result) => (
                        <div class="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-100 space-y-1.5">
                          <div class="font-semibold">Claude 原生测试成功</div>
                          <div class="text-xs">模型：{result().model}</div>
                          <div class="text-xs">
                            状态：{result().status} · 耗时：{result().latencyMs} ms · 尝试：
                            {result().attemptCount}
                          </div>
                          <div class="text-xs">
                            阈值：{result().degradedThresholdMs} ms · 性能标记：
                            {result().degraded ? '已降级' : '正常'}
                          </div>
                          <div class="text-xs text-emerald-50/90 break-all">
                            响应预览：{result().responsePreview}
                          </div>
                        </div>
                      )}
                    </Show>
                  </div>
                </Show>

                <Show when={saveError()}>
                  <div class="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
                    {saveError()}
                  </div>
                </Show>

                {/* Action Buttons */}
                <div class="pt-4 flex items-center gap-3 border-t border-white/5">
                  <button
                    onClick={() => void handleSave()}
                    disabled={isSaving()}
                    class={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium transition-all ${
                      isSaved()
                        ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
                        : 'bg-accent/60 text-white hover:bg-accent/80'
                    } disabled:opacity-50`}
                  >
                    <Show
                      when={isSaving()}
                      fallback={
                        <Show when={isSaved()} fallback={<Save size={16} />}>
                          <CheckCircle2 size={16} />
                        </Show>
                      }
                    >
                      <RefreshCw size={16} class="animate-spin" />
                    </Show>
                    {isSaving() ? '保存中' : isSaved() ? '已保存' : '保存档案'}
                  </button>

                  <Show when={form().id != null && !isCreatingNew()}>
                    <button
                      onClick={() => form().id != null && props.onDeleteProvider(form().id!)}
                      class="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-red-500/10 text-red-300 text-sm font-medium border border-red-500/20 hover:bg-red-500/20 transition-all"
                    >
                      <Trash2 size={16} />
                      删除
                    </button>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={activeTab() === 'appearance'}>
          <div class="px-4 py-4 space-y-6">
            <div>
              <h2 class="text-lg font-bold text-mist-solid">界面外观</h2>
              <p class="text-xs text-mist-solid/40 mt-0.5">
                自定义界面视觉表现，减少动态特效可显著提升低性能设备的运行流畅度
              </p>
            </div>

            {/* Dynamic Effects */}
            <div class="space-y-4">
              <div class="flex items-center justify-between gap-3 py-3 border-b border-white/5">
                <div>
                  <h3 class="text-sm font-bold text-white">动态特效</h3>
                  <p class="text-[11px] text-mist-solid/35 mt-0.5">
                    关闭极光背景动画等动态效果，可降低 GPU 占用并提升帧率
                  </p>
                </div>
                <ToggleSwitch
                  checked={props.enableDynamicEffects}
                  onChange={() => props.onSetEnableDynamicEffects(!props.enableDynamicEffects)}
                />
              </div>

              <div class="rounded-xl border border-dashed border-white/10 px-3 py-2.5 text-xs text-mist-solid/35">
                当前状态：{props.enableDynamicEffects ? '已开启' : '已关闭'}动态特效
              </div>
            </div>

            {/* Message Formatting */}
            <div class="space-y-3">
              <div class="py-2 border-b border-white/5">
                <h3 class="text-sm font-bold text-white">消息格式化</h3>
                <p class="text-[11px] text-mist-solid/35 mt-0.5">
                  控制聊天消息中的文本格式化规则，可自定义高亮样式
                </p>
              </div>

              <div class="flex items-center justify-between gap-3 py-3 border-b border-white/5">
                <div>
                  <div class="text-sm text-mist-solid/80">伪 XML 标签折叠</div>
                  <div class="text-[11px] text-mist-solid/35 mt-0.5">
                    将 &lt;scene&gt;...&lt;/scene&gt; 等标签渲染为可折叠块
                  </div>
                </div>
                <ToggleSwitch
                  checked={props.formatConfig.builtinRules.pseudoXml.enabled}
                  onChange={() =>
                    props.onSetFormatConfig({
                      ...props.formatConfig,
                      builtinRules: {
                        ...props.formatConfig.builtinRules,
                        pseudoXml: {
                          ...props.formatConfig.builtinRules.pseudoXml,
                          enabled: !props.formatConfig.builtinRules.pseudoXml.enabled,
                        },
                      },
                    })
                  }
                />
              </div>

              <Show when={props.formatConfig.builtinRules.pseudoXml.enabled}>
                <div class="flex items-center justify-between gap-3 pl-3 py-3 border-b border-white/5">
                  <div>
                    <div class="text-sm text-mist-solid/80">标签默认展开</div>
                    <div class="text-[11px] text-mist-solid/35 mt-0.5">
                      控制伪 XML 标签块的初始展开或折叠状态
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={props.formatConfig.builtinRules.pseudoXml.defaultExpanded}
                    onChange={() =>
                      props.onSetFormatConfig({
                        ...props.formatConfig,
                        builtinRules: {
                          ...props.formatConfig.builtinRules,
                          pseudoXml: {
                            ...props.formatConfig.builtinRules.pseudoXml,
                            defaultExpanded:
                              !props.formatConfig.builtinRules.pseudoXml.defaultExpanded,
                          },
                        },
                      })
                    }
                  />
                </div>
              </Show>

              <div class="flex items-center justify-between gap-3 py-3 border-b border-white/5">
                <div>
                  <div class="text-sm text-mist-solid/80">斜体灰色文本</div>
                  <div class="text-[11px] text-mist-solid/35 mt-0.5">将 **文本** 渲染为斜体灰色</div>
                </div>
                <ToggleSwitch
                  checked={props.formatConfig.builtinRules.italicGray.enabled}
                  onChange={() =>
                    props.onSetFormatConfig({
                      ...props.formatConfig,
                      builtinRules: {
                        ...props.formatConfig.builtinRules,
                        italicGray: {
                          enabled: !props.formatConfig.builtinRules.italicGray.enabled,
                        },
                      },
                    })
                  }
                />
              </div>

              <div class="flex items-center justify-between gap-3 py-3 border-b border-white/5">
                <div>
                  <div class="text-sm text-mist-solid/80">青色引号文本</div>
                  <div class="text-[11px] text-mist-solid/35 mt-0.5">将 "引号文本" 渲染为青色</div>
                </div>
                <ToggleSwitch
                  checked={props.formatConfig.builtinRules.cyanQuote.enabled}
                  onChange={() =>
                    props.onSetFormatConfig({
                      ...props.formatConfig,
                      builtinRules: {
                        ...props.formatConfig.builtinRules,
                        cyanQuote: {
                          enabled: !props.formatConfig.builtinRules.cyanQuote.enabled,
                        },
                      },
                    })
                  }
                />
              </div>

              <div class="flex items-center justify-between gap-3 py-3 border-b border-white/5">
                <div>
                  <div class="text-sm text-mist-solid/80">世界书关键词高亮</div>
                  <div class="text-[11px] text-mist-solid/35 mt-0.5">将世界书触发关键词渲染为紫色</div>
                </div>
                <ToggleSwitch
                  checked={props.formatConfig.builtinRules.worldBookKeyword.enabled}
                  onChange={() =>
                    props.onSetFormatConfig({
                      ...props.formatConfig,
                      builtinRules: {
                        ...props.formatConfig.builtinRules,
                        worldBookKeyword: {
                          enabled: !props.formatConfig.builtinRules.worldBookKeyword.enabled,
                        },
                      },
                    })
                  }
                />
              </div>
            </div>

            {/* Custom Rules */}
            <div class="space-y-3 pt-2 border-t border-white/5">
              <div class="flex items-center justify-between gap-3 py-2 border-b border-white/5">
                <div>
                  <div class="text-sm font-bold text-white">自定义规则</div>
                  <div class="text-[11px] text-mist-solid/35 mt-0.5">
                    添加基于正则表达式的自定义文本高亮规则
                  </div>
                </div>
                <button
                  onClick={() => {
                    setCustomRuleDraft({
                      name: '',
                      pattern: '',
                      groupIndex: 0,
                      color: '#A78BFA',
                      italic: false,
                      bold: false,
                    });
                    setIsAddingCustomRule(true);
                    setEditingCustomRule(null);
                    setPatternError(null);
                  }}
                  class="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium border border-accent/20 hover:bg-accent/30 transition-colors shrink-0"
                >
                  <Plus size={14} />
                  添加
                </button>
              </div>

              <Show when={props.formatConfig.customRules.length === 0}>
                <div class="text-xs text-mist-solid/35 py-2">暂无自定义规则</div>
              </Show>

              <For each={props.formatConfig.customRules}>
                {(rule) => (
                  <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-white/5 bg-white/5">
                    <div class="flex items-center gap-2 min-w-0">
                      <div
                        class="w-3 h-3 rounded-full shrink-0"
                        style={{ 'background-color': rule.color }}
                      />
                      <div class="min-w-0">
                        <div class="text-sm text-mist-solid/80 truncate">{rule.name}</div>
                        <div class="text-[10px] text-mist-solid/35 truncate font-mono">
                          /{rule.pattern}/
                        </div>
                      </div>
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => {
                          setCustomRuleDraft({
                            name: rule.name,
                            pattern: rule.pattern,
                            groupIndex: rule.groupIndex,
                            color: rule.color,
                            italic: rule.italic,
                            bold: rule.bold,
                          });
                          setPatternError(validateCustomRulePattern(rule.pattern, rule.groupIndex));
                          setEditingCustomRule(rule);
                          setIsAddingCustomRule(false);
                        }}
                        class="p-1.5 rounded-lg hover:bg-white/10 text-mist-solid/40 hover:text-mist-solid transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => {
                          const updated = props.formatConfig.customRules.filter(
                            (r) => r.id !== rule.id,
                          );
                          props.onSetFormatConfig({
                            ...props.formatConfig,
                            customRules: updated,
                          });
                        }}
                        class="p-1.5 rounded-lg hover:bg-red-500/10 text-mist-solid/40 hover:text-red-300 transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <Show when={isAddingCustomRule() || editingCustomRule()}>
              <div class="border-t border-white/5 pt-4 space-y-3">
                <div class="text-sm font-bold text-white">
                  {editingCustomRule() ? '编辑规则' : '新规则'}
                </div>

                <div>
                  <label class="text-xs text-mist-solid/55">规则名称</label>
                  <input
                    type="text"
                    value={customRuleDraft().name}
                    onInput={(e) => updateCustomRuleDraft({ name: e.currentTarget.value })}
                    class="w-full mt-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
                  />
                </div>

                <div>
                  <label class="text-xs text-mist-solid/55">正则表达式</label>
                  <input
                    type="text"
                    value={customRuleDraft().pattern}
                    onInput={(e) => updateCustomRuleDraft({ pattern: e.currentTarget.value })}
                    class="w-full mt-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent/40 text-mist-solid"
                  />
                  <Show when={patternError()}>
                    <div class="text-xs text-red-300 mt-1">{patternError()}</div>
                  </Show>
                </div>

                <div class="flex gap-3">
                  <div class="flex-1">
                    <label class="text-xs text-mist-solid/55">匹配组索引</label>
                    <input
                      type="number"
                      min="0"
                      value={customRuleDraft().groupIndex}
                      onInput={(e) =>
                        updateCustomRuleDraft({ groupIndex: Number(e.currentTarget.value) || 0 })
                      }
                      class="w-full mt-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
                    />
                  </div>
                  <div class="flex-1">
                    <label class="text-xs text-mist-solid/55">文字颜色</label>
                    <div class="flex items-center gap-2 mt-1">
                      <input
                        type="color"
                        value={customRuleDraft().color}
                        onInput={(e) => updateCustomRuleDraft({ color: e.currentTarget.value })}
                        class="w-8 h-8 rounded-lg border border-white/10 cursor-pointer bg-transparent shrink-0"
                      />
                      <input
                        type="text"
                        value={customRuleDraft().color}
                        onInput={(e) => updateCustomRuleDraft({ color: e.currentTarget.value })}
                        class="flex-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent/40 text-mist-solid"
                      />
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-4">
                  <label class="flex items-center gap-2 text-sm text-mist-solid/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customRuleDraft().italic}
                      onChange={(e) => updateCustomRuleDraft({ italic: e.currentTarget.checked })}
                      class="accent-accent"
                    />
                    斜体
                  </label>
                  <label class="flex items-center gap-2 text-sm text-mist-solid/80 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={customRuleDraft().bold}
                      onChange={(e) => updateCustomRuleDraft({ bold: e.currentTarget.checked })}
                      class="accent-accent"
                    />
                    加粗
                  </label>
                </div>

                <div class="flex items-center gap-2 pt-2">
                  <button
                    onClick={() => {
                      const draft = customRuleDraft();
                      if (!draft.name.trim() || !draft.pattern.trim()) return;
                      const validationError = validateCustomRulePattern(
                        draft.pattern,
                        draft.groupIndex,
                      );
                      if (validationError) {
                        setPatternError(validationError);
                        return;
                      }

                      if (editingCustomRule()) {
                        const updated = props.formatConfig.customRules.map((r) =>
                          r.id === editingCustomRule()!.id
                            ? {
                                ...r,
                                name: draft.name,
                                pattern: draft.pattern,
                                groupIndex: draft.groupIndex,
                                color: draft.color,
                                italic: draft.italic,
                                bold: draft.bold,
                              }
                            : r,
                        );
                        props.onSetFormatConfig({
                          ...props.formatConfig,
                          customRules: updated,
                        });
                      } else {
                        const newRule: CustomFormatRule = {
                          id: crypto.randomUUID(),
                          name: draft.name,
                          pattern: draft.pattern,
                          groupIndex: draft.groupIndex,
                          color: draft.color,
                          italic: draft.italic,
                          bold: draft.bold,
                        };
                        props.onSetFormatConfig({
                          ...props.formatConfig,
                          customRules: [...props.formatConfig.customRules, newRule],
                        });
                      }
                      setIsAddingCustomRule(false);
                      setEditingCustomRule(null);
                      setPatternError(null);
                    }}
                    disabled={
                      !customRuleDraft().name.trim() ||
                      !customRuleDraft().pattern.trim() ||
                      patternError() !== null
                    }
                    class="px-4 py-2 rounded-xl bg-accent/60 text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {editingCustomRule() ? '保存修改' : '添加规则'}
                  </button>
                  <button
                    onClick={() => {
                      setIsAddingCustomRule(false);
                      setEditingCustomRule(null);
                      setPatternError(null);
                    }}
                    class="px-4 py-2 rounded-xl bg-white/5 text-mist-solid/60 text-sm hover:bg-white/10 transition-colors"
                  >
                    取消
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};
