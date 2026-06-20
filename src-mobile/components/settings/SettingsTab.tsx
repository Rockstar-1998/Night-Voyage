import { Component, createSignal, For, Show } from 'solid-js';
import { ChevronRight, Globe, Palette, Plus, ChevronLeft, Save, Trash2, CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-solid';
import { ApiProviderSummary, ProviderKind, providersCreate, providersUpdate, providersDelete, providersTest } from '../../../src/lib/backend';
import { ApiProviderDrawer } from './ApiProviderDrawer';

interface SettingsTabProps {
  providers: ApiProviderSummary[];
  onRefresh: () => Promise<void>;
}

type SettingsView = 'home' | 'api-list' | 'appearance';

export const SettingsTab: Component<SettingsTabProps> = (props) => {
  const [activeView, setActiveView] = createSignal<SettingsView>('home');
  
  // API Provider state
  const [selectedProvider, setSelectedProvider] = createSignal<ApiProviderSummary | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = createSignal(false);
  
  const handleOpenDrawer = (provider?: ApiProviderSummary) => {
    if (provider) {
      setSelectedProvider(provider);
    } else {
      setSelectedProvider(null);
    }
    setIsDrawerOpen(true);
  };
  
  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
  };

  return (
    <div class="h-full w-full flex flex-col bg-xuanqing relative overflow-hidden">
      
      {/* Dynamic Header */}
      <header class="h-14 shrink-0 flex items-center justify-between px-4 z-30 bg-xuanqing/80 backdrop-blur-md">
        <div class="flex items-center gap-3 min-w-0">
          <Show when={activeView() !== 'home'} fallback={
            <h1 class="font-bold text-lg select-none truncate">设置</h1>
          }>
            <button
              onClick={() => setActiveView('home')}
              class="text-mist-solid/60 hover:text-white flex items-center gap-1"
            >
              <ChevronLeft size={20} />
              <span class="text-xs">返回</span>
            </button>
            <h1 class="font-bold text-lg select-none truncate">
              {activeView() === 'api-list' ? 'API 档案' : '界面外观'}
            </h1>
          </Show>
        </div>
        
        <Show when={activeView() === 'api-list'}>
          <button
            onClick={() => handleOpenDrawer()}
            class="w-8 h-8 rounded-full bg-accent/20 flex items-center justify-center text-accent hover:bg-accent/30 transition-colors"
          >
            <Plus size={18} />
          </button>
        </Show>
      </header>

      {/* Main Content Area */}
      <div class="flex-1 overflow-y-auto custom-scrollbar px-5 pb-24 relative z-0">
        
        {/* View: Home */}
        <Show when={activeView() === 'home'}>
          <div class="flex flex-col gap-3 pt-4">
            <button
              onClick={() => setActiveView('api-list')}
              class="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 active:scale-[0.98] transition-all"
            >
              <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                  <Globe size={20} />
                </div>
                <div class="flex flex-col items-start">
                  <span class="text-sm font-bold text-white">API 配置</span>
                  <span class="text-[11px] text-mist-solid/40">当前分类</span>
                </div>
              </div>
              <ChevronRight size={18} class="text-mist-solid/40" />
            </button>
            
            <button
              onClick={() => setActiveView('appearance')}
              class="w-full flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/5 active:scale-[0.98] transition-all"
            >
              <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-mist-solid/10 flex items-center justify-center text-mist-solid/60">
                  <Palette size={20} />
                </div>
                <div class="flex flex-col items-start">
                  <span class="text-sm font-bold text-white">界面外观</span>
                  <span class="text-[11px] text-mist-solid/40">点击图标切换</span>
                </div>
              </div>
              <ChevronRight size={18} class="text-mist-solid/40" />
            </button>
          </div>
        </Show>

        {/* View: API List */}
        <Show when={activeView() === 'api-list'}>
          <div class="flex flex-col gap-4 pt-4">
            <p class="text-[11px] text-mist-solid/50 px-1 leading-relaxed">
              管理 OpenAI 兼容与 Anthropic 原生 API 档案，并从服务端拉取模型列表。
            </p>
            
            <Show when={props.providers.length === 0}>
              <div class="py-12 text-center text-sm text-mist-solid/35">
                暂无 API 档案，请点击右上角新建。
              </div>
            </Show>
            
            <div class="flex flex-col gap-3">
              <For each={props.providers}>
                {(provider) => (
                  <button
                    onClick={() => handleOpenDrawer(provider)}
                    class="w-full flex flex-col p-4 rounded-2xl bg-white/5 border border-white/10 active:scale-[0.98] transition-all text-left gap-2 relative overflow-hidden group"
                  >
                    <div class="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    
                    <div class="flex justify-between items-start w-full relative z-10">
                      <h3 class="text-base font-bold text-white">{provider.name}</h3>
                      <span class="text-[9px] uppercase tracking-wider font-bold text-mist-solid/40 bg-white/5 px-2 py-1 rounded-md">
                        {provider.providerKind === 'openai_compatible' ? 'OPENAI_COMPATIBLE' : 'ANTHROPIC'}
                      </span>
                    </div>
                    
                    <div class="flex flex-col gap-1 w-full relative z-10">
                      <span class="text-[13px] text-mist-solid/80 truncate">{provider.models.join(', ') || '未配置模型'}</span>
                      <span class="text-[10px] text-mist-solid/40 font-mono truncate">{provider.baseUrl || '•••• (无 Base URL)'}</span>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* View: Appearance (Placeholder) */}
        <Show when={activeView() === 'appearance'}>
          <div class="flex flex-col items-center justify-center py-20 text-center gap-4">
            <div class="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-mist-solid/40">
              <Palette size={32} />
            </div>
            <p class="text-sm text-mist-solid/50">移动端界面外观设置正在开发中。</p>
          </div>
        </Show>
        
      </div>
      
      <ApiProviderDrawer 
        isOpen={isDrawerOpen()}
        onClose={handleCloseDrawer}
        provider={selectedProvider()}
        onRefresh={props.onRefresh}
      />
    </div>
  );
};
