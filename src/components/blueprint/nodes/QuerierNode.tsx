import { Component, For, Show, createSignal } from 'solid-js';
import type { QuerierConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Search, Plus, Trash2, Lock, Info } from '../../../lib/icons';

const INPUT_CLASS =
  'w-full bg-black/30 border border-white/15 rounded-lg py-2 px-3 text-sm font-mono text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest font-semibold';

export const QuerierNode: Component<NodeConfigComponentProps<QuerierConfig>> = (props) => {
  const update = (updates: Partial<QuerierConfig>) => props.onUpdate(updates);

  const [newKey, setNewKey] = createSignal('');
  const [newVal, setNewVal] = createSignal('');

  const templateEntries = () => {
    const raw = props.config.args_template || {};
    return Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string]);
  };

  const syncTemplate = (entries: [string, string][]) => {
    const record: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k.trim()) {
        record[k.trim()] = v;
      }
    }
    update({ args_template: record });
  };

  const handleKeyChange = (oldKey: string, nextKey: string) => {
    const trimmed = nextKey.trim();
    if (!trimmed || trimmed === oldKey) return;
    const current = templateEntries();
    const updated = current.map(([k, v]) => (k === oldKey ? [trimmed, v] as [string, string] : [k, v] as [string, string]));
    syncTemplate(updated);
  };

  const handleValueChange = (key: string, nextVal: string) => {
    const current = templateEntries();
    const updated = current.map(([k, v]) => (k === key ? [k, nextVal] as [string, string] : [k, v] as [string, string]));
    syncTemplate(updated);
  };

  const handleDeleteEntry = (keyToDelete: string) => {
    const current = templateEntries();
    const updated = current.filter(([k]) => k !== keyToDelete);
    syncTemplate(updated);
  };

  const handleAddParam = () => {
    const k = newKey().trim();
    if (!k) return;
    const v = newVal();
    const current = templateEntries();
    const exists = current.some(([existingKey]) => existingKey === k);
    if (!exists) {
      current.push([k, v]);
    } else {
      const idx = current.findIndex(([existingKey]) => existingKey === k);
      current[idx] = [k, v];
    }
    syncTemplate(current);
    setNewKey('');
    setNewVal('');
  };

  const handleAddBlankParam = () => {
    const current = templateEntries();
    let idx = current.length + 1;
    let candidate = `param_${idx}`;
    while (current.some(([k]) => k === candidate)) {
      idx++;
      candidate = `param_${idx}`;
    }
    current.push([candidate, '']);
    syncTemplate(current);
  };

  return (
    <div class="space-y-4">
      <div class="p-3 rounded-xl border border-sky-500/20 bg-sky-500/5 space-y-2">
        <div class="flex items-center gap-2 text-xs font-bold text-sky-400">
          <Search size={16} />
          <span>Querier 跨域读配置</span>
        </div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          经 ActionBridge 白名单代理调用既有 Tauri 命令（如检索世界书或角色卡），查询结果以结构化 JSON 入链上下文。
        </p>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>命令名称 (Command，须在白名单中)</label>
        <input
          type="text"
          value={props.config.command || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ command: e.currentTarget.value.trim() })}
          class={INPUT_CLASS}
          placeholder="query_world_book_entries / get_character_detail"
        />
      </div>

      <div class="space-y-2 pt-2 border-t border-white/5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <label class={LABEL_CLASS}>参数模板 (args_template)</label>
            <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-white/10 text-mist-solid/60 font-mono">
              {templateEntries().length}
            </span>
          </div>
          <button
            type="button"
            disabled={props.isLocked}
            onClick={handleAddBlankParam}
            class="text-[11px] text-accent hover:text-accent-light flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={12} />
            <span>添加参数</span>
          </button>
        </div>

        <Show
          when={templateEntries().length > 0}
          fallback={
            <div class="rounded-xl border border-dashed border-white/10 p-4 text-center">
              <p class="text-xs text-mist-solid/40">暂无参数模板。可在下方添加参数名与模板表达式。</p>
            </div>
          }
        >
          <div class="space-y-2">
            <For each={templateEntries()}>
              {([key, val]) => (
                <div class="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2 transition-colors focus-within:border-white/20">
                  <div class="w-1/3 min-w-[100px]">
                    <span class="block text-[9px] text-mist-solid/40 uppercase mb-0.5">参数名</span>
                    <input
                      type="text"
                      value={key}
                      disabled={props.isLocked}
                      onChange={(e) => handleKeyChange(key, e.currentTarget.value)}
                      class="w-full bg-black/40 border border-white/10 rounded-md py-1 px-2 text-xs font-mono text-white focus:outline-none focus:border-accent disabled:opacity-50"
                      placeholder="key (如 character_id)"
                    />
                  </div>
                  <div class="flex-1">
                    <span class="block text-[9px] text-mist-solid/40 uppercase mb-0.5">模板表达式</span>
                    <input
                      type="text"
                      value={val}
                      disabled={props.isLocked}
                      onInput={(e) => handleValueChange(key, e.currentTarget.value)}
                      class="w-full bg-black/40 border border-white/10 rounded-md py-1 px-2 text-xs font-mono text-sky-300 focus:outline-none focus:border-accent disabled:opacity-50"
                      placeholder="值表达式 (如 {args.char_id})"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={props.isLocked}
                    onClick={() => handleDeleteEntry(key)}
                    class="p-1.5 rounded-lg text-mist-solid/40 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed self-end mb-0.5"
                    title="删除参数"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>

        <div class="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-2">
          <span class="text-[10px] text-mist-solid/50 font-semibold block uppercase tracking-wider">
            快捷新增参数
          </span>
          <div class="flex items-center gap-2">
            <input
              type="text"
              value={newKey()}
              disabled={props.isLocked}
              onInput={(e) => setNewKey(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddParam()}
              class="w-1/3 min-w-[100px] bg-black/40 border border-white/10 rounded-md py-1 px-2 text-xs font-mono text-white focus:outline-none focus:border-accent placeholder-mist-solid/30 disabled:opacity-50"
              placeholder="新参数名"
            />
            <input
              type="text"
              value={newVal()}
              disabled={props.isLocked}
              onInput={(e) => setNewVal(e.currentTarget.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddParam()}
              class="flex-1 bg-black/40 border border-white/10 rounded-md py-1 px-2 text-xs font-mono text-sky-300 focus:outline-none focus:border-accent placeholder-mist-solid/30 disabled:opacity-50"
              placeholder="模板值 (如 {args.item_id})"
            />
            <button
              type="button"
              disabled={props.isLocked || !newKey().trim()}
              onClick={handleAddParam}
              class="px-2.5 py-1 rounded-md bg-accent/20 text-accent hover:bg-accent/30 text-xs font-medium flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus size={13} />
              <span>添加</span>
            </button>
          </div>
        </div>

        <div class="flex items-start gap-1.5 p-2 rounded-lg bg-white/[0.02] border border-white/5">
          <Info size={12} class="text-mist-solid/40 mt-0.5 shrink-0" />
          <p class="text-[10px] text-mist-solid/40 leading-normal">
            参数模板支持注入动态占位符（如 <code class="text-sky-300/70">{'{args.char_id}'}</code>、<code class="text-sky-300/70">{'{stats.gold}'}</code>）。执行时将自动解析为实际值。
          </p>
        </div>
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-white/5">
        <label class="text-xs text-mist-solid/60 flex items-center gap-1.5 cursor-pointer">
          <Lock size={13} class={props.config.is_locked ? 'text-amber-400' : 'text-mist-solid/30'} />
          <span>锁定节点</span>
        </label>
        <input
          type="checkbox"
          checked={props.config.is_locked || false}
          disabled={props.isLocked}
          onChange={(e) => update({ is_locked: e.currentTarget.checked })}
          class="w-4 h-4 rounded border-white/20 bg-white/5 text-accent focus:ring-1 focus:ring-accent/40"
        />
      </div>
    </div>
  );
};
