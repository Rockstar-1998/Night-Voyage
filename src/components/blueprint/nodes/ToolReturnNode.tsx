import { Component } from 'solid-js';
import type { ToolReturnConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { CornerDownLeft, Lock } from '../../../lib/icons';

const TEXTAREA_CLASS =
  'w-full bg-black/30 border border-white/15 rounded-lg py-2 px-3 text-sm font-mono text-mist-solid focus:outline-none focus:border-accent transition-all custom-scrollbar disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const ToolReturnNode: Component<NodeConfigComponentProps<ToolReturnConfig>> = (props) => {
  const update = (updates: Partial<ToolReturnConfig>) => props.onUpdate(updates);

  return (
    <div class="space-y-4">
      <div class="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-2">
        <div class="flex items-center gap-2 text-xs font-bold text-emerald-400">
          <CornerDownLeft size={16} />
          <span>ToolCall 回执装配与恢复</span>
        </div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          将运算器成功结果或门禁拦截信息封装为标准 ToolResult 回传大模型，让 Agent 基于客观事实继续推进后续正文。
        </p>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>回执内容模板 (Return Template)</label>
        <textarea
          rows={5}
          value={props.config.return_template || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ return_template: e.currentTarget.value })}
          class={TEXTAREA_CLASS}
          placeholder="如: 购买成功！获得 {item.name} x{count}，扣除金币 {cost}，剩余金币 {gold}"
        />
      </div>

      <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5">
        <div class="space-y-0.5">
          <div class="text-xs font-bold text-mist-solid">阻断标志 (Blocked)</div>
          <div class="text-[10px] text-mist-solid/40">标记本回执是否属于门禁拦截回执</div>
        </div>
        <input
          type="checkbox"
          checked={props.config.is_blocked || false}
          disabled={props.isLocked}
          onChange={(e) => update({ is_blocked: e.currentTarget.checked })}
          class="w-4 h-4 rounded border-white/20 bg-white/5 text-accent focus:ring-1 focus:ring-accent/40"
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
