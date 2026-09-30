import { Component, For, Show } from 'solid-js';
import type { LayoutContainer, LayoutNode, WidgetDefinition } from '../../src/lib/backend/types';

export interface MobileLayoutTreeProps {
  node: LayoutNode;
  snapshot: MobileHudSnapshot;
}

/**
 * 移动端视口的当前快照。与 PC 端同名结构一致，但这里的定义属于移动端前端
 * （C5：两端零 UI 耦合，移动端不引 PC 端的运行时模块）。
 */
export interface MobileHudSnapshot {
  stats: Record<string, number>;
  inventory: unknown[];
  flags: Record<string, string>;
  schemaPatches: Record<string, any>;
}

/** 绑定路径解析：未命中返回 undefined，由组件显示可见的「绑定错误」（不伪造成 0）。 */
function resolveBinding(binding: string | undefined, snapshot: MobileHudSnapshot): unknown {
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

function formatValue(value: unknown): string | null {
  if (value === undefined) return null;
  if (value === null) return 'null';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `${value.length} 项`;
  return JSON.stringify(value);
}

/**
 * 移动端常驻 HUD 的布局渲染器。
 *
 * 与 PC 端 `LayoutTreeNode` 是**各自独立的实现**（C5：两端前端零 UI 耦合，禁止互引组件），
 * 但共享同一套绑定解析语义（`src/lib/hud/layoutBinding.ts`）——保证同一个布局在两端
 * 读到的是同一份数据，只是排布按各自形态（移动端更紧凑、可横向滚动）。
 */
export const MobileLayoutTree: Component<MobileLayoutTreeProps> = (props) => (
  <Show
    when={props.node.nodeType === 'container'}
    fallback={<MobileWidget widget={props.node as WidgetDefinition} snapshot={props.snapshot} />}
  >
    <MobileContainer container={props.node as LayoutContainer} snapshot={props.snapshot} />
  </Show>
);

const MobileContainer: Component<{ container: LayoutContainer; snapshot: MobileHudSnapshot }> = (props) => (
  <div
    style={{
      width: `${props.container.width}px`,
      display: props.container.kind === 'grid' ? 'grid' : 'flex',
      'flex-direction': 'column',
      gap: '6px',
      padding: '8px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      'border-radius': '10px',
      'flex-shrink': '0',
    }}
  >
    <For each={props.container.children ?? []}>
      {(child) => <MobileLayoutTree node={child} snapshot={props.snapshot} />}
    </For>
  </div>
);

const MobileWidget: Component<{ widget: WidgetDefinition; snapshot: MobileHudSnapshot }> = (props) => {
  const value = () => resolveBinding(props.widget.dataBinding, props.snapshot);
  const text = () => formatValue(value());

  return (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        gap: '8px',
        padding: '4px 8px',
        background: 'rgba(0,0,0,0.25)',
        'border-radius': '8px',
        'min-width': '120px',
      }}
    >
      <span style={{ 'font-size': '11px', color: '#94a3b8' }}>{props.widget.label}</span>
      <Show
        when={text() !== null}
        fallback={<span style={{ 'font-size': '10px', color: '#fb7185' }} role="alert">绑定错误</span>}
      >
        <span style={{ 'font-size': '11px', 'font-family': 'monospace', color: '#f1f5f9' }}>{text()}</span>
      </Show>
    </div>
  );
};
