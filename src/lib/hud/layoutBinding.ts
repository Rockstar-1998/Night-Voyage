import type { LayoutNode } from '../backend/types';

/**
 * 常驻 HUD 的数据绑定解析。
 *
 * 支持的绑定路径（与 UI 设计器里可填的写法一致）：
 * - `stats.<key>`：DataContainer 的数值属性（如 `stats.hp`、`stats.gold`）；
 * - `inventory`：背包数组；
 * - `flags.<key>`：状态标记；
 * - `schema.<key>`：结构化输出（Schema 字段）投影值。
 *
 * 语义约定（C2：不静默回退）：未命中一律返回 `undefined`，由组件渲染可见的
 * “绑定错误”徽标；**不**回落到 0 / 空串之类的伪值——否则创作者会把"写错绑定"
 * 误判成"数值就是 0"。
 */
export interface HudSnapshot {
  stats: Record<string, number>;
  inventory: unknown[];
  flags: Record<string, string>;
  schemaPatches: Record<string, any>;
}

export function resolveDataBinding(binding: string | undefined, snapshot: HudSnapshot): unknown {
  const path = (binding ?? '').trim();
  if (!path) return undefined;

  const [head, ...rest] = path.split('.');
  const key = rest.join('.');

  switch (head) {
    case 'stats':
      return key ? snapshot.stats[key] : undefined;
    case 'inventory':
      return snapshot.inventory;
    case 'flags':
      return key ? snapshot.flags[key] : undefined;
    case 'schema':
      return key ? snapshot.schemaPatches[key] : undefined;
    default:
      return undefined;
  }
}

/** 把绑定值渲染成可读文本；未命中返回 null 让调用方显示错误徽标。 */
export function formatBindingValue(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `${value.length} 项`;
  return JSON.stringify(value);
}

/** 交互控件（不可编辑，仅渲染）。设计器与运行时共用同一套渲染语义。 */
export function isInteractiveWidget(node: LayoutNode): boolean {
  return node.nodeType === 'widget';
}
