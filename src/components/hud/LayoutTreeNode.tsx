import { Component, For, Show } from 'solid-js';
import type { LayoutContainer, LayoutNode, WidgetDefinition } from '../../lib/backend/types';
import { formatBindingValue, resolveDataBinding, type HudSnapshot } from '../../lib/hud/layoutBinding';

interface LayoutTreeNodeProps {
  node: LayoutNode;
  snapshot: HudSnapshot;
}

const BINDING_ERROR = 'rgba(244, 63, 94, 0.9)';

/**
 * 按 `UILayoutDefinition` 递归渲染常驻 HUD。
 *
 * 与 `PersistentHudContainer` 的内置默认视图并列存在：布局由创作者在 UI 设计器里定义，
 * 这里只做**纯渲染**（C1）——取值走 `resolveDataBinding`，未命中显示可见的绑定错误，
 * 不做任何计算或兜底。
 */
export const LayoutTreeNode: Component<LayoutTreeNodeProps> = (props) => (
  <Show
    when={props.node.nodeType === 'container'}
    fallback={<WidgetView widget={props.node as WidgetDefinition} snapshot={props.snapshot} />}
  >
    <ContainerView container={props.node as LayoutContainer} snapshot={props.snapshot} />
  </Show>
);

const ContainerView: Component<{ container: LayoutContainer; snapshot: HudSnapshot }> = (props) => (
  <div
    style={{
      position: 'relative',
      width: `${props.container.width}px`,
      height: `${props.container.height}px`,
      display: props.container.kind === 'grid' ? 'grid' : 'flex',
      'flex-direction': props.container.kind === 'tabs' ? 'row' : 'column',
      gap: `${Number(props.container.style?.gap ?? 8)}px`,
      padding: `${Number(props.container.style?.padding ?? 8)}px`,
      background: props.container.style?.background ?? 'rgba(255,255,255,0.02)',
      border: props.container.style?.border ?? '1px solid rgba(255,255,255,0.06)',
      'border-radius': props.container.style?.radius ?? '10px',
    }}
  >
    <For each={props.container.children ?? []}>
      {(child) => <LayoutTreeNode node={child} snapshot={props.snapshot} />}
    </For>
  </div>
);

const WidgetView: Component<{ widget: WidgetDefinition; snapshot: HudSnapshot }> = (props) => {
  const value = () => resolveDataBinding(props.widget.dataBinding, props.snapshot);
  const text = () => formatBindingValue(value());
  const percent = () => {
    const bound = value();
    const maxBinding = props.widget.config?.max_stat;
    if (typeof bound !== 'number' || typeof maxBinding !== 'string') return null;
    const max = resolveDataBinding(maxBinding, props.snapshot);
    if (typeof max !== 'number' || max <= 0) return null;
    return Math.min(100, Math.max(0, (bound / max) * 100));
  };

  return (
    <div
      style={{
        padding: '6px 8px',
        'border-radius': '8px',
        background: 'rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.05)',
        'min-width': '80px',
      }}
    >
      <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'baseline', gap: '8px' }}>
        <span style={{ 'font-size': '11px', color: '#94a3b8' }}>{props.widget.label}</span>
        <Show
          when={text() !== null}
          fallback={
            <span style={{ 'font-size': '10px', color: BINDING_ERROR }} role="alert">
              绑定错误: {props.widget.dataBinding || '(空)'}
            </span>
          }
        >
          <span style={{ 'font-size': '11px', 'font-family': 'monospace', color: '#f1f5f9' }}>{text()}</span>
        </Show>
      </div>

      <Show when={props.widget.widgetType === 'statBar' && percent() !== null}>
        <div style={{ 'margin-top': '4px', height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '999px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${percent()}%`,
              height: '100%',
              background: String(props.widget.config?.bar_color ?? '#38bdf8'),
            }}
          />
        </div>
      </Show>

      <Show when={props.widget.widgetType === 'inventorySlotGrid'}>
        <div style={{ display: 'grid', 'grid-template-columns': `repeat(${Number(props.widget.config?.columns ?? 4)}, 1fr)`, gap: '4px', 'margin-top': '4px' }}>
          <For each={Array.isArray(value()) ? (value() as any[]) : []}>
            {(item: any) => (
              <div
                title={`${item?.name ?? ''} x${item?.count ?? 0}`}
                style={{
                  'aspect-ratio': '1',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  'border-radius': '6px',
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'center',
                  'font-size': '10px',
                  color: '#cbd5e1',
                }}
              >
                {item?.icon ?? '🎒'}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
