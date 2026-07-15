/**
 * 移动端预设详情视图（spec 里程碑 C）。
 *
 * C5 移动端独立性：本组件与 PC 端 `src/components/PresetDetailView.tsx` 零代码
 * 耦合，独立实现移动端交互模式（触控友好的 chip / checkbox、safe-area 适配、
 * 移动端 header 样式）。
 *
 * "台前"视图：用户在此选择 Gate 选项，选择状态持久化到 `preset_gate_selections`
 * 表。蓝图编辑器作为"幕后"入口，通过 header 右侧"编辑蓝图"按钮进入。
 *
 * 数据流：
 * - `loadBlueprintGates(presetId)` → 渲染 Gate 选项区
 * - `loadPresetGateSelections(presetId)` → 回填已选状态
 * - 用户点击 → `updatePresetGateSelection` / `clearPresetGateSelection` 持久化
 */

import {
  Component,
  For,
  Show,
  createSignal,
  onMount,
} from 'solid-js';
import {
  type BlueprintGate,
  type PresetSummary,
  loadBlueprintGates,
  loadPresetGateSelections,
  updatePresetGateSelection,
  clearPresetGateSelection,
} from '../../../src/lib/backend';
import { showToast } from '../Toast';

// ─── Props ───

export interface MobilePresetDetailViewProps {
  preset: PresetSummary;
  onBack: () => void;
  onEditBlueprint: () => void;
}

// ─── 单个 Gate 选择器（互斥组单选 chip / 普通组多选 checkbox）───

const GateSelector: Component<{
  gate: BlueprintGate;
  selectedKeys: string[];
  onToggle: (key: string) => void;
}> = (props) => {
  const isSelected = (key: string): boolean => props.selectedKeys.includes(key);

  const handleMutexClick = (key: string) => {
    // 互斥组：点击已选项 → 取消选择（清空）；点击新项 → 替换
    if (isSelected(key)) {
      props.onToggle('__clear__');
    } else {
      props.onToggle(key);
    }
  };

  const handleGroupClick = (key: string) => {
    props.onToggle(key);
  };

  return (
    <div class="rounded-2xl bg-white/5 border border-white/10 p-3.5">
      {/* Gate 标题 */}
      <div class="flex items-center gap-2 mb-3">
        <div
          class={`shrink-0 w-1.5 h-1.5 rounded-full ${
            props.gate.kind === 'mutex' ? 'bg-amber-400' : 'bg-emerald-400'
          }`}
        />
        <h4 class="text-[14px] font-bold text-white flex-1 truncate">{props.gate.label}</h4>
        <span class="text-[10px] text-mist-solid/40 shrink-0">
          {props.gate.kind === 'mutex' ? '互斥单选' : '多选'}
        </span>
      </div>

      {/* 互斥组：chip 单选 */}
      <Show when={props.gate.kind === 'mutex'}>
        <div class="flex flex-wrap gap-2">
          <For each={props.gate.options}>
            {(opt) => {
              const selected = isSelected(opt.key);
              return (
                <button
                  type="button"
                  class={`px-3 py-2 rounded-full text-[12px] font-semibold transition-all active:scale-95 ${
                    selected
                      ? 'bg-amber-500/80 text-white border border-amber-400'
                      : 'bg-white/5 text-mist-solid/70 border border-white/10'
                  }`}
                  onClick={() => handleMutexClick(opt.key)}
                >
                  {opt.label}
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      {/* 普通组：checkbox 多选 */}
      <Show when={props.gate.kind === 'group'}>
        <div class="flex flex-col gap-2">
          <For each={props.gate.options}>
            {(opt) => {
              const selected = isSelected(opt.key);
              return (
                <button
                  type="button"
                  class="flex items-start gap-2.5 p-2.5 rounded-xl bg-white/3 border border-white/5 text-left active:scale-[0.99] transition-transform"
                  onClick={() => handleGroupClick(opt.key)}
                >
                  <div
                    class={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center mt-0.5 ${
                      selected
                        ? 'bg-emerald-500/80 border-emerald-400'
                        : 'border-white/20 bg-transparent'
                    }`}
                  >
                    <Show when={selected}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
                    </Show>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class={`text-[13px] font-semibold ${selected ? 'text-emerald-200' : 'text-mist-solid/80'}`}>
                      {opt.label}
                    </div>
                    <Show when={opt.description}>
                      <div class="text-[11px] text-mist-solid/40 mt-0.5 leading-relaxed">
                        {opt.description}
                      </div>
                    </Show>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </Show>

      {/* 互斥组选项的 description（chip 下方展开） */}
      <Show when={props.gate.kind === 'mutex'}>
        <div class="mt-2.5 flex flex-col gap-1.5">
          <For each={props.gate.options}>
            {(opt) => (
              <Show when={opt.description && isSelected(opt.key)}>
                <div class="text-[11px] text-mist-solid/45 leading-relaxed px-1">
                  {opt.description}
                </div>
              </Show>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};

// ─── 主组件 ───

export const MobilePresetDetailView: Component<MobilePresetDetailViewProps> = (props) => {
  const [gates, setGates] = createSignal<BlueprintGate[]>([]);
  const [selections, setSelections] = createSignal<Map<string, string[]>>(new Map());
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [updatingNodeId, setUpdatingNodeId] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const [gatesData, selectionsData] = await Promise.all([
        loadBlueprintGates(props.preset.id),
        loadPresetGateSelections(props.preset.id),
      ]);
      setGates(gatesData);
      const map = new Map<string, string[]>();
      for (const sel of selectionsData) {
        map.set(sel.nodeId, sel.selectedKeys);
      }
      setSelections(map);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  });

  const handleToggle = async (gate: BlueprintGate, key: string) => {
    const current = selections().get(gate.nodeId) ?? [];
    let next: string[];

    if (gate.kind === 'mutex') {
      // 互斥组：'__clear__' 表示清空，否则替换为单选
      next = key === '__clear__' ? [] : [key];
    } else {
      // 普通组：切换选中状态
      next = current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key];
    }

    // 乐观更新
    const prev = selections();
    const nextMap = new Map(prev);
    nextMap.set(gate.nodeId, next);
    setSelections(nextMap);

    setUpdatingNodeId(gate.nodeId);
    try {
      if (next.length === 0) {
        await clearPresetGateSelection(props.preset.id, gate.nodeId);
      } else {
        await updatePresetGateSelection(props.preset.id, gate.nodeId, next);
      }
    } catch (err) {
      // 回滚
      setSelections(prev);
      showToast(
        `更新选择失败：${err instanceof Error ? err.message : String(err)}`,
        'error',
        5000,
      );
    } finally {
      setUpdatingNodeId(null);
    }
  };

  return (
    <div class="h-full w-full flex flex-col bg-xuanqing">
      {/* Header */}
      <header class="shrink-0 h-14 flex items-center gap-2 px-4 bg-xuanqing/90 backdrop-blur-md border-b border-white/5 safe-area-top">
        <button
          onClick={props.onBack}
          class="shrink-0 p-2 text-mist-solid/70 hover:text-white transition-colors"
          aria-label="返回"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <h1 class="text-[15px] font-bold text-white flex-1 truncate">{props.preset.name}</h1>
        <button
          onClick={props.onEditBlueprint}
          class="shrink-0 px-3 py-1.5 rounded-lg bg-accent/15 text-accent text-[12px] font-semibold active:scale-95 transition-transform"
        >
          编辑蓝图
        </button>
      </header>

      {/* 主体 */}
      <div class="flex-1 overflow-y-auto custom-scrollbar px-4 py-4">
        {/* 预设元信息 */}
        <div class="mb-4 p-3 rounded-xl bg-white/3 border border-white/5">
          <div class="text-[12px] text-mist-solid/50 mb-1">{props.preset.category} · {props.preset.isBuiltin ? '内置' : '自定义'}</div>
          <Show when={props.preset.description}>
            <div class="text-[12px] text-mist-solid/60 leading-relaxed">{props.preset.description}</div>
          </Show>
        </div>

        {/* 加载状态 */}
        <Show when={loading()}>
          <div class="flex items-center justify-center py-12">
            <div class="text-[13px] text-mist-solid/50">加载预设配置…</div>
          </div>
        </Show>

        {/* 错误 */}
        <Show when={loadError()}>
          {(err) => (
            <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-[12px] text-red-200">
              加载预设配置失败：{err()}
            </div>
          )}
        </Show>

        {/* Gate 选择区 */}
        <Show when={!loading() && !loadError()}>
          <Show
            when={gates().length > 0}
            fallback={
              <div class="py-12 text-center">
                <div class="text-[13px] text-mist-solid/40 mb-2">该预设蓝图没有可配置的 Gate 选项</div>
                <div class="text-[11px] text-mist-solid/30">点击右上角"编辑蓝图"添加 MutexGate / GroupGate 节点</div>
              </div>
            }
          >
            <h3 class="text-[12px] font-bold text-mist-solid/60 mb-2.5 px-1">Gate 选项配置</h3>
            <div class="flex flex-col gap-3">
              <For each={gates()}>
                {(gate) => (
                  <div class="relative">
                    <GateSelector
                      gate={gate}
                      selectedKeys={selections().get(gate.nodeId) ?? []}
                      onToggle={(key) => void handleToggle(gate, key)}
                    />
                    <Show when={updatingNodeId() === gate.nodeId}>
                      <div class="absolute inset-0 rounded-2xl bg-xuanqing/30 backdrop-blur-[1px] flex items-center justify-center">
                        <div class="text-[11px] text-mist-solid/60 animate-pulse">保存中…</div>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};
