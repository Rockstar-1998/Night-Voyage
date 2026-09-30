import { Component, For, Show, createSignal } from 'solid-js';
import type {
  LayoutContainer,
  LayoutMountType,
  LayoutNode,
  UILayoutDefinition,
  WidgetDefinition,
  WidgetType,
} from '../../lib/backend/types';
import {
  presetUiLayoutActivate,
  presetUiLayoutDelete,
  presetUiLayoutList,
  presetUiLayoutSave,
} from '../../lib/backend/ui_layout';
import { LayoutTreeNode } from '../hud/LayoutTreeNode';
import type { HudSnapshot } from '../../lib/hud/layoutBinding';

interface UiDesignerModalProps {
  isOpen: boolean;
  presetId: number;
  /** 当前会话 id：提供后可把布局一键绑定到该会话。 */
  sessionId?: number;
  /** 预览用真实快照；未提供时预览显示绑定状态徽标（不伪造数值，C11）。 */
  snapshot?: HudSnapshot;
  onClose: () => void;
}

const EMPTY_SNAPSHOT: HudSnapshot = { stats: {}, inventory: [], flags: {}, schemaPatches: {} };

const MOUNT_TYPES: Array<{ value: LayoutMountType; label: string }> = [
  { value: 'rightDock', label: 'PC: 右侧固定仪表盘' },
  { value: 'topSticky', label: 'PC: 顶部吸顶折叠栏' },
  { value: 'floatingHUD', label: 'PC: 自由浮动画中画' },
  { value: 'mobileDrawer', label: 'Mobile: 顶部吸顶抽屉' },
  { value: 'mobileBottomSticky', label: 'Mobile: 底部微型条' },
];

const WIDGET_TYPES: Array<{ value: WidgetType; label: string }> = [
  { value: 'statBar', label: '数值进度条 StatBar' },
  { value: 'dataLabel', label: '数据标签 DataLabel' },
  { value: 'inventorySlotGrid', label: '背包网格 InventorySlotGrid' },
  { value: 'badge', label: '徽标 Badge' },
  { value: 'avatarFrame', label: '形象框 AvatarFrame' },
];

let uid = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(uid += 1)}`;

const INPUT =
  'w-full bg-black/30 border border-white/15 rounded px-2 py-1 text-xs text-mist-solid focus:outline-none focus:border-accent';
const LABEL = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

/** 可视化 UI 模板设计器：管理某预设下的常驻 HUD 布局（容器嵌套 + 控件绑定 + 自定义 CSS）。 */
export const UiDesignerModal: Component<UiDesignerModalProps> = (props) => {
  const [layouts, setLayouts] = createSignal<UILayoutDefinition[]>([]);
  const [current, setCurrent] = createSignal<UILayoutDefinition | null>(null);
  const [message, setMessage] = createSignal<{ text: string; isError: boolean } | null>(null);
  const [busy, setBusy] = createSignal(false);

  const report = (text: string, isError = false) => setMessage({ text, isError });

  const refresh = async () => {
    setBusy(true);
    try {
      const list = await presetUiLayoutList(props.presetId);
      setLayouts(list);
      report(list.length ? `已加载 ${list.length} 套布局` : '该预设下还没有布局，点「新建布局」开始');
    } catch (err) {
      report(`读取布局列表失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const newLayout = () => {
    setCurrent({
      id: '',
      presetId: props.presetId,
      name: '新布局',
      mountType: 'rightDock',
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
        children: [],
      },
    });
    report('已新建草稿布局，编辑后点「保存」');
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

  const addContainer = () => {
    const base = current();
    if (!base) return;
    patchChildren([
      ...base.rootContainer.children,
      {
        nodeType: 'container',
        id: nextId('panel'),
        kind: 'panel',
        x: 0,
        y: 0,
        width: 200,
        height: 120,
        style: {},
        children: [],
      } as LayoutNode,
    ]);
  };

  const addWidget = (widgetType: WidgetType) => {
    const base = current();
    if (!base) return;
    patchChildren([
      ...base.rootContainer.children,
      {
        nodeType: 'widget',
        id: nextId('widget'),
        widgetType,
        label: WIDGET_TYPES.find((item) => item.value === widgetType)?.label ?? widgetType,
        dataBinding: widgetType === 'inventorySlotGrid' ? 'inventory' : 'stats.hp',
        config: widgetType === 'inventorySlotGrid' ? { columns: 4 } : {},
        style: {},
      } as LayoutNode,
    ]);
  };

  const patchChild = (index: number, updater: (node: LayoutNode) => LayoutNode) => {
    const base = current();
    if (!base) return;
    const next = base.rootContainer.children.slice();
    next[index] = updater(next[index]);
    patchChildren(next);
  };

  const removeChild = (index: number) => {
    const base = current();
    if (!base) return;
    patchChildren(base.rootContainer.children.filter((_, i) => i !== index));
  };

  const save = async () => {
    const base = current();
    if (!base) return;
    if (!base.name.trim()) {
      report('布局名称不能为空', true);
      return;
    }
    setBusy(true);
    try {
      const saved = await presetUiLayoutSave(base);
      setCurrent(saved);
      await refresh();
      report(`已保存布局：${saved.name}`);
    } catch (err) {
      report(`保存失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const base = current();
    if (!base) return;
    if (!base.id) {
      setCurrent(null);
      return;
    }
    setBusy(true);
    try {
      await presetUiLayoutDelete(base.id);
      setCurrent(null);
      await refresh();
      report('布局已删除');
    } catch (err) {
      report(`删除失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const bindToSession = async () => {
    const base = current();
    if (!base || !base.id) {
      report('请先保存布局，再绑定到会话', true);
      return;
    }
    if (props.sessionId == null) {
      report('当前没有选中的会话，无法绑定', true);
      return;
    }
    setBusy(true);
    try {
      await presetUiLayoutActivate(props.sessionId, base.id);
      report(`已绑定到会话 #${props.sessionId}：${base.name}（回到会话即可看到）`);
    } catch (err) {
      report(`绑定失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
        <div class="flex h-[86vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-night-sky shadow-2xl">
          <div class="flex items-center justify-between border-b border-white/10 px-5 py-3">
            <div>
              <h2 class="text-sm font-bold text-white">UI 设计器 · 常驻 HUD 布局</h2>
              <p class="text-[11px] text-mist-solid/40">预设 #{props.presetId} · 容器嵌套与控件数据绑定</p>
            </div>
            <div class="flex items-center gap-2">
              <button class="rounded border border-white/15 px-2 py-1 text-[11px] text-mist-solid hover:border-accent" onClick={() => void refresh()}>
                刷新列表
              </button>
              <button class="rounded border border-accent/40 px-2 py-1 text-[11px] text-accent" onClick={newLayout}>
                新建布局
              </button>
              <button class="rounded border border-white/15 px-2 py-1 text-[11px] text-mist-solid hover:text-white" onClick={props.onClose}>
                关闭
              </button>
            </div>
          </div>

          <div class="grid flex-1 grid-cols-[220px_1fr_320px] overflow-hidden">
            {/* 左：布局列表 */}
            <div class="overflow-y-auto border-r border-white/10 p-3">
              <div class={LABEL}>已有布局 ({layouts().length})</div>
              <div class="mt-2 space-y-1">
                <For each={layouts()}>
                  {(layout) => (
                    <button
                      class={`w-full rounded border px-2 py-1 text-left text-[11px] ${
                        current()?.id === layout.id ? 'border-accent text-accent' : 'border-white/10 text-mist-solid hover:border-white/30'
                      }`}
                      onClick={() => setCurrent(layout)}
                    >
                      {layout.name}
                      <span class="block text-[10px] text-mist-solid/40">{layout.mountType}</span>
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* 中：编辑区 */}
            <div class="overflow-y-auto p-4">
              <Show
                when={current()}
                fallback={<div class="text-xs text-mist-solid/50">左侧选择一套布局，或点右上角「新建布局」。</div>}
              >
                {(layout) => (
                  <div class="space-y-4">
                    <div class="grid grid-cols-2 gap-3">
                      <div>
                        <div class={LABEL}>名称</div>
                        <input class={INPUT} value={layout().name} onInput={(e) => patchCurrent({ name: e.currentTarget.value })} />
                      </div>
                      <div>
                        <div class={LABEL}>挂载锚点</div>
                        <select class={INPUT} value={layout().mountType} onChange={(e) => patchCurrent({ mountType: e.currentTarget.value as LayoutMountType })}>
                          <For each={MOUNT_TYPES}>{(item) => <option value={item.value}>{item.label}</option>}</For>
                        </select>
                      </div>
                    </div>

                    <div class="grid grid-cols-2 gap-3">
                      <div>
                        <div class={LABEL}>根画布宽度 (px)</div>
                        <input type="number" class={INPUT} value={layout().rootContainer.width} onInput={(e) => patchRoot({ width: Number(e.currentTarget.value) })} />
                      </div>
                      <div>
                        <div class={LABEL}>根画布高度 (px)</div>
                        <input type="number" class={INPUT} value={layout().rootContainer.height} onInput={(e) => patchRoot({ height: Number(e.currentTarget.value) })} />
                      </div>
                    </div>

                    <div>
                      <div class={LABEL}>自定义 CSS（仅在本面板的 Shadow DOM 内生效）</div>
                      <textarea
                        rows={5}
                        class={`${INPUT} font-mono`}
                        placeholder=".hud-panel { background: #0b0f19; }"
                        value={layout().customCss}
                        onInput={(e) => patchCurrent({ customCss: e.currentTarget.value })}
                      />
                    </div>

                    <div class="flex items-center gap-2">
                      <button class="rounded border border-white/15 px-2 py-1 text-[11px] text-mist-solid hover:border-accent" onClick={addContainer}>
                        + 容器 Panel
                      </button>
                      <For each={WIDGET_TYPES}>
                        {(widget) => (
                          <button class="rounded border border-white/15 px-2 py-1 text-[11px] text-mist-solid hover:border-accent" onClick={() => addWidget(widget.value)}>
                            + {widget.label}
                          </button>
                        )}
                      </For>
                    </div>

                    <div class="space-y-2">
                      <div class={LABEL}>根画布下的元素 ({layout().rootContainer.children.length})</div>
                      <For each={layout().rootContainer.children}>
                        {(child, index) => (
                          <div class="space-y-2 rounded border border-white/10 p-2">
                            <div class="flex items-center justify-between text-[11px] text-mist-solid/70">
                              <span>{child.nodeType === 'container' ? `容器 · ${(child as LayoutContainer).kind}` : `控件 · ${(child as WidgetDefinition).widgetType}`}</span>
                              <button class="text-rose-300 hover:text-rose-200" onClick={() => removeChild(index())}>
                                删除
                              </button>
                            </div>

                            <Show when={child.nodeType === 'container'}>
                              <div class="grid grid-cols-4 gap-2">
                                <div>
                                  <div class={LABEL}>容器类型</div>
                                  <select
                                    class={INPUT}
                                    value={(child as LayoutContainer).kind}
                                    onChange={(e) => patchChild(index(), (node) => ({ ...(node as LayoutContainer), kind: e.currentTarget.value as LayoutContainer['kind'], nodeType: 'container' }))}
                                  >
                                    <option value="panel">panel</option>
                                    <option value="tabs">tabs</option>
                                    <option value="grid">grid</option>
                                  </select>
                                </div>
                                <div>
                                  <div class={LABEL}>宽</div>
                                  <input type="number" class={INPUT} value={(child as LayoutContainer).width} onInput={(e) => patchChild(index(), (node) => ({ ...(node as LayoutContainer), width: Number(e.currentTarget.value), nodeType: 'container' }))} />
                                </div>
                                <div>
                                  <div class={LABEL}>高</div>
                                  <input type="number" class={INPUT} value={(child as LayoutContainer).height} onInput={(e) => patchChild(index(), (node) => ({ ...(node as LayoutContainer), height: Number(e.currentTarget.value), nodeType: 'container' }))} />
                                </div>
                                <div>
                                  <div class={LABEL}>方位</div>
                                  <select
                                    class={INPUT}
                                    value={String((child as LayoutContainer).style?.align ?? '')}
                                    onChange={(e) => patchChild(index(), (node) => {
                                      const container = node as LayoutContainer;
                                      return { ...container, nodeType: 'container', style: { ...(container.style ?? {}), align: e.currentTarget.value } };
                                    })}
                                  >
                                    <option value="">默认</option>
                                    <option value="center">center</option>
                                    <option value="end">end</option>
                                  </select>
                                </div>
                              </div>
                            </Show>

                            <Show when={child.nodeType === 'widget'}>
                              <div class="grid grid-cols-3 gap-2">
                                <div>
                                  <div class={LABEL}>标签</div>
                                  <input class={INPUT} value={(child as WidgetDefinition).label} onInput={(e) => patchChild(index(), (node) => ({ ...(node as WidgetDefinition), label: e.currentTarget.value, nodeType: 'widget' }))} />
                                </div>
                                <div>
                                  <div class={LABEL}>数据绑定</div>
                                  <input
                                    class={INPUT}
                                    value={(child as WidgetDefinition).dataBinding}
                                    onInput={(e) => patchChild(index(), (node) => ({ ...(node as WidgetDefinition), dataBinding: e.currentTarget.value, nodeType: 'widget' }))}
                                    placeholder="stats.hp / inventory / flags.xxx / schema.xxx"
                                  />
                                </div>
                                <div>
                                  <div class={LABEL}>控件类型</div>
                                  <select
                                    class={INPUT}
                                    value={(child as WidgetDefinition).widgetType}
                                    onChange={(e) => patchChild(index(), (node) => ({ ...(node as WidgetDefinition), widgetType: e.currentTarget.value as WidgetType, nodeType: 'widget' }))}
                                  >
                                    <For each={WIDGET_TYPES}>{(item) => <option value={item.value}>{item.label}</option>}</For>
                                  </select>
                                </div>
                              </div>
                            </Show>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </Show>
            </div>

            {/* 右：预览与操作 */}
            <div class="flex flex-col overflow-hidden border-l border-white/10">
              <div class="border-b border-white/10 p-3">
                <div class={LABEL}>预览（真实数据绑定）</div>
                <div class="mt-2 overflow-auto rounded-lg bg-black/30 p-2">
                  <Show when={current()}>
                    {(layout) => <LayoutTreeNode node={{ nodeType: 'container', ...layout().rootContainer }} snapshot={props.snapshot ?? EMPTY_SNAPSHOT} />}
                  </Show>
                </div>
              </div>
              <div class="space-y-2 p-3">
                <button class="w-full rounded border border-accent/40 px-2 py-1.5 text-[11px] text-accent disabled:opacity-50" disabled={busy()} onClick={() => void save()}>
                  保存布局
                </button>
                <button class="w-full rounded border border-white/15 px-2 py-1.5 text-[11px] text-mist-solid disabled:opacity-50" disabled={busy()} onClick={() => void bindToSession()}>
                  绑定到当前会话
                </button>
                <button class="w-full rounded border border-rose-500/40 px-2 py-1.5 text-[11px] text-rose-300 disabled:opacity-50" disabled={busy()} onClick={() => void remove()}>
                  删除布局
                </button>
                <Show when={message()}>
                  {(msg) => (
                    <div class={`rounded border p-2 text-[11px] ${msg().isError ? 'border-rose-500/40 bg-rose-500/10 text-rose-200' : 'border-white/10 bg-white/5 text-mist-solid'}`} role={msg().isError ? 'alert' : undefined}>
                      {msg().text}
                    </div>
                  )}
                </Show>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
