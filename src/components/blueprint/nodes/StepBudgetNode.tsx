/**
 * StepBudgetNode — 步长预算节点配置面板（工单 01 前端注册补齐）。
 *
 * 配置字段（与 Rust StepBudgetConfig 一一对应）：
 * - max_steps：本轮步长预算上限（>=1）。1 = 单步直出；>=2 = 多步推理，
 *   步长耗尽触发熔断报错。
 * - short_circuit_on_tools：单步模式下，首步工具执行完毕后强制短路收尾，
 *   不再发起第二次 API 请求（零二次请求延迟）。
 *
 * 典型用法：放在 Branch 等分支路由的下游，为不同分支物理设定不同的
 * 执行步长配额；图遍历经过本节点时把预算盖戳到本轮执行上下文。
 */
import { Component } from 'solid-js';
import type { StepBudgetConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Gauge } from '../../../lib/icons';

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const StepBudgetNode: Component<NodeConfigComponentProps<StepBudgetConfig>> = (props) => {
  const update = (updates: Partial<StepBudgetConfig>) => props.onUpdate(updates);

  const handleMaxSteps = (raw: string) => {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return;
    update({ max_steps: Math.max(1, parsed) });
  };

  return (
    <div class="space-y-4">
      <div class="p-3 rounded-xl border border-rose-500/20 bg-rose-500/5 space-y-2">
        <div class="flex items-center gap-2 text-xs font-bold text-rose-400">
          <Gauge size={16} />
          <span>步长预算（Step Budget）</span>
        </div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          为本分支设定 Agent 单轮执行的步长配额。max_steps = 1 时单步直出：模型在一次请求内同时产出
          对白与工具调用，本地执行完工具后直接收尾；大于 1 时允许多步推理循环，步长耗尽将熔断报错。
        </p>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>最大步长 (max_steps，≥1)</label>
        <input
          type="number"
          min="1"
          step="1"
          value={props.config.max_steps}
          disabled={props.isLocked}
          onInput={(e) => handleMaxSteps(e.currentTarget.value)}
          class={INPUT_CLASS}
          placeholder="1"
        />
      </div>

      <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
        <div class="space-y-0.5">
          <div class="text-xs font-bold text-mist-solid">首步工具短路 (short_circuit_on_tools)</div>
          <div class="text-[10px] text-mist-solid/40">单步模式下首步工具执行后立即收尾，不再发起第二次请求</div>
        </div>
        <input
          type="checkbox"
          checked={props.config.short_circuit_on_tools || false}
          disabled={props.isLocked}
          onChange={(e) => update({ short_circuit_on_tools: e.currentTarget.checked })}
          class="w-4 h-4 rounded border-white/20 bg-white/5 text-accent focus:ring-1 focus:ring-accent/40"
        />
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>工具暴露策略 (tool_policy)</label>
        <select
          value={props.config.tool_policy ?? 'all'}
          disabled={props.isLocked}
          onChange={(e) =>
            update({ tool_policy: e.currentTarget.value as 'all' | 'settlement_only' })
          }
          class={INPUT_CLASS}
        >
          <option value="all">全部暴露（本执行流激活的所有工具）</option>
          <option value="settlement_only">仅结算类（单步直出契约：工具回执不回注，查询类不进白名单）</option>
        </select>
        <p class="text-[10px] text-mist-solid/40 leading-relaxed">
          仅结算类要求工具在 Tool Definition 中标注「结算/变更类」；查询类与未分类工具将被排除出本路白名单。
        </p>
      </div>
    </div>
  );
};
