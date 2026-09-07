import { Component, For, Show, createSignal } from 'solid-js';
import type { StructuredResponse } from '../lib/structured';

interface MobileStructuredRendererProps {
  response: StructuredResponse;
  onChoiceSelect?: (index: number, value: string) => void;
}

/**
 * 移动端结构化输出渲染：对齐 PC 端 MessageFormatRenderer 的 StructuredResponseRenderer。
 * - string 字段：可折叠分区（标签 = 字段名），hideLabel 时直接显示正文。
 * - object 字段：只读键值卡片。
 * - array 字段：编号可点击选项，点击回调 onChoiceSelect。
 */
export const MobileStructuredRenderer: Component<MobileStructuredRendererProps> = (props) => {
  const sortedFieldEntries = () => {
    return Object.entries(props.response.fields).sort(([keyA], [keyB]) => {
      const orderA = props.response.displayConfig[keyA]?.order ?? 0;
      const orderB = props.response.displayConfig[keyB]?.order ?? 0;
      return orderA - orderB;
    });
  };

  return (
    <div class="flex flex-col gap-3">
      <For each={sortedFieldEntries()}>
        {([key, field]) => {
          const isHidden = () => props.response.displayConfig[key]?.hideLabel ?? false;
          const isCollapsed = () => props.response.displayConfig[key]?.defaultCollapsed ?? false;
          const isBody = () => props.response.displayConfig[key]?.body ?? false;
          const [expanded, setExpanded] = createSignal(!isCollapsed());

          if (field.kind === 'string') {
            // 叙事正文（body）：渲染为消息主体，与 thinking 折叠区在视觉上明确区分。
            if (isBody()) {
              return (
                <div class="my-1 px-3 py-2 border-l-2 border-accent/70 bg-accent/[0.05] rounded-r-md whitespace-pre-wrap text-sm text-mist-solid leading-relaxed">
                  {(field as { kind: 'string'; value: string }).value}
                </div>
              );
            }

            if (isHidden()) {
              return (
                <div class="whitespace-pre-wrap text-sm text-mist-solid/80 leading-relaxed">
                  {(field as { kind: 'string'; value: string }).value}
                </div>
              );
            }

            return (
              <div class="rounded-lg border border-white/5 bg-white/[0.02]">
                <button
                  class="w-full flex items-center gap-2 px-3 py-2 text-left"
                  onClick={() => setExpanded(!expanded())}
                >
                  <span
                    class="text-xs transition-transform duration-200"
                    style={{ transform: expanded() ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}
                  >
                    ▶
                  </span>
                  <span class="text-[11px] font-semibold uppercase tracking-wider text-accent/70">{key}</span>
                </button>
                <Show when={expanded()}>
                  <div class="px-3 pb-3 whitespace-pre-wrap text-sm text-mist-solid/80 leading-relaxed">
                    {(field as { kind: 'string'; value: string }).value}
                  </div>
                </Show>
              </div>
            );
          }

          if (field.kind === 'object') {
            return (
              <div class="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                <div class="mb-2 text-xs font-semibold uppercase tracking-wider text-accent/60">{key}</div>
                <div class="flex flex-col gap-1.5">
                  <For each={Object.entries((field as { kind: 'object'; value: Record<string, string> }).value)}>
                    {([k, v]) => (
                      <div class="flex gap-3 text-sm">
                        <span class="shrink-0 text-mist-solid/45">{k}</span>
                        <span class="text-mist-solid/80 leading-relaxed">{v}</span>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            );
          }

          if (field.kind === 'array') {
            return (
              <div class="flex flex-col gap-2">
                <For each={(field as { kind: 'array'; value: string[] }).value}>
                  {(optValue, i) => (
                    <button
                      class="flex items-start gap-3 px-4 py-3 bg-xuanqing/40 border border-white/5 hover:border-accent/40 hover:bg-white/[0.04] transition-all text-left rounded-lg w-full"
                      onClick={() => props.onChoiceSelect?.(i() + 1, optValue)}
                    >
                      <span class="text-accent font-black tracking-widest uppercase text-xs w-4 shrink-0 mt-0.5">{`${i() + 1}`}</span>
                      <span class="text-mist-solid/80 text-sm leading-relaxed">{optValue}</span>
                    </button>
                  )}
                </For>
              </div>
            );
          }

          return null;
        }}
      </For>
    </div>
  );
};
