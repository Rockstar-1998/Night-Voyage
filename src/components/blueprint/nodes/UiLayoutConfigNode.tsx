import { Component, For, Show, createResource } from 'solid-js';
import type { UiLayoutConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { presetUiLayoutList } from '../../../lib/backend/ui_layout';
import { Layout, Lock } from '../../../lib/icons';

const SELECT_CLASS =
  'w-full bg-night-water border border-white/15 rounded-lg py-2 px-3 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const UiLayoutConfigNode: Component<NodeConfigComponentProps<UiLayoutConfig>> = (props) => {
  const update = (updates: Partial<UiLayoutConfig>) => props.onUpdate(updates);

  // 布局模板列表来自真实数据源（preset_ui_layout_list），不内置任何候选值（C11）。
  // 读取失败必须显式可见（C2）：没有预设 id / 列表为空 / 请求出错分别给出不同提示。
  const [layouts] = createResource(
    () => props.presetId,
    async (presetId: number) => presetUiLayoutList(presetId),
  );

  const layoutError = () => {
    const err = layouts.error;
    if (!err) return null;
    return err instanceof Error ? err.message : String(err);
  };

  return (
    <div class="space-y-4">
      <div class="p-3 rounded-xl border border-pink-500/20 bg-pink-500/5 space-y-2">
        <div class="flex items-center gap-2 text-xs font-bold text-pink-400">
          <Layout size={16} />
          <span>常驻 UI 布局绑定</span>
        </div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          绑定常驻 HUD 的布局模板（如 PC 右侧仪表盘、顶部折叠吸顶栏或移动端吸顶抽屉），激活 Shadow DOM 沙箱隔离渲染。
        </p>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>挂载锚点位置 (Mount Type)</label>
        <select
          value={props.config.mount_type || 'RightDock'}
          disabled={props.isLocked}
          onChange={(e) => update({ mount_type: e.currentTarget.value as UiLayoutConfig['mount_type'] })}
          class={SELECT_CLASS}
        >
          <option value="RightDock">PC: 右侧固定仪表盘 (RightDock)</option>
          <option value="TopSticky">PC: 顶部吸顶折叠栏 (TopSticky)</option>
          <option value="FloatingHUD">PC: 自由浮动画中画 (FloatingHUD)</option>
          <option value="MobileDrawer">Mobile: 顶部吸顶抽屉 (MobileDrawer)</option>
          <option value="MobileBottomSticky">Mobile: 底部微型条 (MobileBottomSticky)</option>
        </select>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>UI 布局模板 (Layout)</label>
        <Show
          when={props.presetId != null}
          fallback={
            <div class="p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300">
              无法读取布局列表：当前蓝图没有关联预设 id。
            </div>
          }
        >
          <Show
            when={!layoutError()}
            fallback={
              <div class="p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300">
                读取布局列表失败：{layoutError()}
              </div>
            }
          >
            <Show
              when={(layouts() ?? []).length > 0}
              fallback={
                <div class="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-300">
                  该预设下还没有 UI 布局模板。请先在预设详情页的「UI 设计器」里创建布局，再回到这里绑定。
                </div>
              }
            >
              <select
                value={props.config.layout_id || ''}
                disabled={props.isLocked || layouts.loading}
                onChange={(e) => update({ layout_id: e.currentTarget.value })}
                class={SELECT_CLASS}
              >
                <option value="">（未绑定）</option>
                <For each={layouts() ?? []}>
                  {(layout) => (
                    <option value={layout.id}>
                      {layout.name} · {layout.mountType}
                    </option>
                  )}
                </For>
              </select>
            </Show>
          </Show>
        </Show>
        <p class="text-[10px] text-mist-solid/35">
          未绑定时，会话使用项目默认的工业级玄青色常驻面板。
        </p>
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
