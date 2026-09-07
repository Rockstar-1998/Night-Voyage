import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Check, Copy, FileText, Loader2, RefreshCw, X } from '../../lib/icons';
import {
  listPresetConversations,
  previewBlueprintWithSession,
  type BlueprintCompilePreview,
  type PresetConversationOption,
} from '../../lib/backend';
import { IconButton } from '../ui/IconButton';

export interface BlueprintCompilePreviewModalProps {
  presetId: number;
  graphJson: string;
  onClose: () => void;
  onJumpToNode: (nodeId: string) => void;
}

export const BlueprintCompilePreviewModal: Component<BlueprintCompilePreviewModalProps> = (props) => {
  const [conversations, setConversations] = createSignal<PresetConversationOption[]>([]);
  const [selectedConversationId, setSelectedConversationId] = createSignal<number | null>(null);
  const [previewData, setPreviewData] = createSignal<BlueprintCompilePreview | null>(null);
  const [isLoading, setIsLoading] = createSignal<boolean>(true);
  const [error, setError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal<boolean>(false);
  const [showSchema, setShowSchema] = createSignal<boolean>(false);

  const fetchPreview = async (cid: number | null) => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await previewBlueprintWithSession(props.presetId, props.graphJson, cid);
      setPreviewData(data);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  };

  onMount(async () => {
    try {
      const convs = await listPresetConversations(props.presetId);
      setConversations(convs);
      const initialId = convs.length > 0 ? convs[0].id : null;
      setSelectedConversationId(initialId);
      await fetchPreview(initialId);
    } catch (err) {
      setError(String(err));
      setIsLoading(false);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        props.onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => window.removeEventListener('keydown', handleKeyDown));
  });

  const handleSelectConversation = (e: Event) => {
    const val = (e.target as HTMLSelectElement).value;
    const cid = val === '' ? null : Number(val);
    setSelectedConversationId(cid);
    void fetchPreview(cid);
  };

  const handleCopyFullPrompt = async () => {
    const text = previewData()?.fullPromptText;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div class="fixed inset-0 bg-night-water/80 backdrop-blur-md z-50 flex items-center justify-center p-4 md:p-6 animate-in fade-in duration-200">
      <div class="relative w-full max-w-5xl h-[90vh] bg-xuanqing/95 border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Minimal Header */}
        <header class="flex items-center justify-between px-6 py-3.5 border-b border-white/5 bg-white/[0.01] flex-shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <div class="flex items-center gap-2 text-accent">
              <FileText size={18} />
              <span class="text-sm font-bold tracking-wide">编译预览</span>
            </div>

            <div class="h-4 w-px bg-white/10" />

            {/* Session Selector Dropdown */}
            <div class="flex items-center gap-2">
              <span class="text-xs text-mist-solid/40">会话上下文:</span>
              <select
                class="bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-xs text-mist-solid/90 focus:outline-none focus:border-accent/50 cursor-pointer hover:bg-white/[0.08] transition-colors"
                value={selectedConversationId() !== null ? String(selectedConversationId()) : ''}
                onChange={handleSelectConversation}
                disabled={isLoading()}
              >
                <option value="" class="bg-xuanqing text-mist-solid">
                  默认环境 (未指定会话)
                </option>
                <For each={conversations()}>
                  {(c) => (
                    <option value={String(c.id)} class="bg-xuanqing text-mist-solid">
                      {c.title} ({c.conversationType === 'single' ? '单人' : '联机'} · {c.protocol === 'anthropic' ? 'Anthropic 原生' : 'OpenAI 协议'})
                    </option>
                  )}
                </For>
              </select>
            </div>

            <IconButton
              onClick={() => void fetchPreview(selectedConversationId())}
              disabled={isLoading()}
              label="重新编译"
              size="sm"
            >
              <RefreshCw size={14} class={isLoading() ? 'animate-spin' : ''} />
            </IconButton>
          </div>

          <div class="flex items-center gap-2">
            <IconButton
              onClick={() => void handleCopyFullPrompt()}
              disabled={isLoading() || !previewData()}
              label={copied() ? '已复制！' : '复制完整提示词'}
              size="sm"
              tone={copied() ? 'accent' : 'neutral'}
            >
              <Show when={copied()} fallback={<Copy size={16} />}>
                <Check size={16} class="text-accent" />
              </Show>
            </IconButton>
            <IconButton onClick={props.onClose} label="关闭预览 (Esc)" size="sm">
              <X size={18} />
            </IconButton>
          </div>
        </header>

        {/* Error Banner */}
        <Show when={error()}>
          <div class="px-6 py-2.5 bg-red-500/10 border-b border-red-500/20 text-xs text-red-200 flex items-center justify-between">
            <span>编译失败：{error()}</span>
            <button
              onClick={() => void fetchPreview(selectedConversationId())}
              class="underline hover:text-white"
            >
              重试
            </button>
          </div>
        </Show>

        {/* Reading Container Body */}
        <div class="flex-1 min-h-0 overflow-y-auto px-6 md:px-12 py-6 custom-scrollbar">
          <Show when={isLoading() && !previewData()}>
            <div class="h-full flex flex-col items-center justify-center gap-3 text-mist-solid/40">
              <Loader2 size={24} class="animate-spin text-accent" />
              <div class="text-xs">正在根据会话环境编译蓝图提示词…</div>
            </div>
          </Show>

          <Show when={previewData()}>
            {(data) => (
              <div class="max-w-4xl mx-auto space-y-1">
                <For each={data().blocks}>
                  {(block) => (
                    <div
                      class="group relative my-3.5 p-5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.05] hover:border-accent/40 transition-all duration-150 cursor-pointer select-text"
                      onClick={() => {
                        if (block.nodeId) {
                          props.onJumpToNode(block.nodeId);
                          props.onClose();
                        }
                      }}
                    >
                      {/* Hover Pill: Blueprint Node Provenance */}
                      <Show when={block.nodeId}>
                        <div class="opacity-0 group-hover:opacity-100 transition-opacity duration-150 absolute -top-3 right-4 z-20 pointer-events-none flex items-center gap-1.5 px-3 py-1 rounded-full bg-night-water/95 border border-accent/40 text-[11px] font-medium text-accent shadow-xl backdrop-blur-md">
                          <span>📍</span>
                          <span>{block.nodeLabel || block.identifier || block.nodeId}</span>
                          <span class="text-mist-solid/40 text-[10px] ml-1.5 border-l border-white/10 pl-1.5">
                            点击定位画布节点
                          </span>
                        </div>
                      </Show>

                      {/* Prompt Content */}
                      <div class="text-[13.5px] text-mist-solid/85 font-normal leading-relaxed whitespace-pre-wrap selection:bg-accent/30 selection:text-white">
                        {block.content}
                      </div>
                    </div>
                  )}
                </For>

                {/* Structured Output Schema Section */}
                <Show when={data().structuredOutputSchema && Object.keys(data().structuredOutputSchema).length > 0}>
                  <div class="mt-8 pt-6 border-t border-white/5">
                    <button
                      class="flex items-center gap-2 text-xs font-semibold text-mist-solid/40 hover:text-mist-solid/80 transition-colors py-2 focus:outline-none"
                      onClick={() => setShowSchema(!showSchema())}
                    >
                      <span class="text-[10px]">{showSchema() ? '▼' : '▶'}</span>
                      <span>结构化输出 Schema 预览</span>
                      <span class="text-[10px] px-1.5 py-0.2 rounded bg-white/5 text-mist-solid/40">
                        {Object.keys((data().structuredOutputSchema as { properties?: Record<string, unknown> }).properties ?? {}).length} 个字段
                      </span>
                    </button>
                    <Show when={showSchema()}>
                      <pre class="mt-2 p-4 rounded-xl bg-black/40 border border-white/5 text-xs text-mist-solid/70 font-mono overflow-x-auto whitespace-pre leading-relaxed selection:bg-accent/30 selection:text-white">
                        {JSON.stringify(data().structuredOutputSchema, null, 2)}
                      </pre>
                    </Show>
                  </div>
                </Show>
              </div>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
};
