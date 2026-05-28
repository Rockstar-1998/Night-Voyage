import { Component, For, Show, createSignal, createEffect } from 'solid-js';
import { animate } from '../lib/animate';
import type { FormatNode, TagNode, ItalicNode, QuoteNode, KeywordNode, CustomNode, StructuredResponseNode, StructuredField } from '../lib/messageFormatter';
import { parseMessageContent, DEFAULT_FORMAT_CONFIG } from '../lib/messageFormatter';

interface MessageFormatRendererProps {
  nodes: FormatNode[];
  defaultExpanded?: boolean;
  onChoiceSelect?: (key: string, value: string) => void;
}

interface CollapsibleTagProps {
  tagName: string;
  children: FormatNode[];
  defaultExpanded: boolean;
  onChoiceSelect?: (key: string, value: string) => void;
}

export const CollapsibleTag: Component<CollapsibleTagProps> = (props) => {
  const [isExpanded, setIsExpanded] = createSignal(props.defaultExpanded);
  let contentRef: HTMLDivElement | undefined;

  createEffect(() => {
    const expanded = isExpanded();
    if (!contentRef) return;
    if (expanded) {
      contentRef.style.height = '0px';
      contentRef.style.opacity = '0';
      animate(contentRef, { height: 'auto', opacity: 1 }, { duration: 0.25, ease: 'easeOut' });
    } else {
      animate(contentRef, { height: 0, opacity: 0 }, { duration: 0.25, ease: 'easeIn' });
    }
  });

  return (
    <div class="my-1">
      <div
        class="flex items-center gap-2 px-3 py-1.5 bg-white/[0.04] border-l-2 border-accent/40 cursor-pointer hover:bg-white/[0.07] transition-colors rounded-r-md"
        onClick={() => setIsExpanded((prev) => !prev)}
      >
        <span
          class="text-xs transition-transform duration-200"
          style={{ transform: isExpanded() ? 'rotate(90deg)' : 'rotate(0deg)', 'display': 'inline-block' }}
        >
          ▶
        </span>
        <span class="text-[11px] font-semibold uppercase tracking-wider text-accent/70">
          {props.tagName}
        </span>
      </div>
      <Show when={isExpanded()}>
        <div ref={contentRef} style={{ overflow: 'hidden', height: '0px', opacity: 0 }}>
          <div class="pl-4 pt-1">
            <MessageFormatRenderer nodes={props.children} defaultExpanded={props.defaultExpanded} onChoiceSelect={props.onChoiceSelect} />
          </div>
        </div>
      </Show>
    </div>
  );
};

const StructuredResponseRenderer: Component<{
  fields: Record<string, StructuredField>;
  mainContentKey: string | null;
  displayConfig: Record<string, { defaultCollapsed: boolean }>;
  defaultExpanded: boolean;
  onChoiceSelect?: (key: string, value: string) => void;
}> = (props) => {
  const fieldEntries = () => Object.entries(props.fields);

  return (
    <div class="structured-response">
      <For each={fieldEntries()}>
        {([key, field]) => {
          const isCollapsed = () => props.displayConfig[key]?.defaultCollapsed ?? false;
          return (
            <Show
              when={field.kind === 'string' && key !== props.mainContentKey}
              fallback={
                <Show when={field.kind === 'string' && key === props.mainContentKey}>
                  <div class="whitespace-pre-wrap">
                    <MessageFormatRenderer
                      nodes={parseMessageContent((field as { kind: 'string'; value: string }).value, DEFAULT_FORMAT_CONFIG, [])}
                      defaultExpanded={props.defaultExpanded}
                      onChoiceSelect={props.onChoiceSelect}
                    />
                  </div>
                </Show>
              }
            >
              <MessageFormatRenderer
                nodes={[{ kind: 'tag', tagName: key, children: [{ kind: 'text', text: (field as { kind: 'string'; value: string }).value }] }]}
                defaultExpanded={!isCollapsed()}
                onChoiceSelect={props.onChoiceSelect}
              />
            </Show>
          );
        }}
      </For>
      <For each={fieldEntries()}>
        {([_key, field]) => (
          <Show when={field.kind === 'object'}>
            <div class="flex flex-wrap gap-2 mt-3">
              <For each={Object.entries((field as { kind: 'object'; value: Record<string, string> }).value)}>
                {([optKey, optValue]) => (
                  <button
                    class="px-4 py-2 bg-accent/20 border border-accent/30 rounded-lg text-sm text-mist-solid hover:bg-accent/30 transition-colors"
                    onClick={() => {
                      props.onChoiceSelect?.(optKey, optValue);
                    }}
                  >
                    <span class="text-accent/80 font-semibold mr-1">{optKey}</span>
                    <span class="text-mist-solid/70">{optValue}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        )}
      </For>
    </div>
  );
};

const renderNode = (node: FormatNode, _index: number, defaultExpanded: boolean, onChoiceSelect?: (key: string, value: string) => void) => {
  switch (node.kind) {
    case 'text': {
      const rawText = (node as FormatNode & { text: string }).text;
      const normalizedText = rawText.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
      return <span class="whitespace-pre-wrap">{normalizedText}</span>;
    }
    case 'tag': {
      const tag = node as TagNode;
      return <CollapsibleTag tagName={tag.tagName} children={tag.children} defaultExpanded={defaultExpanded} onChoiceSelect={onChoiceSelect} />;
    }
    case 'italic': {
      const italic = node as ItalicNode;
      return <span style={{ 'font-style': 'italic', color: 'rgba(245, 245, 247, 0.5)' }}>{italic.text}</span>;
    }
    case 'quote': {
      const quote = node as QuoteNode;
      return <span style={{ color: '#4ECDC4' }}>{quote.text}</span>;
    }
    case 'keyword': {
      const keyword = node as KeywordNode;
      return <span style={{ color: '#A78BFA' }}>{keyword.text}</span>;
    }
    case 'custom': {
      const custom = node as CustomNode;
      return (
        <span
          style={{
            color: custom.color,
            'font-style': custom.italic ? 'italic' : 'normal',
            'font-weight': custom.bold ? 'bold' : 'normal',
          }}
        >
          {custom.text}
        </span>
      );
    }
    case 'structured_response': {
      const sr = node as StructuredResponseNode;
      return (
        <StructuredResponseRenderer
          fields={sr.fields}
          mainContentKey={sr.mainContentKey}
          displayConfig={sr.displayConfig}
          defaultExpanded={defaultExpanded}
          onChoiceSelect={onChoiceSelect}
        />
      );
    }
    default:
      return null;
  }
};

export const MessageFormatRenderer: Component<MessageFormatRendererProps> = (props) => {
  return (
    <For each={props.nodes}>
      {(node, i) => renderNode(node, i(), props.defaultExpanded ?? true, props.onChoiceSelect)}
    </For>
  );
};
