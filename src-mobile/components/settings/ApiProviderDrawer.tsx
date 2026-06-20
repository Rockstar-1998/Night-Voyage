import { Component, createSignal, createEffect, For, Show } from 'solid-js';
import { Save, Trash2, X, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-solid';
import { ApiProviderSummary, providersCreate, providersUpdate, providersDelete, providersTest, providersFetchModels } from '../../../src/lib/backend';

interface ApiProviderDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  provider: ApiProviderSummary | null;
  onRefresh: () => Promise<void>;
}

export const ApiProviderDrawer: Component<ApiProviderDrawerProps> = (props) => {
  const [name, setName] = createSignal('');
  const [providerKind, setProviderKind] = createSignal<'openai_compatible' | 'anthropic'>('openai_compatible');
  const [baseUrl, setBaseUrl] = createSignal('');
  const [apiKey, setApiKey] = createSignal('');
  const [modelName, setModelName] = createSignal('');
  const [fetchedModels, setFetchedModels] = createSignal<string[]>([]);

  const [isSaving, setIsSaving] = createSignal(false);
  const [isTesting, setIsTesting] = createSignal(false);
  const [isFetching, setIsFetching] = createSignal(false);
  
  const [testResult, setTestResult] = createSignal<{success: boolean, msg: string} | null>(null);

  // Sync state when provider prop changes
  createEffect(() => {
    if (props.isOpen) {
      if (props.provider) {
        setName(props.provider.name);
        setProviderKind(props.provider.providerKind as any || 'openai_compatible');
        setBaseUrl(props.provider.baseUrl || '');
        setApiKey(''); // Keep empty, only update if user types
        setModelName(props.provider.modelName || '');
      } else {
        setName('');
        setProviderKind('openai_compatible');
        setBaseUrl('');
        setApiKey('');
        setModelName('');
      }
      setFetchedModels([]);
      setTestResult(null);
    }
  });

  const handleSave = async () => {
    if (!name().trim()) {
      window.alert('档案名称不能为空');
      return;
    }
    
    setIsSaving(true);
    try {
      const payload = {
        name: name().trim(),
        providerKind: providerKind(),
        baseUrl: baseUrl().trim() || undefined,
        apiKey: apiKey().trim() || undefined,
        modelName: modelName().trim() || '<empty>',
      };
      
      if (props.provider) {
        await providersUpdate({ id: props.provider.id, ...payload });
      } else {
        await providersCreate(payload);
      }
      await props.onRefresh();
      props.onClose();
    } catch (e) {
      window.alert(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!props.provider) return;
    if (!window.confirm(`确定要删除档案「${props.provider.name}」吗？`)) return;
    
    setIsSaving(true);
    try {
      await providersDelete(props.provider.id);
      await props.onRefresh();
      props.onClose();
    } catch (e) {
      window.alert(`删除失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!props.provider && !apiKey().trim() && !baseUrl().trim()) {
       setTestResult({success: false, msg: '请先填写完整信息或先保存档案'});
       return;
    }
    
    setIsTesting(true);
    setTestResult(null);
    try {
      // Create test payload. For unsaved providers we might just test with the current form data.
      // But the backend `providersTest` requires `providerId` OR inline payload depending on the signature.
      // Looking at `backend.ts`, `providersTest` can take `providerId` or inline parameters.
      const payload: any = props.provider ? { providerId: props.provider.id } : {
         providerKind: providerKind(),
         baseUrl: baseUrl().trim() || undefined,
         apiKey: apiKey().trim() || undefined,
      };
      
      const res = await providersTest(payload);
      if (res.ok) {
        setTestResult({success: true, msg: `测试通过 (${res.latencyMs}ms)`});
      } else {
        setTestResult({success: false, msg: `测试失败: HTTP ${res.status}`});
      }
    } catch (e) {
      setTestResult({success: false, msg: `测试出错: ${e instanceof Error ? e.message : String(e)}`});
    } finally {
      setIsTesting(false);
    }
  };

  const handleFetchModels = async () => {
    if (!props.provider) {
      window.alert('请先保存档案后再拉取模型');
      return;
    }
    
    setIsFetching(true);
    try {
      const fetched = await providersFetchModels(props.provider.id);
      if (fetched && fetched.length > 0) {
        const newModels = fetched.map(m => m.id);
        setFetchedModels(newModels);
        if (!modelName()) {
          setModelName(newModels[0]);
        }
      } else {
        window.alert('未拉取到模型列表');
      }
    } catch (e) {
      window.alert(`拉取模型失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsFetching(false);
    }
  };

  return (
    <div class={`fixed inset-0 z-[3000] flex flex-col justify-end transition-all duration-300 ease-out ${props.isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
      {/* Backdrop */}
      <div 
        class={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${props.isOpen ? 'opacity-100' : 'opacity-0'}`}
        onClick={props.onClose}
      />

      {/* Drawer */}
      <div class={`relative w-full bg-[#1A2332] rounded-t-3xl h-[90vh] flex flex-col transition-transform duration-300 ease-out safe-area-bottom ${props.isOpen ? 'translate-y-0' : 'translate-y-full'}`}>
        
        {/* Handle */}
        <div class="w-full flex justify-center pt-4 pb-2 shrink-0">
          <div class="w-12 h-1.5 bg-white/20 rounded-full" />
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar px-6 pb-24 pt-2 flex flex-col gap-6 relative z-0">
          
          <div class="flex items-center justify-between">
             <h2 class="text-xl font-bold text-white">{props.provider ? '编辑 API 档案' : '新建 API 档案'}</h2>
             <button onClick={props.onClose} class="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-mist-solid/60 hover:text-white transition-colors">
               <X size={16} />
             </button>
          </div>

          <div class="flex flex-col gap-5">
            {/* Name */}
            <div class="flex flex-col gap-1.5">
              <label class="text-[11px] font-bold text-mist-solid/40 uppercase tracking-widest">档案名称</label>
              <input
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="例如：nvidia, moonshot"
                class="w-full bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {/* Provider Type */}
            <div class="flex flex-col gap-1.5">
              <label class="text-[11px] font-bold text-mist-solid/40 uppercase tracking-widest">Provider 类型</label>
              <div class="relative">
                <select
                  value={providerKind()}
                  onChange={(e) => setProviderKind(e.currentTarget.value as any)}
                  class="w-full appearance-none bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-accent transition-colors"
                >
                  <option value="openai_compatible" class="bg-[#1A2332]">openai_compatible</option>
                  <option value="anthropic" class="bg-[#1A2332]">anthropic</option>
                </select>
                <div class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-mist-solid/60">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                </div>
              </div>
            </div>

            {/* Base URL */}
            <div class="flex flex-col gap-1.5">
              <label class="text-[11px] font-bold text-mist-solid/40 uppercase tracking-widest">接口地址 (Base URL)</label>
              <input
                value={baseUrl()}
                onInput={(e) => setBaseUrl(e.currentTarget.value)}
                placeholder="https://api.example.com/v1"
                class="w-full bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {/* API Key */}
            <div class="flex flex-col gap-1.5">
              <label class="text-[11px] font-bold text-mist-solid/40 uppercase tracking-widest">API Key</label>
              <input
                type="password"
                value={apiKey()}
                onInput={(e) => setApiKey(e.currentTarget.value)}
                placeholder={props.provider ? '留空表示不更改密钥' : 'sk-...'}
                class="w-full bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-accent transition-colors"
              />
              <p class="text-[10px] text-mist-solid/40 mt-1 leading-relaxed">
                MAX TOKENS、TEMPERATURE 等 API 请求参数，后续在聊天预设中定义。
              </p>
            </div>
            
            {/* Test Connection Button */}
            <div class="flex items-center gap-3">
               <button
                 onClick={handleTest}
                 disabled={isTesting()}
                 class="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-bold text-white hover:bg-white/10 transition-colors disabled:opacity-50"
               >
                 {isTesting() ? '测试中...' : '测试连通性'}
               </button>
               <Show when={testResult()}>
                 {(res) => (
                   <span class={`text-[11px] font-bold ${res().success ? 'text-green-400' : 'text-red-400'}`}>
                     {res().msg}
                   </span>
                 )}
               </Show>
            </div>

            {/* Models */}
            <div class="flex flex-col gap-1.5 mt-2 pt-4 border-t border-white/5">
              <div class="flex justify-between items-end mb-1">
                <label class="text-[11px] font-bold text-mist-solid/40 uppercase tracking-widest">模型名称</label>
                <button
                  onClick={handleFetchModels}
                  disabled={isFetching() || !props.provider}
                  class="flex items-center gap-1.5 text-[10px] bg-accent/20 text-accent px-2.5 py-1.5 rounded-md font-bold disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={12} class={isFetching() ? 'animate-spin' : ''} />
                  从服务端拉取模型
                </button>
              </div>
              
              <Show when={fetchedModels().length > 0}>
                <div class="relative group mb-2">
                  <select
                    value={fetchedModels().includes(modelName()) ? modelName() : ''}
                    onChange={(e) => setModelName(e.currentTarget.value)}
                    class="w-full appearance-none bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-accent transition-colors"
                  >
                    <option value="" disabled class="bg-[#1A2332]">-- 从列表中选择 --</option>
                    <For each={fetchedModels()}>
                      {(m) => <option value={m} class="bg-[#1A2332]">{m}</option>}
                    </For>
                  </select>
                  <div class="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-mist-solid/60">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
                  </div>
                </div>
              </Show>

              <div class="flex gap-2">
                <input
                  value={modelName()}
                  onInput={(e) => setModelName(e.currentTarget.value)}
                  placeholder="手动输入或选择上方拉取的模型名称"
                  class="flex-1 bg-black/20 border border-white/10 rounded-xl py-3 px-4 text-sm text-white focus:outline-none focus:border-accent transition-colors"
                />
              </div>
            </div>

          </div>
        </div>

        {/* Action Buttons */}
        <div class="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-[#1A2332] via-[#1A2332]/95 to-transparent z-20 pb-[max(1rem,env(safe-area-inset-bottom))] flex gap-3">
          <Show when={props.provider}>
            <button
              onClick={handleDelete}
              disabled={isSaving()}
              class="w-12 h-12 shrink-0 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Trash2 size={20} />
            </button>
          </Show>
          <button
            onClick={handleSave}
            disabled={isSaving()}
            class="flex-1 h-12 rounded-xl bg-accent text-white font-bold text-sm flex items-center justify-center gap-2 hover:bg-accent/90 transition-colors shadow-[0_4px_15px_rgba(58,109,140,0.4)] disabled:opacity-50"
          >
            <Save size={18} />
            {isSaving() ? '保存中...' : '保存档案'}
          </button>
        </div>
      </div>
    </div>
  );
};
