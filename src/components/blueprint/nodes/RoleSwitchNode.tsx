/**
 * RoleSwitch node config editor (DEPRECATED).
 *
 * Edits a RoleSwitchConfig: just `label`. The two outlet ports
 * (out_single / out_online) are fixed by the node type and cannot be
 * edited here — they are listed as a read-only reference so the user
 * knows which downstream branch each port maps to.
 *
 * RoleSwitch is the orthogonal axis to ModeSwitch: ModeSwitch branches on
 * memory mode (legacy/mem0/stateless), RoleSwitch branches on conversation
 * type (single/online). The two nodes are composed in-graph via serial
 * connection to realise the 6 permutation paths.
 *
 * 已废弃：被 Constant + Branch 节点替代。保留此变体仅为向后兼容，
 * 旧图仍可加载执行；新图应使用 Constant（读取会话属性）+ Branch（按值分支）。
 * 已从 NodeSelector 可选列表移除，仅当选中已有 RoleSwitch 节点时才显示此表单。
 *
 * Constraints:
 * - C1 Frontend Render-Only: edits forwarded via onUpdate, no backend calls.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 */

import { Component, For } from 'solid-js';
import type { RoleSwitchConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

const PORTS: ReadonlyArray<{ port: string; desc: string }> = [
  { port: 'out_single', desc: '单人模式（单角色对话）' },
  { port: 'out_online', desc: '多人模式（联机房间）' },
];

export const RoleSwitchNode: Component<NodeConfigComponentProps<RoleSwitchConfig>> = (props) => {
  const update = (updates: Partial<RoleSwitchConfig>) => props.onUpdate(updates);

  return (
    <div class="space-y-4">
      <div class="px-3 py-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-300/80 leading-relaxed">
        RoleSwitch 已废弃，建议迁移为 Constant + Branch 节点。旧图仍可执行。
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>label（显示名）</label>
        <input
          type="text"
          value={props.config.label}
          onInput={(e) => update({ label: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="如 角色模式分支"
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
          运行时根据会话的 conversation_type 走对应出口，两条分支应在下游汇聚。
          与 ModeSwitch 串联可实现 6 种排列组合路径。
        </p>
      </div>
    </div>
  );
};
