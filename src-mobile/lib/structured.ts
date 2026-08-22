// 移动端结构化输出解析工具（C5：移动端前端独立，不复用 PC 端 messageFormatter.ts）。
// 逻辑与 PC 端 parseStructuredResponse / MessageItem 的 structuredResponse memo 对齐，
// 仅做纯函数解析，不依赖任何 DOM / 组件。

export interface StructuredField {
  kind: 'string' | 'object' | 'array';
  value: string | Record<string, string> | string[];
}

export interface StructuredDisplayConfig {
  defaultCollapsed?: boolean;
  hideLabel?: boolean;
}

export interface StructuredResponse {
  fields: Record<string, StructuredField>;
  displayConfig: Record<string, StructuredDisplayConfig>;
}

/**
 * 解析完整 JSON 回复体（历史消息或流结束后）为结构化字段集合。
 * 与 PC 端 messageFormatter.parseStructuredResponse 行为一致。
 */
export function parseStructuredResponse(
  jsonContent: string,
  displayConfig: Record<string, StructuredDisplayConfig> = {},
): StructuredResponse | null {
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
          if (typeof v === 'string') stringEntries[k] = v;
        }
        if (Object.keys(stringEntries).length > 0) {
          fields[key] = { kind: 'object', value: stringEntries };
        }
      } else if (Array.isArray(value)) {
        const items = value.filter((v): v is string => typeof v === 'string');
        if (items.length > 0) {
          fields[key] = { kind: 'array', value: items };
        }
      }
    }

    if (Object.keys(fields).length === 0) return null;

    return { fields, displayConfig };
  } catch {
    return null;
  }
}

/**
 * 解析流式过程中的结构化字段（key -> JSON 字符串）。
 * 与 PC 端 MessageItem 的 streamingStructuredMode memo 对齐：
 * `{` 开头 → 对象；`[` 开头 → 数组；其余 → 字符串。
 */
export function parseStreamingFields(
  structuredFields: Record<string, string>,
): Record<string, StructuredField> {
  const fields: Record<string, StructuredField> = {};

  for (const [key, value] of Object.entries(structuredFields)) {
    const trimmed = value.trimStart();
    if (trimmed.startsWith('{')) {
      try {
        const parsed = JSON.parse(value);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
          const stringEntries: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') stringEntries[k] = v;
          }
          if (Object.keys(stringEntries).length > 0) {
            fields[key] = { kind: 'object', value: stringEntries };
          }
        }
      } catch {
        /* not valid JSON yet */
      }
    } else if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          const items = parsed.filter((v): v is string => typeof v === 'string');
          if (items.length > 0) {
            fields[key] = { kind: 'array', value: items };
          }
        }
      } catch {
        /* not valid JSON yet */
      }
    } else {
      fields[key] = { kind: 'string', value };
    }
  }

  return fields;
}
