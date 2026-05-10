import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import { Save, RefreshCw, CheckCircle2, ChevronDown, Plus, Trash2, Pencil } from '../lib/icons';
import type { ApiProviderSummary, RemoteModel } from '../lib/backend';
import { type MessageFormatConfig, type CustomFormatRule } from '../lib/messageFormatter';
import { IconButton } from './ui/IconButton';

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

interface SettingsAreaProps {
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

export const SettingsArea: Component<SettingsAreaProps> = (props) => {
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
  };

  const handleSelectProvider = (providerId: number) => {
    setIsCreatingNew(false);
    setSelectedProviderId(providerId);
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

    console.debug('[provider-debug] frontend:settings_save:start', {
      id: value.id ?? null,
      providerKind: value.providerKind,
      baseUrl: value.baseUrl,
      modelName: value.modelName || '<empty>',
      hasApiKey: Boolean(value.apiKey.trim()),
    });

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
      console.error('[provider-debug] frontend:settings_save:error', {
        id: value.id ?? null,
        providerKind: value.providerKind,
        baseUrl: value.baseUrl,
        modelName: value.modelName || '<empty>',
        error,
      });
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

    console.debug('[provider-debug] frontend:claude_native_test:start', payload);
    setIsTestingClaudeNative(true);
    setClaudeTestError(null);
    setClaudeTestResult(null);

    try {
      const result = await props.onTestClaudeNative(payload);
      console.debug('[provider-debug] frontend:claude_native_test:success', result);
      setClaudeTestResult(result);
    } catch (error) {
      const message = toErrorMessage(error);
      console.error('[provider-debug] frontend:claude_native_test:error', {
        providerId,
        error,
      });
      setClaudeTestError(message);
    } finally {
      setIsTestingClaudeNative(false);
    }
  };

  return (
    <div class="flex-1 flex flex-col h-full bg-transparent overflow-y-auto custom-scrollbar">
      <div class="max-w-5xl mx-auto w-full px-8 py-16">
        <Show when={props.activeCategory === 'api'}>
          <div class="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div class="flex items-start justify-between gap-6">
              <div>
                <h2 class="text-2xl font-bold text-mist-solid mb-2">API 档案</h2>
                <p class="text-mist-solid/40 text-sm">
                  管理 OpenAI 兼容与 Anthropic 原生 API 档案，并从服务端拉取模型列表。
                </p>
              </div>
              <div class="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                <div class="text-right">
                  <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">
                    操作
                  </div>
                  <div class="text-sm text-mist-solid/40 mt-1">新建档案</div>
                </div>
                <IconButton onClick={handleNew} label="新建 API 档案" tone="accent" size="lg">
                  <Plus size={18} />
                </IconButton>
              </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-8">
              <div class="space-y-3">
                <Show when={!props.loading} fallback={<div class="text-sm text-mist-solid/35">正在加载档案...</div>}>
                  <For each={props.providers}>
                    {(provider) => (
                      <button
                        onClick={() => handleSelectProvider(provider.id)}
                        class={`w-full text-left p-4 rounded-2xl border transition-all ${
                          selectedProviderId() === provider.id && !isCreatingNew()
                            ? 'bg-accent/10 border-accent/30'
                            : 'bg-white/5 border-white/5 hover:bg-white/10'
                        }`}
                      >
                        <div class="flex items-center justify-between gap-3 mb-2">
                          <h3 class="text-sm font-bold text-white truncate">{provider.name}</h3>
                          <span class="text-[10px] text-mist-solid/35 uppercase tracking-widest">
                            {provider.providerKind}
                          </span>
                        </div>
                        <p class="text-xs text-mist-solid/40 truncate">{provider.modelName}</p>
                        <p class="text-[10px] text-mist-solid/25 mt-2">
                          {provider.apiKeyPreview ?? '未配置密钥'}
                        </p>
                      </button>
                    )}
                  </For>
                </Show>
              </div>

              <div class="space-y-6 p-6 rounded-3xl border border-white/5 bg-white/5">
                <div class="space-y-2">
                  <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                    档案名称
                  </label>
                  <input
                    type="text"
                    value={form().name}
                    onInput={(e) => setForm({ ...form(), name: e.currentTarget.value })}
                    class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all text-mist-solid"
                  />
                </div>

                <div class="space-y-2">
                  <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                    Provider 类型
                  </label>
                  <div class="relative group">
                    <select
                      value={form().providerKind}
                      onChange={(e) => {
                        const providerKind =
                          e.currentTarget.value === 'anthropic' ? 'anthropic' : 'openai_compatible';
                        setClaudeTestError(null);
                        setClaudeTestResult(null);
                        setForm({
                          ...form(),
                          providerKind,
                          baseUrl:
                            providerKind === 'anthropic'
                              ? 'https://api.anthropic.com'
                              : 'https://api.openai.com/v1',
                        });
                      }}
                      class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm appearance-none focus:outline-none focus:border-accent/50 transition-all text-mist-solid cursor-pointer"
                    >
                      <option value="openai_compatible">openai_compatible</option>
                      <option value="anthropic">anthropic</option>
                    </select>
                    <ChevronDown
                      size={18}
                      class="absolute right-4 top-1/2 -translate-y-1/2 text-mist-solid/20 pointer-events-none"
                    />
                  </div>
                </div>

                <div class="space-y-2">
                  <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                    接口地址 (Base URL)
                  </label>
                  <input
                    type="text"
                    value={form().baseUrl}
                    onInput={(e) => setForm({ ...form(), baseUrl: e.currentTarget.value })}
                    class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all text-mist-solid"
                  />
                </div>

                <div class="space-y-2">
                  <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={form().apiKey}
                    onInput={(e) => setForm({ ...form(), apiKey: e.currentTarget.value })}
                    placeholder={form().id ? '留空表示不更新密钥' : 'sk-...'}
                    class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all text-mist-solid"
                  />
                </div>

                <div class="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-mist-solid/35">
                  MAX TOKENS 与 TEMPERATURE 已从 API 档案中移除，后续由聊天预设统一定义。
                </div>

                <div class="space-y-4 pt-4 border-t border-white/5">
                  <div class="flex items-center justify-between gap-4">
                    <div>
                      <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                        模型选择
                      </label>
                      <p class="text-[11px] text-mist-solid/25 mt-1">
                        从当前档案对应服务端拉取模型列表。
                      </p>
                    </div>
                    <IconButton
                      onClick={() =>
                        selectedProviderId() != null && props.onFetchModels(selectedProviderId()!)
                      }
                      disabled={selectedProviderId() == null || isFetchingCurrentProvider()}
                      label={
                        isFetchingCurrentProvider()
                          ? '正在拉取模型列表'
                          : selectedProviderId() == null
                            ? '请先保存档案'
                            : '拉取模型列表'
                      }
                      size="md"
                      class={isFetchingCurrentProvider() ? 'text-accent' : ''}
                    >
                      <RefreshCw
                        size={16}
                        class={isFetchingCurrentProvider() ? 'animate-spin' : ''}
                      />
                    </IconButton>
                  </div>

                  <Show
                    when={currentModels().length > 0}
                    fallback={
                      <div class="space-y-2">
                        <div class="flex items-center gap-2">
                          <input
                            type="text"
                            value={form().modelName}
                            onInput={(e) => setForm({ ...form(), modelName: e.currentTarget.value })}
                            placeholder="输入自定义模型名，如 claude-sonnet-4-20250514"
                            class="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all text-mist-solid placeholder:text-mist-solid/20"
                          />
                          <Show when={form().modelName}>
                            <button
                              onClick={() => setForm({ ...form(), modelName: '' })}
                              class="px-3 py-3 text-mist-solid/30 hover:text-mist-solid/60 transition-all"
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
                      <div class="relative group">
                        <select
                          value={form().modelName}
                          onChange={(e) => setForm({ ...form(), modelName: e.currentTarget.value })}
                          class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm appearance-none focus:outline-none focus:border-accent/50 transition-all text-mist-solid cursor-pointer"
                        >
                          <For each={currentModels()}>
                            {(model) => <option value={model.id}>{model.id}</option>}
                          </For>
                        </select>
                        <ChevronDown
                          size={18}
                          class="absolute right-4 top-1/2 -translate-y-1/2 text-mist-solid/20 pointer-events-none"
                        />
                      </div>
                      <div class="flex items-center gap-2">
                        <input
                          type="text"
                          value={form().modelName}
                          onInput={(e) => setForm({ ...form(), modelName: e.currentTarget.value })}
                          placeholder="或直接输入自定义模型名"
                          class="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs focus:outline-none focus:border-accent/50 transition-all text-mist-solid placeholder:text-mist-solid/20"
                        />
                        <Show when={form().modelName}>
                          <button
                            onClick={() => setForm({ ...form(), modelName: '' })}
                            class="px-2 py-2 text-mist-solid/30 hover:text-mist-solid/60 transition-all"
                            title="清除"
                          >
                            <Trash2 size={14} />
                          </button>
                        </Show>
                      </div>
                    </div>
                  </Show>
                </div>

                <Show when={form().providerKind === 'anthropic'}>
                  <div class="space-y-4 pt-4 border-t border-white/5">
                    <div class="flex items-center justify-between gap-4">
                      <div>
                        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                          Claude 原生测试
                        </label>
                        <p class="text-[11px] text-mist-solid/25 mt-1">
                          参考 CC Switch 的测试参数，直接走 Claude 原生 Messages API。
                        </p>
                      </div>
                      <IconButton
                        onClick={() => void handleClaudeNativeTest()}
                        disabled={!canRunClaudeNativeTest() || isTestingClaudeNative()}
                        label={
                          isTestingClaudeNative()
                            ? 'Claude 原生测试中'
                            : canRunClaudeNativeTest()
                              ? 'Claude 原生测试'
                              : '请先保存档案'
                        }
                        tone="accent"
                        size="md"
                      >
                        <RefreshCw
                          size={16}
                          class={isTestingClaudeNative() ? 'animate-spin' : ''}
                        />
                      </IconButton>
                    </div>

                    <Show when={!canRunClaudeNativeTest()}>
                      <div class="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-mist-solid/35">
                        Claude 原生测试使用已保存档案里的 base URL 与 API Key；请先保存档案。
                      </div>
                    </Show>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div class="space-y-2 md:col-span-2">
                        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                          测试模型
                        </label>
                        <input
                          type="text"
                          value={claudeTestForm().testModel}
                          onInput={(e) =>
                            setClaudeTestForm({
                              ...claudeTestForm(),
                              testModel: e.currentTarget.value,
                            })
                          }
                          class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all text-mist-solid"
                        />
                      </div>

                      <div class="space-y-2">
                        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                          超时时间（秒）
                        </label>
                        <input
                          type="text"
                          value={claudeTestForm().timeoutSeconds}
                          onInput={(e) =>
                            setClaudeTestForm({
                              ...claudeTestForm(),
                              timeoutSeconds: e.currentTarget.value,
                            })
                          }
                          class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all text-mist-solid"
                        />
                      </div>

                      <div class="space-y-2">
                        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                          降级阈值（毫秒）
                        </label>
                        <input
                          type="text"
                          value={claudeTestForm().degradedThresholdMs}
                          onInput={(e) =>
                            setClaudeTestForm({
                              ...claudeTestForm(),
                              degradedThresholdMs: e.currentTarget.value,
                            })
                          }
                          class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all text-mist-solid"
                        />
                      </div>

                      <div class="space-y-2 md:col-span-2">
                        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                          测试提示词
                        </label>
                        <input
                          type="text"
                          value={claudeTestForm().testPrompt}
                          onInput={(e) =>
                            setClaudeTestForm({
                              ...claudeTestForm(),
                              testPrompt: e.currentTarget.value,
                            })
                          }
                          class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all text-mist-solid"
                        />
                      </div>

                      <div class="space-y-2">
                        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
                          最大重试次数
                        </label>
                        <input
                          type="text"
                          value={claudeTestForm().maxRetries}
                          onInput={(e) =>
                            setClaudeTestForm({
                              ...claudeTestForm(),
                              maxRetries: e.currentTarget.value,
                            })
                          }
                          class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/50 transition-all text-mist-solid"
                        />
                      </div>
                    </div>

                    <Show when={claudeTestError()}>
                      <div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                        {claudeTestError()}
                      </div>
                    </Show>

                    <Show when={claudeTestResult()}>
                      {(result) => (
                        <div class="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100 space-y-2">
                          <div class="font-semibold">Claude 原生测试成功</div>
                          <div>模型：{result().model}</div>
                          <div>
                            状态：{result().status} · 耗时：{result().latencyMs} ms · 尝试：
                            {result().attemptCount}
                          </div>
                          <div>
                            阈值：{result().degradedThresholdMs} ms · 性能标记：
                            {result().degraded ? '已降级' : '正常'}
                          </div>
                          <div class="text-emerald-50/90 break-all">
                            响应预览：{result().responsePreview}
                          </div>
                        </div>
                      )}
                    </Show>
                  </div>
                </Show>

                <Show when={saveError()}>
                  <div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {saveError()}
                  </div>
                </Show>

                <div class="pt-4 flex items-center justify-between gap-4 border-t border-white/5">
                  <div>
                    <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">
                      表单操作
                    </div>
                    <div class="text-sm text-mist-solid/40 mt-1">
                      {isSaved() ? '当前档案已保存。' : '修改完成后请保存当前档案。'}
                    </div>
                  </div>

                  <div class="flex items-center gap-3">
                    <IconButton
                      onClick={() => void handleSave()}
                      label={isSaving() ? '保存中' : isSaved() ? '已保存配置' : '保存档案'}
                      tone={isSaved() ? 'success' : 'accent'}
                      size="lg"
                      disabled={isSaving()}
                    >
                      <Show
                        when={isSaving()}
                        fallback={
                          <Show when={isSaved()} fallback={<Save size={18} />}>
                            <CheckCircle2 size={18} />
                          </Show>
                        }
                      >
                        <RefreshCw size={18} class="animate-spin" />
                      </Show>
                    </IconButton>

                    <Show when={form().id != null && !isCreatingNew()}>
                      <IconButton
                        onClick={() => form().id != null && props.onDeleteProvider(form().id!)}
                        label="删除档案"
                        tone="danger"
                        size="lg"
                      >
                        <Trash2 size={18} />
                      </IconButton>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>

        <Show when={props.activeCategory === 'appearance'}>
          <div class="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div>
              <h2 class="text-2xl font-bold text-mist-solid mb-2">界面外观</h2>
              <p class="text-mist-solid/40 text-sm">
                自定义界面视觉表现，减少动态特效可显著提升低性能设备的运行流畅度。
              </p>
            </div>

            <div class="p-6 rounded-3xl border border-white/5 bg-white/5 space-y-6">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <h3 class="text-sm font-bold text-white">动态特效</h3>
                  <p class="text-[11px] text-mist-solid/35 mt-1">
                    关闭极光背景动画等动态效果，可降低 GPU 占用并提升帧率。
                  </p>
                </div>
                <button
                  onClick={() => props.onSetEnableDynamicEffects(!props.enableDynamicEffects)}
                  class={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                    props.enableDynamicEffects
                      ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
                      : 'bg-white/10'
                  }`}
                  role="switch"
                  aria-checked={props.enableDynamicEffects}
                  aria-label={props.enableDynamicEffects ? '关闭动态特效' : '开启动态特效'}
                >
                  <div
                    class={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
                      props.enableDynamicEffects ? 'left-7' : 'left-1'
                    }`}
                  />
                </button>
              </div>

              <div class="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-mist-solid/35">
                当前状态：{props.enableDynamicEffects ? '已开启' : '已关闭'}动态特效
              </div>
            </div>

            <div class="p-6 rounded-3xl border border-white/5 bg-white/5 space-y-6">
              <div class="flex items-center justify-between gap-4">
                <div>
                  <h3 class="text-sm font-bold text-white">消息格式化</h3>
                  <p class="text-[11px] text-mist-solid/35 mt-1">
                    控制聊天消息中的文本格式化规则，可自定义高亮样式。
                  </p>
                </div>
              </div>

              <div class="space-y-3">
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm text-mist-solid/80">伪 XML 标签折叠</div>
                    <div class="text-[11px] text-mist-solid/35 mt-0.5">将 &lt;scene&gt;...&lt;/scene&gt; 等标签渲染为可折叠块</div>
                  </div>
                  <button
                    onClick={() => props.onSetFormatConfig({
                      ...props.formatConfig,
                      builtinRules: { ...props.formatConfig.builtinRules, pseudoXml: { ...props.formatConfig.builtinRules.pseudoXml, enabled: !props.formatConfig.builtinRules.pseudoXml.enabled } }
                    })}
                    class={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                      props.formatConfig.builtinRules.pseudoXml.enabled
                        ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
                        : 'bg-white/10'
                    }`}
                    role="switch"
                    aria-checked={props.formatConfig.builtinRules.pseudoXml.enabled}
                  >
                    <div class={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
                      props.formatConfig.builtinRules.pseudoXml.enabled ? 'left-7' : 'left-1'
                    }`} />
                  </button>
                </div>

                <Show when={props.formatConfig.builtinRules.pseudoXml.enabled}>
                  <div class="flex items-center justify-between gap-4 pl-4">
                    <div>
                      <div class="text-sm text-mist-solid/80">标签默认展开</div>
                      <div class="text-[11px] text-mist-solid/35 mt-0.5">控制伪 XML 标签块的初始展开或折叠状态</div>
                    </div>
                    <button
                      onClick={() => props.onSetFormatConfig({
                        ...props.formatConfig,
                        builtinRules: { ...props.formatConfig.builtinRules, pseudoXml: { ...props.formatConfig.builtinRules.pseudoXml, defaultExpanded: !props.formatConfig.builtinRules.pseudoXml.defaultExpanded } }
                      })}
                      class={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                        props.formatConfig.builtinRules.pseudoXml.defaultExpanded
                          ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
                          : 'bg-white/10'
                      }`}
                      role="switch"
                      aria-checked={props.formatConfig.builtinRules.pseudoXml.defaultExpanded}
                    >
                      <div class={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
                        props.formatConfig.builtinRules.pseudoXml.defaultExpanded ? 'left-7' : 'left-1'
                      }`} />
                    </button>
                  </div>
                </Show>

                <div class="flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm text-mist-solid/80">斜体灰色文本</div>
                    <div class="text-[11px] text-mist-solid/35 mt-0.5">将 **文本** 渲染为斜体灰色</div>
                  </div>
                  <button
                    onClick={() => props.onSetFormatConfig({
                      ...props.formatConfig,
                      builtinRules: { ...props.formatConfig.builtinRules, italicGray: { enabled: !props.formatConfig.builtinRules.italicGray.enabled } }
                    })}
                    class={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                      props.formatConfig.builtinRules.italicGray.enabled
                        ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
                        : 'bg-white/10'
                    }`}
                    role="switch"
                    aria-checked={props.formatConfig.builtinRules.italicGray.enabled}
                  >
                    <div class={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
                      props.formatConfig.builtinRules.italicGray.enabled ? 'left-7' : 'left-1'
                    }`} />
                  </button>
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm text-mist-solid/80">青色引号文本</div>
                    <div class="text-[11px] text-mist-solid/35 mt-0.5">将 "引号文本" 渲染为青色</div>
                  </div>
                  <button
                    onClick={() => props.onSetFormatConfig({
                      ...props.formatConfig,
                      builtinRules: { ...props.formatConfig.builtinRules, cyanQuote: { enabled: !props.formatConfig.builtinRules.cyanQuote.enabled } }
                    })}
                    class={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                      props.formatConfig.builtinRules.cyanQuote.enabled
                        ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
                        : 'bg-white/10'
                    }`}
                    role="switch"
                    aria-checked={props.formatConfig.builtinRules.cyanQuote.enabled}
                  >
                    <div class={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
                      props.formatConfig.builtinRules.cyanQuote.enabled ? 'left-7' : 'left-1'
                    }`} />
                  </button>
                </div>

                <div class="flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm text-mist-solid/80">世界书关键词高亮</div>
                    <div class="text-[11px] text-mist-solid/35 mt-0.5">将世界书触发关键词渲染为紫色</div>
                  </div>
                  <button
                    onClick={() => props.onSetFormatConfig({
                      ...props.formatConfig,
                      builtinRules: { ...props.formatConfig.builtinRules, worldBookKeyword: { enabled: !props.formatConfig.builtinRules.worldBookKeyword.enabled } }
                    })}
                    class={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                      props.formatConfig.builtinRules.worldBookKeyword.enabled
                        ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
                        : 'bg-white/10'
                    }`}
                    role="switch"
                    aria-checked={props.formatConfig.builtinRules.worldBookKeyword.enabled}
                  >
                    <div class={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
                      props.formatConfig.builtinRules.worldBookKeyword.enabled ? 'left-7' : 'left-1'
                    }`} />
                  </button>
                </div>
              </div>

              <div class="border-t border-white/5 pt-4 space-y-3">
                <div class="flex items-center justify-between gap-4">
                  <div>
                    <div class="text-sm font-bold text-white">自定义规则</div>
                    <div class="text-[11px] text-mist-solid/35 mt-0.5">添加基于正则表达式的自定义文本高亮规则</div>
                  </div>
                  <button
                    onClick={() => {
                      setCustomRuleDraft({ name: '', pattern: '', groupIndex: 0, color: '#A78BFA', italic: false, bold: false });
                      setIsAddingCustomRule(true);
                      setEditingCustomRule(null);
                      setPatternError(null);
                    }}
                    class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium border border-accent/20 hover:bg-accent/30 transition-colors"
                  >
                    <Plus size={14} />
                    添加规则
                  </button>
                </div>

                <Show when={props.formatConfig.customRules.length === 0}>
                  <div class="text-xs text-mist-solid/35 py-2">暂无自定义规则</div>
                </Show>

                <For each={props.formatConfig.customRules}>
                  {(rule) => (
                    <div class="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-white/5 bg-white/5">
                      <div class="flex items-center gap-2 min-w-0">
                        <div class="w-3 h-3 rounded-full shrink-0" style={{ 'background-color': rule.color }} />
                        <div class="min-w-0">
                          <div class="text-sm text-mist-solid/80 truncate">{rule.name}</div>
                          <div class="text-[10px] text-mist-solid/35 truncate font-mono">/{rule.pattern}/</div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            setCustomRuleDraft({ name: rule.name, pattern: rule.pattern, groupIndex: rule.groupIndex, color: rule.color, italic: rule.italic, bold: rule.bold });
                            setEditingCustomRule(rule);
                            setIsAddingCustomRule(false);
                            setPatternError(null);
                          }}
                          class="p-1.5 rounded-lg hover:bg-white/10 text-mist-solid/40 hover:text-mist-solid transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => {
                            const updated = props.formatConfig.customRules.filter(r => r.id !== rule.id);
                            props.onSetFormatConfig({ ...props.formatConfig, customRules: updated });
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
                  <div class="text-sm font-bold text-white">{editingCustomRule() ? '编辑规则' : '新规则'}</div>

                  <div>
                    <label class="text-xs text-mist-solid/55">规则名称</label>
                    <input
                      type="text"
                      value={customRuleDraft().name}
                      onInput={(e) => setCustomRuleDraft({ ...customRuleDraft(), name: e.currentTarget.value })}
                      class="w-full mt-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
                    />
                  </div>

                  <div>
                    <label class="text-xs text-mist-solid/55">正则表达式</label>
                    <input
                      type="text"
                      value={customRuleDraft().pattern}
                      onInput={(e) => {
                        const pattern = e.currentTarget.value;
                        setCustomRuleDraft({ ...customRuleDraft(), pattern });
                        try {
                          if (pattern) new RegExp(pattern, 'd');
                          setPatternError(null);
                        } catch (err) {
                          setPatternError(String(err));
                        }
                      }}
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
                        onInput={(e) => setCustomRuleDraft({ ...customRuleDraft(), groupIndex: Number(e.currentTarget.value) || 0 })}
                        class="w-full mt-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
                      />
                    </div>
                    <div class="flex-1">
                      <label class="text-xs text-mist-solid/55">文字颜色</label>
                      <div class="flex items-center gap-2 mt-1">
                        <input
                          type="color"
                          value={customRuleDraft().color}
                          onInput={(e) => setCustomRuleDraft({ ...customRuleDraft(), color: e.currentTarget.value })}
                          class="w-8 h-8 rounded-lg border border-white/10 cursor-pointer bg-transparent"
                        />
                        <input
                          type="text"
                          value={customRuleDraft().color}
                          onInput={(e) => setCustomRuleDraft({ ...customRuleDraft(), color: e.currentTarget.value })}
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
                        onChange={(e) => setCustomRuleDraft({ ...customRuleDraft(), italic: e.currentTarget.checked })}
                        class="accent-accent"
                      />
                      斜体
                    </label>
                    <label class="flex items-center gap-2 text-sm text-mist-solid/80 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={customRuleDraft().bold}
                        onChange={(e) => setCustomRuleDraft({ ...customRuleDraft(), bold: e.currentTarget.checked })}
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
                        try { new RegExp(draft.pattern, 'd'); } catch { return; }

                        if (editingCustomRule()) {
                          const updated = props.formatConfig.customRules.map(r =>
                            r.id === editingCustomRule()!.id
                              ? { ...r, name: draft.name, pattern: draft.pattern, groupIndex: draft.groupIndex, color: draft.color, italic: draft.italic, bold: draft.bold }
                              : r
                          );
                          props.onSetFormatConfig({ ...props.formatConfig, customRules: updated });
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
                          props.onSetFormatConfig({ ...props.formatConfig, customRules: [...props.formatConfig.customRules, newRule] });
                        }
                        setIsAddingCustomRule(false);
                        setEditingCustomRule(null);
                        setPatternError(null);
                      }}
                      disabled={!customRuleDraft().name.trim() || !customRuleDraft().pattern.trim() || patternError() !== null}
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
          </div>
        </Show>

        <Show when={props.activeCategory !== 'api' && props.activeCategory !== 'appearance'}>
          <div class="h-[60vh] flex flex-col items-center justify-center text-mist-solid/20">
            <p class="text-xl font-bold mb-2">正在设计中</p>
            <p class="text-sm italic">此功能模块暂未接入真实后端</p>
          </div>
        </Show>
      </div>
    </div>
  );
};
