import { Component, For, Show, createSignal } from 'solid-js';
import type { LayoutContainer, LayoutNode, WidgetDefinition } from '../../src/lib/backend/types';
import { actionBridgeInvoke } from '../../src/lib/backend/actionBridge';

export interface MobileLayoutTreeProps {
  node: LayoutNode;
  snapshot: MobileHudSnapshot;
  /** 动作件执行命令所需会话上下文 */
  conversationId?: number;
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
    fallback={<MobileWidget widget={props.node as WidgetDefinition} snapshot={props.snapshot} conversationId={props.conversationId} />}
  >
    <MobileContainer container={props.node as LayoutContainer} snapshot={props.snapshot} conversationId={props.conversationId} />
  </Show>
);

const MobileContainer: Component<{ container: LayoutContainer; snapshot: MobileHudSnapshot; conversationId?: number }> = (props) => (
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
      {(child) => <MobileLayoutTree node={child} snapshot={props.snapshot} conversationId={props.conversationId} />}
    </For>
  </div>
);

const MobileWidget: Component<{ widget: WidgetDefinition; snapshot: MobileHudSnapshot; conversationId?: number }> = (props) => {
  const value = () => resolveBinding(props.widget.dataBinding, props.snapshot);
  const text = () => formatValue(value());

  // StatBar：真实进度条（值/上限来自绑定与 config.max_stat，计划 §4.1）
  const statBar = () => {
    const bound = value();
    const maxBinding = props.widget.config?.max_stat;
    const max = typeof maxBinding === 'string' ? resolveBinding(maxBinding, props.snapshot) : null;
    const percent =
      typeof bound === 'number' && typeof max === 'number' && max > 0
        ? Math.min(100, Math.max(0, (bound / max) * 100))
        : null;
    return (
      <div style={{ padding: '4px 8px', 'border-radius': '8px', background: 'rgba(0,0,0,0.25)', 'min-width': '120px' }}>
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'baseline' }}>
          <span style={{ 'font-size': '11px', color: '#94a3b8' }}>{props.widget.label}</span>
          <span style={{ 'font-size': '11px', 'font-family': 'monospace', color: '#f1f5f9' }}>{text() ?? ''}</span>
        </div>
        <div style={{ 'margin-top': '3px', height: '5px', background: 'rgba(255,255,255,0.08)', 'border-radius': '999px', overflow: 'hidden' }}>
          <div
            style={{
              width: `${percent ?? 0}%`,
              height: '100%',
              background: String(props.widget.config?.bar_color ?? '#38bdf8'),
            }}
          />
        </div>
        <Show when={percent === null}>
          <span style={{ 'font-size': '10px', color: '#fb7185' }} role="alert">绑定错误</span>
        </Show>
      </div>
    );
  };

  // InventorySlotGrid：图标 + 数量角标 + 品质框（计划 §4.1 四要素之三）
  const inventoryGrid = () => {
    const items = Array.isArray(value()) ? (value() as any[]) : [];
    return (
      <div style={{ padding: '4px 8px', 'border-radius': '8px', background: 'rgba(0,0,0,0.25)', 'min-width': '120px' }}>
        <div style={{ display: 'flex', 'justify-content': 'space-between' }}>
          <span style={{ 'font-size': '11px', color: '#94a3b8' }}>{props.widget.label}</span>
        </div>
        <div style={{ display: 'grid', 'grid-template-columns': `repeat(${Number(props.widget.config?.columns ?? 4)}, 1fr)`, gap: '4px', 'margin-top': '4px' }}>
          <For each={items}>
            {(item: any) => {
              const quality = String(item?.properties?.quality ?? '').toLowerCase();
              const qualityColor =
                quality.includes('epic') || quality.includes('史诗')
                  ? '#a855f7'
                  : quality.includes('rare') || quality.includes('稀有')
                    ? '#3b82f6'
                    : 'rgba(255,255,255,0.08)';
              return (
                <div
                  title={`${item?.name ?? ''} x${item?.count ?? 0}`}
                  style={{
                    'aspect-ratio': '1',
                    position: 'relative',
                    background: 'rgba(0,0,0,0.3)',
                    border: `1px solid ${qualityColor}`,
                    'border-radius': '6px',
                    display: 'flex',
                    'align-items': 'center',
                    'justify-content': 'center',
                    'font-size': '10px',
                    color: '#cbd5e1',
                  }}
                >
                  {item?.icon ?? '🎒'}
                  <Show when={Number(item?.count ?? 0) > 1}>
                    <span
                      style={{
                        position: 'absolute',
                        right: '2px',
                        bottom: '2px',
                        'font-size': '9px',
                        background: 'rgba(0,0,0,0.7)',
                        'border-radius': '4px',
                        padding: '0 3px',
                        color: '#e2e8f0',
                      }}
                    >
                      {item?.count}
                    </span>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </div>
    );
  };

  // Badge：胶囊徽标视觉（与 DataLabel 的文本盒区分）
  const badge = () => (
    <div
      style={{
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'space-between',
        gap: '8px',
        padding: '4px 10px',
        'border-radius': '999px',
        background: String(props.widget.config?.badge_background ?? 'rgba(56,189,248,0.15)'),
        border: `1px solid ${String(props.widget.config?.badge_border ?? 'rgba(56,189,248,0.4)')}`,
        'min-width': '120px',
      }}
    >
      <span style={{ 'font-size': '11px', color: '#94a3b8' }}>{props.widget.label}</span>
      <Show
        when={text() !== null}
        fallback={<span style={{ 'font-size': '10px', color: '#fb7185' }} role="alert">绑定错误</span>}
      >
        <span style={{ 'font-size': '11px', 'font-family': 'monospace', color: '#7dd3fc' }}>{text()}</span>
      </Show>
    </div>
  );

  // AvatarFrame：头像（绑定值 = 图片 URL/base64）+ Buff 徽标（flags 中 buff_ 前缀）
  const avatarFrame = () => {
    const buffs = Object.entries(props.snapshot.flags).filter(([k]) => k.toLowerCase().startsWith('buff_'));
    return (
      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '4px 8px', 'border-radius': '8px', background: 'rgba(0,0,0,0.25)', 'min-width': '120px' }}>
        <div
          style={{
            width: '40px',
            height: '40px',
            'border-radius': '10px',
            background: 'rgba(0,0,0,0.3)',
            border: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            'font-size': '18px',
            overflow: 'hidden',
          }}
        >
          <Show
            when={typeof value() === 'string' && (value() as string).startsWith('data:')}
            fallback={'🧙'}
          >
            <img src={value() as string} alt={props.widget.label} style={{ width: '100%', height: '100%', 'object-fit': 'cover' }} />
          </Show>
        </div>
        <div style={{ display: 'flex', gap: '2px', 'flex-wrap': 'wrap' }}>
          <For each={buffs}>
            {([flagKey]) => (
              <span
                style={{
                  'font-size': '10px',
                  padding: '1px 4px',
                  'border-radius': '4px',
                  background: 'rgba(168,85,247,0.2)',
                  color: '#d8b4fe',
                }}
              >
                {flagKey.replace(/^buff_/i, '')}
              </span>
            )}
          </For>
        </div>
      </div>
    );
  };

  return (
    <Show
      when={props.widget.widgetType !== 'actionButton'}
      fallback={<MobileActionButton widget={props.widget} snapshot={props.snapshot} conversationId={props.conversationId} />}
    >
    <Show when={props.widget.widgetType === 'statBar'} fallback={
    <Show when={props.widget.widgetType === 'inventorySlotGrid'} fallback={
    <Show when={props.widget.widgetType === 'badge'} fallback={
    <Show when={props.widget.widgetType === 'avatarFrame'} fallback={
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
    }>
      {avatarFrame()}
    </Show>
    }>
      {badge()}
    </Show>
    }>
      {inventoryGrid()}
    </Show>
    }>
      {statBar()}
    </Show>
    </Show>
  );
};

/**
 * 移动端动作件（spec §2.3 M4）：与 PC 端 ActionButtonView 各自独立实现（C5），
 * 但走同一条 action_bridge 白名单链路；未注册命令显式报错（I2）。
 */
const MobileActionButton: Component<{
  widget: WidgetDefinition;
  snapshot: MobileHudSnapshot;
  conversationId?: number;
}> = (props) => {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [resultJson, setResultJson] = createSignal<string | null>(null);

  const command = () => String(props.widget.config?.command ?? '');

  const resolvePlaceholder = (expr: string): unknown => {
    const trimmed = expr.trim();
    if (trimmed.startsWith('stats.')) return props.snapshot.stats[trimmed.slice(6)];
    if (trimmed.startsWith('schema.')) return props.snapshot.schemaPatches[trimmed.slice(7)];
    if (trimmed.startsWith('flags.')) return props.snapshot.flags[trimmed.slice(6)];
    return props.snapshot.schemaPatches[trimmed] ?? props.snapshot.stats[trimmed];
  };

  const onClick = async () => {
    if (!props.conversationId) {
      setError('动作件执行需要会话上下文（conversationId 缺失）');
      return;
    }
    if (!command()) {
      setError('动作件未配置 command（布局资产 config.command 缺失）');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const rawTemplate = props.widget.config?.args_template;
      const template: Record<string, string> =
        rawTemplate && typeof rawTemplate === 'object' ? (rawTemplate as Record<string, string>) : {};
      const args: Record<string, unknown> = {};
      for (const [key, tpl] of Object.entries(template)) {
        if (typeof tpl !== 'string') {
          args[key] = tpl;
          continue;
        }
        args[key] = tpl.replace(/\{([^{}]+)\}/g, (_m, expr: string) => {
          const value = resolvePlaceholder(expr);
          return value === undefined || value === null ? '' : String(value);
        });
      }
      const result = await actionBridgeInvoke(props.conversationId, command(), args);
      setResultJson(JSON.stringify(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        'flex-direction': 'column',
        gap: '4px',
        padding: '4px 8px',
        background: 'rgba(0,0,0,0.25)',
        'border-radius': '8px',
        'min-width': '120px',
      }}
    >
      <button
        type="button"
        disabled={busy()}
        onClick={onClick}
        style={{
          padding: '6px 10px',
          'border-radius': '8px',
          background: 'rgba(56,189,248,0.25)',
          border: '1px solid rgba(56,189,248,0.45)',
          color: '#e0f2fe',
          'font-size': '11px',
          cursor: busy() ? 'wait' : 'pointer',
        }}
      >
        {busy() ? '执行中…' : props.widget.label || command() || '(未命名动作)'}
      </button>
      <Show when={error()}>
        <span style={{ 'font-size': '10px', color: '#fb7185', 'word-break': 'break-all' }} role="alert">
          {error()}
        </span>
      </Show>
      <Show when={resultJson()}>
        <span style={{ 'font-size': '10px', 'font-family': 'monospace', color: '#cbd5e1', 'word-break': 'break-all' }}>
          {resultJson()}
        </span>
      </Show>
    </div>
  );
};
