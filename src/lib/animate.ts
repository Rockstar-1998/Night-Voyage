type AnimateOptions = {
    duration?: number;
    ease?: string;
    delay?: number;
    repeat?: number;
};

const easeMap: Record<string, string> = {
    easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    easeOut: 'cubic-bezier(0, 0, 0.2, 1)',
    easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
    linear: 'linear',
};

function processKeyframes(keyframes: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(keyframes)) {
        switch (key) {
            case 'x':
                result['translate'] = value;
                break;
            case 'y':
                if (Array.isArray(value)) {
                    result['translate'] = value.map((v: any) => `0 ${v}`);
                } else {
                    result['translate'] = `0 ${value}`;
                }
                break;
            case 'rotate':
                if (Array.isArray(value)) {
                    result['rotate'] = value.map((v: any) =>
                        typeof v === 'number' ? `${v}deg` : v
                    );
                } else {
                    result['rotate'] = typeof value === 'number' ? `${value}deg` : value;
                }
                break;
            default:
                result[key] = value;
        }
    }
    return result;
}

export function animate(
    element: Element,
    keyframes: Record<string, any>,
    options: AnimateOptions = {}
): Animation {
    const processed = processKeyframes(keyframes);

    const animationOptions: KeyframeAnimationOptions = {
        duration: (options.duration ?? 0.3) * 1000,
        easing: easeMap[options.ease ?? 'easeOut'] ?? (options.ease ?? 'ease-out'),
        delay: (options.delay ?? 0) * 1000,
        iterations: options.repeat ?? 1,
        fill: 'forwards',
    };

    return (element as HTMLElement).animate(processed, animationOptions);
}
