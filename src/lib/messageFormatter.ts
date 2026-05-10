export interface MessageFormatConfig {
  builtinRules: {
    pseudoXml: { enabled: boolean; defaultExpanded: boolean };
    italicGray: { enabled: boolean };
    cyanQuote: { enabled: boolean };
    worldBookKeyword: { enabled: boolean };
  };
  customRules: CustomFormatRule[];
}

export interface CustomFormatRule {
  id: string;
  name: string;
  pattern: string;
  groupIndex: number;
  color: string;
  italic: boolean;
  bold: boolean;
}

export type FormatNode =
  | TextNode
  | TagNode
  | ItalicNode
  | QuoteNode
  | KeywordNode
  | CustomNode;

export interface TextNode {
  kind: 'text';
  text: string;
}

export interface TagNode {
  kind: 'tag';
  tagName: string;
  children: FormatNode[];
}

export interface ItalicNode {
  kind: 'italic';
  text: string;
}

export interface QuoteNode {
  kind: 'quote';
  text: string;
}

export interface KeywordNode {
  kind: 'keyword';
  text: string;
}

export interface CustomNode {
  kind: 'custom';
  text: string;
  ruleId: string;
  color: string;
  italic: boolean;
  bold: boolean;
}

export const DEFAULT_FORMAT_CONFIG: MessageFormatConfig = {
  builtinRules: {
    pseudoXml: { enabled: true, defaultExpanded: true },
    italicGray: { enabled: true },
    cyanQuote: { enabled: true },
    worldBookKeyword: { enabled: true },
  },
  customRules: [],
};

export function parseMessageContent(
  content: string,
  config: MessageFormatConfig,
  worldBookKeywords: string[]
): FormatNode[] {
  if (!content) return [];
  return parsePseudoXml(content, config, worldBookKeywords);
}

function parsePseudoXml(
  text: string,
  config: MessageFormatConfig,
  worldBookKeywords: string[]
): FormatNode[] {
  if (!config.builtinRules.pseudoXml.enabled) {
    return parseInlineRules(text, config, worldBookKeywords);
  }

  const nodes: FormatNode[] = [];
  const regex = /<([a-zA-Z][a-zA-Z0-9_-]*)>([\s\S]*?)<\/\1>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    if (match.index > lastIndex) {
      nodes.push(
        ...parseInlineRules(text.slice(lastIndex, match.index), config, worldBookKeywords)
      );
    }
    const children = parseMessageContent(match[2], config, worldBookKeywords);
    nodes.push({ kind: 'tag', tagName: match[1], children });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(...parseInlineRules(text.slice(lastIndex), config, worldBookKeywords));
  }

  return nodes;
}

function parseInlineRules(
  text: string,
  config: MessageFormatConfig,
  worldBookKeywords: string[]
): FormatNode[] {
  if (!text) return [];

  let fragments: FormatNode[] = [{ kind: 'text', text }];

  if (config.builtinRules.worldBookKeyword.enabled && worldBookKeywords.length > 0) {
    fragments = applyWorldBookKeywords(fragments, worldBookKeywords);
  }

  if (config.builtinRules.italicGray.enabled) {
    fragments = applyRegexRule(fragments, /\*\*(.+?)\*\*/g, (m) => ({
      kind: 'italic' as const,
      text: m[1],
    }));
  }

  if (config.builtinRules.cyanQuote.enabled) {
    fragments = applyCyanQuoteRule(fragments);
  }

  for (const rule of config.customRules) {
    fragments = applyCustomRule(fragments, rule);
  }

  return fragments;
}

function applyRegexRule(
  nodes: FormatNode[],
  regex: RegExp,
  createNode: (match: RegExpExecArray) => FormatNode
): FormatNode[] {
  const result: FormatNode[] = [];
  for (const node of nodes) {
    if (node.kind !== 'text') {
      result.push(node);
      continue;
    }
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    const text = node.text;
    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      if (match.index > lastIndex) {
        result.push({ kind: 'text', text: text.slice(lastIndex, match.index) });
      }
      result.push(createNode(match));
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      result.push({ kind: 'text', text: text.slice(lastIndex) });
    }
  }
  return result;
}

function applyWorldBookKeywords(
  nodes: FormatNode[],
  keywords: string[]
): FormatNode[] {
  const sorted = [...keywords].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((k) =>
    k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const pattern = new RegExp(`\\b(${escaped.join('|')})\\b`, 'g');
  return applyRegexRule(nodes, pattern, (m) => ({
    kind: 'keyword' as const,
    text: m[1],
  }));
}

function applyCyanQuoteRule(nodes: FormatNode[]): FormatNode[] {
  const result: FormatNode[] = [];
  const regex = /\u201C([\s\S]*?)\u201D|"([^"]*)"/g;
  for (const node of nodes) {
    if (node.kind !== 'text') {
      result.push(node);
      continue;
    }
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    const text = node.text;
    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      if (match.index > lastIndex) {
        result.push({ kind: 'text', text: text.slice(lastIndex, match.index) });
      }
      result.push({ kind: 'quote', text: match[0] });
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
      result.push({ kind: 'text', text: text.slice(lastIndex) });
    }
  }
  return result;
}

function applyCustomRule(
  nodes: FormatNode[],
  rule: CustomFormatRule
): FormatNode[] {
  const result: FormatNode[] = [];
  const regex = new RegExp(rule.pattern, 'gd');
  for (const node of nodes) {
    if (node.kind !== 'text') {
      result.push(node);
      continue;
    }
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    const text = node.text;
    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      const [groupStart, groupEnd] = match.indices![rule.groupIndex];
      if (matchStart > lastEnd) {
        result.push({ kind: 'text', text: text.slice(lastEnd, matchStart) });
      }
      if (groupStart > matchStart) {
        result.push({ kind: 'text', text: text.slice(matchStart, groupStart) });
      }
      result.push({
        kind: 'custom',
        text: text.slice(groupStart, groupEnd),
        ruleId: rule.id,
        color: rule.color,
        italic: rule.italic,
        bold: rule.bold,
      });
      if (groupEnd < matchEnd) {
        result.push({ kind: 'text', text: text.slice(groupEnd, matchEnd) });
      }
      lastEnd = matchEnd;
    }
    if (lastEnd < text.length) {
      result.push({ kind: 'text', text: text.slice(lastEnd) });
    }
  }
  return result;
}
