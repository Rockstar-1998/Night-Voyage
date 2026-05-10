import { Component, For, Show } from 'solid-js';
import { Eye, RefreshCw, X } from '../lib/icons';
import type { PresetCompilePreview } from '../lib/backend';
import { IconButton } from './ui/IconButton';

export const CompletionPreviewModal: Component<{
  isOpen: boolean;
  loading?: boolean;
  error?: string | null;
  preview: PresetCompilePreview | null;
  providerKind: string;
  onProviderKindChange: (value: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}> = (props) => {
  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-[1000] flex flex-col bg-xuanqing/95 backdrop-blur-2xl animate-in fade-in duration-300">
        <div class="h-16 flex items-center justify-between px-8 border-b border-white/5">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg bg-accent/20 text-accent">
              <Eye size={20} />
            </div>
            <div>
              <h2 class="text-lg font-bold text-white tracking-tight">预设编译预览</h2>
              <p class="text-xs text-mist-solid/35 mt-1">查看当前 preset 编译后的 system 文本、示例消息和合并参数。</p>
            </div>
          </div>
          <IconButton onClick={props.onClose} label="关闭编译预览" size="md">
            <X size={18} />
          </IconButton>
        </div>

        <div class="flex-1 overflow-y-auto p-10 custom-scrollbar">
          <div class="max-w-6xl mx-auto space-y-6">
            <div class="rounded-3xl border border-white/5 bg-white/5 p-5 flex items-end gap-4">
              <div class="flex-1 space-y-2">
                <label class="text-xs font-bold text-mist-solid/35 uppercase tracking-widest block">Provider Kind（可选）</label>
                <input
                  type="text"
                  value={props.providerKind}
                  onInput={(e) => props.onProviderKindChange(e.currentTarget.value)}
                  class="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-3 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
                  placeholder="例如 openai_compatible"
                />
              </div>
              <div class="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/10 px-4 py-3">
                <div class="text-right">
                  <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">操作</div>
                  <div class="text-sm text-mist-solid/40 mt-1">{props.loading ? '刷新中' : '刷新预览'}</div>
                </div>
                <IconButton onClick={props.onRefresh} label={props.loading ? '刷新预览中' : '刷新预览'} tone="accent" size="lg">
                  <RefreshCw size={16} class={props.loading ? 'animate-spin' : ''} />
                </IconButton>
              </div>
            </div>

            <Show when={props.error}>
              <div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {props.error}
              </div>
            </Show>

            <Show when={!props.loading} fallback={<div class="text-sm text-mist-solid/35">正在编译预览...</div>}>
              <Show
                when={props.preview}
                fallback={<div class="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-mist-solid/35">尚未加载预览数据。</div>}
              >
                {(previewAccessor) => {
                  const preview = () => previewAccessor();
                  return (
                    <div class="space-y-6">
                      <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
                        <div class="xl:col-span-2 rounded-3xl border border-white/5 bg-white/5 p-5 space-y-4">
                          <div>
                            <h3 class="text-sm font-bold text-mist-solid">System Text</h3>
                            <p class="text-xs text-mist-solid/35 mt-1">这是 provider adapter 会看到的合并后 system 文本。</p>
                          </div>
                          <textarea
                            readOnly
                            value={preview().systemText}
                            class="w-full min-h-[320px] bg-black/30 border border-white/10 rounded-2xl px-4 py-4 text-sm text-mist-solid resize-none custom-scrollbar"
                          />
                        </div>

                        <div class="rounded-3xl border border-white/5 bg-white/5 p-5 space-y-4">
                          <div>
                            <h3 class="text-sm font-bold text-mist-solid">合并参数</h3>
                            <p class="text-xs text-mist-solid/35 mt-1">包含基础参数与 provider override 合并后的结果。</p>
                          </div>
                          <div class="space-y-2 text-sm text-mist-solid/70">
                            <div>temperature：{preview().params.temperature ?? '未设置'}</div>
                            <div>maxOutputTokens：{preview().params.maxOutputTokens ?? '未设置'}</div>
                            <div>topP：{preview().params.topP ?? '未设置'}</div>
                            <div>presencePenalty：{preview().params.presencePenalty ?? '未设置'}</div>
                            <div>frequencyPenalty：{preview().params.frequencyPenalty ?? '未设置'}</div>
                            <div>responseMode：{preview().params.responseMode ?? '未设置'}</div>
                          </div>
                          <div class="pt-3 border-t border-white/5 space-y-2">
                            <div class="text-xs font-bold text-mist-solid/35 uppercase tracking-widest">Stop Sequences</div>
                            <Show when={preview().params.stopSequences.length > 0} fallback={<div class="text-sm text-mist-solid/35">无</div>}>
                              <div class="flex flex-wrap gap-2">
                                <For each={preview().params.stopSequences}>
                                  {(stop) => (
                                    <span class="text-[11px] px-2 py-1 rounded-md border border-accent/20 bg-accent/10 text-accent">
                                      {stop}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                        </div>
                      </div>

                      <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        <div class="rounded-3xl border border-white/5 bg-white/5 p-5 space-y-4">
                          <div>
                            <h3 class="text-sm font-bold text-mist-solid">System Blocks</h3>
                            <p class="text-xs text-mist-solid/35 mt-1">哪些条目实际参与了编译。</p>
                          </div>
                          <div class="space-y-3 max-h-[320px] overflow-y-auto custom-scrollbar">
                            <For each={preview().systemBlocks}>
                              {(block) => (
                                <div class="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-2">
                                  <div class="flex flex-wrap items-center gap-2">
                                    <div class="text-sm font-bold text-mist-solid">{block.title ?? block.blockType}</div>
                                    <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/50">
                                      {block.blockType}
                                    </span>
                                  </div>
                                  <p class="text-xs text-mist-solid/45 leading-5 line-clamp-4">{block.content}</p>
                                </div>
                              )}
                            </For>
                            <Show when={preview().systemBlocks.length === 0}>
                              <div class="text-sm text-mist-solid/35">当前没有可见 system blocks。</div>
                            </Show>
                          </div>
                        </div>

                        <div class="rounded-3xl border border-white/5 bg-white/5 p-5 space-y-4">
                          <div>
                            <h3 class="text-sm font-bold text-mist-solid">Example Messages</h3>
                            <p class="text-xs text-mist-solid/35 mt-1">few-shot 示例消息预览。</p>
                          </div>
                          <div class="space-y-3 max-h-[320px] overflow-y-auto custom-scrollbar">
                            <For each={preview().exampleMessages}>
                              {(message) => (
                                <div class="rounded-2xl border border-white/10 bg-black/10 p-4 space-y-2">
                                  <span class="text-[10px] px-2 py-0.5 rounded-md border border-blue-500/20 bg-blue-500/10 text-blue-200 uppercase tracking-widest">
                                    {message.role}
                                  </span>
                                  <p class="text-xs text-mist-solid/60 leading-5 whitespace-pre-wrap">{message.content}</p>
                                </div>
                              )}
                            </For>
                            <Show when={preview().exampleMessages.length === 0}>
                              <div class="text-sm text-mist-solid/35">当前没有 example messages。</div>
                            </Show>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }}
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
