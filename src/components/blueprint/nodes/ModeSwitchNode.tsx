/**
 * ModeSwitch node config editor (Task 9).
 *
 * Edits a ModeSwitchConfig: just `label`. The three outlet ports
 * (out_legacy / out_mem0 / out_stateless) are fixed by the node type and
 * cannot be edited here — they are listed as a read-only reference so the
 * user knows which downstream branch each port maps to.
 *
 * Constraints:
 * - C1 Frontend Render-Only: edits forwarded via onUpdate, no backend calls.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 */

import { Component, For } from 'solid-js';
import type { ModeSwitchConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

const PORTS: ReadonlyArray<{ port: string; desc: string }> = [
  { port: 'out_legacy', desc: '传统模式（完整历史拼接）' },
  { port: 'out_mem0', desc: 'MEM0 模式（外部记忆检索）' },
  { port: 'out_stateless', desc: '无状态模式（不注入历史）' },
];

export const ModeSwitchNode: Component<NodeConfigComponentProps<ModeSwitchConfig>> = (props) => {
  const update = (updates: Partial<ModeSwitchConfig>) => props.onUpdate(updates);

  return (
    <div class="space-y-4">
      <div class="space-y-1">
        <label class={LABEL_CLASS}>label（显示名）</label>
        <input
          type="text"
          value={props.config.label}
          onInput={(e) => update({ label: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="如 记忆模式分支"
        />
      </div>

      <div class="space-y-2">
        <label class={LABEL_CLASS}>出口端口（固定，不可编辑）</label>
        <ul class="space-y-1.5 text-xs">
          <For each={PORTS}>
            {(p) => (
              <li class="flex items-baseline gap-2">
                <span class="font-mono text-mist-solid/80 bg-white/5 px-1.5 py-0.5 rounded">
                  {p.port}
                </span>
                <span class="text-mist-solid/50">{p.desc}</span>
              </li>
            )}
          </For>
        </ul>
        <p class="text-[10px] text-mist-solid/35">
          运行时根据会话的 memory_mode 走对应出口，三条分支应在下游汇聚。
        </p>
      </div>
    </div>
  );
};
