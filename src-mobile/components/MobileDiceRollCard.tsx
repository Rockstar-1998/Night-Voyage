import { Component, Show } from 'solid-js';
import { Calculator, Sparkles, CheckCircle2, AlertTriangle, Lock } from 'lucide-solid';
import type { DiceRollEvent } from '../../src/lib/backend';

interface MobileDiceRollCardProps {
  roll: DiceRollEvent;
}

export const MobileDiceRollCard: Component<MobileDiceRollCardProps> = (props) => {
  const isNat20 = () => props.roll.roll === 20;
  const isNat1 = () => props.roll.roll === 1;
  const total = () => props.roll.roll + props.roll.modifier;
  const passed = () => props.roll.passed;

  const statusBadge = () => {
    if (isNat20()) {
      return {
        label: '大成功 (Nat 20)',
        bg: 'bg-amber-400/20 text-amber-300 border-amber-400/40',
        cardBorder: 'border-amber-400/50 shadow-[0_0_12px_rgba(251,191,36,0.2)]',
      };
    }
    if (isNat1()) {
      return {
        label: '大失败 (Nat 1)',
        bg: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
        cardBorder: 'border-purple-500/50 shadow-[0_0_12px_rgba(168,85,247,0.2)]',
      };
    }
    if (passed()) {
      return {
        label: '检定通过',
        bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
        cardBorder: 'border-emerald-500/40 shadow-[0_0_12px_rgba(16,185,129,0.15)]',
      };
    }
    return {
      label: '检定未通过',
      bg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
      cardBorder: 'border-rose-500/40 shadow-[0_0_12px_rgba(244,63,94,0.15)]',
    };
  };

  return (
    <div
      class={`my-2 p-3 rounded-xl bg-black/70 backdrop-blur-md border text-left transition-all duration-300 ${statusBadge().cardBorder}`}
    >
      <div class="flex items-center justify-between pb-1.5 mb-1.5 border-b border-white/10">
        <div class="flex items-center gap-1.5">
          <div class="p-1 rounded bg-sky-500/10 border border-sky-500/20 text-sky-400">
            <Calculator size={14} />
          </div>
          <div>
            <div class="text-[11px] font-bold text-white flex items-center gap-1">
              <span>{props.roll.tool ? `契约: ${props.roll.tool}` : 'D20 骰点'}</span>
              <Show when={isNat20()}>
                <Sparkles size={11} class="text-amber-400 animate-pulse" />
              </Show>
            </div>
            <div class="text-[9px] text-white/50 font-mono">
              DC {props.roll.dc} 难度
            </div>
          </div>
        </div>
        <div
          class={`px-1.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${statusBadge().bg}`}
        >
          <Show when={passed()} fallback={<AlertTriangle size={10} />}>
            <CheckCircle2 size={10} />
          </Show>
          <span>{statusBadge().label}</span>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-1.5 py-1 px-1.5 bg-white/[0.03] rounded border border-white/5 text-center">
        <div>
          <div class="text-[9px] text-white/40">D20</div>
          <div
            class={`text-sm font-black font-mono ${
              isNat20()
                ? 'text-amber-400'
                : isNat1()
                ? 'text-purple-400'
                : 'text-white'
            }`}
          >
            {props.roll.roll}
          </div>
        </div>
        <div>
          <div class="text-[9px] text-white/40">修正</div>
          <div class="text-sm font-bold font-mono text-white/80">
            {props.roll.modifier >= 0 ? `+${props.roll.modifier}` : props.roll.modifier}
          </div>
        </div>
        <div>
          <div class="text-[9px] text-white/40">总计 vs DC</div>
          <div class="text-sm font-black font-mono text-sky-300">
            {total()} <span class="text-[9px] text-white/40">/{props.roll.dc}</span>
          </div>
        </div>
      </div>

      <div class="mt-1.5 flex items-center justify-between text-[9px] text-white/40 font-mono">
        <div class="flex items-center gap-0.5">
          <Lock size={9} class="text-emerald-400" />
          <span>OS-CSPRNG 安全随机源</span>
        </div>
        <span>R#{props.roll.roundId}</span>
      </div>
    </div>
  );
};
