/**
 * 移动端蓝图节点配置底部抽屉（Task 13.1 / 13.3）。
 *
 * 选中节点时从屏幕底部滑出抽屉，覆盖下半屏；用户可上下拖动抽屉头部调整高度，
 * 松手时吸附到最近档位（40% / 65% / 90%）。
 *
 * 设计：
 * - 受控：父级传入 `selectedNode`（null 时关闭）和 `onConfigChange`
 * - 表单变更实时回调父级（受控）；父级维护"草稿 vs 已保存"两份状态时本组件
 *   只负责展示 + 实时编辑；这里采用更简单的"实时回调 + 显式保存"模型
 * - 抽屉高度用 vh 单位 + transform 过渡；拖动用 Pointer Events
 * - 底部固定 Save / Cancel / Delete 按钮
 *
 * 约束：
 * - C3 响应性：抽屉用 transform 平移（合成器友好）；表单滚动用原生 overflow
 * - C5 移动端独立：仅引用 src-mobile 内组件 + 共享类型
 */

import {
  Component,
  createMemo,
  createSignal,
  For,
  Show,
} from 'solid-js';
import type { BlueprintNode, NodeConfig } from '../../../src/lib/blueprint/types';
import { isNodeLocked } from './mobileNodeLayout';
import { MobileNodeConfigForm } from './MobileNodeConfigForms';
import { showToast } from '../Toast';

export interface MobileNodeConfigPanelProps {
  /** 当前选中的节点（null 时不显示抽屉） */
  node: BlueprintNode | null;
  /** 配置变更实时回调（每次按键都会触发） */
  onConfigChange: (nodeId: string, config: NodeConfig) => void;
  /** 保存按钮回调（父级持久化） */
  onSave: (nodeId: string) => void;
  /** 取消按钮回调（父级回滚草稿） */
  onCancel: (nodeId: string) => void;
  /** 删除节点回调（锁定节点不可删） */
  onDelete: (nodeId: string) => void;
}

// ─── 抽屉高度档位（vh 百分比）───

const HEIGHT_SNAPS = [40, 65, 90] as const;
const DEFAULT_HEIGHT = 65;

// ─── 组件 ───

export const MobileNodeConfigPanel: Component<MobileNodeConfigPanelProps> = (props) => {
  const [heightPct, setHeightPct] = createSignal<number>(DEFAULT_HEIGHT);
  const [dragState, setDragState] = createSignal<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);

  const isOpen = createMemo(() => props.node !== null);

  const snapToNearest = (h: number): number => {
    let best: number = HEIGHT_SNAPS[0];
    let bestDist = Math.abs(h - best);
    for (const snap of HEIGHT_SNAPS) {
      const d = Math.abs(h - snap);
      if (d < bestDist) {
        best = snap;
        bestDist = d;
      }
    }
    return best;
  };

  // ─── 抽屉头部拖动（调整高度）───

  const handleHandlePointerDown = (e: PointerEvent) => {
    if (!isOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    setDragState({
      pointerId: e.pointerId,
      startY: e.clientY,
      startHeight: heightPct(),
    });
    (e.currentTarget as SVGElement).setPointerCapture?.(e.pointerId);
  };

  const handleHandlePointerMove = (e: PointerEvent) => {
    const ds = dragState();
    if (!ds || ds.pointerId !== e.pointerId) return;
    const dy = e.clientY - ds.startY;
    // 向下拖 dy > 0 → 高度减小
    const vh = window.innerHeight;
    const newHeight = ds.startHeight - (dy / vh) * 100;
    const clamped = Math.max(20, Math.min(95, newHeight));
    setHeightPct(clamped);
  };

  const handleHandlePointerUp = (e: PointerEvent) => {
    const ds = dragState();
    if (!ds || ds.pointerId !== e.pointerId) return;
    (e.currentTarget as SVGElement).releasePointerCapture?.(e.pointerId);
    setHeightPct(snapToNearest(heightPct()));
    setDragState(null);
  };

  // ─── 删除按钮（锁定节点禁用）───

  const handleDelete = () => {
    const node = props.node;
    if (!node) return;
    if (isNodeLocked(node)) {
      showToast('锁定节点不可删除', 'warning');
      return;
    }
    if (node.type === 'start' || node.type === 'end') {
      showToast('Start / End 节点不可删除', 'warning');
      return;
    }
    props.onDelete(node.id);
  };

  // ─── 节点类型显示名 ───

  const nodeTypeLabel = (node: BlueprintNode): string => {
    switch (node.type) {
      case 'start': return 'Start（起点）';
      case 'end': return 'End（终点）';
      case 'prompt': return 'Prompt（提示词片段）';
      case 'schema_field': return 'SchemaField（schema 字段）';
      case 'mutex_gate': return 'MutexGate（互斥组 / 单选）';
      case 'group_gate': return 'GroupGate（多选组）';
      case 'mode_switch': return 'ModeSwitch（三模式分支）';
      case 'role_switch': return 'RoleSwitch（已废弃）';
      case 'constant': return 'Constant（常量）';
      case 'branch': return 'Branch（分支）';
      case 'sampling_params': return 'SamplingParams（legacy 采样参数）';
      case 'sampling_params_openai': return 'SamplingParams（OpenAI 版）';
      case 'sampling_params_anthropic': return 'SamplingParams（Anthropic 版）';
    }
  };

  const canDelete = (node: BlueprintNode): boolean => {
    if (isNodeLocked(node)) return false;
    if (node.type === 'start' || node.type === 'end') return false;
    return true;
  };

  // ─── 渲染 ───

  return (
    <Show when={props.node}>
      {(node) => (
        <div
          class="fixed inset-0 z-[1500] flex flex-col justify-end pointer-events-none"
          aria-modal="true"
          role="dialog"
        >
          {/* 半透明遮罩（点击关闭 = 取消） */}
          <div
            class="absolute inset-0 bg-black/40 backdrop-blur-[2px] pointer-events-auto transition-opacity duration-300"
            onClick={() => props.onCancel(node().id)}
          />

          {/* 抽屉主体 */}
          <div
            class="relative w-full bg-xuanqing rounded-t-3xl border-t border-white/10 shadow-2xl flex flex-col pointer-events-auto transition-transform duration-300 ease-out safe-area-bottom"
            style={{
              height: `${heightPct()}vh`,
              transform: isOpen() ? 'translateY(0)' : 'translateY(100%)',
            }}
          >
            {/* 拖动手柄 */}
            <div
              class="shrink-0 w-full flex flex-col items-center pt-2 pb-1 cursor-grab active:cursor-grabbing touch-none"
              onPointerDown={handleHandlePointerDown}
              onPointerMove={handleHandlePointerMove}
              onPointerUp={handleHandlePointerUp}
              onPointerCancel={handleHandlePointerUp}
            >
              <div class="w-12 h-1.5 bg-white/25 rounded-full mb-2" />
              <div class="w-full px-5 flex items-center justify-between">
                <div class="flex flex-col min-w-0 flex-1">
                  <span class="text-[11px] text-mist-solid/50 font-medium">{nodeTypeLabel(node())}</span>
                  <span class="text-[15px] text-white font-bold truncate">
                    {node().id}
                  </span>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  {/* 高度档位快捷按钮 */}
                  <For each={HEIGHT_SNAPS}>
                    {(snap) => (
                      <button
                        type="button"
                        onClick={() => setHeightPct(snap)}
                        class={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors ${
                          heightPct() === snap
                            ? 'bg-accent/20 text-accent'
                            : 'bg-white/5 text-mist-solid/50'
                        }`}
                      >
                        {snap}%
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </div>

            {/* 分隔线 */}
            <div class="h-px bg-white/5 shrink-0" />

            {/* 表单滚动区 */}
            <div class="flex-1 overflow-y-auto custom-scrollbar py-4 min-h-0">
              <MobileNodeConfigForm
                node={node()}
                onConfigChange={(config) => props.onConfigChange(node().id, config)}
              />
            </div>

            {/* 底部固定按钮栏 */}
            <div class="shrink-0 px-4 py-3 bg-xuanqing/95 backdrop-blur-md border-t border-white/5 flex items-center gap-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              <Show when={canDelete(node())}>
                <button
                  type="button"
                  onClick={handleDelete}
                  class="shrink-0 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/25 text-red-300 text-[13px] font-medium active:scale-95 transition-transform"
                >
                  删除
                </button>
              </Show>
              <button
                type="button"
                onClick={() => props.onCancel(node().id)}
                class="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-mist-solid/70 text-[14px] font-medium active:scale-[0.98] transition-transform"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => props.onSave(node().id)}
                class="flex-1 py-2.5 rounded-xl bg-accent border border-accent/30 text-white text-[14px] font-bold active:scale-[0.98] transition-transform shadow-[0_2px_12px_rgba(58,109,140,0.3)]"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

