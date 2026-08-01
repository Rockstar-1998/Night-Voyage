/**
 * 预设详情视图（PC 端，spec 里程碑 C）。
 *
 * "台前"视图：用户在此选择 Gate 选项（互斥组单选 chip / 普通组多选 checkbox），
 * 选择状态持久化到 `preset_gate_selections` 表（预设级存储）。蓝图编辑器作为
 * "幕后"入口，通过本视图右上角的"编辑蓝图"按钮进入。
 *
 * 数据流：
 * - `loadBlueprintGates(presetId)` → 渲染 Gate 选项区
 * - `loadPresetGateSelections(presetId)` → 回填已选状态
 * - 用户点击 → `updatePresetGateSelection` / `clearPresetGateSelection` 持久化
 *
 * 设计要点：
 * - 受控组件：父级传入 `presetId` / `onBack` / `onEditBlueprint`
 * - 细粒度响应式：每个 Gate 是独立的小组件，选择变更只更新该 Gate 的本地信号
 * - C2 零回退：加载/更新失败显式 toast，不静默跳过
 * - C3 响应性：选项点击只触发单条 IPC 调用 + 本地信号 patch
 */

import { Component, For, Show, createMemo, createSignal, onMount } from 'solid-js';
import {
  type BlueprintGate,
  type BlueprintGateOption,
  type PresetGateSelection,
  type PresetSummary,
  loadBlueprintGates,
  loadPresetGateSelections,
  updatePresetGateSelection,
  clearPresetGateSelection,
} from '../lib/backend';
import { showToast } from './Toast';

// ─── Props ───

export interface PresetDetailViewProps {
  preset: PresetSummary;
  onBack: () => void;
  onEditBlueprint: () => void;
  onExport?: () => void;
}

// ─── 单个 Gate 选择器 ───

interface GateSelectorProps {
  presetId: number;
  gate: BlueprintGate;
  initialSelected: string[];
}

/**
 * 单个 Gate 的选择 UI。互斥组单选 chip，普通组多选 checkbox。
 *
 * 选择变更立即持久化（乐观更新：先改本地信号，再发 IPC；失败时 toast 并回滚）。
 */
const GateSelector: Component<GateSelectorProps> = (props) => {
  const [selected, setSelected] = createSignal<string[]>(props.initialSelected);
  const [pending, setPending] = createSignal(false);

  const isSelected = (key: string) => selected().includes(key);

  /**
   * 互斥组点击逻辑：点击已选项 = 清空选择；点击未选项 = 替换为该选项。
   * 普通组点击逻辑：切换该选项的选中状态。
   */
  const handleToggle = async (option: BlueprintGateOption) => {
    if (pending()) return;
    const prevSelected = selected();
    let nextSelected: string[];
    if (props.gate.kind === 'mutex') {
      nextSelected = prevSelected.includes(option.key) ? [] : [option.key];
    } else {
      nextSelected = prevSelected.includes(option.key)
        ? prevSelected.filter((k) => k !== option.key)
        : [...prevSelected, option.key];
    }
    setSelected(nextSelected);
    setPending(true);
    try {
      if (nextSelected.length === 0) {
        await clearPresetGateSelection(props.presetId, props.gate.nodeId);
      } else {
        await updatePresetGateSelection(props.presetId, props.gate.nodeId, nextSelected);
      }
    } catch (err) {
      // 回滚乐观更新
      setSelected(prevSelected);
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`保存选择失败：${msg}`, 'error');
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="rounded-xl border border-white/5 bg-night-water/30 p-4">
      <div class="flex items-baseline justify-between mb-3">
        <div class="flex items-baseline gap-2 min-w-0">
          <h4 class="text-sm font-bold text-mist-solid truncate">{props.gate.label}</h4>
          <span
            class={`shrink-0 text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full border ${
              props.gate.kind === 'mutex'
                ? 'text-orange-300/80 border-orange-500/30 bg-orange-500/10'
                : 'text-yellow-300/80 border-yellow-500/30 bg-yellow-500/10'
            }`}
          >
            {props.gate.kind === 'mutex' ? '单选' : '多选'}
          </span>
        </div>
        <Show when={pending()}>
          <span class="text-[10px] text-accent/70 animate-pulse">保存中…</span>
        </Show>
      </div>
      <Show
        when={props.gate.kind === 'mutex'}
        fallback={
          // 普通组：checkbox 列表
          <div class="flex flex-col gap-1.5">
            <For each={props.gate.options}>
              {(opt) => {
                const checked = createMemo(() => isSelected(opt.key));
                return (
                  <label class="flex items-start gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={checked()}
                      onChange={() => void handleToggle(opt)}
                      class="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/5 text-accent focus:ring-1 focus:ring-accent/40"
                    />
                    <div class="flex-1 min-w-0">
                      <div class="text-sm text-mist-solid">{opt.label}</div>
                      <Show when={opt.description}>
                        <div class="text-[11px] text-mist-solid/45 mt-0.5 leading-relaxed">
                          {opt.description}
                        </div>
                      </Show>
                    </div>
                  </label>
                );
              }}
            </For>
          </div>
        }
      >
        {/* 互斥组：chip 单选 */}
        <div class="flex flex-wrap gap-1.5">
          <For each={props.gate.options}>
            {(opt) => {
              const active = createMemo(() => isSelected(opt.key));
              return (
                <button
                  type="button"
                  class={`px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                    active()
                      ? 'bg-accent/25 border-accent/60 text-accent'
                      : 'bg-white/5 border-white/10 text-mist-solid/70 hover:bg-white/10 hover:text-mist-solid'
                  }`}
                  onClick={() => void handleToggle(opt)}
                  title={opt.description ?? undefined}
                >
                  {opt.label}
                </button>
              );
            }}
          </For>
        </div>
      </Show>
      <Show when={props.gate.options.length === 0}>
        <div class="text-[11px] text-mist-solid/40 italic">该 Gate 未定义任何选项</div>
      </Show>
    </div>
  );
};

// ─── 主组件 ───

export const PresetDetailView: Component<PresetDetailViewProps> = (props) => {
  const [gates, setGates] = createSignal<BlueprintGate[]>([]);
  const [selections, setSelections] = createSignal<PresetGateSelection[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  const refreshAll = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [gateList, selList] = await Promise.all([
        loadBlueprintGates(props.preset.id),
        loadPresetGateSelections(props.preset.id),
      ]);
      setGates(gateList);
      setSelections(selList);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
      showToast(`加载预设 Gate 失败：${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    void refreshAll();
  });

  const selectionFor = (nodeId: string): string[] => {
    const found = selections().find((s) => s.nodeId === nodeId);
    return found ? found.selectedKeys : [];
  };

  return (
    <div class="flex flex-col h-full w-full bg-transparent">
      {/* 顶部栏 */}
      <div class="px-8 pt-12 pb-3 flex items-center justify-between gap-3 border-b border-white/5">
        <div class="flex items-center gap-3 min-w-0">
          <button
            type="button"
            class="shrink-0 p-1.5 rounded-lg text-mist-solid/60 hover:text-mist-solid hover:bg-white/5 transition-colors"
            onClick={props.onBack}
            aria-label="返回预设列表"
            title="返回预设列表"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <div class="flex flex-col min-w-0">
            <span class="text-[10px] uppercase tracking-widest text-mist-solid/40">预设详情</span>
            <h1 class="text-lg font-bold text-mist-solid truncate">{props.preset.name}</h1>
          </div>
          <Show when={props.preset.blueprintGraph}>
            <span class="shrink-0 text-[9px] uppercase tracking-widest text-emerald-300/70 border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 rounded-full">
              蓝图
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <Show when={props.onExport}>
            <button
              type="button"
              class="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-mist-solid/80 border border-white/10 transition-colors flex items-center gap-1.5"
              onClick={props.onExport}
              title="导出预设文件 (.nvpreset.json)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/></svg>
              导出预设
            </button>
          </Show>
          <button
            type="button"
            class="shrink-0 px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-mist-solid/80 border border-white/10 transition-colors flex items-center gap-1.5"
            onClick={props.onEditBlueprint}
            title="打开蓝图编辑器（幕后）"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21v-4a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v4"/><path d="M7 8 12 3l5 5"/><path d="M12 3v12"/></svg>
            编辑蓝图
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div class="flex-1 overflow-auto px-8 py-6">
        <Show when={loading()}>
          <div class="flex items-center justify-center py-12">
            <div class="text-sm text-mist-solid/50 animate-pulse">加载 Gate 选项中…</div>
          </div>
        </Show>

        <Show when={!loading() && loadError()}>
          {(err) => (
            <div class="max-w-2xl mx-auto p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-200">
              加载失败：{err()}
              <button
                type="button"
                class="ml-3 px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-100 text-xs"
                onClick={() => void refreshAll()}
              >
                重试
              </button>
            </div>
          )}
        </Show>

        <Show when={!loading() && !loadError()}>
          <div class="max-w-3xl mx-auto flex flex-col gap-4">
            <Show
              when={gates().length > 0}
              fallback={
                <div class="flex flex-col items-center justify-center py-16 gap-2 text-center">
                  <div class="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-mist-solid/30">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                  </div>
                  <div class="text-sm text-mist-solid/50">该预设蓝图未定义可选项</div>
                  <div class="text-[11px] text-mist-solid/35">在蓝图编辑器中添加 MutexGate / GroupGate 节点即可在此选择</div>
                </div>
              }
            >
              <div class="px-1">
                <h2 class="text-xs uppercase tracking-widest text-mist-solid/40 mb-1">Gate 选项</h2>
                <p class="text-[11px] text-mist-solid/35">选择启用哪些选项。所有使用该预设的会话共享此配置。</p>
              </div>
              <For each={gates()}>
                {(gate) => (
                  <GateSelector
                    presetId={props.preset.id}
                    gate={gate}
                    initialSelected={selectionFor(gate.nodeId)}
                  />
                )}
              </For>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
};
