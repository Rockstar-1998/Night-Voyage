/**
 * MacroPinsNode — Pin configuration form for macro_inputs and macro_outputs.
 *
 * Allows creators to:
 * - View existing pins on the macro boundary node
 * - Add new pins (Exec flow or typed data: Number, String, Boolean, Object)
 * - Rename pins and change their types
 * - Remove pins
 */

import { Component, For, createSignal } from 'solid-js';
import { Plus, Trash2 } from '../../../lib/icons';
import type { MacroPinDefinition, PinType } from '../../../lib/blueprint/types';
import { PIN_TYPE_COLORS } from '../nodeLayout';

export interface MacroPinsNodeProps {
  pins: MacroPinDefinition[];
  isInput: boolean;
  isLocked: boolean;
  onUpdate: (pins: MacroPinDefinition[]) => void;
}

const PIN_TYPES: { value: PinType; label: string }[] = [
  { value: 'exec', label: 'Exec (执行流)' },
  { value: 'number', label: 'Number (数值)' },
  { value: 'string', label: 'String (字符串)' },
  { value: 'boolean', label: 'Boolean (布尔)' },
  { value: 'object', label: 'Object / Any (对象/任意)' },
];

export const MacroPinsNode: Component<MacroPinsNodeProps> = (props) => {
  const [newPinName, setNewPinName] = createSignal('');
  const [newPinType, setNewPinType] = createSignal<PinType>('exec');

  const handleAddPin = () => {
    const name = newPinName().trim();
    if (!name) return;
    const id = `pin_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(-3)}`;
    const updated = [
      ...(props.pins || []),
      {
        id,
        name,
        pin_type: newPinType(),
      },
    ];
    props.onUpdate(updated);
    setNewPinName('');
  };

  const handleRemovePin = (index: number) => {
    const updated = [...(props.pins || [])];
    updated.splice(index, 1);
    props.onUpdate(updated);
  };

  const handleUpdatePin = (index: number, patch: Partial<MacroPinDefinition>) => {
    const updated = [...(props.pins || [])];
    updated[index] = { ...updated[index], ...patch };
    props.onUpdate(updated);
  };

  return (
    <div class="space-y-4 text-xs">
      <div class="flex items-center justify-between pb-2 border-b border-white/10">
        <div>
          <h4 class="font-semibold text-white">
            {props.isInput ? '宏输入代理引脚 (Inputs)' : '宏输出代理引脚 (Outputs)'}
          </h4>
          <p class="text-[11px] text-mist-muted mt-0.5">
            {props.isInput
              ? '定义调用者传入宏的数据与执行入口'
              : '定义宏执行完毕后向外传出的数据与出口'}
          </p>
        </div>
      </div>

      {/* Pin List */}
      <div class="space-y-2">
        <For each={props.pins || []}>
          {(pin, idx) => (
            <div class="p-2.5 rounded-lg border border-white/10 bg-ink-deep/60 space-y-2">
              <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 flex-1">
                  <span
                    class="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0"
                    style={{ 'background-color': PIN_TYPE_COLORS[pin.pin_type] || '#ffffff' }}
                  />
                  <input
                    type="text"
                    value={pin.name}
                    disabled={props.isLocked}
                    onInput={(e) => handleUpdatePin(idx(), { name: e.currentTarget.value })}
                    class="flex-1 px-2 py-1 text-xs rounded bg-white/5 border border-white/10 text-white focus:outline-none focus:border-accent"
                    placeholder="引脚名称"
                  />
                </div>
                <button
                  type="button"
                  disabled={props.isLocked}
                  onClick={() => handleRemovePin(idx())}
                  class="p-1 rounded text-mist-muted/60 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                  title="删除引脚"
                >
                  <Trash2 class="w-3.5 h-3.5" />
                </button>
              </div>

              <div class="flex items-center gap-2">
                <label class="text-[11px] text-mist-muted w-14">类型</label>
                <select
                  value={pin.pin_type}
                  disabled={props.isLocked}
                  onChange={(e) => handleUpdatePin(idx(), { pin_type: e.currentTarget.value as PinType })}
                  class="flex-1 px-2 py-1 text-xs rounded bg-white/5 border border-white/10 text-white focus:outline-none focus:border-accent"
                >
                  <For each={PIN_TYPES}>
                    {(t) => <option value={t.value}>{t.label}</option>}
                  </For>
                </select>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Add Pin Bar */}
      <div class="p-2.5 rounded-lg border border-dashed border-white/15 bg-white/5 space-y-2">
        <div class="text-[11px] font-semibold text-white">添加新引脚</div>
        <div class="flex items-center gap-2">
          <input
            type="text"
            placeholder="引脚名称（如：In / Target / Out）"
            value={newPinName()}
            disabled={props.isLocked}
            onInput={(e) => setNewPinName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleAddPin();
            }}
            class="flex-1 px-2 py-1 text-xs rounded bg-night-sky border border-white/10 text-white placeholder-mist-muted focus:outline-none focus:border-accent"
          />
          <select
            value={newPinType()}
            disabled={props.isLocked}
            onChange={(e) => setNewPinType(e.currentTarget.value as PinType)}
            class="w-32 px-2 py-1 text-xs rounded bg-night-sky border border-white/10 text-white focus:outline-none focus:border-accent"
          >
            <For each={PIN_TYPES}>
              {(t) => <option value={t.value}>{t.label}</option>}
            </For>
          </select>
        </div>
        <button
          type="button"
          disabled={props.isLocked || !newPinName().trim()}
          onClick={handleAddPin}
          class="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-accent text-white hover:bg-accent/80 transition-colors disabled:opacity-50"
        >
          <Plus class="w-3.5 h-3.5" />
          添加引脚
        </button>
      </div>
    </div>
  );
};
