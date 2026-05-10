import { Component, For, Show, createMemo, createSignal } from 'solid-js';
import { ArrowLeft, ChevronDown, ChevronRight, Copy, Info, Plus, Save, Search, ToggleLeft, ToggleRight, Trash2 } from '../lib/icons';
import type { UpsertWorldBookEntryPayload, WorldBookEntryRecord, WorldBookSummary } from '../lib/backend';
import { IconButton } from './ui/IconButton';

interface Props {
  book: WorldBookSummary;
  entries: WorldBookEntryRecord[];
  loading?: boolean;
  onBack: () => void;
  onUpsertEntry: (payload: UpsertWorldBookEntryPayload) => Promise<void> | void;
  onDeleteEntry: (entryId: number) => Promise<void> | void;
}

interface DraftState {
  title: string;
  content: string;
  keywords: string;
  triggerMode: 'any' | 'all';
  isEnabled: boolean;
  sortOrder: number;
}

export const WorldBookEntryArea: Component<Props> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [expandedEntryId, setExpandedEntryId] = createSignal<number | null>(null);
  const [drafts, setDrafts] = createSignal<Record<number, DraftState>>({});

  const filteredEntries = createMemo(() => {
    const query = searchQuery().toLowerCase();
    if (!query) return props.entries;
    return props.entries.filter((entry) =>
      entry.title.toLowerCase().includes(query) ||
      entry.content.toLowerCase().includes(query) ||
      entry.keywords.some((keyword) => keyword.toLowerCase().includes(query)),
    );
  });

  const ensureDraft = (entry: WorldBookEntryRecord) => {
    const current = drafts()[entry.id];
    if (current) return current;
    const next: DraftState = {
      title: entry.title,
      content: entry.content,
      keywords: entry.keywords.join(', '),
      triggerMode: entry.triggerMode === 'all' ? 'all' : 'any',
      isEnabled: entry.isEnabled,
      sortOrder: entry.sortOrder,
    };
    setDrafts({ ...drafts(), [entry.id]: next });
    return next;
  };

  const readDraft = (entry: WorldBookEntryRecord) => drafts()[entry.id] ?? ensureDraft(entry);

  const updateDraft = (entryId: number, patch: Partial<DraftState>) => {
    const current = drafts()[entryId] ?? {
      title: '',
      content: '',
      keywords: '',
      triggerMode: 'any' as const,
      isEnabled: true,
      sortOrder: 0,
    };
    setDrafts({
      ...drafts(),
      [entryId]: { ...current, ...patch },
    });
  };

  const handleAddNew = async () => {
    await props.onUpsertEntry({
      worldBookId: props.book.id,
      title: '新条目',
      content: '',
      keywords: [],
      triggerMode: 'any',
      isEnabled: true,
      sortOrder: props.entries.length,
    });
  };

  const saveEntry = async (entry: WorldBookEntryRecord) => {
    const draft = readDraft(entry);
    await props.onUpsertEntry({
      worldBookId: props.book.id,
      entryId: entry.id,
      title: draft.title.trim() || '新条目',
      content: draft.content,
      keywords: draft.keywords.split(',').map((keyword) => keyword.trim()).filter(Boolean),
      triggerMode: draft.triggerMode,
      isEnabled: draft.isEnabled,
      sortOrder: draft.sortOrder,
    });
  };

  return (
    <div class="h-full w-full flex flex-col bg-transparent overflow-hidden isolate relative animate-in fade-in slide-in-from-right-4 duration-300">
      <div class="p-8 flex items-center justify-between border-b border-white/5 bg-xuanqing/20">
        <div class="flex items-center gap-4 flex-1">
          <IconButton onClick={props.onBack} label="返回世界书列表" size="lg" class="group">
            <ArrowLeft size={18} class="group-hover:-translate-x-0.5 transition-transform" />
          </IconButton>
          <div>
            <h2 class="text-xl font-bold text-mist-solid tracking-tight">{props.book.title}</h2>
            <span class="text-xs text-mist-solid/40">{props.entries.length} 个条目 · V2 激进触发已启用</span>
          </div>

          <div class="relative max-w-sm flex-1 ml-6 group">
            <Search class="absolute left-4 top-1/2 -translate-y-1/2 text-mist-solid/20 group-focus-within:text-accent transition-colors" size={16} />
            <input
              type="text"
              placeholder="搜索条目..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="w-full bg-xuanqing border border-white/5 rounded-xl py-2.5 pl-11 pr-4 text-sm focus:outline-none focus:border-accent/40 transition-all placeholder:text-mist-solid/20"
            />
          </div>
        </div>
        <div class="flex items-center gap-4 pl-4">
          <div class="flex items-center gap-3 rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
            <div class="text-right">
              <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">操作</div>
              <div class="text-sm text-mist-solid/40 mt-1">新增条目</div>
            </div>
            <IconButton onClick={() => void handleAddNew()} label="添加新条目" tone="accent" size="lg">
              <Plus size={18} />
            </IconButton>
          </div>
        </div>
      </div>

      <div class="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar relative z-10">
        <Show when={!props.loading} fallback={<div class="text-sm text-mist-solid/35">正在加载条目...</div>}>
          <div class="flex flex-col gap-3 max-w-4xl mx-auto">
            <div class="rounded-2xl border border-accent/20 bg-accent/5 p-4 text-sm text-mist-solid/80 shadow-lg shadow-accent/5">
              <div class="flex items-start gap-3">
                <div class="mt-0.5 text-accent shrink-0">
                  <Info size={18} />
                </div>
                <div class="space-y-2">
                  <div class="font-bold text-mist-solid">世界书 V2 注入逻辑</div>
                  <ul class="space-y-1.5 text-xs leading-5 text-mist-solid/65 list-disc pl-4">
                    <li>关键词会同时参考当前轮输入、最近历史和最新角色状态层。</li>
                    <li>同一条目即使被多个来源同时命中，也只会注入一次。</li>
                    <li>来源优先级为：当前轮输入 {'>'} 最近历史 {'>'} 角色状态。</li>
                    <li><code>sortOrder</code> 越小，在同来源命中时越容易优先进入 prompt。</li>
                  </ul>
                </div>
              </div>
            </div>
            <For each={filteredEntries()}>
              {(item) => (
                <div class={`flex flex-col rounded-xl border transition-all ${expandedEntryId() === item.id ? 'bg-xuanqing/80 border-accent/40 shadow-xl' : 'bg-xuanqing/40 border-white/5 hover:border-white/10 hover:bg-xuanqing/60 cursor-pointer'}`}>
                  <div
                    class="group flex items-center gap-4 p-4"
                    onClick={() => {
                      setExpandedEntryId(expandedEntryId() === item.id ? null : item.id);
                      ensureDraft(item);
                    }}
                  >
                    <IconButton
                      onClick={(event) => {
                        event.stopPropagation();
                        const draft = readDraft(item);
                        updateDraft(item.id, { isEnabled: !draft.isEnabled });
                        void props.onUpsertEntry({
                          worldBookId: props.book.id,
                          entryId: item.id,
                          title: draft.title.trim() || '新条目',
                          content: draft.content,
                          keywords: draft.keywords.split(',').map((keyword) => keyword.trim()).filter(Boolean),
                          triggerMode: draft.triggerMode,
                          isEnabled: !draft.isEnabled,
                          sortOrder: draft.sortOrder,
                        });
                      }}
                      label={item.isEnabled ? '关闭条目' : '启用条目'}
                      size="sm"
                      active={item.isEnabled}
                      class={item.isEnabled ? 'text-accent' : 'text-mist-solid/20'}
                    >
                      <Show when={item.isEnabled} fallback={<ToggleLeft size={22} />}>
                        <ToggleRight size={22} />
                      </Show>
                    </IconButton>

                    <div class="p-1 rounded-md bg-white/5 text-mist-solid/20 group-hover:text-mist-solid/40 transition-colors">
                      <Show when={expandedEntryId() === item.id} fallback={<ChevronRight size={16} />}>
                        <ChevronDown size={16} />
                      </Show>
                    </div>

                    <div class="flex-1 min-w-0">
                      <div class={`w-full text-sm font-bold ${item.isEnabled ? 'text-white' : 'text-mist-solid/40'}`}>{item.title}</div>
                    </div>

                    <div class="flex flex-wrap items-center gap-1.5">
                      <span class={`text-[10px] px-2 py-0.5 rounded-md border ${item.isEnabled ? 'bg-white/5 border-white/10 text-mist-solid/70' : 'bg-white/5 border-white/10 text-mist-solid/35'}`}>
                        {item.triggerMode === 'all' ? '全部命中' : '任一命中'}
                      </span>
                      <span class={`text-[10px] px-2 py-0.5 rounded-md border ${item.isEnabled ? 'bg-white/5 border-white/10 text-mist-solid/70' : 'bg-white/5 border-white/10 text-mist-solid/35'}`}>
                        排序 {item.sortOrder}
                      </span>
                      <For each={item.keywords.slice(0, 3)}>
                        {(keyword) => (
                          <span class={`text-[10px] px-2 py-0.5 rounded-md border ${item.isEnabled ? 'bg-accent/10 border-accent/20 text-accent' : 'bg-white/5 border-white/10 text-mist-solid/40'}`}>
                            {keyword}
                          </span>
                        )}
                      </For>
                    </div>

                    <div class={`flex items-center gap-2 transition-opacity ${expandedEntryId() === item.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                      <IconButton
                        onClick={(event) => {
                          event.stopPropagation();
                          void props.onUpsertEntry({
                            worldBookId: props.book.id,
                            title: `${item.title} (副本)`,
                            content: item.content,
                            keywords: [...item.keywords],
                            triggerMode: item.triggerMode === 'all' ? 'all' : 'any',
                            isEnabled: false,
                            sortOrder: item.sortOrder + 1,
                          });
                        }}
                        label="复制副本"
                        size="sm"
                      >
                        <Copy size={14} />
                      </IconButton>
                      <IconButton
                        onClick={(event) => {
                          event.stopPropagation();
                          void props.onDeleteEntry(item.id);
                        }}
                        label="删除条目"
                        tone="danger"
                        size="sm"
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </div>

                  <Show when={expandedEntryId() === item.id}>
                    <div class="p-4 pt-0 border-t border-white/5 mt-1 bg-black/10 animate-in fade-in slide-in-from-top-2 duration-200">
                      <div class="flex flex-col gap-4 mt-4">
                        <div class="space-y-1">
                          <label class="text-[10px] text-mist-solid/40 uppercase font-bold px-1">标题</label>
                          <input
                            type="text"
                            value={readDraft(item).title}
                            onInput={(e) => updateDraft(item.id, { title: e.currentTarget.value })}
                            class="w-full bg-xuanqing border border-white/5 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
                          />
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div class="space-y-1 md:col-span-2">
                            <label class="text-[10px] text-mist-solid/40 uppercase font-bold px-1">触发关键词</label>
                            <input
                              type="text"
                              value={readDraft(item).keywords}
                              onInput={(e) => updateDraft(item.id, { keywords: e.currentTarget.value })}
                              class="w-full bg-xuanqing border border-white/5 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
                            />
                            <p class="px-1 text-[11px] text-mist-solid/40 leading-5">使用逗号分隔关键词。V2 运行时会用这些关键词去匹配当前轮输入、最近历史和最新角色状态。</p>
                          </div>
                          <div class="space-y-1">
                            <label class="text-[10px] text-mist-solid/40 uppercase font-bold px-1">触发方式</label>
                            <select
                              value={readDraft(item).triggerMode}
                              onChange={(e) => updateDraft(item.id, { triggerMode: e.currentTarget.value === 'all' ? 'all' : 'any' })}
                              class="w-full bg-xuanqing border border-white/5 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
                            >
                              <option value="any">任一命中</option>
                              <option value="all">全部命中</option>
                            </select>
                            <p class="px-1 text-[11px] text-mist-solid/40 leading-5">任一命中 = 任意关键词出现即可；全部命中 = 所有关键词都要出现。</p>
                          </div>
                          <div class="space-y-1">
                            <label class="text-[10px] text-mist-solid/40 uppercase font-bold px-1">排序优先级</label>
                            <input
                              type="number"
                              value={readDraft(item).sortOrder}
                              onInput={(e) => updateDraft(item.id, { sortOrder: Number.isFinite(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : 0 })}
                              class="w-full bg-xuanqing border border-white/5 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
                            />
                            <p class="px-1 text-[11px] text-mist-solid/40 leading-5">数值越小越靠前；同来源命中时，更容易在上限裁剪前被保留。</p>
                          </div>
                        </div>
                        <div class="space-y-1 flex-1 flex flex-col">
                            <label class="text-[10px] text-mist-solid/40 uppercase font-bold px-1">内容</label>
                            <textarea
                              value={readDraft(item).content}
                              onInput={(e) => updateDraft(item.id, { content: e.currentTarget.value })}
                              class="w-full flex-1 min-h-[160px] bg-xuanqing border border-white/5 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid custom-scrollbar"
                            />
                            <p class="px-1 text-[11px] text-mist-solid/40 leading-5">命中后同一条目只会注入一次，不会因为当前轮、最近历史、角色状态同时命中而重复叠加。</p>
                          </div>
                        <div class="flex items-center justify-between gap-4">
                          <div>
                            <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">条目操作</div>
                            <div class="text-sm text-mist-solid/40 mt-1">修改完成后保存当前条目。</div>
                          </div>
                          <IconButton onClick={() => void saveEntry(item)} label="保存条目" tone="accent" size="lg">
                            <Save size={18} />
                          </IconButton>
                        </div>
                      </div>
                    </div>
                  </Show>
                </div>
              )}
            </For>
            <Show when={filteredEntries().length === 0}>
              <div class="py-12 flex flex-col items-center justify-center opacity-40">
                <span class="text-sm">未找到世界书条目</span>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};
