import { Component, For, Show, createSignal } from 'solid-js';
import type { InitialStateConfig, InitialStatDef, InitialStateInventoryItem } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { SlidersHorizontal, Plus, Trash2, Layers3 } from '../../../lib/icons';

const INPUT_CLASS =
  'w-full bg-black/30 border border-white/15 rounded-lg py-1.5 px-2.5 text-xs font-mono text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/50 uppercase tracking-widest font-semibold';

export const InitialStateConfigNode: Component<NodeConfigComponentProps<InitialStateConfig>> = (props) => {
  const update = (updates: Partial<InitialStateConfig>) => props.onUpdate(updates);

  // 临时新增属性/物品输入
  const [newStatKey, setNewStatKey] = createSignal('');
  const [newStatInitial, setNewStatInitial] = createSignal(100);

  const [newItemId, setNewItemId] = createSignal('');
  const [newItemName, setNewItemName] = createSignal('');

  const [newFlagKey, setNewFlagKey] = createSignal('');
  const [newFlagVal, setNewFlagVal] = createSignal('true');

  const statsList = () => Object.entries(props.config.stats || {});
  const flagsList = () => Object.entries(props.config.flags || {});

  const handleAddStat = () => {
    const key = newStatKey().trim();
    if (!key) return;
    const current = { ...(props.config.stats || {}) };
    current[key] = {
      initial: newStatInitial(),
      min: 0,
      max: null,
    };
    update({ stats: current });
    setNewStatKey('');
    setNewStatInitial(100);
  };

  const handleRemoveStat = (key: string) => {
    const current = { ...(props.config.stats || {}) };
    delete current[key];
    update({ stats: current });
  };

  const handleUpdateStat = (key: string, updates: Partial<InitialStatDef>) => {
    const current = { ...(props.config.stats || {}) };
    if (current[key]) {
      current[key] = { ...current[key], ...updates };
      update({ stats: current });
    }
  };

  const handleAddItem = () => {
    const id = newItemId().trim();
    const name = newItemName().trim() || id;
    if (!id) return;
    const current = [...(props.config.inventory || [])];
    current.push({
      id,
      name,
      count: 1,
      unit_weight: 0,
      unit_price: 0,
    });
    update({ inventory: current });
    setNewItemId('');
    setNewItemName('');
  };

  const handleRemoveItem = (index: number) => {
    const current = [...(props.config.inventory || [])];
    current.splice(index, 1);
    update({ inventory: current });
  };

  const handleUpdateItem = (index: number, updates: Partial<InitialStateInventoryItem>) => {
    const current = [...(props.config.inventory || [])];
    if (current[index]) {
      current[index] = { ...current[index], ...updates };
      update({ inventory: current });
    }
  };

  const handleAddFlag = () => {
    const key = newFlagKey().trim();
    if (!key) return;
    const current = { ...(props.config.flags || {}) };
    current[key] = newFlagVal().trim();
    update({ flags: current });
    setNewFlagKey('');
    setNewFlagVal('true');
  };

  const handleRemoveFlag = (key: string) => {
    const current = { ...(props.config.flags || {}) };
    delete current[key];
    update({ flags: current });
  };

  const handleUpdateFlag = (key: string, val: string) => {
    const current = { ...(props.config.flags || {}) };
    current[key] = val;
    update({ flags: current });
  };

  return (
    <div class="space-y-4">
      {/* 头部介绍卡片 */}
      <div class="p-3 rounded-xl border border-sky-500/20 bg-sky-500/5 space-y-2">
        <div class="flex items-center gap-2 text-xs font-bold text-sky-400">
          <SlidersHorizontal size={16} />
          <span>流派中立初始状态与背包</span>
        </div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          彻底消除核心引擎硬编码的奇幻属性（如 HP/MP/Gold/Weight）。创作者可自由定义契合世界观的初始属性（如 sanity/credits/fuel）、初始物品及剧情标志位。
        </p>
      </div>

      {/* 初始数值字典 (Stats) */}
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class={LABEL_CLASS}>初始属性字典 ({statsList().length})</label>
        </div>

        <div class="space-y-2">
          <For each={statsList()}>
            {([statKey, statDef]) => (
              <div class="p-2.5 rounded-lg border border-white/10 bg-black/20 space-y-2">
                <div class="flex items-center justify-between">
                  <span class="text-xs font-mono font-bold text-sky-300">{statKey}</span>
                  <button
                    type="button"
                    disabled={props.isLocked}
                    onClick={() => handleRemoveStat(statKey)}
                    class="text-mist-solid/40 hover:text-rose-400 transition-colors disabled:opacity-30"
                    title="删除此属性"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div class="grid grid-cols-3 gap-1.5">
                  <div>
                    <span class="text-[9px] text-mist-solid/40 block">初始值</span>
                    <input
                      type="number"
                      value={statDef.initial}
                      disabled={props.isLocked}
                      onInput={(e) => handleUpdateStat(statKey, { initial: Number(e.currentTarget.value) })}
                      class={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <span class="text-[9px] text-mist-solid/40 block">最小值 (可选)</span>
                    <input
                      type="number"
                      value={statDef.min ?? ''}
                      disabled={props.isLocked}
                      onInput={(e) =>
                        handleUpdateStat(statKey, {
                          min: e.currentTarget.value === '' ? null : Number(e.currentTarget.value),
                        })
                      }
                      placeholder="无"
                      class={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <span class="text-[9px] text-mist-solid/40 block">最大值 (可选)</span>
                    <input
                      type="number"
                      value={statDef.max ?? ''}
                      disabled={props.isLocked}
                      onInput={(e) =>
                        handleUpdateStat(statKey, {
                          max: e.currentTarget.value === '' ? null : Number(e.currentTarget.value),
                        })
                      }
                      placeholder="无"
                      class={INPUT_CLASS}
                    />
                  </div>
                </div>
              </div>
            )}
          </For>

          {/* 添加属性控件 */}
          <Show when={!props.isLocked}>
            <div class="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                placeholder="属性名 (如 sanity, credits)"
                value={newStatKey()}
                onInput={(e) => setNewStatKey(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddStat()}
                class={`${INPUT_CLASS} flex-1`}
              />
              <input
                type="number"
                placeholder="初始值"
                value={newStatInitial()}
                onInput={(e) => setNewStatInitial(Number(e.currentTarget.value))}
                class={`${INPUT_CLASS} w-20`}
              />
              <button
                type="button"
                onClick={handleAddStat}
                class="px-2.5 py-1.5 rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 text-xs font-semibold flex items-center gap-1 transition-colors"
              >
                <Plus size={13} />
                <span>添加</span>
              </button>
            </div>
          </Show>
        </div>
      </div>

      {/* 初始背包物品清单 (Inventory) */}
      <div class="space-y-2 pt-2 border-t border-white/5">
        <div class="flex items-center justify-between">
          <label class={LABEL_CLASS}>初始物品清单 ({(props.config.inventory || []).length})</label>
        </div>

        <div class="space-y-2">
          <For each={props.config.inventory || []}>
            {(item, idx) => (
              <div class="p-2.5 rounded-lg border border-white/10 bg-black/20 space-y-2">
                <div class="flex items-center justify-between">
                  <div class="flex items-center gap-1.5">
                    <span class="text-xs font-semibold text-mist-solid">{item.name || item.id}</span>
                    <span class="text-[10px] font-mono text-mist-solid/40">({item.id})</span>
                  </div>
                  <button
                    type="button"
                    disabled={props.isLocked}
                    onClick={() => handleRemoveItem(idx())}
                    class="text-mist-solid/40 hover:text-rose-400 transition-colors disabled:opacity-30"
                    title="删除此物品"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div class="grid grid-cols-3 gap-1.5">
                  <div>
                    <span class="text-[9px] text-mist-solid/40 block">持有数量</span>
                    <input
                      type="number"
                      value={item.count}
                      disabled={props.isLocked}
                      onInput={(e) => handleUpdateItem(idx(), { count: Math.max(1, Math.round(Number(e.currentTarget.value))) })}
                      class={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <span class="text-[9px] text-mist-solid/40 block">单件重量</span>
                    <input
                      type="number"
                      value={item.unit_weight ?? 0}
                      disabled={props.isLocked}
                      onInput={(e) => handleUpdateItem(idx(), { unit_weight: Number(e.currentTarget.value) })}
                      class={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <span class="text-[9px] text-mist-solid/40 block">单件单价</span>
                    <input
                      type="number"
                      value={item.unit_price ?? 0}
                      disabled={props.isLocked}
                      onInput={(e) => handleUpdateItem(idx(), { unit_price: Number(e.currentTarget.value) })}
                      class={INPUT_CLASS}
                    />
                  </div>
                </div>
              </div>
            )}
          </For>

          {/* 添加物品控件 */}
          <Show when={!props.isLocked}>
            <div class="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                placeholder="物品ID (如 starter_gun)"
                value={newItemId()}
                onInput={(e) => setNewItemId(e.currentTarget.value)}
                class={`${INPUT_CLASS} flex-1`}
              />
              <input
                type="text"
                placeholder="物品名"
                value={newItemName()}
                onInput={(e) => setNewItemName(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddItem()}
                class={`${INPUT_CLASS} flex-1`}
              />
              <button
                type="button"
                onClick={handleAddItem}
                class="px-2.5 py-1.5 rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 text-xs font-semibold flex items-center gap-1 transition-colors"
              >
                <Plus size={13} />
                <span>添加</span>
              </button>
            </div>
          </Show>
        </div>
      </div>

      {/* 初始剧情标志位 (Flags) */}
      <div class="space-y-2 pt-2 border-t border-white/5">
        <div class="flex items-center justify-between">
          <label class={LABEL_CLASS}>初始剧情标志位 ({flagsList().length})</label>
        </div>

        <div class="space-y-1.5">
          <For each={flagsList()}>
            {([flagKey, flagVal]) => (
              <div class="flex items-center gap-1.5 p-1.5 rounded-lg border border-white/10 bg-black/20">
                <span class="text-xs font-mono text-sky-300 w-1/3 truncate">{flagKey}</span>
                <input
                  type="text"
                  value={flagVal}
                  disabled={props.isLocked}
                  onInput={(e) => handleUpdateFlag(flagKey, e.currentTarget.value)}
                  class={`${INPUT_CLASS} flex-1`}
                />
                <button
                  type="button"
                  disabled={props.isLocked}
                  onClick={() => handleRemoveFlag(flagKey)}
                  class="text-mist-solid/40 hover:text-rose-400 transition-colors disabled:opacity-30 p-1"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            )}
          </For>

          {/* 添加标志位控件 */}
          <Show when={!props.isLocked}>
            <div class="flex items-center gap-1.5 pt-1">
              <input
                type="text"
                placeholder="标志位键名"
                value={newFlagKey()}
                onInput={(e) => setNewFlagKey(e.currentTarget.value)}
                class={`${INPUT_CLASS} flex-1`}
              />
              <input
                type="text"
                placeholder="初始值"
                value={newFlagVal()}
                onInput={(e) => setNewFlagVal(e.currentTarget.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddFlag()}
                class={`${INPUT_CLASS} w-24`}
              />
              <button
                type="button"
                onClick={handleAddFlag}
                class="px-2.5 py-1.5 rounded-lg bg-sky-500/20 text-sky-300 hover:bg-sky-500/30 text-xs font-semibold flex items-center gap-1 transition-colors"
              >
                <Plus size={13} />
                <span>添加</span>
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
};
