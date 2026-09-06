/**
 * BranchNode — 分支节点配置面板（spec 里程碑 B）。
 *
 * 配置字段：
 * - label：节点标签（仅显示用）
 * - cases：匹配规则列表，每条 { match_value, port }
 * - default_port：默认出口端口名（所有 case 不匹配时走此出口）
 *
 * 每条 case 的 port 必须与节点上的出边端口名一致，否则图校验会失败。
 */
import { Component, Index, Show } from 'solid-js';
import type { BranchConfig, BranchCase } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Plus, Trash2 } from '../../../lib/icons';

const INPUT_CLASS =
  'w-full bg-transparent border-b border-white/20 rounded-none py-2 px-1 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

const CASE_INPUT_CLASS =
  'flex-1 min-w-0 h-8 px-2 rounded bg-night-deep/80 border border-white/10 text-xs text-mist-solid focus:outline-none focus:border-accent/40 disabled:opacity-50';

export const BranchNode: Component<NodeConfigComponentProps<BranchConfig>> = (props) => {
  const update = (updates: Partial<BranchConfig>) => props.onUpdate(updates);

  const handleAddCase = () => {
    const nextIndex = props.config.cases.length;
    const newCase: BranchCase = {
      match_value: '',
      port: `out_${nextIndex + 1}`,
    };
    update({ cases: [...props.config.cases, newCase] });
  };

  const handleRemoveCase = (index: number) => {
    const next = props.config.cases.filter((_, i) => i !== index);
    update({ cases: next });
  };

  const handleUpdateCase = (index: number, updates: Partial<BranchCase>) => {
    const next = props.config.cases.map((c, i) =>
      i === index ? { ...c, ...updates } : c,
    );
    update({ cases: next });
  };

  return (
    <div class="space-y-4">
      <div class="space-y-1">
        <label class={LABEL_CLASS}>label（显示名）</label>
        <input
          type="text"
          value={props.config.label}
          disabled={props.isLocked}
          onInput={(e) => update({ label: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="如：角色分支"
        />
      </div>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class={LABEL_CLASS}>匹配规则（按顺序匹配，首个命中生效）</label>
          <button
            type="button"
            class="inline-flex items-center gap-1 text-[11px] text-accent hover:text-accent/80 disabled:opacity-40"
            disabled={props.isLocked}
            onClick={handleAddCase}
          >
            <Plus size={12} />
            添加规则
          </button>
        </div>

        {/*
          用 <Index> 而非 <For>：每次按键都会生成新的 case 对象，<For> 按引用
          比对会判定为"换了一项"从而销毁重建整行 DOM，输入框随即失焦。<Index>
          按下标比对，只更新行内 signal，不重建 DOM。
        */}
        <Index each={props.config.cases}>
          {(caseItem, index) => (
            <div class="flex items-center gap-2 p-2 rounded-lg bg-night-deep/40 border border-white/5">
              <input
                type="text"
                class={CASE_INPUT_CLASS}
                placeholder="匹配值（如 single）"
                value={caseItem().match_value}
                disabled={props.isLocked}
                onInput={(e) =>
                  handleUpdateCase(index, { match_value: e.currentTarget.value })
                }
              />
              <span class="text-mist-solid/40 text-xs">→</span>
              <input
                type="text"
                class={CASE_INPUT_CLASS}
                placeholder="出口端口名（如 out_single）"
                value={caseItem().port}
                disabled={props.isLocked}
                onInput={(e) =>
                  handleUpdateCase(index, { port: e.currentTarget.value })
                }
              />
              <button
                type="button"
                class="text-mist-solid/40 hover:text-red-400 disabled:opacity-30"
                disabled={props.isLocked}
                onClick={() => handleRemoveCase(index)}
                aria-label="删除规则"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )}
        </Index>

        <Show when={props.config.cases.length === 0}>
          <p class="text-[11px] text-mist-solid/40 leading-5 py-2">
            尚无匹配规则。点击"添加规则"创建一条。
          </p>
        </Show>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>default_port（默认出口，所有规则不匹配时走此端口）</label>
        <input
          type="text"
          value={props.config.default_port}
          disabled={props.isLocked}
          onInput={(e) => update({ default_port: e.currentTarget.value })}
          class={INPUT_CLASS}
          placeholder="如：out_default"
        />
      </div>

      <p class="text-[10px] text-mist-solid/35">
        每条规则的出口端口必须连一条出边；默认出口也必须有出边，否则图校验失败。
        Branch 节点的入边必须来自 Constant 节点。
      </p>
    </div>
  );
};
