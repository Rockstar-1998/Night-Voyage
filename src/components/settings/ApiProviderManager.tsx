import { Component, For, Show, createSignal, createEffect, onMount } from 'solid-js';
import { Plus } from '../../lib/icons';
import { IconButton } from '../ui/IconButton';
import { ProviderForm, type ProviderSavePayload } from './ProviderForm';
import { Mem0ConfigPanel } from './Mem0ConfigPanel';
import type { ClaudeTestPayload, ProviderClaudeNativeTestResult } from './ClaudeNativeTestPanel';
import type { ApiProviderSummary, RemoteModel } from '../../lib/backend';
import { settingsGetAll, settingsSet } from '../../lib/backend';

interface ApiProviderManagerProps {
  providers: ApiProviderSummary[];
  modelsByProvider?: Record<number, RemoteModel[]>;
  loading?: boolean;
  fetchingModelsFor?: number | null;
  onFetchModels: (providerId: number) => Promise<void> | void;
  onSaveProvider: (payload: ProviderSavePayload) => Promise<void> | void;
  onDeleteProvider: (id: number) => Promise<void> | void;
  onTestClaudeNative: (payload: ClaudeTestPayload) => Promise<ProviderClaudeNativeTestResult> | ProviderClaudeNativeTestResult;
  mem0InitError?: string | null;
}

export const ApiProviderManager: Component<ApiProviderManagerProps> = (props) => {
  const [selectedProviderId, setSelectedProviderId] = createSignal<number | null>(null);
  const [isCreatingNew, setIsCreatingNew] = createSignal(false);

  // ---- MEM0 embedding dims (global) ----
  const [embeddingDims, setEmbeddingDims] = createSignal('1536');
  const [embeddingDimsError, setEmbeddingDimsError] = createSignal<string | null>(null);
  const [embeddingDimsSaving, setEmbeddingDimsSaving] = createSignal(false);

  const handleSaveEmbeddingDims = async () => {
    const dims = Number(embeddingDims().trim());
    if (!Number.isInteger(dims) || dims <= 0) {
      setEmbeddingDimsError('embedding 维度必须是正整数');
      return;
    }
    setEmbeddingDimsError(null);
    setEmbeddingDimsSaving(true);
    try {
      await settingsSet('mem0_embedding_dims', String(dims));
    } catch (err) {
      setEmbeddingDimsError(err instanceof Error ? err.message : String(err));
    } finally {
      setEmbeddingDimsSaving(false);
    }
  };

  onMount(async () => {
    try {
      const all = await settingsGetAll();
      const dims = all.find((s) => s.key === 'mem0_embedding_dims');
      if (dims?.value) setEmbeddingDims(dims.value);
    } catch (err) {
      setEmbeddingDimsError(err instanceof Error ? err.message : String(err));
    }
  });

  // Auto-select first provider when list changes and nothing is selected.
  createEffect(() => {
    const providers = props.providers;
    const currentSelected = selectedProviderId();
    if (providers.length === 0) {
      setSelectedProviderId(null);
      return;
    }
    if (isCreatingNew()) return;
    if (currentSelected == null || !providers.some((provider) => provider.id === currentSelected)) {
      const next = providers[0];
      setSelectedProviderId(next.id);
    }
  });

  const handleNew = () => {
    setIsCreatingNew(true);
    setSelectedProviderId(null);
  };

  const handleSelectProvider = (providerId: number) => {
    setIsCreatingNew(false);
    setSelectedProviderId(providerId);
  };

  return (
    <div class="h-full w-full overflow-y-auto custom-scrollbar">
      <div class="max-w-5xl mx-auto w-full px-8 py-16 space-y-10">
        <div class="flex items-start justify-between gap-6">
          <div>
            <h2 class="text-2xl font-bold text-mist-solid mb-2">API 档案</h2>
            <p class="text-mist-solid/40 text-sm">
              管理 OpenAI 兼容与 Anthropic 原生 API 档案，并从服务端拉取模型列表。
            </p>
          </div>
          <div class="flex items-center gap-3 border-l-2 border-white/10 bg-transparent px-4 py-3">
            <div class="text-right">
              <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">操作</div>
              <div class="text-sm text-mist-solid/40 mt-1">新建档案</div>
            </div>
            <IconButton onClick={handleNew} label="新建 API 档案" tone="accent" size="lg">
              <Plus size={18} />
            </IconButton>
          </div>
        </div>

        <Show when={props.mem0InitError}>
          <div class="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <span class="opacity-90">MEM0 记忆现在按会话配置 embedding provider，请在会话右侧抽屉的会话绑定中设置。</span>
          </div>
        </Show>

        <div class="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-8">
          {/* Provider list */}
          <div class="space-y-3">
            <Show when={!props.loading} fallback={<div class="text-sm text-mist-solid/35">正在加载档案...</div>}>
              <For each={props.providers}>
                {(provider) => (
                  <button
                    onClick={() => handleSelectProvider(provider.id)}
                    class={`w-full text-left py-4 px-2 border-b border-white/5 transition-all ${
                      selectedProviderId() === provider.id && !isCreatingNew()
                        ? 'text-accent border-accent/30'
                        : 'text-mist-solid hover:text-white hover:border-white/20'
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

          {/* Provider form / new form */}
          <ProviderForm
            selectedProviderId={selectedProviderId()}
            isCreatingNew={isCreatingNew()}
            providers={props.providers}
            modelsByProvider={props.modelsByProvider}
            fetchingModelsFor={props.fetchingModelsFor}
            onSave={props.onSaveProvider}
            onDelete={props.onDeleteProvider}
            onFetchModels={props.onFetchModels}
            onTestClaudeNative={props.onTestClaudeNative}
          />
        </div>

        <Mem0ConfigPanel
          embeddingDims={embeddingDims()}
          embeddingDimsError={embeddingDimsError()}
          embeddingDimsSaving={embeddingDimsSaving()}
          onSetEmbeddingDims={setEmbeddingDims}
          onSaveEmbeddingDims={handleSaveEmbeddingDims}
        />
      </div>
    </div>
  );
};
