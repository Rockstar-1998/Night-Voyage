import { Component, For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import type { JSX } from 'solid-js';
import { animate } from '../lib/animate';
import type {
  CustomNode,
  FormatErrorNode,
  FormatNode,
  ItalicNode,
  KeywordNode,
  MessageFormatConfig,
  QuoteNode,
  StructuredField,
  StructuredResponseNode,
  TagNode,
} from '../lib/messageFormatter';
import { DEFAULT_FORMAT_CONFIG, parseMessageContent } from '../lib/messageFormatter';

interface MessageFormatRendererProps {
  nodes: FormatNode[];
  defaultExpanded?: boolean;
  onChoiceSelect?: (key: string, value: string) => void;
  isStreaming?: boolean;
  toggleScope?: string;
  streamKey?: string;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
}

interface CollapsibleTagProps {
  tagName: string;
  tagPath: string;
  children: FormatNode[];
  defaultExpanded: boolean;
  onChoiceSelect?: (key: string, value: string) => void;
  isStreaming?: boolean;
  toggleScope?: string;
  streamKey?: string;
  formatConfig?: MessageFormatConfig;
  worldBookKeywords?: string[];
}

interface RenderContext {
  defaultExpanded: boolean;
  onChoiceSelect?: (key: string, value: string) => void;
  isStreaming?: boolean;
  toggleScope?: string;
  streamKey?: string;
  formatConfig: MessageFormatConfig;
  worldBookKeywords: string[];
}

interface StreamingTextProps {
  text: string;
  nodePath: string;
  className?: string;
  style?: JSX.CSSProperties;
  isStreaming?: boolean;
  streamKey?: string;
}

// Preserve user choices without leaking a toggle from one message/field into another.
const userToggleState = new Map<string, boolean>();

// Cache previous text by stable stream path so only newly appended suffixes animate.
const streamingTextCache = new Map<string, string>();

export function clearStreamingRenderCache(scope: string) {
  const prefix = `${scope}:`;
  for (const key of Array.from(streamingTextCache.keys())) {
    if (key === scope || key.startsWith(prefix)) {
      streamingTextCache.delete(key);
    }
  }
}

const normalizeEscapedText = (text: string) =>
  text.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');

const getScopedKey = (scope: string | undefined, tagPath: string, tagName: string) =>
  `${scope ?? 'global'}:${tagPath}:${tagName}`;

const childStreamKey = (streamKey: string | undefined, suffix: string) =>
  streamKey ? `${streamKey}:${suffix}` : undefined;

const StreamingText: Component<StreamingTextProps> = (props) => {
  const segments = createMemo(() => {
    const text = normalizeEscapedText(props.text);
    if (!props.isStreaming || !props.streamKey) {
      return { stable: text, tail: '' };
    }

    const cacheKey = `${props.streamKey}:${props.nodePath}`;
    const previous = streamingTextCache.get(cacheKey);
    streamingTextCache.set(cacheKey, text);

    if (!previous || !text.startsWith(previous) || text.length <= previous.length) {
      return { stable: text, tail: '' };
    }

    return { stable: previous, tail: text.slice(previous.length) };
  });

  return (
    <span class={props.className} style={props.style}>
      {segments().stable}
      <Show when={segments().tail}>
        {(tail) => <span class="streaming-char">{tail()}</span>}
      </Show>
    </span>
  );
};

export const CollapsibleTag: Component<CollapsibleTagProps> = (props) => {
  const toggleKey = () => getScopedKey(props.toggleScope, props.tagPath, props.tagName);

  const [isExpanded, setIsExpanded] = createSignal(() => {
    const persisted = userToggleState.get(toggleKey());
    return persisted !== undefined ? persisted : props.defaultExpanded;
  });

  let contentRef: HTMLDivElement | undefined;

  createEffect(() => {
    const persisted = userToggleState.get(toggleKey());
    if (persisted === undefined) {
      setIsExpanded(props.defaultExpanded);
    }
  });

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

  const handleToggle = () => {
    const next = !isExpanded();
    userToggleState.set(toggleKey(), next);
    setIsExpanded(next);
  };

  return (
    <div class="my-1">
      <div
        class="flex items-center gap-2 px-3 py-1.5 bg-white/[0.04] border-l-2 border-accent/40 cursor-pointer hover:bg-white/[0.07] transition-colors rounded-r-md"
        onClick={handleToggle}
      >
        <span
          class="text-xs transition-transform duration-200"
          style={{ transform: isExpanded() ? 'rotate(90deg)' : 'rotate(0deg)', display: 'inline-block' }}
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
            <MessageFormatRenderer
              nodes={props.children}
              defaultExpanded={props.defaultExpanded}
              onChoiceSelect={props.onChoiceSelect}
              isStreaming={props.isStreaming}
              toggleScope={props.toggleScope}
              streamKey={childStreamKey(props.streamKey, `tag:${props.tagPath}:${props.tagName}`)}
              formatConfig={props.formatConfig}
              worldBookKeywords={props.worldBookKeywords}
            />
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
  isStreaming?: boolean;
  toggleScope?: string;
  streamKey?: string;
  formatConfig: MessageFormatConfig;
  worldBookKeywords: string[];
}> = (props) => {
  const fieldEntries = () => Object.entries(props.fields);
  const parseFieldContent = (value: string) =>
    parseMessageContent(value, props.formatConfig, props.worldBookKeywords);

  return (
    <div class="structured-response">
      <For each={fieldEntries()}>
        {([key, field], index) => {
          const isCollapsed = () => props.displayConfig[key]?.defaultCollapsed ?? false;
          const fieldPath = () => `structured:${index()}:${key}`;
          return (
            <Show
              when={field.kind === 'string' && key !== props.mainContentKey}
              fallback={
                <Show when={field.kind === 'string' && key === props.mainContentKey}>
                  <div class="whitespace-pre-wrap">
                    <MessageFormatRenderer
                      nodes={parseFieldContent((field as { kind: 'string'; value: string }).value)}
                      defaultExpanded={props.defaultExpanded}
                      onChoiceSelect={props.onChoiceSelect}
                      isStreaming={props.isStreaming}
                      toggleScope={`${props.toggleScope ?? 'structured'}:${key}`}
                      streamKey={childStreamKey(props.streamKey, `${fieldPath()}:main`)}
                      formatConfig={props.formatConfig}
                      worldBookKeywords={props.worldBookKeywords}
                    />
                  </div>
                </Show>
              }
            >
              <MessageFormatRenderer
                nodes={[
                  {
                    kind: 'tag',
                    tagName: key,
                    children: parseFieldContent((field as { kind: 'string'; value: string }).value),
                  },
                ]}
                defaultExpanded={!isCollapsed()}
                onChoiceSelect={props.onChoiceSelect}
                isStreaming={props.isStreaming}
                toggleScope={`${props.toggleScope ?? 'structured'}:${key}`}
                streamKey={childStreamKey(props.streamKey, `${fieldPath()}:tag`)}
                formatConfig={props.formatConfig}
                worldBookKeywords={props.worldBookKeywords}
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

const renderNode = (node: FormatNode, path: string, context: RenderContext) => {
  switch (node.kind) {
    case 'text': {
      const textNode = node as FormatNode & { text: string };
      return (
        <StreamingText
          text={textNode.text}
          nodePath={path}
          className="whitespace-pre-wrap"
          isStreaming={context.isStreaming}
          streamKey={context.streamKey}
        />
      );
    }
    case 'tag': {
      const tag = node as TagNode;
      return (
        <CollapsibleTag
          tagName={tag.tagName}
          tagPath={path}
          children={tag.children}
          defaultExpanded={context.defaultExpanded}
          onChoiceSelect={context.onChoiceSelect}
          isStreaming={context.isStreaming}
          toggleScope={context.toggleScope}
          streamKey={context.streamKey}
          formatConfig={context.formatConfig}
          worldBookKeywords={context.worldBookKeywords}
        />
      );
    }
    case 'italic': {
      const italic = node as ItalicNode;
      return (
        <StreamingText
          text={italic.text}
          nodePath={path}
          style={{ 'font-style': 'italic', color: 'rgba(245, 245, 247, 0.5)' }}
          isStreaming={context.isStreaming}
          streamKey={context.streamKey}
        />
      );
    }
    case 'quote': {
      const quote = node as QuoteNode;
      return (
        <StreamingText
          text={quote.text}
          nodePath={path}
          style={{ color: '#4ECDC4' }}
          isStreaming={context.isStreaming}
          streamKey={context.streamKey}
        />
      );
    }
    case 'keyword': {
      const keyword = node as KeywordNode;
      return (
        <StreamingText
          text={keyword.text}
          nodePath={path}
          style={{ color: '#A78BFA' }}
          isStreaming={context.isStreaming}
          streamKey={context.streamKey}
        />
      );
    }
    case 'custom': {
      const custom = node as CustomNode;
      return (
        <StreamingText
          text={custom.text}
          nodePath={path}
          style={{
            color: custom.color,
            'font-style': custom.italic ? 'italic' : 'normal',
            'font-weight': custom.bold ? 'bold' : 'normal',
          }}
          isStreaming={context.isStreaming}
          streamKey={context.streamKey}
        />
      );
    }
    case 'format_error': {
      const error = node as FormatErrorNode;
      return (
        <span
          class="inline-flex my-0.5 rounded-md border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-xs text-red-200 whitespace-pre-wrap"
          title={error.message}
        >
          {error.message}
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
          defaultExpanded={context.defaultExpanded}
          onChoiceSelect={context.onChoiceSelect}
          isStreaming={context.isStreaming}
          toggleScope={context.toggleScope}
          streamKey={context.streamKey}
          formatConfig={context.formatConfig}
          worldBookKeywords={context.worldBookKeywords}
        />
      );
    }
    default:
      return null;
  }
};

export const MessageFormatRenderer: Component<MessageFormatRendererProps> = (props) => {
  const formatConfig = () => props.formatConfig ?? DEFAULT_FORMAT_CONFIG;
  const worldBookKeywords = () => props.worldBookKeywords ?? [];

  return (
    <For each={props.nodes}>
      {(node, i) =>
        renderNode(node, `${i()}`, {
          defaultExpanded: props.defaultExpanded ?? true,
          onChoiceSelect: props.onChoiceSelect,
          isStreaming: props.isStreaming,
          toggleScope: props.toggleScope,
          streamKey: props.streamKey,
          formatConfig: formatConfig(),
          worldBookKeywords: worldBookKeywords(),
        })
      }
    </For>
  );
};
