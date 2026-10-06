import { Component, For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { Plus, Trash2, X, ShieldAlert } from '../../lib/icons';
import { actionBridgeWhitelistGet, actionBridgeWhitelistSet } from '../../lib/backend/actionBridge';

/**
 * 动作命令白名单管理弹窗（预设详情页入口）。
 *
 * 位置依据：原始实现文档（plans/agent-system-architecture-plan.md）为预设中心架构，
 * 创作者资产管理一律在预设上下文（Schema 管理 / UI 设计器 / 蓝图编辑器均在预设详情页），
 * 动作白名单治理的是本预设 ActionButton / Querier 引用的命令，管理面板据此跟随预设。
 * 白名单本体存 settings 表 `action_bridge.command_whitelist`（全局注册表，默认空 =
 * 动作件/Querier 调用前显式报错，I2）。
 */
export const PresetActionWhitelistModal: Component<{
  presetId: number;
  isOpen: boolean;
  onClose: () => void;
}> = (props) => {
  const [whitelist, { refetch }] = createResource(() => actionBridgeWhitelistGet());
  const [newCommand, setNewCommand] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [saved, setSaved] = createSignal(false);

  const save = async (commands: string[]) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await actionBridgeWhitelistSet(commands);
      setSaved(true);
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const command = newCommand().trim();
    if (!command) return;
    await save([...(whitelist() ?? []), command]);
    setNewCommand('');
  };

  const remove = async (command: string) => {
    await save((whitelist() ?? []).filter((c) => c !== command));
  };

  createEffect(() => {
    if (props.isOpen) {
      setSaved(false);
      setError(null);
      void refetch();
    }
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div class="relative flex flex-col w-full max-w-3xl h-[70vh] rounded-2xl border border-white/10 bg-[#0f141c] text-mist-solid shadow-2xl overflow-hidden">
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-xl bg-accent/15 border border-accent/30 text-accent">
                <ShieldAlert size={20} />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h2 class="text-base font-bold text-mist-solid">动作命令白名单</h2>
                  <span class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-accent">
                    预设 #{props.presetId}
                  </span>
                </div>
                <p class="text-xs text-mist-solid/50 mt-0.5">
                  本预设的 HUD 动作件、产物卡按钮与蓝图 Querier 只能调用这里登记的命令；未登记的命令调用时显式报错，不会静默失败。
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="p-2 rounded-lg text-mist-solid/60 hover:text-mist-solid hover:bg-white/10 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 flex flex-col min-h-0 overflow-y-auto p-6 space-y-4 custom-scrollbar">
            <div class="flex items-center gap-2">
              <input
                type="text"
                value={newCommand()}
                onInput={(e) => setNewCommand(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void add();
                }}
                placeholder="输入命令名，如 create_world_book_entry"
                class="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
              />
              <button
                type="button"
                disabled={busy() || !newCommand().trim()}
                onClick={() => void add()}
                class="flex items-center gap-1 px-3 py-2 rounded-lg bg-accent/60 text-white text-xs font-medium hover:bg-accent/80 disabled:opacity-40 transition-colors"
              >
                <Plus size={14} />
                登记
              </button>
            </div>

            <Show when={error()}>
              <div class="text-xs text-red-300 break-all" role="alert">{error()}</div>
            </Show>
            <Show when={saved() && !error()}>
              <div class="text-xs text-emerald-300">已保存</div>
            </Show>

            <div class="rounded-2xl border border-white/8 bg-white/[0.02] divide-y divide-white/5">
              <Show
                when={(whitelist() ?? []).length > 0}
                fallback={
                  <div class="px-4 py-6 text-center text-xs text-mist-solid/30">
                    白名单为空：所有动作件与 Querier 调用都会显式报错（默认安全态）
                  </div>
                }
              >
                <For each={whitelist() ?? []}>
                  {(command) => (
                    <div class="flex items-center justify-between gap-3 px-4 py-2.5">
                      <code class="text-xs text-mist-solid/85 font-mono">{command}</code>
                      <button
                        type="button"
                        disabled={busy()}
                        onClick={() => void remove(command)}
                        class="p-1 rounded text-mist-solid/40 hover:text-red-400 disabled:opacity-40 transition-colors"
                        title={`移除 ${command}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-white/[0.02]">
            <div class="text-xs text-mist-solid/40">
              提示：命令的实际行为由蓝图/UI 资产中的命令名与参数模板定义；白名单只治理“准许调用”。
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="px-4 py-2 text-xs rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-mist-solid/80 transition-colors"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
