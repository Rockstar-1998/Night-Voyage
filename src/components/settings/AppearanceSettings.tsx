import { Component } from 'solid-js';
import { MessageFormatSettings } from './MessageFormatSettings';
import type { MessageFormatConfig } from '../../lib/messageFormatter';

interface AppearanceSettingsProps {
  enableDynamicEffects: boolean;
  onSetEnableDynamicEffects: (enabled: boolean) => void;
  formatConfig: MessageFormatConfig;
  onSetFormatConfig: (config: MessageFormatConfig) => void;
}

export const AppearanceSettings: Component<AppearanceSettingsProps> = (props) => {
  return (
    <div class="h-full w-full overflow-y-auto custom-scrollbar">
      <div class="max-w-5xl mx-auto w-full px-8 py-16 space-y-10">
        <div>
          <h2 class="text-2xl font-bold text-mist-solid mb-2">界面外观</h2>
          <p class="text-mist-solid/40 text-sm">
            自定义界面视觉表现，减少动态特效可显著提升低性能设备的运行流畅度。
          </p>
        </div>

        <div class="space-y-6">
          <div class="flex items-center justify-between gap-4 py-4 border-b border-white/5">
            <div>
              <h3 class="text-sm font-bold text-white">动态特效</h3>
              <p class="text-[11px] text-mist-solid/35 mt-1">
                关闭极光背景动画等动态效果，可降低 GPU 占用并提升帧率。
              </p>
            </div>
            <button
              onClick={() => props.onSetEnableDynamicEffects(!props.enableDynamicEffects)}
              class={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                props.enableDynamicEffects
                  ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
                  : 'bg-white/10'
              }`}
              role="switch"
              aria-checked={props.enableDynamicEffects}
              aria-label={props.enableDynamicEffects ? '关闭动态特效' : '开启动态特效'}
            >
              <div
                class={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
                  props.enableDynamicEffects ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>

          <div class="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-mist-solid/35">
            当前状态：{props.enableDynamicEffects ? '已开启' : '已关闭'}动态特效
          </div>
        </div>

        <MessageFormatSettings
          formatConfig={props.formatConfig}
          onSetFormatConfig={props.onSetFormatConfig}
        />
      </div>
    </div>
  );
};
