import { Component, For, Show, createSignal } from 'solid-js';
import type { SchemaCardAction, SchemaCardConfig, SchemaFieldDefinition } from '../lib/backend/types';
import { actionBridgeInvoke } from '../lib/backend/actionBridge';

/**
 * 产物卡渲染（spec §2.4 M5）：Schema 资产的 card 扩展。
 *
 * 字段物理排序（`fields` 数组顺序）即卡片展示顺序（C1 纯渲染）；
 * 动作按钮点击时经 action_bridge 白名单代理既有命令——命令未在白名单注册
 * 会显式报错（I2），不静默降级。
 *
 * 「待确认两态」：卡片渲染出来为 pending（待确认）；任一动作执行成功后转
 * confirmed（本消息内标记，不再重复执行按钮高亮）。
 */

export interface SchemaCardViewProps {
  card: SchemaCardConfig;
  fields: SchemaFieldDefinition[];
  /** 字段值（来自结构化输出 JSON），键 = 字段名 */
  values: Record<string, string>;
  /** 动作执行所需会话；缺省时动作按钮不可用并显式提示 */
  conversationId?: number;
  /** 外部已确认标记（如该消息的动作此前已执行成功） */
  confirmed?: boolean;
  onConfirmed?: () => void;
}

/** 解析 `{字段名}` 占位（上下文：卡片字段值 → 调用参数原样）。 */
export function resolveArgsTemplate(
  template: string,
  values: Record<string, unknown>,
): string {
  return template.replace(/\{([^{}]+)\}/g, (_match, key: string) => {
    const trimmed = key.trim();
    const value = values[trimmed];
    return value === undefined || value === null ? '' : String(value);
  });
}

export const SchemaCardView: Component<SchemaCardViewProps> = (props) => {
  const [runningAction, setRunningAction] = createSignal<string | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [confirmedLocal, setConfirmedLocal] = createSignal(false);
  const [lastResult, setLastResult] = createSignal<string | null>(null);

  const confirmed = () => props.confirmed || confirmedLocal();
  const title = () => props.values[props.card.titleField] ?? props.card.titleField;

  const runAction = async (action: SchemaCardAction) => {
    if (!props.conversationId) {
      setActionError('产物卡动作需要会话上下文（conversationId 缺失）');
      return;
    }
    setActionError(null);
    setRunningAction(action.command);
    try {
      const args: Record<string, unknown> = {};
      for (const [key, template] of action.argsTemplate ?? []) {
        args[key] = resolveArgsTemplate(template, props.values);
      }
      const result = await actionBridgeInvoke(props.conversationId, action.command, args);
      setLastResult(JSON.stringify(result));
      setConfirmedLocal(true);
      props.onConfirmed?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <div
      class="rounded-2xl border border-accent/25 bg-accent/5 p-4 my-2 max-w-xl"
      data-schema-card={props.card.titleField}
    >
      <div class="flex items-center justify-between gap-2 mb-2">
        <div class="text-sm font-semibold text-mist-solid">{title()}</div>
        <span
          class={`text-[10px] px-2 py-0.5 rounded-full border ${
            confirmed()
              ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
              : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
          }`}
        >
          {confirmed() ? '已确认' : '待确认'}
        </span>
      </div>

      <For each={props.fields}>
        {(field) => (
          <Show when={props.values[field.name] !== undefined}>
            <div class="flex gap-2 text-xs py-0.5">
              <span class="text-mist-solid/40 shrink-0">{field.name}</span>
              <span class="text-mist-solid/85 whitespace-pre-wrap break-words">
                {props.values[field.name]}
              </span>
            </div>
          </Show>
        )}
      </For>

      <Show when={(props.card.actions ?? []).length > 0}>
        <div class="flex flex-wrap gap-2 mt-3">
          <For each={props.card.actions ?? []}>
            {(action) => (
              <button
                type="button"
                disabled={runningAction() !== null}
                onClick={() => runAction(action)}
                class="px-3 py-1.5 rounded-lg bg-accent/70 text-white text-xs font-medium hover:bg-accent/85 disabled:opacity-50 transition-colors"
              >
                {runningAction() === action.command ? '执行中…' : action.label}
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={actionError()}>
        <div class="mt-2 text-xs text-red-300 break-all" role="alert">
          {actionError()}
        </div>
      </Show>
      <Show when={lastResult()}>
        <div class="mt-1 text-[10px] text-mist-solid/40 font-mono break-all">{lastResult()}</div>
      </Show>
    </div>
  );
};
