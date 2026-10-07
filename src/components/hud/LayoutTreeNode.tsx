import { Component, For, Show, createSignal } from 'solid-js';
import type { LayoutContainer, LayoutNode, WidgetDefinition } from '../../lib/backend/types';
import { actionBridgeInvoke } from '../../lib/backend/actionBridge';
import { presetSchemaGet } from '../../lib/backend/schema';
import { SchemaCardView } from '../SchemaCardView';
import { formatBindingValue, resolveDataBinding, type HudSnapshot } from '../../lib/hud/layoutBinding';

interface LayoutTreeNodeProps {
  node: LayoutNode;
  snapshot: HudSnapshot;
  /** 动作件执行命令所需会话上下文（HUD 挂载即会话） */
  conversationId?: number;
}

const BINDING_ERROR = 'rgba(244, 63, 94, 0.9)';

/**
 * 按 `UILayoutDefinition` 递归渲染常驻 HUD。
 *
 * 与 `PersistentHudContainer` 的内置默认视图并列存在：布局由创作者在 UI 设计器里定义，
 * 这里只做**纯渲染**（C1）——取值走 `resolveDataBinding`，未命中显示可见的绑定错误，
 * 不做任何计算或兜底。
 *
 * 容器语义（计划 §4.1）：
 * - `layout_mode`: `absolute`（子元素按 x/y 自由坐标）/ `flex`（纵向流式，缺省）/ `grid`（style.columns 列网格）；
 * - `tabs` 容器：标签页分页（本地激活页状态）；
 * - x/y/width/height 忠实呈现（absolute 模式下生效）。
 */
export const LayoutTreeNode: Component<LayoutTreeNodeProps> = (props) => (
  <Show
    when={props.node.nodeType === 'container'}
    fallback={<WidgetView widget={props.node as WidgetDefinition} snapshot={props.snapshot} conversationId={props.conversationId} />}
  >
    <ContainerView container={props.node as LayoutContainer} snapshot={props.snapshot} conversationId={props.conversationId} />
  </Show>
);

const ContainerView: Component<{ container: LayoutContainer; snapshot: HudSnapshot; conversationId?: number }> = (props) => {
  // tabs 容器：本地激活页状态（按子元素索引）
  const [activeTab, setActiveTab] = createSignal(0);

  const containerStyle = (): Record<string, string> => {
    const mode = layoutMode();
    const style: Record<string, string> = {
      // absolute 模式下容器自身用 absolute 定位（读取 x/y）；flex/grid 用 relative 流式
      position: mode === 'absolute' ? 'absolute' : 'relative',
      display: mode === 'grid' ? 'grid' : 'flex',
      'flex-direction': 'column',
      gap: `${Number(props.container.style?.gap ?? 8)}px`,
      padding: `${Number(props.container.style?.padding ?? 8)}px`,
      background: props.container.style?.background ?? 'rgba(255,255,255,0.02)',
      border: props.container.style?.border ?? '1px solid rgba(255,255,255,0.06)',
      'border-radius': props.container.style?.radius ?? '10px',
    };
    // absolute 模式：容器自身按 x/y 定位（根容器 x/y=0 时等效于 relative 起点）
    if (mode === 'absolute') {
      style.left = `${props.container.x}px`;
      style.top = `${props.container.y}px`;
    }
    if (props.container.width > 0) style.width = `${props.container.width}px`;
    if (props.container.height > 0) style.height = `${props.container.height}px`;
    return style;
  };

  // 排版模式（计划 §4.1）：absolute 自由坐标 / flex 纵向流式 / grid 网格
  const layoutMode = () => props.container.layoutMode ?? 'flex';

  return (
    <Show
      when={props.container.kind !== 'tabs'}
      fallback={
        <div class="tabs-container" style={{ ...containerStyle(), 'flex-direction': 'column' }}>
          {/* 标签头：取各子元素的 label（控件取 label，容器取"页 N"） */}
          <div style={{ display: 'flex', gap: '4px', 'margin-bottom': '4px', 'flex-wrap': 'wrap' }}>
            <For each={props.container.children ?? []}>
              {(child, index) => (
                <button
                  type="button"
                  onClick={() => setActiveTab(index())}
                  style={{
                    padding: '4px 10px',
                    'font-size': '11px',
                    'border-radius': '6px',
                    cursor: 'pointer',
                    border: activeTab() === index() ? '1px solid rgba(56,189,248,0.6)' : '1px solid rgba(255,255,255,0.1)',
                    background: activeTab() === index() ? 'rgba(56,189,248,0.2)' : 'rgba(0,0,0,0.25)',
                    color: activeTab() === index() ? '#7dd3fc' : '#94a3b8',
                  }}
                >
                  {child.nodeType === 'widget' ? child.label : `页 ${index() + 1}`}
                </button>
              )}
            </For>
          </div>
          {/* 激活页内容 */}
          <For each={props.container.children ?? []}>
            {(child, index) => (
              <Show when={activeTab() === index()}>
                <LayoutTreeNode node={child} snapshot={props.snapshot} conversationId={props.conversationId} />
              </Show>
            )}
          </For>
        </div>
      }
    >
      <div
        style={{
          ...containerStyle(),
          ...(layoutMode() === 'grid'
            ? {
                display: 'grid',
                'grid-template-columns': `repeat(${Number(props.container.style?.columns ?? 2)}, 1fr)`,
                gap: `${Number(props.container.style?.gap ?? 8)}px`,
              }
            : layoutMode() === 'absolute'
              ? { position: 'relative' }
              : {}),
        }}
      >
        <For each={props.container.children ?? []}>
          {(child) => {
            // absolute 模式：子元素（容器或控件）按 x/y 自由坐标定位（计划 §4.1 Absolute 排版）
            const style =
              layoutMode() === 'absolute'
                ? ({
                    position: 'absolute',
                    left: `${child.x}px`,
                    top: `${child.y}px`,
                    ...(child.width > 0 ? { width: `${child.width}px` } : {}),
                    ...(child.height > 0 ? { height: `${child.height}px` } : {}),
                  } as Record<string, string>)
                : {};
            return (
              <div style={style}>
                <LayoutTreeNode node={child} snapshot={props.snapshot} conversationId={props.conversationId} />
              </div>
            );
          }}
        </For>
      </div>
    </Show>
  );
};

const WidgetView: Component<{ widget: WidgetDefinition; snapshot: HudSnapshot; conversationId?: number }> = (props) => {
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
    <Show
      when={props.widget.widgetType !== 'actionButton'}
      fallback={<ActionButtonView widget={props.widget} snapshot={props.snapshot} conversationId={props.conversationId} />}
    >
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
        <div
          style={{
            'margin-top': '4px',
            ...(props.widget.config?.vertical
              ? { height: `${Number(props.widget.config?.bar_thickness ?? 60)}px`, width: `${Number(props.widget.config?.bar_thickness ?? 5)}px` }
              : { height: `${Number(props.widget.config?.bar_thickness ?? 5)}px`, width: '100%' }),
            background: 'rgba(255,255,255,0.08)',
            'border-radius': '999px',
            overflow: 'hidden',
            display: props.widget.config?.vertical ? 'flex' : 'block',
            'flex-direction': props.widget.config?.vertical ? 'column-reverse' : undefined,
          }}
        >
          <div
            style={{
              width: props.widget.config?.vertical ? '100%' : `${percent()}%`,
              height: props.widget.config?.vertical ? `${percent()}%` : '100%',
              background: String(props.widget.config?.bar_color ?? '#38bdf8'),
            }}
          />
        </div>
      </Show>

      <Show when={props.widget.widgetType === 'inventorySlotGrid'}>
        <div style={{ display: 'grid', 'grid-template-columns': `repeat(${Number(props.widget.config?.columns ?? 4)}, 1fr)`, gap: '4px', 'margin-top': '4px' }}>
          <For each={Array.isArray(value()) ? (value() as any[]) : []}>
            {(item: any) => {
              // 品质框：item.properties.quality → 边框色（计划 §4.1 四要素之二）
              const qualityColor = () => {
                const quality = String(item?.properties?.quality ?? item?.quality ?? '').toLowerCase();
                if (quality.includes('epic') || quality.includes('史诗')) return '#a855f7';
                if (quality.includes('rare') || quality.includes('稀有')) return '#3b82f6';
                if (quality.includes('uncommon') || quality.includes('优秀')) return '#22c55e';
                return 'rgba(255,255,255,0.08)';
              };
              // 详情气泡：点击展开的详情面板（四要素之四）
              const [showDetail, setShowDetail] = createSignal(false);
              return (
                <div>
                  <button
                    type="button"
                    title={`${item?.name ?? ''} x${item?.count ?? 0}`}
                    onClick={() => setShowDetail(!showDetail())}
                    style={{
                      'aspect-ratio': '1',
                      width: '100%',
                      position: 'relative',
                      background: 'rgba(0,0,0,0.3)',
                      border: `1px solid ${qualityColor()}`,
                      'border-radius': '6px',
                      display: 'flex',
                      'align-items': 'center',
                      'justify-content': 'center',
                      'font-size': '10px',
                      color: '#cbd5e1',
                      cursor: 'pointer',
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
                  </button>
                  <Show when={showDetail()}>
                    <div
                      style={{
                        'margin-top': '2px',
                        padding: '4px',
                        'font-size': '9px',
                        background: 'rgba(0,0,0,0.6)',
                        'border-radius': '4px',
                        color: '#cbd5e1',
                        'word-break': 'break-all',
                      }}
                    >
                      <div>{item?.name ?? ''} ×{item?.count ?? 0}</div>
                      <Show when={item?.unit_price}>
                        <div>单价: {item.unit_price}G</div>
                      </Show>
                      <Show when={item?.unit_weight}>
                        <div>单件重: {item.unit_weight}kg</div>
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>

      <Show when={props.widget.widgetType === 'badge'}>
        {/* Badge 控件：胶囊徽标视觉（与 DataLabel 的文本盒区分） */}
        <span
          style={{
            display: 'inline-block',
            padding: '2px 10px',
            'border-radius': '999px',
            'font-size': '11px',
            background: String(props.widget.config?.badge_background ?? 'rgba(56,189,248,0.15)'),
            color: String(props.widget.config?.badge_color ?? '#7dd3fc'),
            border: `1px solid ${String(props.widget.config?.badge_border ?? 'rgba(56,189,248,0.4)')}`,
          }}
        >
          {text() ?? '绑定错误'}
        </span>
      </Show>

      <Show when={props.widget.widgetType === 'avatarFrame'}>
        {/* AvatarFrame：玩家头像（绑定值 = 头像 URL/base64）+ Buff 图标（flags 前缀 buff_） */}
        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
          <Show
            when={typeof value() === 'string' && (value() as string).length > 0}
            fallback={
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  'border-radius': '10px',
                  background: 'rgba(0,0,0,0.3)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'center',
                  'font-size': '20px',
                }}
              >
                🧙
              </div>
            }
          >
            <img
              src={String(value())}
              alt={props.widget.label}
              style={{ width: '48px', height: '48px', 'border-radius': '10px', 'object-fit': 'cover' }}
            />
          </Show>
          <div style={{ display: 'flex', gap: '2px', 'flex-wrap': 'wrap' }}>
            <For each={Object.entries(props.snapshot.flags).filter(([k]) => k.toLowerCase().startsWith('buff_'))}>
              {([flagKey, flagValue]) => (
                <span
                  title={`${flagKey}: ${flagValue}`}
                  style={{
                    'font-size': '10px',
                    padding: '1px 4px',
                    'border-radius': '4px',
                    background: 'rgba(168,85,247,0.2)',
                    color: '#d8b4fe',
                    border: '1px solid rgba(168,85,247,0.4)',
                  }}
                >
                  {flagKey.replace(/^buff_/i, '')}
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
    </Show>
  );
};

/**
 * 动作件（spec §2.3 M4）：config 携带 `command` / `args_template` / `result_schema_id`。
 * 点击 → action_bridge 白名单校验 + 分发；未注册显式报错（I2）。
 * `result_schema_id` 指向 Schema 资产时，命令结果按该资产的 card 配置渲染产物卡（L4）。
 */
const ActionButtonView: Component<{
  widget: WidgetDefinition;
  snapshot: HudSnapshot;
  conversationId?: number;
}> = (props) => {
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [resultJson, setResultJson] = createSignal<string | null>(null);
  const [resultCard, setResultCard] = createSignal<{
    card: any;
    fields: any[];
    values: Record<string, string>;
  } | null>(null);

  const command = () => String(props.widget.config?.command ?? '');
  const argsTemplate = (): Record<string, string> => {
    const raw = props.widget.config?.args_template;
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  };

  const resolvePlaceholder = (expr: string): unknown => {
    const trimmed = expr.trim();
    if (trimmed.startsWith('stats.')) return props.snapshot.stats[trimmed.slice(6)];
    if (trimmed.startsWith('schema.')) return props.snapshot.schemaPatches[trimmed.slice(7)];
    if (trimmed.startsWith('flags.')) return props.snapshot.flags[trimmed.slice(6)];
    // 裸名：依次查 schema 投影 → stats
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
      const args: Record<string, unknown> = {};
      for (const [key, template] of Object.entries(argsTemplate())) {
        if (typeof template !== 'string') {
          args[key] = template;
          continue;
        }
        args[key] = template.replace(/\{([^{}]+)\}/g, (_m, expr: string) => {
          const value = resolvePlaceholder(expr);
          return value === undefined || value === null ? '' : String(value);
        });
      }
      const result = await actionBridgeInvoke(props.conversationId, command(), args);
      setResultJson(JSON.stringify(result));

      const schemaId = props.widget.config?.result_schema_id;
      if (typeof schemaId === 'string' && schemaId.trim()) {
        const schema = await presetSchemaGet(schemaId);
        if (schema.card) {
          const values: Record<string, string> = {};
          const obj = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
          for (const field of schema.fields) {
            const value = obj[field.name];
            values[field.name] =
              value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
          }
          setResultCard({ card: schema.card, fields: schema.fields, values });
        } else {
          setResultCard(null);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResultCard(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: '6px 8px',
        'border-radius': '8px',
        background: 'rgba(0,0,0,0.25)',
        border: '1px solid rgba(255,255,255,0.05)',
        'min-width': '80px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '6px',
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
          'white-space': 'nowrap',
        }}
      >
        {busy() ? '执行中…' : props.widget.label || command() || '(未命名动作)'}
      </button>
      <Show when={error()}>
        <div style={{ 'font-size': '10px', color: BINDING_ERROR, 'word-break': 'break-all' }} role="alert">
          {error()}
        </div>
      </Show>
      <Show when={resultCard()}>
        {(cardData) => (
          <SchemaCardView
            card={cardData().card}
            fields={cardData().fields}
            values={cardData().values}
            conversationId={props.conversationId}
            confirmed
          />
        )}
      </Show>
      <Show when={resultJson() && !resultCard()}>
        <div style={{ 'font-size': '10px', 'font-family': 'monospace', color: '#cbd5e1', 'word-break': 'break-all' }}>
          {resultJson()}
        </div>
      </Show>
    </div>
  );
};
