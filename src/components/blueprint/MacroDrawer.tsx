/**
 * MacroDrawer — Blueprint Macro Library Drawer (PC Frontend).
 *
 * Allows creators to:
 * - View all blueprint macro assets defined in the preset.
 * - Create new macros (with auto-scaffolded Inputs and Outputs proxy nodes).
 * - Open a macro for isolated subgraph editing.
 * - Delete unused macros.
 * - Place a MacroInstance node onto the canvas.
 */

import { Component, For, Show, createSignal } from 'solid-js';
import { Layers3, Plus, Trash2, X, ChevronRight, FilePlus2 } from '../../lib/icons';
import type { BlueprintMacro } from '../../lib/blueprint/types';
import { IconButton } from '../ui/IconButton';
import { showConfirm } from '../Toast';

export interface MacroDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  macros: BlueprintMacro[];
  activeMacroId: string | null;
  onSelectMacro: (macroId: string) => void;
  onCreateMacro: (name: string, category: string) => void;
  onDeleteMacro: (macroId: string) => void;
  onPlaceMacroInstance: (macroId: string) => void;
}

export const MacroDrawer: Component<MacroDrawerProps> = (props) => {
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
      <div class="fixed inset-y-0 right-0 z-40 w-96 bg-night-water/95 backdrop-blur-xl border-l border-white/10 shadow-2xl flex flex-col text-mist-solid">
        {/* Header */}
        <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div class="flex items-center gap-2">
            <Layers3 class="w-5 h-5 text-accent" />
            <h2 class="text-sm font-semibold text-white">UE5 蓝图宏资产库</h2>
            <span class="text-xs px-2 py-0.5 rounded-full bg-accent/20 text-accent font-medium">
              {props.macros.length}
            </span>
          </div>
          <IconButton icon={X} size="sm" onClick={props.onClose} title="关闭" />
        </div>

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
          {/* Action Bar */}
          <div class="flex items-center justify-between">
            <span class="text-xs text-mist-muted">宏子图资产列表</span>
            <button
              onClick={() => setIsCreating(true)}
              class="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors shadow-sm"
            >
              <Plus class="w-3.5 h-3.5" />
              新建宏
            </button>
          </div>

          {/* New Macro Form */}
          <Show when={isCreating()}>
            <div class="p-3 rounded-xl border border-accent/40 bg-accent/10 space-y-2.5 animate-fadeIn">
              <div class="text-xs font-semibold text-white">新建宏定义</div>
              <input
                type="text"
                placeholder="宏名称（如：购买物品判定链）"
                value={newMacroName()}
                onInput={(e) => setNewMacroName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreate();
                  if (e.key === 'Escape') setIsCreating(false);
                }}
                class="w-full px-2.5 py-1.5 text-xs rounded-lg bg-night-sky border border-white/15 text-white placeholder-mist-muted focus:outline-none focus:border-accent"
                autofocus
              />
              <input
                type="text"
                placeholder="分类（可选，默认：通用）"
                value={newMacroCategory()}
                onInput={(e) => setNewMacroCategory(e.currentTarget.value)}
                class="w-full px-2.5 py-1.5 text-xs rounded-lg bg-night-sky border border-white/15 text-white placeholder-mist-muted focus:outline-none focus:border-accent"
              />
              <div class="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setIsCreating(false)}
                  class="px-2.5 py-1 text-xs rounded-lg border border-white/10 hover:bg-white/5 transition-colors text-mist-muted"
                >
                  取消
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!newMacroName().trim()}
                  class="px-3 py-1 text-xs rounded-lg bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
                >
                  创建
                </button>
              </div>
            </div>
          </Show>

          {/* Macro List */}
          <div class="space-y-2">
            <Show
              when={props.macros.length > 0}
              fallback={
                <div class="p-8 text-center text-xs text-mist-muted/60 border border-dashed border-white/10 rounded-xl">
                  暂无宏定义。宏可将多步校验与计算链封装为单一节点，编译期零开销内联展开。
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
                      class={`p-3 rounded-xl border transition-all ${
                        isActive()
                          ? 'border-accent bg-accent/15 shadow-md shadow-accent/10'
                          : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                      }`}
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div>
                          <div class="flex items-center gap-2">
                            <span class="text-xs font-semibold text-white">{macro.name}</span>
                            <span class="text-[10px] px-1.5 py-0.2 rounded bg-white/10 text-mist-muted">
                              {macro.category || '通用'}
                            </span>
                          </div>
                          <Show when={macro.description}>
                            <p class="text-[11px] text-mist-muted mt-0.5 line-clamp-1">{macro.description}</p>
                          </Show>
                        </div>

                        <button
                          onClick={async () => {
                            const ok = await showConfirm(`确定删除宏「${macro.name}」吗？图上的实例节点也将失效。`);
                            if (ok) props.onDeleteMacro(macro.id);
                          }}
                          class="p-1 rounded text-mist-muted/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="删除宏"
                        >
                          <Trash2 class="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Pin Summary */}
                      <div class="flex items-center gap-3 mt-2 text-[10px] text-mist-muted">
                        <span>引脚：{inputsCount()} 入 / {outputsCount()} 出</span>
                        <span>内部节点：{macro.nodes?.length || 0}</span>
                      </div>

                      {/* Operations */}
                      <div class="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-white/5">
                        <button
                          onClick={() => props.onPlaceMacroInstance(macro.id)}
                          class="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-white/10 hover:bg-white/15 text-mist-solid transition-colors"
                        >
                          <FilePlus2 class="w-3 h-3 text-accent" />
                          放入画布
                        </button>

                        <button
                          onClick={() => {
                            props.onSelectMacro(macro.id);
                            props.onClose();
                          }}
                          class={`flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium rounded transition-colors ${
                            isActive()
                              ? 'bg-accent text-white'
                              : 'bg-accent/20 text-accent hover:bg-accent/30'
                          }`}
                        >
                          {isActive() ? '正在编辑' : '编辑子图'}
                          <ChevronRight class="w-3 h-3" />
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
    </Show>
  );
};
