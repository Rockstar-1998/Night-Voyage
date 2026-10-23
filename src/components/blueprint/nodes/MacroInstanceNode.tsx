/**
 * MacroInstanceNode — Configuration form for macro_instance node.
 *
 * Displays:
 * - Macro reference selection
 * - Instance name
 * - Quick jump to edit macro subgraph
 * - Input/Output pin preview
 */

import { Component, For, Show } from 'solid-js';
import { ChevronRight, Layers3 } from '../../../lib/icons';
import type { BlueprintMacro, MacroInstanceConfig } from '../../../lib/blueprint/types';
import { PIN_TYPE_COLORS } from '../nodeLayout';

export interface MacroInstanceNodeProps {
  config: MacroInstanceConfig;
  macros: BlueprintMacro[];
  isLocked: boolean;
  onUpdate: (updates: Partial<MacroInstanceConfig>) => void;
  onOpenMacro?: (macroId: string) => void;
}

export const MacroInstanceNode: Component<MacroInstanceNodeProps> = (props) => {
  const currentMacro = () => props.macros?.find((m) => m.id === props.config.macro_id);

  return (
    <div class="space-y-4 text-xs">
      <div>
        <label class="block text-[11px] font-bold uppercase tracking-wider text-mist-solid/40 mb-1">
          实例显示名称
        </label>
        <input
          type="text"
          value={props.config.name || ''}
          disabled={props.isLocked}
          onInput={(e) => props.onUpdate({ name: e.currentTarget.value })}
          placeholder={currentMacro()?.name || '宏实例名称'}
          class="w-full px-3 py-2 rounded-lg bg-ink-deep border border-white/10 text-white placeholder-mist-muted focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <label class="block text-[11px] font-bold uppercase tracking-wider text-mist-solid/40 mb-1">
          引用宏资产
        </label>
        <select
          value={props.config.macro_id}
          disabled={props.isLocked}
          onChange={(e) => props.onUpdate({ macro_id: e.currentTarget.value })}
          class="w-full px-3 py-2 rounded-lg bg-ink-deep border border-white/10 text-white focus:outline-none focus:border-accent"
        >
          <option value="" disabled>选择要调用的宏...</option>
          <For each={props.macros || []}>
            {(macro) => (
              <option value={macro.id}>
                {macro.name} ({macro.category || '通用'})
              </option>
            )}
          </For>
        </select>
      </div>

      <Show when={currentMacro()}>
        {(macro) => (
          <div class="p-3 rounded-xl border border-white/10 bg-white/5 space-y-3">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-1.5">
                <Layers3 class="w-4 h-4 text-accent" />
                <span class="font-semibold text-white">{macro().name}</span>
              </div>
              <button
                type="button"
                onClick={() => props.onOpenMacro?.(macro().id)}
                class="flex items-center gap-1 px-2.5 py-1 text-[11px] rounded bg-accent/20 text-accent hover:bg-accent/30 font-medium transition-colors"
              >
                进入宏子图
                <ChevronRight class="w-3 h-3" />
              </button>
            </div>

            <Show when={macro().description}>
              <p class="text-[11px] text-mist-muted">{macro().description}</p>
            </Show>

            {/* Inputs preview */}
            <div>
              <div class="text-[10px] text-mist-muted mb-1 font-medium">输入引脚 ({macro().inputs?.length || 0}):</div>
              <div class="flex flex-wrap gap-1.5">
                <For each={macro().inputs || []}>
                  {(pin) => (
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-white">
                      <span
                        class="w-2 h-2 rounded-full"
                        style={{ 'background-color': PIN_TYPE_COLORS[pin.pin_type] || '#ffffff' }}
                      />
                      {pin.name}
                    </span>
                  )}
                </For>
              </div>
            </div>

            {/* Outputs preview */}
            <div>
              <div class="text-[10px] text-mist-muted mb-1 font-medium">输出引脚 ({macro().outputs?.length || 0}):</div>
              <div class="flex flex-wrap gap-1.5">
                <For each={macro().outputs || []}>
                  {(pin) => (
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-white">
                      <span
                        class="w-2 h-2 rounded-full"
                        style={{ 'background-color': PIN_TYPE_COLORS[pin.pin_type] || '#ffffff' }}
                      />
                      {pin.name}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
};
