import { Component, JSX, Show, splitProps } from 'solid-js';

type IconButtonTone = 'neutral' | 'accent' | 'danger' | 'success';
type IconButtonSize = 'sm' | 'md' | 'lg';

interface IconButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  active?: boolean;
  badge?: JSX.Element;
}

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'w-10 h-10',
  md: 'w-11 h-11',
  lg: 'w-12 h-12',
};

const TONE_CLASSES: Record<IconButtonTone, string> = {
  neutral: 'bg-white/5 border-white/10 text-mist-solid/60 hover:text-white hover:bg-white/10',
  accent: 'bg-accent border-accent/30 text-white shadow-[0_0_20px_rgba(58,109,140,0.25)] hover:bg-accent/85 hover:shadow-[0_0_28px_rgba(58,109,140,0.35)]',
  danger: 'bg-red-500/10 border-red-500/20 text-red-300 hover:bg-red-500/15 hover:text-red-200',
  success: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/15 hover:text-emerald-200',
};

export const IconButton: Component<IconButtonProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'label',
    'tone',
    'size',
    'active',
    'badge',
    'children',
    'class',
    'type',
  ]);

  const size = () => local.size ?? 'md';
  const tone = () => local.tone ?? 'neutral';
  const hasExplicitPositionClass = () => /\b(static|fixed|absolute|relative|sticky)\b/.test(local.class ?? '');

  return (
    <button
      {...rest}
      type={local.type ?? 'button'}
      aria-label={local.label}
      title={local.label}
      class={[
        'inline-flex items-center justify-center rounded-xl border backdrop-blur-sm transition-all shrink-0',
        !hasExplicitPositionClass() && local.badge ? 'relative' : '',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-0',
        'disabled:opacity-40 disabled:cursor-not-allowed active:scale-95',
        SIZE_CLASSES[size()],
        TONE_CLASSES[tone()],
        local.active ? 'ring-2 ring-accent/30 ring-offset-0 text-white' : '',
        local.class ?? '',
      ].join(' ')}
    >
      {local.children}
      <span class="sr-only">{local.label}</span>
      <Show when={local.badge}>
        <span class="absolute -top-1 -right-1">{local.badge}</span>
      </Show>
    </button>
  );
};
