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
  | CustomNode
  | FormatErrorNode
  | StructuredResponseNode;

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

export interface FormatErrorNode {
  kind: 'format_error';
  message: string;
}

export interface StructuredField {
  kind: 'string' | 'object';
  value: string | Record<string, string>;
}

export interface StructuredResponseNode {
  kind: 'structured_response';
  fields: Record<string, StructuredField>;
  mainContentKey: string | null;
  displayConfig: Record<string, { defaultCollapsed: boolean }>;
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

  for (const rule of config.customRules) {
    fragments = applyCustomRule(fragments, rule);
  }

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

export function parseStructuredResponse(jsonContent: string, displayConfig?: Record<string, { defaultCollapsed: boolean }>): StructuredResponseNode | null {
  try {
    const parsed = JSON.parse(jsonContent);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const fields: Record<string, StructuredField> = {};

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') {
        fields[key] = { kind: 'string', value };
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const stringEntries: Record<string, string> = {};
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === 'string') {
            stringEntries[k] = v;
          }
        }
        if (Object.keys(stringEntries).length > 0) {
          fields[key] = { kind: 'object', value: stringEntries };
        }
      }
    }

    if (Object.keys(fields).length === 0) return null;

    const mainContentKey = fields['content'] ? 'content' : Object.keys(fields)[0];

    return { kind: 'structured_response', fields, mainContentKey, displayConfig: displayConfig ?? {} };
  } catch {
    return null;
  }
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
  let regex: RegExp;
  try {
    regex = new RegExp(rule.pattern, 'gd');
  } catch (error) {
    return [
      {
        kind: 'format_error',
        message: `自定义格式规则「${rule.name}」正则无效：${error instanceof Error ? error.message : String(error)}`,
      },
      ...nodes,
    ];
  }

  for (const node of nodes) {
    if (node.kind !== 'text') {
      result.push(node);
      continue;
    }
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    let lastEnd = 0;
    const text = node.text;
    const localResult: FormatNode[] = [];
    let groupError: FormatNode | null = null;

    while ((match = regex.exec(text)) !== null) {
      if (match[0].length === 0) {
        regex.lastIndex++;
        continue;
      }
      const matchStart = match.index;
      const matchEnd = match.index + match[0].length;
      const groupRange = match.indices?.[rule.groupIndex];
      if (!groupRange || groupRange[0] == null || groupRange[1] == null) {
        groupError = {
          kind: 'format_error',
          message: `自定义格式规则「${rule.name}」的匹配组 ${rule.groupIndex} 不存在或未命中。`,
        };
        break;
      }
      const [groupStart, groupEnd] = groupRange;
      if (matchStart > lastEnd) {
        localResult.push({ kind: 'text', text: text.slice(lastEnd, matchStart) });
      }
      if (groupStart > matchStart) {
        localResult.push({ kind: 'text', text: text.slice(matchStart, groupStart) });
      }
      localResult.push({
        kind: 'custom',
        text: text.slice(groupStart, groupEnd),
        ruleId: rule.id,
        color: rule.color,
        italic: rule.italic,
        bold: rule.bold,
      });
      if (groupEnd < matchEnd) {
        localResult.push({ kind: 'text', text: text.slice(groupEnd, matchEnd) });
      }
      lastEnd = matchEnd;
    }
    if (groupError) {
      result.push(groupError, node);
      continue;
    }
    if (lastEnd < text.length) {
      localResult.push({ kind: 'text', text: text.slice(lastEnd) });
    }
    result.push(...localResult);
  }
  return result;
}
