import { Component, onMount, createEffect, createSignal, on, Show } from 'solid-js';
import { animate } from '../lib/animate';

interface AuroraBackgroundProps {
    characterImageUrl?: string;
    isActive: boolean;
    enableAurora?: boolean;
}

export const AuroraBackground: Component<AuroraBackgroundProps> = (props) => {
    let auroraRef1: HTMLDivElement | undefined;
    let auroraRef2: HTMLDivElement | undefined;
    let auroraRef3: HTMLDivElement | undefined;
    let charBgRef: HTMLDivElement | undefined;
    let auroraContainerRef: HTMLDivElement | undefined;
    let imgRefA: HTMLImageElement | undefined;
    let imgRefB: HTMLImageElement | undefined;

    const [slotAUrl, setSlotAUrl] = createSignal<string>('');
    const [slotBUrl, setSlotBUrl] = createSignal<string>('');
    const [activeSlot, setActiveSlot] = createSignal<'A' | 'B'>('A');

    onMount(() => {
        if (auroraRef1) {
            animate(auroraRef1,
                {
                    opacity: [0.4, 0.8, 0.4],
                    scale: [1, 1.3, 1],
                    rotate: [0, 10, -10, 0],
                    x: ['-15%', '15%', '-15%'],
                } as any,
                { duration: 12, repeat: Infinity, ease: "easeInOut" }
            );
        }
        if (auroraRef2) {
            animate(auroraRef2,
                {
                    opacity: [0.3, 0.7, 0.3],
                    scale: [1.3, 1, 1.3],
                    rotate: [-10, 10, -10],
                    x: ['15%', '-15%', '15%'],
                } as any,
                { duration: 18, repeat: Infinity, ease: "easeInOut", delay: 2 }
            );
        }
        if (auroraRef3) {
            animate(auroraRef3,
                {
                    opacity: [0.2, 0.6, 0.2],
                    scale: [0.9, 1.2, 0.9],
                    rotate: [10, -10, 10],
                    y: ['-10%', '10%', '-10%'],
                } as any,
                { duration: 15, repeat: Infinity, ease: "easeInOut", delay: 4 }
            );
        }
    });

    createEffect(on(() => props.characterImageUrl, (url) => {
        const urlStr = url || '';
        const current = activeSlot();
        const currentUrl = current === 'A' ? slotAUrl() : slotBUrl();

        if (urlStr === currentUrl) return;

        if (!urlStr) {
            if (current === 'A' && imgRefA && slotAUrl()) {
                animate(imgRefA, { opacity: [1, 0] }, { duration: 0.8, ease: 'easeInOut' });
            } else if (current === 'B' && imgRefB && slotBUrl()) {
                animate(imgRefB, { opacity: [1, 0] }, { duration: 0.8, ease: 'easeInOut' });
            }
            return;
        }

        if (current === 'A') {
            setSlotBUrl(urlStr);
            if (imgRefB) animate(imgRefB, { opacity: [0, 1] }, { duration: 0.8, ease: 'easeInOut' });
            if (imgRefA && slotAUrl()) animate(imgRefA, { opacity: [1, 0] }, { duration: 0.8, ease: 'easeInOut' });
            setActiveSlot('B');
        } else {
            setSlotAUrl(urlStr);
            if (imgRefA) animate(imgRefA, { opacity: [0, 1] }, { duration: 0.8, ease: 'easeInOut' });
            if (imgRefB && slotBUrl()) animate(imgRefB, { opacity: [1, 0] }, { duration: 0.8, ease: 'easeInOut' });
            setActiveSlot('A');
        }
    }));

    createEffect(() => {
        const active = props.isActive && !!props.characterImageUrl;
        if (charBgRef) {
            animate(charBgRef, { opacity: active ? 1 : 0 }, { duration: 0.8, ease: 'easeInOut' });
        }
        if (auroraContainerRef) {
            animate(auroraContainerRef, { opacity: active ? 0.3 : 1 }, { duration: 0.8, ease: 'easeInOut' });
        }
    });

    return (
        <div class="fixed inset-0 -z-10 overflow-hidden bg-xuanqing pointer-events-none">
            <div ref={charBgRef} style={{ opacity: 0 }} class="absolute inset-0">
                <img
                    ref={imgRefA}
                    src={slotAUrl() || undefined}
                    style={{ filter: 'blur(60px) saturate(1.2)', 'object-fit': 'cover', opacity: 0 }}
                    class="absolute inset-0 w-full h-full"
                />
                <img
                    ref={imgRefB}
                    src={slotBUrl() || undefined}
                    style={{ filter: 'blur(60px) saturate(1.2)', 'object-fit': 'cover', opacity: 0 }}
                    class="absolute inset-0 w-full h-full"
                />
                <div class="absolute inset-0" style={{ background: 'rgba(6, 12, 20, 0.6)' }} />
            </div>

            <div class="absolute inset-0 bg-gradient-to-br from-[#060C14] via-[#0B121B] to-black opacity-80" />

            <Show when={props.enableAurora !== false}>
                <div ref={auroraContainerRef} style={{ opacity: 1 }} class="absolute inset-0">
                    <div
                        ref={auroraRef1}
                        class="absolute -top-1/3 -left-1/4 w-[160%] h-[160%]"
                        style={{
                            background: 'radial-gradient(ellipse at center, rgba(58, 109, 140, 0.5) 0%, transparent 65%)',
                            filter: 'blur(90px)',
                            'mix-blend-mode': 'screen'
                        }}
                    />
                    <div
                        ref={auroraRef2}
                        class="absolute -top-1/2 -right-1/3 w-[160%] h-[160%]"
                        style={{
                            background: 'radial-gradient(ellipse at center, rgba(76, 175, 180, 0.4) 0%, transparent 60%)',
                            filter: 'blur(110px)',
                            'mix-blend-mode': 'screen'
                        }}
                    />
                    <div
                        ref={auroraRef3}
                        class="absolute top-1/3 -left-1/3 w-[180%] h-[120%]"
                        style={{
                            background: 'radial-gradient(ellipse at center, rgba(160, 130, 240, 0.2) 0%, transparent 75%)',
                            filter: 'blur(130px)',
                            'mix-blend-mode': 'screen'
                        }}
                    />
                </div>

                <div class="absolute inset-0 opacity-[0.05] mix-blend-overlay pointer-events-none" style={{
                    'background-image': `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`
                }} />
            </Show>
        </div>
    );
};
