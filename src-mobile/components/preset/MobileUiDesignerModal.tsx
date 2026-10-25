/**
 * 移动端 UI 设计器弹窗（Task 08）。
 *
 * C5 移动端独立性：位于 src-mobile/components/preset/，零 PC 端 UI 耦合。
 * 管理当前预设下的常驻 HUD 布局（容器嵌套、控件数据绑定、样式与实时预览）。
 */

import { Component, For, Show, createEffect, createResource, createSignal } from 'solid-js';
import type {
  LayoutContainer,
  LayoutMountType,
  LayoutNode,
  UILayoutDefinition,
  WidgetDefinition,
  WidgetType,
} from '../../../src/lib/backend/types';
import {
  presetUiLayoutActivate,
  presetUiLayoutDelete,
  presetUiLayoutList,
  presetUiLayoutSave,
} from '../../../src/lib/backend/ui_layout';
import { presetSchemasList } from '../../../src/lib/backend/schema';
import { MobileLayoutTree, type MobileHudSnapshot } from '../MobileLayoutTree';
import { showToast } from '../Toast';

export interface MobileUiDesignerModalProps {
  isOpen: boolean;
  presetId: number;
  sessionId?: number;
  onClose: () => void;
}

const MOUNT_TYPES: Array<{ value: LayoutMountType; label: string }> = [
  { value: 'mobileDrawer', label: '移动端: 顶部吸顶抽屉 (mobileDrawer)' },
  { value: 'mobileBottomSticky', label: '移动端: 底部微型条 (mobileBottomSticky)' },
  { value: 'rightDock', label: 'PC: 右侧固定仪表盘 (rightDock)' },
  { value: 'topSticky', label: 'PC: 顶部吸顶折叠栏 (topSticky)' },
  { value: 'floatingHUD', label: '自由浮动画中画 (floatingHUD)' },
];

const WIDGET_TYPES: Array<{ value: WidgetType; label: string }> = [
  { value: 'statBar', label: '数值进度条 (StatBar)' },
  { value: 'dataLabel', label: '数据标签 (DataLabel)' },
  { value: 'inventorySlotGrid', label: '背包网格 (InventorySlotGrid)' },
  { value: 'badge', label: '徽标 (Badge)' },
  { value: 'avatarFrame', label: '形象框 (AvatarFrame)' },
  { value: 'actionButton', label: '动作按钮 (ActionButton)' },
];

const PREVIEW_SNAPSHOT: MobileHudSnapshot = {
  stats: { hp: 85, max_hp: 100, gold: 260, sanity: 70 },
  inventory: [
    { id: 'item_1', name: '急救包', count: 3 },
    { id: 'item_2', name: '通讯器', count: 1 },
  ],
  flags: { status: '正常' },
  schemaPatches: { thinking: '分析当前环境中…' },
};

let uid = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(uid += 1)}`;

export const MobileUiDesignerModal: Component<MobileUiDesignerModalProps> = (props) => {
  const [layouts, setLayouts] = createSignal<UILayoutDefinition[]>([]);
  const [current, setCurrent] = createSignal<UILayoutDefinition | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [activeTab, setActiveTab] = createSignal<'designer' | 'preview'>('designer');
  const [selectedWidgetType, setSelectedWidgetType] = createSignal<WidgetType>('statBar');

  const [schemaOptions] = createResource(
    () => props.presetId,
    async (presetId) => {
      try {
        return await presetSchemasList(presetId);
      } catch {
        return [];
      }
    },
  );

  const refresh = async () => {
    setBusy(true);
    try {
      const list = await presetUiLayoutList(props.presetId);
      setLayouts(list);
      if (list.length > 0 && !current()) {
        setCurrent(list[0]);
      } else if (list.length === 0) {
        newLayout();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`读取布局列表失败：${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  createEffect(() => {
    if (props.isOpen) {
      void refresh();
    }
  });

  const newLayout = () => {
    setCurrent({
      id: '',
      presetId: props.presetId,
      name: '新移动端 HUD 布局',
      mountType: 'mobileDrawer',
      theme: 'xuanqing',
      customCss: '',
      rootContainer: {
        id: nextId('root'),
        kind: 'rootCanvas',
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        style: {},
        children: [
          {
            nodeType: 'widget',
            id: nextId('widget'),
            widgetType: 'statBar',
            label: '生命值',
            dataBinding: 'stats.hp',
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            config: { bar_color: '#ef4444', max_stat: 'stats.max_hp' },
            style: {},
          },
          {
            nodeType: 'widget',
            id: nextId('widget'),
            widgetType: 'dataLabel',
            label: '金币',
            dataBinding: 'stats.gold',
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            config: {},
            style: {},
          },
        ],
      },
    });
  };

  const patchCurrent = (updates: Partial<UILayoutDefinition>) => {
    const base = current();
    if (!base) return;
    setCurrent({ ...base, ...updates });
  };

  const patchRoot = (updates: Partial<LayoutContainer>) => {
    const base = current();
    if (!base) return;
    setCurrent({ ...base, rootContainer: { ...base.rootContainer, ...updates } });
  };

  const patchChildren = (children: LayoutNode[]) => patchRoot({ children });

  const addWidget = (widgetType: WidgetType) => {
    const base = current();
    if (!base) return;
    const label = WIDGET_TYPES.find((w) => w.value === widgetType)?.label || widgetType;
    const newNode: LayoutNode = {
      nodeType: 'widget',
      id: nextId('widget'),
      widgetType,
      label,
      dataBinding: widgetType === 'inventorySlotGrid' ? 'inventory' : 'stats.hp',
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      config:
        widgetType === 'inventorySlotGrid'
          ? { columns: 4 }
          : widgetType === 'actionButton'
            ? { command: '', args_template: {}, result_schema_id: '' }
            : {},
      style: {},
    } as LayoutNode;

    patchChildren([...(base.rootContainer.children ?? []), newNode]);
  };

  const addContainer = (kind: 'panel' | 'tabs' | 'grid' = 'panel') => {
    const base = current();
    if (!base) return;
    const newNode: LayoutNode = {
      nodeType: 'container',
      id: nextId(kind),
      kind,
      layoutMode: kind === 'grid' ? 'grid' : 'flex',
      x: 0,
      y: 0,
      width: 280,
      height: 100,
      style: kind === 'grid' ? { columns: '2' } : {},
      children: [],
    } as LayoutNode;

    patchChildren([...(base.rootContainer.children ?? []), newNode]);
  };

  const appendChildInto = (containerIndex: number, newNode: LayoutNode) => {
    patchChild(containerIndex, (node) => {
      if (node.nodeType !== 'container') return node;
      const container = node as LayoutContainer;
      return {
        ...container,
        nodeType: 'container',
        children: [...(container.children ?? []), newNode],
      };
    });
  };

  const removeNestedChild = (containerIndex: number, childIndex: number) => {
    patchChild(containerIndex, (node) => {
      if (node.nodeType !== 'container') return node;
      const container = node as LayoutContainer;
      return {
        ...container,
        nodeType: 'container',
        children: (container.children ?? []).filter((_, i) => i !== childIndex),
      };
    });
  };

  const patchNestedChild = (
    containerIndex: number,
    childIndex: number,
    updater: (node: LayoutNode) => LayoutNode,
  ) => {
    patchChild(containerIndex, (node) => {
      if (node.nodeType !== 'container') return node;
      const container = node as LayoutContainer;
      const children = (container.children ?? []).slice();
      children[childIndex] = updater(children[childIndex]);
      return {
        ...container,
        nodeType: 'container',
        children,
      };
    });
  };

  const patchChild = (index: number, updater: (node: LayoutNode) => LayoutNode) => {
    const base = current();
    if (!base) return;
    const next = (base.rootContainer.children ?? []).slice();
    next[index] = updater(next[index]);
    patchChildren(next);
  };

  const removeChild = (index: number) => {
    const base = current();
    if (!base) return;
    patchChildren((base.rootContainer.children ?? []).filter((_, i) => i !== index));
  };

  const save = async () => {
    const base = current();
    if (!base) return;
    if (!base.name.trim()) {
      showToast('布局名称不能为空', 'warning');
      return;
    }
    setBusy(true);
    try {
      const saved = await presetUiLayoutSave(base);
      setCurrent(saved);
      await refresh();
      showToast(`已保存布局：${saved.name}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`保存失败：${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const base = current();
    if (!base) return;
    if (!confirm(`确定删除布局「${base.name}」吗？`)) return;
    if (!base.id) {
      setCurrent(null);
      return;
    }
    setBusy(true);
    try {
      await presetUiLayoutDelete(base.id);
      showToast('布局已删除', 'success');
      setCurrent(null);
      await refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`删除失败：${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const bindToSession = async () => {
    const base = current();
    if (!base || !base.id) {
      showToast('请先保存布局，再绑定到会话', 'warning');
      return;
    }
    if (props.sessionId == null) {
      showToast('当前没有选中的会话', 'warning');
      return;
    }
    setBusy(true);
    try {
      await presetUiLayoutActivate(props.sessionId, base.id);
      showToast(`已绑定到会话 #${props.sessionId}`, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showToast(`绑定失败：${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex flex-col bg-xuanqing text-mist-solid safe-area-top safe-area-bottom animate-in fade-in duration-200">
        {/* Header */}
        <header class="shrink-0 h-14 flex items-center justify-between px-4 bg-xuanqing/90 backdrop-blur-md border-b border-white/5">
          <div class="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={props.onClose}
              class="p-2 text-mist-solid/70 hover:text-white transition-colors"
              aria-label="关闭"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            </button>
            <div class="flex items-center gap-1.5 min-w-0">
              <h2 class="text-[15px] font-bold text-white truncate">UI 设计器 · 常驻 HUD</h2>
              <span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                预设 #{props.presetId}
              </span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <Show when={props.sessionId != null && current()?.id}>
              <button
                type="button"
                onClick={bindToSession}
                disabled={busy()}
                class="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-xs font-semibold active:scale-95 transition-transform"
              >
                绑定会话
              </button>
            </Show>
            <button
              type="button"
              onClick={save}
              disabled={busy() || !current()}
              class="px-4 py-1.5 rounded-lg bg-accent text-white font-semibold text-[13px] active:scale-95 transition-transform disabled:opacity-40"
            >
              {busy() ? '保存中…' : '保存'}
            </button>
          </div>
        </header>

        {/* 布局选择药丸条 */}
        <div class="shrink-0 px-4 py-2.5 border-b border-white/5 bg-white/[0.02] flex items-center gap-2 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={newLayout}
            class="shrink-0 px-3 py-1.5 rounded-xl border border-dashed border-purple-400/40 text-purple-300 text-xs font-semibold active:scale-95 transition-transform"
          >
            + 新建布局
          </button>
          <For each={layouts()}>
            {(lay) => (
              <button
                type="button"
                onClick={() => setCurrent(lay)}
                class={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  current()?.id === lay.id
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                    : 'bg-white/5 text-mist-solid/70 border border-white/10'
                }`}
              >
                {lay.name}
              </button>
            )}
          </For>
        </div>

        {/* 设计 vs 预览 切换分段控制 */}
        <div class="shrink-0 px-4 pt-3 pb-1 flex items-center justify-center">
          <div class="flex rounded-xl bg-white/5 border border-white/10 p-1 w-full max-w-xs">
            <button
              type="button"
              onClick={() => setActiveTab('designer')}
              class={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab() === 'designer' ? 'bg-accent text-white shadow' : 'text-mist-solid/60'
              }`}
            >
              控件与设计
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              class={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab() === 'preview' ? 'bg-accent text-white shadow' : 'text-mist-solid/60'
              }`}
            >
              实时预览
            </button>
          </div>
        </div>

        {/* 主体区 */}
        <div class="flex-1 overflow-y-auto px-4 py-3 space-y-4 custom-scrollbar">
          <Show
            when={activeTab() === 'designer'}
            fallback={
              <div class="space-y-4">
                <div class="p-3 rounded-xl bg-white/5 border border-white/10 text-xs text-mist-solid/60">
                  使用模拟快照数据进行实时渲染预览（数值不伪造，未命中绑定将显式报错）：
                </div>
                <Show when={current()}>
                  {(lay) => {
                    const reqStats = Object.keys(lay().requiredDataInterface?.requiredStats ?? {});
                    const reqFlags = lay().requiredDataInterface?.requiredFlags ?? [];
                    const reqInv = lay().requiredDataInterface?.requiredInventory ?? false;
                    return (
                      <div class="p-3 rounded-xl bg-white/5 border border-white/10 text-xs space-y-1">
                        <div class="text-[11px] font-bold text-purple-300 uppercase tracking-wider mb-1">
                          导出的数据契约 (RequiredDataInterface)
                        </div>
                        <div class="text-mist-solid/70">必需数值: <span class="text-accent">{reqStats.length > 0 ? reqStats.join(', ') : '无'}</span></div>
                        <div class="text-mist-solid/70">必需标志: <span class="text-purple-300">{reqFlags.length > 0 ? reqFlags.join(', ') : '无'}</span></div>
                        <div class="text-mist-solid/70">背包依赖: <span class="text-amber-300">{reqInv ? '是 (需槽位)' : '否'}</span></div>
                      </div>
                    );
                  }}
                </Show>
                <Show when={current()}>
                  {(lay) => (
                    <div class="p-4 rounded-2xl border border-white/10 bg-black/40 overflow-x-auto min-h-[220px]">
                      <MobileLayoutTree
                        node={lay().rootContainer}
                        snapshot={PREVIEW_SNAPSHOT}
                        isDesignPreview={true}
                      />
                    </div>
                  )}
                </Show>
              </div>
            }
          >
            <Show when={current()}>
              {(lay) => (
                <div class="space-y-4">
                  {/* 基础配置 */}
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                    <h3 class="text-xs font-bold text-purple-400 tracking-wider uppercase">布局属性</h3>
                    <div>
                      <label class="text-[12px] font-semibold text-mist-solid/80 block mb-1">布局名称</label>
                      <input
                        type="text"
                        value={lay().name}
                        onInput={(e) => patchCurrent({ name: e.currentTarget.value })}
                        placeholder="如 极简移动端状态条"
                        class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:border-accent"
                      />
                    </div>

                    <div>
                      <label class="text-[12px] font-semibold text-mist-solid/80 block mb-1">挂载位置 (mountType)</label>
                      <select
                        value={lay().mountType}
                        onChange={(e) => patchCurrent({ mountType: e.currentTarget.value as LayoutMountType })}
                        class="w-full px-3 py-2 rounded-xl bg-xuanqing border border-white/10 text-xs text-white"
                      >
                        <For each={MOUNT_TYPES}>
                          {(opt) => <option value={opt.value}>{opt.label}</option>}
                        </For>
                      </select>
                    </div>

                    <div>
                      <label class="text-[12px] font-semibold text-mist-solid/80 block mb-1">自定义 CSS</label>
                      <textarea
                        value={lay().customCss || ''}
                        onInput={(e) => patchCurrent({ customCss: e.currentTarget.value })}
                        placeholder="注入到 HUD 根容器的额外 CSS…"
                        rows={2}
                        class="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-mono text-white focus:outline-none focus:border-accent"
                      />
                    </div>
                  </div>

                  {/* 控件添加控制栏 */}
                  <div class="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
                    <h3 class="text-xs font-bold text-purple-400 tracking-wider uppercase">添加控件与容器</h3>
                    <div class="flex items-center gap-2">
                      <select
                        value={selectedWidgetType()}
                        onChange={(e) => setSelectedWidgetType(e.currentTarget.value as WidgetType)}
                        class="flex-1 px-3 py-2 rounded-xl bg-xuanqing border border-white/10 text-xs text-white"
                      >
                        <For each={WIDGET_TYPES}>
                          {(opt) => <option value={opt.value}>{opt.label}</option>}
                        </For>
                      </select>
                      <button
                        type="button"
                        onClick={() => addWidget(selectedWidgetType())}
                        class="px-3.5 py-2 rounded-xl bg-accent text-white text-xs font-semibold shrink-0 active:scale-95 transition-transform"
                      >
                        + 添加控件
                      </button>
                    </div>
                    <div class="flex items-center gap-2 pt-1 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => addContainer('panel')}
                        class="flex-1 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-mist-solid hover:text-white"
                      >
                        + 面板 Panel
                      </button>
                      <button
                        type="button"
                        onClick={() => addContainer('grid')}
                        class="flex-1 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-mist-solid hover:text-white"
                      >
                        + 网格 Grid
                      </button>
                    </div>
                  </div>

                  {/* 控件树列表 */}
                  <div class="space-y-3">
                    <div class="flex items-center justify-between px-1">
                      <h3 class="text-xs font-bold text-purple-400 tracking-wider uppercase">
                        根容器子项 ({(lay().rootContainer.children ?? []).length})
                      </h3>
                    </div>

                    <For each={lay().rootContainer.children ?? []}>
                      {(child, idx) => (
                        <div class="rounded-2xl border border-white/10 bg-white/5 p-3.5 space-y-2.5">
                          <div class="flex items-center justify-between">
                            <span class="text-xs font-mono font-bold text-emerald-400">
                              #{idx() + 1} {child.nodeType === 'widget' ? (child as WidgetDefinition).widgetType : (child as LayoutContainer).kind}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeChild(idx())}
                              class="text-mist-solid/40 hover:text-rose-400 text-xs px-1.5 py-0.5 rounded bg-white/5"
                            >
                              删除
                            </button>
                          </div>

                          <Show when={child.nodeType === 'widget'}>
                            {(() => {
                              const widget = child as WidgetDefinition;
                              return (
                                <div class="space-y-2">
                                  <div class="grid grid-cols-2 gap-2">
                                    <div>
                                      <label class="text-[11px] text-mist-solid/50 block mb-1">标题/标签</label>
                                      <input
                                        type="text"
                                        value={widget.label || ''}
                                        onInput={(e) =>
                                          patchChild(idx(), (w) => ({
                                            ...(w as WidgetDefinition),
                                            label: e.currentTarget.value,
                                          }))
                                        }
                                        class="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white"
                                      />
                                    </div>
                                    <div>
                                      <label class="text-[11px] text-mist-solid/50 block mb-1">数据绑定路径</label>
                                      <input
                                        type="text"
                                        value={widget.dataBinding || ''}
                                        onInput={(e) =>
                                          patchChild(idx(), (w) => ({
                                            ...(w as WidgetDefinition),
                                            dataBinding: e.currentTarget.value,
                                          }))
                                        }
                                        placeholder="如 stats.hp 或 inventory"
                                        class="w-full px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white font-mono"
                                      />
                                    </div>
                                  </div>

                                  <Show when={widget.widgetType === 'actionButton'}>
                                    <div class="pt-1 border-t border-white/5 grid grid-cols-2 gap-2">
                                      <div>
                                        <label class="text-[11px] text-mist-solid/50 block mb-1">白名单命令</label>
                                        <input
                                          type="text"
                                          value={(widget.config as any)?.command || ''}
                                          onInput={(e) =>
                                            patchChild(idx(), (w) => ({
                                              ...(w as WidgetDefinition),
                                              config: { ...(w as WidgetDefinition).config, command: e.currentTarget.value },
                                            }))
                                          }
                                          placeholder="如 query_item"
                                          class="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-white"
                                        />
                                      </div>
                                      <div>
                                        <label class="text-[11px] text-mist-solid/50 block mb-1">结果渲染 Schema</label>
                                        <select
                                          value={(widget.config as any)?.result_schema_id || ''}
                                          onChange={(e) =>
                                            patchChild(idx(), (w) => ({
                                              ...(w as WidgetDefinition),
                                              config: { ...(w as WidgetDefinition).config, result_schema_id: e.currentTarget.value },
                                            }))
                                          }
                                          class="w-full px-2 py-1 rounded bg-xuanqing border border-white/10 text-xs text-white"
                                        >
                                          <option value="">(默认行内消息)</option>
                                          <For each={schemaOptions() ?? []}>
                                            {(s) => <option value={s.id}>{s.name}</option>}
                                          </For>
                                        </select>
                                      </div>
                                    </div>
                                  </Show>
                                </div>
                              );
                            })()}
                          </Show>

                          <Show when={child.nodeType === 'container'}>
                            <div class="space-y-2 pt-2 border-t border-white/5">
                              <div class="flex items-center justify-between">
                                <span class="text-[11px] font-semibold text-accent">
                                  嵌套元素 ({((child as LayoutContainer).children ?? []).length})
                                </span>
                                <div class="flex gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => appendChildInto(idx(), { nodeType: 'widget', id: nextId('widget'), widgetType: 'dataLabel', label: '数据标签', dataBinding: 'stats.hp', config: {}, style: {} } as LayoutNode)}
                                    class="px-2 py-0.5 rounded bg-accent/20 text-accent text-[11px] font-medium"
                                  >
                                    + 控件
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => appendChildInto(idx(), { nodeType: 'container', id: nextId('panel'), kind: 'panel', layoutMode: 'flex', x: 0, y: 0, width: 280, height: 80, style: {}, children: [] } as LayoutNode)}
                                    class="px-2 py-0.5 rounded bg-white/10 text-mist-solid text-[11px]"
                                  >
                                    + 容器
                                  </button>
                                </div>
                              </div>

                              <For each={(child as LayoutContainer).children ?? []}>
                                {(nested, nestedIdx) => (
                                  <div class="p-2.5 rounded-xl border border-white/5 bg-black/20 space-y-2">
                                    <div class="flex items-center justify-between text-xs">
                                      <span class="font-mono text-emerald-400 font-semibold text-[11px]">
                                        #{nestedIdx() + 1} {nested.nodeType === 'widget' ? (nested as WidgetDefinition).widgetType : (nested as LayoutContainer).kind}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => removeNestedChild(idx(), nestedIdx())}
                                        class="text-rose-400 hover:text-rose-300 text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10"
                                      >
                                        删除
                                      </button>
                                    </div>
                                    <Show when={nested.nodeType === 'widget'}>
                                      {(() => {
                                        const w = nested as WidgetDefinition;
                                        return (
                                          <div class="grid grid-cols-2 gap-2 text-xs">
                                            <div>
                                              <label class="text-[10px] text-mist-solid/50 block mb-0.5">标签</label>
                                              <input
                                                type="text"
                                                value={w.label || ''}
                                                onInput={(e) => patchNestedChild(idx(), nestedIdx(), (n) => ({ ...(n as WidgetDefinition), label: e.currentTarget.value, nodeType: 'widget' }))}
                                                class="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-white"
                                              />
                                            </div>
                                            <div>
                                              <label class="text-[10px] text-mist-solid/50 block mb-0.5">数据绑定</label>
                                              <input
                                                type="text"
                                                value={w.dataBinding || ''}
                                                onInput={(e) => patchNestedChild(idx(), nestedIdx(), (n) => ({ ...(n as WidgetDefinition), dataBinding: e.currentTarget.value, nodeType: 'widget' }))}
                                                placeholder="如 stats.hp"
                                                class="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-xs text-white font-mono"
                                              />
                                            </div>
                                          </div>
                                        );
                                      })()}
                                    </Show>
                                  </div>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                      )}
                    </For>

                    <Show when={(lay().rootContainer.children ?? []).length === 0}>
                      <div class="py-10 text-center rounded-2xl border border-dashed border-white/10 p-6 space-y-1">
                        <div class="text-xs text-mist-solid/50">布局容器尚无控件</div>
                        <div class="text-[11px] text-mist-solid/30">点击上方按钮添加进度条、背包网格或动作按钮</div>
                      </div>
                    </Show>
                  </div>

                  {/* 删除按钮 */}
                  <Show when={lay().id}>
                    <div class="pt-4 pb-8 flex justify-center">
                      <button
                        type="button"
                        onClick={remove}
                        class="px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-semibold active:scale-95 transition-transform"
                      >
                        删除此布局
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </Show>
        </div>
      </div>
    </Show>
  );
};
