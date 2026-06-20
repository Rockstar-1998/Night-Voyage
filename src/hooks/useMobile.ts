import { createSignal, onMount, onCleanup } from 'solid-js';

/**
 * 移动端检测 hook
 * 断点 640px：
 * - 手机（< 640px）：使用移动端布局（底部导航栏）
 * - 平板/桌面（>= 640px）：使用PC桌面布局
 *
 * 选择 640px 而非 768px 的原因：
 * - 8寸平板竖屏宽度约 600-800px，768px 会误判为手机
 * - 640px 可以正确区分手机和大部分平板
 * - 7寸以下平板（如折叠屏内屏）可能仍显示移动端布局，但触控体验更好
 */
export function useMobile() {
    const [isMobile, setIsMobile] = createSignal(window.innerWidth < 640);

    const updateWindowSize = () => {
        setIsMobile(window.innerWidth < 640);
    };

    onMount(() => {
        window.addEventListener('resize', updateWindowSize);
        onCleanup(() => window.removeEventListener('resize', updateWindowSize));
    });

    return isMobile;
}
