import { Component, For, Show, createSignal } from 'solid-js';
import type { SchemaCardConfig, SchemaFieldDefinition } from '../../src/lib/backend/types';
import { actionBridgeInvoke } from '../../src/lib/backend/actionBridge';

/**
 * 移动端产物卡（spec §2.4 M5）：与 PC 端 SchemaCardView 各自独立实现（C5），
 * 但走同一条 action_bridge 白名单链路；字段物理排序即卡片展示顺序。
 */
export interface MobileSchemaCardProps {
  card: SchemaCardConfig;
  fields: SchemaFieldDefinition[];
  values: Record<string, string>;
  conversationId?: number;
}

export const MobileSchemaCard: Component<MobileSchemaCardProps> = (props) => {
  const [busy, setBusy] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [confirmed, setConfirmed] = createSignal(false);

  const runAction = async (command: string, argsTemplate: Array<[string, string]>) => {
    if (!props.conversationId) {
      setError('产物卡动作需要会话上下文（conversationId 缺失）');
      return;
    }
    setError(null);
    setBusy(command);
    try {
      const args: Record<string, unknown> = {};
      for (const [key, template] of argsTemplate ?? []) {
        args[key] = template.replace(/\{([^{}]+)\}/g, (_m, key2: string) => {
          const value = props.values[key2.trim()];
          return value === undefined || value === null ? '' : value;
        });
      }
      await actionBridgeInvoke(props.conversationId, command, args);
      setConfirmed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div
      class="rounded-xl border p-3 my-1"
      style={{ 'border-color': 'rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.08)' }}
      data-schema-card={props.card.titleField}
    >
      <div class="flex items-center justify-between gap-2 mb-1.5">
        <span class="text-sm font-semibold text-mist-solid">
          {props.values[props.card.titleField] ?? props.card.titleField}
        </span>
        <span
          class="text-[10px] px-1.5 py-0.5 rounded-full"
          style={{
            background: confirmed() ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)',
            color: confirmed() ? '#6ee7b7' : '#fcd34d',
          }}
        >
          {confirmed() ? '已确认' : '待确认'}
        </span>
      </div>
      <For each={props.fields}>
        {(field) => (
          <Show when={props.values[field.name] !== undefined}>
            <div class="flex gap-2 text-[11px] py-0.5">
              <span class="text-mist-solid/40 shrink-0">{field.name}</span>
              <span class="text-mist-solid/85 whitespace-pre-wrap break-words">{props.values[field.name]}</span>
            </div>
          </Show>
        )}
      </For>
      <Show when={(props.card.actions ?? []).length > 0}>
        <div class="flex flex-wrap gap-2 mt-2">
          <For each={props.card.actions ?? []}>
            {(action) => (
              <button
                type="button"
                disabled={busy() !== null}
                onClick={() => void runAction(action.command, action.argsTemplate)}
                class="px-3 py-1.5 rounded-lg text-white text-[11px] font-medium disabled:opacity-50"
                style={{ background: 'rgba(56,189,248,0.55)' }}
              >
                {busy() === action.command ? '执行中…' : action.label}
              </button>
            )}
          </For>
        </div>
      </Show>
      <Show when={error()}>
        <div class="mt-1.5 text-[10px] text-red-300 break-all" role="alert">{error()}</div>
      </Show>
    </div>
  );
};
