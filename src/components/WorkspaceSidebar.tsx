import { Component, onMount } from 'solid-js';
import { MessageSquare, Users, Book, Settings, LayoutGrid } from '../lib/icons';
import { animate } from '../lib/animate';

export const WorkspaceSidebar: Component<{
    activeWorkspace?: string;
    onWorkspaceChange?: (id: string) => void;
}> = (props) => {
    let containerRef: HTMLDivElement | undefined;

    onMount(() => {
        if (containerRef) {
            animate(containerRef, { x: [-20, 0], opacity: [0, 1] }, { duration: 0.5, ease: "easeOut" });
        }
    });

    const NavIcon: Component<{ id: string; icon: any; active?: boolean; label: string }> = (iconProps) => (
        <button
            onClick={() => props.onWorkspaceChange?.(iconProps.id)}
            class={`w-12 h-12 flex items-center justify-center rounded-xl transition-all duration-300 group relative focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${iconProps.active
                ? 'bg-accent text-white shadow-[0_0_15px_rgba(58,109,140,0.4)]'
                : 'text-mist-solid/40 hover:text-mist-solid hover:bg-white/5'
                }`}
            title={iconProps.label}
            aria-label={iconProps.label}
        >
            <iconProps.icon size={22} />
            {iconProps.active && (
                <div class="absolute left-0 w-1 h-6 bg-white rounded-r-full" />
            )}
        </button>
    );

    return (
        <div
            ref={containerRef}
            class="w-18 flex flex-col items-center pt-10 pb-6 bg-xuanqing/60 backdrop-blur-xl border-r border-white/5 z-20 shrink-0 h-full"
        >
            {/* Settings at the top */}
            <div class="mb-8">
                <NavIcon id="settings" icon={Settings} label="设置" />
            </div>

            {/* Main Nav */}
            <div class="flex flex-col gap-4 flex-1">
                <NavIcon id="chat" icon={MessageSquare} active={props.activeWorkspace === 'chat'} label="对话" />
                <NavIcon id="character" icon={Users} active={props.activeWorkspace === 'character'} label="角色展示柜" />
                <NavIcon id="workspace" icon={LayoutGrid} active={props.activeWorkspace === 'workspace'} label="对话补全预设" />
                <NavIcon id="kb" icon={Book} active={props.activeWorkspace === 'kb'} label="世界书" />
            </div>

        </div>
    );
};
