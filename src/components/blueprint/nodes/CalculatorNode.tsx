import { Component } from 'solid-js';
import type { CalculatorConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Calculator as CalcIcon, Lock } from '../../../lib/icons';

const INPUT_CLASS =
  'w-full bg-black/30 border border-white/15 rounded-lg py-2 px-3 text-sm font-mono text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const SELECT_CLASS =
  'w-full bg-night-water border border-white/15 rounded-lg py-2 px-3 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const CalculatorNode: Component<NodeConfigComponentProps<CalculatorConfig>> = (props) => {
  const update = (updates: Partial<CalculatorConfig>) => props.onUpdate(updates);

  return (
    <div class="space-y-4">
      <div class="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 space-y-2">
        <div class="flex items-center gap-2 text-xs font-bold text-amber-400">
          <CalcIcon size={16} />
          <span>确定性数值与容器修改运算器</span>
        </div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          由 Rust 执行确定性原子数值算术与物品增删，拒绝让大模型产生幻觉算数，保障游戏状态与背包准确。
        </p>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>运算模式 (Mode)</label>
        <select
          value={props.config.calc_mode || 'math'}
          disabled={props.isLocked}
          onChange={(e) => update({ calc_mode: e.currentTarget.value as 'math' | 'collection' })}
          class={SELECT_CLASS}
        >
          <option value="math">数值算术 (Math Operation)</option>
          <option value="collection">容器集合操作 (Collection / Inventory)</option>
        </select>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>目标变量 (Target)</label>
        <input
          type="text"
          value={props.config.target || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ target: e.currentTarget.value.trim() })}
          class={INPUT_CLASS}
          placeholder="如: stats.gold, stats.hp, inventory"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>操作符 (Operator)</label>
        <select
          value={props.config.op || '+'}
          disabled={props.isLocked}
          onChange={(e) => update({ op: e.currentTarget.value })}
          class={SELECT_CLASS}
        >
          <option value="+">加 (+) / 累加</option>
          <option value="-">减 (-) / 扣除</option>
          <option value="*">乘 (*)</option>
          <option value="/">除 (/)</option>
          <option value="set">设值 (set)</option>
          <option value="clamp">区间截断 (clamp)</option>
          <option value="min">取最小值 (min)</option>
          <option value="max">取最大值 (max)</option>
          <option value="add_item">增加道具 (add_item)</option>
          <option value="remove_item">移除道具 (remove_item)</option>
          <option value="recompute_weight">重算负重 (recompute_weight)</option>
        </select>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>操作数 A (Operand A / 参数)</label>
        <input
          type="text"
          value={props.config.operand_a || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ operand_a: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="数值或参数名 (如 args.count, 50)"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>操作数 B (可选上限/参数 B)</label>
        <input
          type="text"
          value={props.config.operand_b || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ operand_b: e.currentTarget.value || null })}
          class={INPUT_CLASS}
          placeholder="用于 clamp 上限值等（可选）"
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
