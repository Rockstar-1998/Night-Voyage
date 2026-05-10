import { Component, For, Show, createSignal, createEffect } from 'solid-js';
import { animate } from '../lib/animate';
import type { FormatNode, TagNode, ItalicNode, QuoteNode, KeywordNode, CustomNode } from '../lib/messageFormatter';

interface MessageFormatRendererProps {
  nodes: FormatNode[];
  defaultExpanded?: boolean;
}

interface CollapsibleTagProps {
  tagName: string;
  children: FormatNode[];
  defaultExpanded: boolean;
}

const CollapsibleTag: Component<CollapsibleTagProps> = (props) => {
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
            <MessageFormatRenderer nodes={props.children} defaultExpanded={props.defaultExpanded} />
          </div>
        </div>
      </Show>
    </div>
  );
};

const renderNode = (node: FormatNode, _index: number, defaultExpanded: boolean) => {
  switch (node.kind) {
    case 'text':
      return <span>{(node as FormatNode & { text: string }).text}</span>;
    case 'tag': {
      const tag = node as TagNode;
      return <CollapsibleTag tagName={tag.tagName} children={tag.children} defaultExpanded={defaultExpanded} />;
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
    default:
      return null;
  }
};

export const MessageFormatRenderer: Component<MessageFormatRendererProps> = (props) => {
  return (
    <For each={props.nodes}>
      {(node, i) => renderNode(node, i(), props.defaultExpanded ?? true)}
    </For>
  );
};
