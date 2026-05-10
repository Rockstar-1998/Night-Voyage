import { createSignal, onMount, onCleanup } from 'solid-js';

export function useMobile() {
    const [isMobile, setIsMobile] = createSignal(window.innerWidth < 768);

    const updateWindowSize = () => {
        setIsMobile(window.innerWidth < 768);
    };

    onMount(() => {
        window.addEventListener('resize', updateWindowSize);
        onCleanup(() => window.removeEventListener('resize', updateWindowSize));
    });

    return isMobile;
}
