import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { ChevronDown } from '../../lib/icons';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  class?: string;
  placeholder?: string;
}

export const Select: Component<SelectProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  const handleOutsideClick = (e: MouseEvent) => {
    if (isOpen() && containerRef && !containerRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener('mousedown', handleOutsideClick);
  });

  onCleanup(() => {
    document.removeEventListener('mousedown', handleOutsideClick);
  });

  const selectedOption = () => props.options.find((o) => o.value === props.value);

  return (
    <div ref={containerRef} class={`relative w-full ${props.class || ''}`}>
      <button
        type="button"
        disabled={props.disabled}
        onClick={() => !props.disabled && setIsOpen(!isOpen())}
        class={`w-full flex items-center justify-between bg-transparent border-b-2 py-3 px-1 text-sm transition-all focus:outline-none ${
          props.disabled ? 'opacity-40 cursor-not-allowed border-white/10' : isOpen() ? 'border-accent text-mist-solid' : 'border-white/20 hover:border-white/40 text-mist-solid'
        }`}
      >
        <span class={`truncate ${!selectedOption() ? 'text-mist-solid/40' : ''}`}>
          {selectedOption()?.label ?? props.placeholder ?? '请选择...'}
        </span>
        <ChevronDown
          size={14}
          class={`transition-transform duration-300 ${isOpen() ? 'rotate-180 text-accent' : 'text-mist-solid/40'}`}
        />
      </button>

      <Show when={isOpen()}>
        <div class="absolute top-full left-0 right-0 mt-1 z-[1000] max-h-64 overflow-y-auto custom-scrollbar bg-xuanqing/95 backdrop-blur-2xl border border-white/10 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200">
          <ul class="py-1">
            <For each={props.options}>
              {(option) => (
                <li>
                  <button
                    type="button"
                    class={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                      props.value === option.value
                        ? 'bg-accent/15 text-accent border-l-2 border-accent'
                        : 'text-mist-solid/70 hover:bg-white/10 hover:text-mist-solid border-l-2 border-transparent'
                    }`}
                    onClick={() => {
                      props.onChange(option.value);
                      setIsOpen(false);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              )}
            </For>
            <Show when={props.options.length === 0}>
              <li class="px-4 py-3 text-sm text-mist-solid/30 text-center">无选项</li>
            </Show>
          </ul>
        </div>
      </Show>
    </div>
  );
};
