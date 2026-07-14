/**
 * Settings area shared validation and helper utilities.
 * Extracted from SettingsArea.tsx to keep validation logic reusable and testable.
 */

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  return '操作失败，请查看控制台或后端日志。';
}

export function requireNonEmpty(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} 不能为空`);
  }
  return trimmed;
}

export function parsePositiveIntegerField(label: string, value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`${label} 必须是正整数`);
  }
  return Number(trimmed);
}

/** Counts the number of capturing groups in a regex pattern source string. */
export function countCapturingGroups(pattern: string): number {
  let count = 0;
  let escaped = false;
  let inCharacterClass = false;

  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '[') {
      inCharacterClass = true;
      continue;
    }
    if (char === ']' && inCharacterClass) {
      inCharacterClass = false;
      continue;
    }
    if (inCharacterClass || char !== '(') {
      continue;
    }

    if (pattern[index + 1] !== '?') {
      count++;
      continue;
    }

    if (pattern[index + 2] === '<' && pattern[index + 3] !== '=' && pattern[index + 3] !== '!') {
      count++;
    }
  }

  return count;
}

/**
 * Validates a custom format rule's regex pattern + group index.
 * Returns an error message string when invalid, or `null` when valid.
 */
export function validateCustomRulePattern(pattern: string, groupIndex: number): string | null {
  if (!pattern.trim()) return null;
  if (!Number.isInteger(groupIndex) || groupIndex < 0) {
    return '匹配组索引必须是大于等于 0 的整数';
  }

  try {
    new RegExp(pattern, 'd');
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  const captureCount = countCapturingGroups(pattern);
  if (groupIndex > captureCount) {
    return `匹配组 ${groupIndex} 不存在；当前正则只有 0-${captureCount} 组`;
  }

  return null;
}
