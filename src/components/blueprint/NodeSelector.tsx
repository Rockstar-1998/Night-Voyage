/**
 * NodeSelector — blueprint node type picker (Task 10.2).
 *
 * A compact dropdown that lists the 8 node types defined in `types.ts`.
 * When the user picks a type, `onAddNode` is invoked with the type and a
 * position (the caller decides where to place the new node — typically the
 * current view center).
 *
 * The selector owns no graph state. It is a presentational component that
 * forwards user intent to the parent (BlueprintEditor), which performs the
 * actual `createNode` mutation.
 *
 * Constraints:
 * - C1 Frontend Render-Only: forwards user intent via callback, no backend calls.
 * - C3 Responsiveness: SolidJS fine-grained — the dropdown only re-renders
 *   when its own open/close signal changes.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`. The mobile
 *   editor (Task 13) ships its own selector under `src-mobile/`.
 */

import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Plus, ChevronDown } from '../../lib/icons';
import type { NodeType, Position } from '../../lib/blueprint/types';
import { NODE_TYPES } from '../../lib/blueprint/types';

export interface NodeSelectorProps {
  onAddNode: (type: NodeType, position: Position) => void;
  /** Disabled when no graph is loaded yet (e.g. during initial preset fetch). */
  disabled?: boolean;
}

// ─── Node type → display label ───

export const NODE_LABELS: Record<NodeType, string> = {
  start: 'Start（起点）',
  end: 'End（终点）',
  prompt: 'Prompt（提示词片段）',
  schema_field: 'Schema Field（结构化字段）',
  mutex_gate: 'Mutex Gate（互斥单选）',
  group_gate: 'Group Gate（普通多选）',
  mode_switch: 'Mode Switch（三模式分支）',
  role_switch: 'Role Switch（已废弃，建议用常量+分支替代）',
  sampling_params: 'Sampling Params（legacy，已不可新建）',
  sampling_params_openai: 'Sampling Params（OpenAI 版）',
  sampling_params_anthropic: 'Sampling Params（Anthropic 版）',
  constant: 'Constant（常量，读取会话属性）',
  branch: 'Branch（分支，按值走出口）',
};

const NODE_DESCRIPTIONS: Record<NodeType, string> = {
  start: '蓝图流程的起点，每图唯一',
  end: '蓝图流程的终点，每图唯一',
  prompt: '一段提示词内容，编译为 block',
  schema_field: '结构化输出字段，可映射 db 持久化',
  mutex_gate: '互斥选项组，运行时单选一个分支',
  group_gate: '普通选项组，运行时多选分支',
  mode_switch: '按会话记忆模式三分支（legacy/mem0/stateless）',
  role_switch: '已废弃：被常量+分支替代，旧图仍可执行',
  sampling_params: 'legacy 通用采样参数，旧图仍可加载执行，但不再允许新建',
  sampling_params_openai: 'OpenAI / chat_completions 专用：temperature / top_p / frequency_penalty / presence_penalty / stop',
  sampling_params_anthropic: 'Anthropic 专用：temperature / top_p / stop / thinking_enabled / thinking_budget_tokens',
  constant: '读取会话属性（如 conversation_type / memory_mode / protocol）输出值',
  branch: '接收上游常量值，按 cases 匹配走对应出口',
};

/// 选择器中展示的节点类型列表：移除已废弃的 role_switch 与 legacy
/// sampling_params。旧图中的这些节点仍可加载和执行，但不允许新建。
/// 导出给画布右键上下文菜单复用（同一份可新建列表）。
export const SELECTABLE_NODE_TYPES: NodeType[] = NODE_TYPES.filter(
  (t) => t !== 'role_switch' && t !== 'sampling_params',
);

export const NodeSelector: Component<NodeSelectorProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  const toggle = () => setOpen((v) => !v);
  const close = () => setOpen(false);

  const handlePick = (type: NodeType) => {
    close();
    // Position is decided by the parent (view center). We pass {0,0} as a
    // sentinel; the parent overrides it with the actual view-center coords.
    props.onAddNode(type, { x: 0, y: 0 });
  };

  // Close on outside click.
  const handleDocPointerDown = (e: MouseEvent) => {
    if (!rootEl) return;
    if (!rootEl.contains(e.target as Node)) close();
  };

  onMount(() => {
    document.addEventListener('pointerdown', handleDocPointerDown);
    onCleanup(() => document.removeEventListener('pointerdown', handleDocPointerDown));
  });

  return (
    <div class="relative" ref={(el) => { rootEl = el; }}>
      <button
        type="button"
        onClick={toggle}
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open()}
        class="inline-flex items-center gap-2 px-3 h-10 rounded-xl border border-accent/30 bg-accent text-white text-sm font-semibold shadow-[0_0_20px_rgba(58,109,140,0.25)] hover:bg-accent/85 hover:shadow-[0_0_28px_rgba(58,109,140,0.35)] transition-all disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Plus size={16} />
        添加节点
        <ChevronDown size={14} class={`transition-transform ${open() ? 'rotate-180' : ''}`} />
      </button>

      <Show when={open()}>
        <ul
          role="listbox"
          class="absolute z-50 mt-2 w-72 max-h-[60vh] overflow-y-auto rounded-xl border border-white/10 bg-night-water/95 backdrop-blur-xl shadow-2xl custom-scrollbar"
        >
          <For each={SELECTABLE_NODE_TYPES}>
            {(type) => (
              <li>
                <button
                  type="button"
                  role="option"
                  onClick={() => handlePick(type)}
                  class="w-full text-left px-4 py-3 hover:bg-white/5 transition-colors border-b border-white/5 last:border-b-0"
                >
                  <div class="text-sm font-bold text-mist-solid">{NODE_LABELS[type]}</div>
                  <div class="text-[11px] text-mist-solid/45 mt-0.5 leading-5">
                    {NODE_DESCRIPTIONS[type]}
                  </div>
                </button>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
};
