/**
 * MobileMacroDrawer — Mobile Blueprint Macro Library Bottom Sheet.
 *
 * Implements mobile-optimized UI for:
 * - Browsing macro assets in the preset
 * - Creating new macros with auto-scaffolded Inputs/Outputs boundary nodes
 * - Switching into macro subgraph editing
 * - Placing macro instances into the blueprint
 * - Deleting macros
 */

import { Component, For, Show, createSignal } from 'solid-js';
import type { BlueprintMacro } from '../../../src/lib/blueprint/types';
import { showToast } from '../Toast';

export interface MobileMacroDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  macros: BlueprintMacro[];
  activeMacroId: string | null;
  onSelectMacro: (macroId: string) => void;
  onCreateMacro: (name: string, category: string) => void;
  onDeleteMacro: (macroId: string) => void;
  onPlaceMacroInstance: (macroId: string) => void;
}

export const MobileMacroDrawer: Component<MobileMacroDrawerProps> = (props) => {
  const [newMacroName, setNewMacroName] = createSignal('');
  const [newMacroCategory, setNewMacroCategory] = createSignal('通用');
  const [isCreating, setIsCreating] = createSignal(false);

  const handleCreate = () => {
    const name = newMacroName().trim();
    if (!name) return;
    props.onCreateMacro(name, newMacroCategory().trim() || '通用');
    setNewMacroName('');
    setIsCreating(false);
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-[1600] flex flex-col justify-end">
        {/* Backdrop */}
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
          onClick={props.onClose}
        />

        {/* Sheet Content */}
        <div class="relative w-full max-h-[85vh] bg-xuanqing rounded-t-3xl border-t border-white/10 shadow-2xl flex flex-col safe-area-bottom pb-[max(1rem,env(safe-area-inset-bottom))]">
          {/* Grab Bar */}
          <div class="w-full flex justify-center pt-3 pb-1 shrink-0">
            <div class="w-12 h-1.5 bg-white/20 rounded-full" />
          </div>

          {/* Header */}
          <div class="px-5 py-3 border-b border-white/10 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-[16px] font-bold text-white">UE5 蓝图宏库</span>
              <span class="text-[11px] px-2 py-0.5 rounded-full bg-accent/20 text-accent font-medium">
                {props.macros.length}
              </span>
            </div>
            <button
              onClick={props.onClose}
              class="px-2.5 py-1 text-xs rounded-lg bg-white/5 text-mist-solid/60 active:bg-white/10"
            >
              关闭
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
            {/* Action Bar */}
            <div class="flex items-center justify-between">
              <span class="text-xs text-mist-solid/50">子图资产定义</span>
              <button
                onClick={() => setIsCreating(true)}
                class="px-3 py-1.5 text-xs font-bold rounded-xl bg-accent text-white active:scale-95 transition-transform shadow-md"
              >
                + 新建宏
              </button>
            </div>

            {/* Create Form */}
            <Show when={isCreating()}>
              <div class="p-3.5 rounded-2xl border border-accent/40 bg-accent/10 space-y-2.5">
                <div class="text-xs font-bold text-white">新建宏定义</div>
                <input
                  type="text"
                  placeholder="宏名称（如：购买物品判定链）"
                  value={newMacroName()}
                  onInput={(e) => setNewMacroName(e.currentTarget.value)}
                  class="w-full px-3 py-2 text-xs rounded-xl bg-night-sky border border-white/15 text-white placeholder-mist-solid/30 focus:outline-none focus:border-accent"
                />
                <input
                  type="text"
                  placeholder="分类（可选，默认：通用）"
                  value={newMacroCategory()}
                  onInput={(e) => setNewMacroCategory(e.currentTarget.value)}
                  class="w-full px-3 py-2 text-xs rounded-xl bg-night-sky border border-white/15 text-white placeholder-mist-solid/30 focus:outline-none focus:border-accent"
                />
                <div class="flex justify-end gap-2 pt-1">
                  <button
                    onClick={() => setIsCreating(false)}
                    class="px-3 py-1.5 text-xs rounded-xl border border-white/10 text-mist-solid/60 active:bg-white/5"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!newMacroName().trim()}
                    class="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-accent text-white disabled:opacity-50 active:scale-95 transition-transform"
                  >
                    创建
                  </button>
                </div>
              </div>
            </Show>

            {/* Macro List */}
            <div class="space-y-2.5">
              <Show
                when={props.macros.length > 0}
                fallback={
                  <div class="p-8 text-center text-xs text-mist-solid/40 border border-dashed border-white/10 rounded-2xl">
                    暂无宏定义。可将常用计算与校验封装为宏，编译期自动内联展开。
                  </div>
                }
              >
                <For each={props.macros}>
                  {(macro) => {
                    const isActive = () => props.activeMacroId === macro.id;
                    const inputsCount = () => macro.inputs?.length || 0;
                    const outputsCount = () => macro.outputs?.length || 0;

                    return (
                      <div
                        class={`p-3.5 rounded-2xl border transition-all ${
                          isActive()
                            ? 'border-accent bg-accent/15 shadow-lg shadow-accent/10'
                            : 'border-white/10 bg-white/5 active:border-white/20'
                        }`}
                      >
                        <div class="flex items-start justify-between gap-2">
                          <div>
                            <div class="flex items-center gap-2">
                              <span class="text-[13px] font-bold text-white">{macro.name}</span>
                              <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-mist-solid/60">
                                {macro.category || '通用'}
                              </span>
                            </div>
                            <Show when={macro.description}>
                              <p class="text-[11px] text-mist-solid/50 mt-0.5 line-clamp-1">{macro.description}</p>
                            </Show>
                          </div>

                          <button
                            onClick={() => {
                              if (confirm(`确定删除宏「${macro.name}」吗？`)) {
                                props.onDeleteMacro(macro.id);
                              }
                            }}
                            class="p-1.5 rounded-lg text-mist-solid/40 hover:text-red-400 active:bg-red-500/10"
                            title="删除宏"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                          </button>
                        </div>

                        <div class="flex items-center gap-3 mt-2 text-[11px] text-mist-solid/50">
                          <span>引脚：{inputsCount()} 入 / {outputsCount()} 出</span>
                          <span>节点：{macro.nodes?.length || 0}</span>
                        </div>

                        <div class="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-white/5">
                          <button
                            onClick={() => {
                              props.onPlaceMacroInstance(macro.id);
                              props.onClose();
                            }}
                            class="flex items-center gap-1 px-3 py-1.5 text-xs rounded-xl bg-white/10 text-mist-solid active:bg-white/15 font-medium"
                          >
                            放入画布
                          </button>

                          <button
                            onClick={() => {
                              props.onSelectMacro(macro.id);
                              props.onClose();
                            }}
                            class={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-transform active:scale-95 ${
                              isActive()
                                ? 'bg-accent text-white'
                                : 'bg-accent/20 text-accent'
                            }`}
                          >
                            {isActive() ? '正在编辑' : '进入子图'}
                          </button>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
