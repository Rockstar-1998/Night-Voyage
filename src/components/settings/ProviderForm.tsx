import { Component, Show, createMemo, createSignal, createEffect } from 'solid-js';
import { Save, RefreshCw, CheckCircle2, ChevronDown, Trash2 } from '../../lib/icons';
import { Select } from '../ui/Select';
import { IconButton } from '../ui/IconButton';
import { ClaudeNativeTestPanel, type ClaudeTestPayload, type ProviderClaudeNativeTestResult } from './ClaudeNativeTestPanel';
import { toErrorMessage } from './validationUtils';
import type { ApiProviderSummary, RemoteModel } from '../../lib/backend';

export interface ProviderFormState {
  id?: number;
  name: string;
  providerKind: 'openai_compatible' | 'anthropic';
  purpose: 'llm' | 'embedding';
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export interface ProviderSavePayload {
  id?: number;
  name: string;
  providerKind: 'openai_compatible' | 'anthropic';
  purpose?: 'llm' | 'embedding';
  baseUrl: string;
  apiKey?: string;
  modelName: string;
}

const EMPTY_FORM: ProviderFormState = {
  name: '',
  providerKind: 'openai_compatible',
  purpose: 'llm',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  modelName: '',
};

interface ProviderFormProps {
  selectedProviderId: number | null;
  isCreatingNew: boolean;
  providers: ApiProviderSummary[];
  modelsByProvider?: Record<number, RemoteModel[]>;
  fetchingModelsFor?: number | null;
  onSave: (payload: ProviderSavePayload) => Promise<void> | void;
  onDelete: (id: number) => Promise<void> | void;
  onFetchModels: (providerId: number) => Promise<void> | void;
  onTestClaudeNative: (payload: ClaudeTestPayload) => Promise<ProviderClaudeNativeTestResult> | ProviderClaudeNativeTestResult;
}

export const ProviderForm: Component<ProviderFormProps> = (props) => {
  const [form, setForm] = createSignal<ProviderFormState>(EMPTY_FORM);
  const [isSaved, setIsSaved] = createSignal(false);
  const [isSaving, setIsSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const updateForm = (patch: Partial<ProviderFormState>) =>
    setForm({ ...form(), ...patch });

  // Sync form when selected provider changes.
  createEffect(() => {
    const providerId = props.selectedProviderId;
    if (providerId == null || props.isCreatingNew) return;
    const provider = props.providers.find((item) => item.id === providerId);
    if (!provider) return;
    setForm({
      id: provider.id,
      name: provider.name,
      providerKind: provider.providerKind === 'anthropic' ? 'anthropic' : 'openai_compatible',
      purpose: provider.purpose === 'embedding' ? 'embedding' : 'llm',
      baseUrl: provider.baseUrl,
      apiKey: '',
      modelName: provider.modelName,
    });
  });

  const currentModels = createMemo(() => {
    const providerId = props.selectedProviderId;
    if (providerId == null || !props.modelsByProvider) return [];
    return props.modelsByProvider[providerId] ?? [];
  });

  const isFetchingCurrentProvider = createMemo(() => {
    const providerId = props.selectedProviderId;
    return providerId != null && props.fetchingModelsFor === providerId;
  });

  const handleSave = async () => {
    const value = form();
    const payload: ProviderSavePayload = {
      id: value.id,
      name: value.name,
      providerKind: value.providerKind,
      purpose: value.purpose,
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
      await props.onSave(payload);
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

  return (
    <div class="space-y-8 pt-4">
      <div class="space-y-2">
        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">档案名称</label>
        <input
          type="text"
          value={form().name}
          onInput={(e) => updateForm({ name: e.currentTarget.value })}
          class="w-full bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
        />
      </div>

      <div class="space-y-2">
        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">Provider 类型</label>
        <div class="relative group">
          <Select
            value={form().providerKind}
            onChange={(val) => updateForm({ providerKind: val as 'openai_compatible' | 'anthropic' })}
            options={[
              { label: 'openai_compatible', value: 'openai_compatible' },
              { label: 'anthropic', value: 'anthropic' },
              { label: 'google_gemini', value: 'google_gemini' },
            ]}
          />
        </div>
      </div>

      <div class="space-y-2">
        <label class="text-[10px] font-bold text-mist-solid/30 uppercase tracking-wider">用途</label>
        <Select
          value={form().purpose}
          onChange={(val) => updateForm({ purpose: val as 'llm' | 'embedding' })}
          options={[
            { label: 'LLM（聊天/补全）', value: 'llm' },
            { label: 'Embedding（向量嵌入）', value: 'embedding' },
          ]}
        />
        <p class="text-[10px] text-mist-solid/30">
          LLM 档案用于聊天；Embedding 档案用于 MEM0 记忆检索，必须是 OpenAI 兼容端点。
        </p>
      </div>

      <div class="space-y-2">
        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">接口地址 (Base URL)</label>
        <input
          type="text"
          value={form().baseUrl}
          onInput={(e) => updateForm({ baseUrl: e.currentTarget.value })}
          class="w-full bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
        />
      </div>

      <div class="space-y-2">
        <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">API Key</label>
        <input
          type="password"
          value={form().apiKey}
          onInput={(e) => updateForm({ apiKey: e.currentTarget.value })}
          placeholder={form().id ? '留空表示不更新密钥' : 'sk-...'}
          class="w-full bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
        />
      </div>

      <div class="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-mist-solid/35">
        MAX TOKENS 与 TEMPERATURE 已从 API 档案中移除，后续由聊天预设统一定义。
      </div>

      {/* Model selection */}
      <div class="space-y-4 pt-4 border-t border-white/5">
        <div class="flex items-center justify-between gap-4 py-4 border-b border-white/5">
          <div>
            <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">模型选择</label>
            <p class="text-[11px] text-mist-solid/25 mt-1">从当前档案对应服务端拉取模型列表。</p>
          </div>
          <IconButton
            onClick={() => props.selectedProviderId != null && props.onFetchModels(props.selectedProviderId)}
            disabled={props.selectedProviderId == null || isFetchingCurrentProvider()}
            label={
              isFetchingCurrentProvider()
                ? '正在拉取模型列表'
                : props.selectedProviderId == null
                  ? '请先保存档案'
                  : '拉取模型列表'
            }
            size="md"
            class={isFetchingCurrentProvider() ? 'text-accent' : ''}
          >
            <RefreshCw size={16} class={isFetchingCurrentProvider() ? 'animate-spin' : ''} />
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
                  onInput={(e) => updateForm({ modelName: e.currentTarget.value })}
                  placeholder="输入自定义模型名，如 claude-sonnet-4-20250514"
                  class="flex-1 bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid placeholder:text-mist-solid/20"
                />
                <Show when={form().modelName}>
                  <button
                    onClick={() => updateForm({ modelName: '' })}
                    class="px-3 py-3 text-mist-solid/30 hover:text-mist-solid/60 transition-all"
                    title="清除"
                  >
                    <Trash2 size={16} />
                  </button>
                </Show>
              </div>
              <p class="text-[11px] text-mist-solid/25">无可用模型列表，请手动输入模型名称。</p>
            </div>
          }
        >
          <div class="space-y-2">
            <div class="relative group">
              <Select
                value={form().modelName}
                onChange={(val) => updateForm({ modelName: val })}
                options={currentModels().map((model) => ({ label: model.id, value: model.id.toString() }))}
              />
              <ChevronDown
                size={18}
                class="absolute right-4 top-1/2 -translate-y-1/2 text-mist-solid/20 pointer-events-none"
              />
            </div>
            <div class="flex items-center gap-2">
              <input
                type="text"
                value={form().modelName}
                onInput={(e) => updateForm({ modelName: e.currentTarget.value })}
                placeholder="或直接输入自定义模型名"
                class="flex-1 bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-xs focus:outline-none focus:border-accent transition-all text-mist-solid placeholder:text-mist-solid/20"
              />
              <Show when={form().modelName}>
                <button
                  onClick={() => updateForm({ modelName: '' })}
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

      {/* Claude native test */}
      <Show when={form().providerKind === 'anthropic'}>
        <ClaudeNativeTestPanel
          providerId={form().id ?? null}
          suggestedModel={form().modelName}
          onTest={props.onTestClaudeNative}
        />
      </Show>

      <Show when={saveError()}>
        <div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {saveError()}
        </div>
      </Show>

      {/* Save / Delete actions */}
      <div class="pt-4 flex items-center justify-between gap-4 border-t border-white/5">
        <div>
          <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">表单操作</div>
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

          <Show when={form().id != null && !props.isCreatingNew}>
            <IconButton
              onClick={() => form().id != null && props.onDelete(form().id!)}
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
  );
};

export { EMPTY_FORM };
