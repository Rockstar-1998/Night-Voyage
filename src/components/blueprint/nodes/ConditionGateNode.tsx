import { Component } from 'solid-js';
import type { ConditionGateConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { ShieldAlert, Lock } from '../../../lib/icons';

const INPUT_CLASS =
  'w-full bg-black/30 border border-white/15 rounded-lg py-2 px-3 text-sm font-mono text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const SELECT_CLASS =
  'w-full bg-night-water border border-white/15 rounded-lg py-2 px-3 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const ConditionGateNode: Component<NodeConfigComponentProps<ConditionGateConfig>> = (props) => {
  const update = (updates: Partial<ConditionGateConfig>) => props.onUpdate(updates);

  return (
    <div class="space-y-4">
      <div class="p-3 rounded-xl border border-rose-500/20 bg-rose-500/5 space-y-2">
        <div class="flex items-center gap-2 text-xs font-bold text-rose-400">
          <ShieldAlert size={16} />
          <span>确定性规则判定与动作拦截门禁</span>
        </div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          校验金币充盈度、负重上限或背包槽位。若不满足条件，则立即阻断并走拦截分支，回传错误回执，保护数据容器。
        </p>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>门禁类型 (Gate Type)</label>
        <select
          value={props.config.gate_type || 'gold'}
          disabled={props.isLocked}
          onChange={(e) => update({ gate_type: e.currentTarget.value as 'gold' | 'weight' | 'slots' | 'custom' })}
          class={SELECT_CLASS}
        >
          <option value="gold">金币校验 (gold &gt;= cost)</option>
          <option value="weight">负重校验 (weight + add_w &lt;= max_w)</option>
          <option value="slots">槽位校验 (slots &lt; max_slots)</option>
          <option value="custom">自定义表达式 (Custom)</option>
        </select>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>判定值 / 表达式 (Expression)</label>
        <input
          type="text"
          value={props.config.expression || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ expression: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="如所需金币数或表达式 (50, total_cost)"
        />
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="space-y-1">
          <label class={LABEL_CLASS}>放行出口标签 (Pass)</label>
          <input
            type="text"
            value={props.config.pass_label || '放行'}
            disabled={props.isLocked}
            onInput={(e) => update({ pass_label: e.currentTarget.value })}
            class={INPUT_CLASS}
          />
        </div>
        <div class="space-y-1">
          <label class={LABEL_CLASS}>拦截出口标签 (Blocked)</label>
          <input
            type="text"
            value={props.config.blocked_label || '拦截'}
            disabled={props.isLocked}
            onInput={(e) => update({ blocked_label: e.currentTarget.value })}
            class={INPUT_CLASS}
          />
        </div>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>拦截理由模板 (Block Reason)</label>
        <input
          type="text"
          value={props.config.block_reason || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ block_reason: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="如: 金币不足！无法购买该道具"
        />
      </div>

      <div class="flex items-center justify-between pt-2 border-t border-white/5">
        <label class="text-xs text-mist-solid/60 flex items-center gap-1.5 cursor-pointer">
          <Lock size={13} class={props.config.is_locked ? 'text-amber-400' : 'text-mist-solid/30'} />
          <span>锁定节点</span>
        </label>
        <input
          type="checkbox"
          checked={props.config.is_locked || false}
          onChange={(e) => update({ is_locked: e.currentTarget.checked })}
          class="w-4 h-4 rounded border-white/20 bg-white/5 text-accent focus:ring-1 focus:ring-accent/40"
        />
      </div>
    </div>
  );
};
