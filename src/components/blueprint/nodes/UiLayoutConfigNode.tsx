import { Component } from 'solid-js';
import type { UiLayoutConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { Layout, Lock } from '../../../lib/icons';

const INPUT_CLASS =
  'w-full bg-black/30 border border-white/15 rounded-lg py-2 px-3 text-sm font-mono text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const SELECT_CLASS =
  'w-full bg-night-water border border-white/15 rounded-lg py-2 px-3 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const UiLayoutConfigNode: Component<NodeConfigComponentProps<UiLayoutConfig>> = (props) => {
  const update = (updates: Partial<UiLayoutConfig>) => props.onUpdate(updates);

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
        <label class={LABEL_CLASS}>UI 布局模板 ID (Layout ID)</label>
        <input
          type="text"
          value={props.config.layout_id || ''}
          disabled={props.isLocked}
          onInput={(e) => update({ layout_id: e.currentTarget.value.trim() })}
          class={INPUT_CLASS}
          placeholder="如: default_hud_layout"
        />
        <p class="text-[10px] text-mist-solid/35">
          留空或使用 default_hud_layout 时，将使用项目默认的工业级玄青色常驻面板。
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
