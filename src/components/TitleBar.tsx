import { Component } from 'solid-js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { X, Square, Minus, Copy } from '../lib/icons';
import { createSignal, onMount, onCleanup } from 'solid-js';

export const TitleBar: Component = () => {
    const appWindow = getCurrentWindow();
    const [isMaximized, setIsMaximized] = createSignal(false);

    onMount(async () => {
        const checkMaximized = async () => {
            const maximized = await appWindow.isMaximized();
            setIsMaximized(maximized);
        };

        checkMaximized();
        const unlisten = await appWindow.onResized(() => {
            checkMaximized();
        });

        onCleanup(() => {
            unlisten();
        });
    });

    const handleMinimize = () => appWindow.minimize();
    const handleMaximize = async () => {
        await appWindow.toggleMaximize();
    };
    const handleClose = () => appWindow.close();

    return (
        <div
            data-tauri-drag-region
            class="h-8 w-full flex items-center justify-between bg-transparent select-none z-50 shrink-0"
        >
            {/* Left side: App Title/Logo info could go here if needed */}
            <div class="flex items-center px-4 pointer-events-none">
                <span class="text-[10px] uppercase tracking-[0.2em] font-bold text-mist-solid/20">Night Voyage</span>
            </div>

            {/* Right side: Window Controls */}
            <div class="flex h-full">
                <button
                    onClick={handleMinimize}
                    class="w-11 h-full flex items-center justify-center text-mist-solid/40 hover:bg-white/5 hover:text-mist-solid transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    title="最小化窗口"
                    aria-label="最小化窗口"
                >
                    <Minus size={14} />
                </button>
                <button
                    onClick={handleMaximize}
                    class="w-11 h-full flex items-center justify-center text-mist-solid/40 hover:bg-white/5 hover:text-mist-solid transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    title={isMaximized() ? '还原窗口' : '最大化窗口'}
                    aria-label={isMaximized() ? '还原窗口' : '最大化窗口'}
                >
                    {isMaximized() ? <Copy size={12} /> : <Square size={12} />}
                </button>
                <button
                    onClick={handleClose}
                    class="w-11 h-full flex items-center justify-center text-mist-solid/40 hover:bg-red-500/80 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
                    title="关闭窗口"
                    aria-label="关闭窗口"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
};
