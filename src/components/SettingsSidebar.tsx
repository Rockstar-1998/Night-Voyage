import { Component, onMount, For } from 'solid-js';
import { Globe, Palette } from '../lib/icons';
import { animate } from '../lib/animate';
import { IconButton } from './ui/IconButton';

interface SettingCategory {
    id: string;
    label: string;
    icon: any;
}

export const SettingsSidebar: Component<{ activeCategory: string; onCategoryChange: (id: string) => void }> = (props) => {
    let containerRef: HTMLDivElement | undefined;

    const categories: SettingCategory[] = [
        { id: 'api', label: 'API 配置', icon: Globe },
        { id: 'appearance', label: '界面外观', icon: Palette },
    ];

    onMount(() => {
        if (containerRef) {
            animate(containerRef, { x: [-10, 0], opacity: [0, 1] }, { duration: 0.6, delay: 0.1, ease: "easeOut" });
        }
    });

    return (
        <div
            ref={containerRef}
            class="w-80 flex flex-col bg-night-water border-r border-white/5 h-full relative pt-10"
        >
            <div class="p-6 flex flex-col gap-6">
                <h1 class="text-3xl font-black text-white tracking-tighter uppercase italic">设置</h1>
            </div>

            <div class="flex-1 overflow-y-auto px-4 pb-20 custom-scrollbar">
                <div class="flex flex-col gap-2">
                    <For each={categories}>
                        {(cat) => (
                            <div class={`flex items-center justify-between gap-4 px-4 py-3 rounded-2xl transition-all border ${props.activeCategory === cat.id
                                ? 'bg-accent/10 border-accent/20 text-accent'
                                : 'bg-transparent border-transparent text-mist-solid/40 hover:bg-white/5 hover:text-mist-solid'
                                }`}>
                                <div class="min-w-0">
                                    <div class="text-sm font-medium">{cat.label}</div>
                                    <div class="text-[10px] uppercase tracking-[0.25em] text-mist-solid/25 mt-1">
                                        {props.activeCategory === cat.id ? '当前分类' : '点击图标切换'}
                                    </div>
                                </div>
                                <div class="flex items-center gap-2 shrink-0">
                                    {props.activeCategory === cat.id && (
                                        <div class="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(58,109,140,0.8)]" />
                                    )}
                                    <IconButton
                                        onClick={() => props.onCategoryChange(cat.id)}
                                        label={`切换到${cat.label}`}
                                        tone={props.activeCategory === cat.id ? 'accent' : 'neutral'}
                                        active={props.activeCategory === cat.id}
                                        size="md"
                                    >
                                        <cat.icon size={18} />
                                    </IconButton>
                                </div>
                            </div>
                        )}
                    </For>
                </div>
            </div>
        </div>
    );
};
