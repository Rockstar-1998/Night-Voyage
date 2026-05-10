import { Component, onMount, For } from 'solid-js';
import { Search, Plus, Folder } from '../lib/icons';
import { animate } from '../lib/animate';
import { IconButton } from './ui/IconButton';

interface PresetGroup {
    id: string;
    name: string;
    count: number;
}

export const CompletionSidebar: Component<{
    activeGroup: string;
    onGroupChange: (id: string) => void;
}> = (props) => {
    let containerRef: HTMLDivElement | undefined;

    const groups: PresetGroup[] = [
        { id: 'default', name: '默认预设', count: 12 },
        { id: 'roleplay', name: '角色扮演', count: 45 },
        { id: 'assistant', name: '助手模式', count: 8 },
        { id: 'creative', name: '创意写作', count: 15 },
    ];

    onMount(() => {
        if (containerRef) {
            animate(containerRef, { x: [-10, 0], opacity: [0, 1] }, { duration: 0.6, delay: 0.1, ease: "easeOut" });
        }
    });

    return (
        <div
            ref={containerRef}
            class="w-80 flex flex-col bg-night-water/60 backdrop-blur-xl border-r border-white/5 h-full relative pt-10"
        >
            <div class="p-6 flex flex-col gap-6">
                <h1 class="text-2xl font-bold text-mist-solid tracking-tight">完成预设</h1>

                {/* Search */}
                <div class="relative group">
                    <Search class="absolute left-3 top-1/2 -translate-y-1/2 text-mist-solid/20 group-focus-within:text-accent transition-colors" size={18} />
                    <input
                        type="text"
                        placeholder="搜索预设组..."
                        class="w-full bg-xuanqing border border-white/5 rounded-xl py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-accent/40 transition-all placeholder:text-mist-solid/20"
                    />
                </div>

                <div class="w-full flex items-center justify-between gap-4 py-3 px-4 rounded-xl bg-white/5 border border-white/5 text-mist-solid/60">
                    <div>
                        <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">预留操作</div>
                        <div class="text-sm mt-1">新建预设组</div>
                    </div>
                    <IconButton label="新建预设组（待接入）" size="md" disabled>
                        <Plus size={18} />
                    </IconButton>
                </div>
            </div>

            <div class="flex-1 overflow-y-auto px-4 pb-20 custom-scrollbar">
                <div class="flex flex-col gap-1">
                    <For each={groups}>
                        {(group) => (
                            <button
                                onClick={() => props.onGroupChange(group.id)}
                                class={`flex items-center justify-between p-4 rounded-2xl transition-all group ${props.activeGroup === group.id
                                    ? 'bg-accent text-white shadow-lg shadow-accent/20'
                                    : 'text-mist-solid/40 hover:bg-white/5 hover:text-mist-solid/60'
                                    }`}
                            >
                                <div class="flex items-center gap-3">
                                    <Folder size={18} class={props.activeGroup === group.id ? 'text-white' : 'text-accent/60'} />
                                    <span class="text-sm font-medium">{group.name}</span>
                                </div>
                                <span class={`text-[10px] px-1.5 py-0.5 rounded-md border ${props.activeGroup === group.id
                                    ? 'bg-white/20 border-white/20'
                                    : 'bg-white/5 border-white/5'
                                    }`}>
                                    {group.count}
                                </span>
                            </button>
                        )}
                    </For>
                </div>
            </div>
        </div>
    );
};
