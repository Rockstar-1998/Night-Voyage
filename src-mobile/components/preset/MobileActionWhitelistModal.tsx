/**
 * 移动端动作命令白名单管理弹窗（Task 08）。
 *
 * C5 移动端独立性：位于 src-mobile/components/preset/，零 PC 端 UI 耦合。
 * 管理本预设动作件、产物卡按钮与 Querier 可调用的命令白名单。
 * 白名单存储于全局设置（未登记的命令调用时显式报错，杜绝静默失败）。
 */

import { Component, For, Show, createEffect, createResource, createSignal } from 'solid-js';
import { actionBridgeWhitelistGet, actionBridgeWhitelistSet } from '../../../src/lib/backend/actionBridge';
import { showToast } from '../Toast';

export interface MobileActionWhitelistModalProps {
  presetId: number;
  isOpen: boolean;
  onClose: () => void;
}

export const MobileActionWhitelistModal: Component<MobileActionWhitelistModalProps> = (props) => {
  const [whitelist, { refetch }] = createResource(() => actionBridgeWhitelistGet());
  const [newCommand, setNewCommand] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const save = async (commands: string[]) => {
    setBusy(true);
    setError(null);
    try {
      await actionBridgeWhitelistSet(commands);
      showToast('动作白名单已更新', 'success');
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      showToast(`保存白名单失败：${msg}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const command = newCommand().trim();
    if (!command) return;
    const current = whitelist() ?? [];
    if (current.includes(command)) {
      showToast('该命令已在白名单中', 'warning');
      return;
    }
    await save([...current, command]);
    setNewCommand('');
  };

  const remove = async (command: string) => {
    const current = whitelist() ?? [];
    await save(current.filter((c) => c !== command));
  };

  createEffect(() => {
    if (props.isOpen) {
      setError(null);
      void refetch();
    }
  });

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
            <div class="flex flex-col min-w-0">
              <div class="flex items-center gap-1.5">
                <h2 class="text-[15px] font-bold text-white truncate">动作命令白名单</h2>
                <span class="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  预设 #{props.presetId}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            class="px-3 py-1.5 rounded-lg bg-white/5 text-mist-solid text-[12px] font-semibold active:scale-95 transition-transform"
          >
            完成
          </button>
        </header>

        {/* 说明横幅 */}
        <div class="p-4 bg-white/[0.02] border-b border-white/5">
          <div class="flex items-start gap-2.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200/90 text-xs leading-relaxed">
            <svg class="shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
            <span>本预设的 HUD 动作件、产物卡按钮与蓝图 Querier 只能调用登记在此的命令；未登记的命令调用时显式报错拦截，杜绝静默失败。</span>
          </div>
        </div>

        {/* 主体滚动区 */}
        <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4 custom-scrollbar">
          {/* 添加新命令 */}
          <div class="space-y-1.5">
            <label class="text-[12px] font-semibold text-mist-solid/80">添加白名单命令</label>
            <div class="flex items-center gap-2">
              <input
                type="text"
                value={newCommand()}
                onInput={(e) => setNewCommand(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void add();
                }}
                placeholder="命令名，如 create_world_book_entry"
                class="flex-1 px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[14px] font-mono text-mist-solid focus:outline-none focus:border-accent/50 placeholder-mist-solid/30"
              />
              <button
                type="button"
                onClick={add}
                disabled={busy() || !newCommand().trim()}
                class="px-4 py-2.5 rounded-xl bg-accent text-white font-semibold text-[13px] active:scale-95 transition-transform disabled:opacity-40"
              >
                添加
              </button>
            </div>
          </div>

          <Show when={error()}>
            {(err) => (
              <div class="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs">
                {err()}
              </div>
            )}
          </Show>

          {/* 白名单命令列表 */}
          <div class="space-y-2">
            <div class="flex items-center justify-between text-xs text-mist-solid/60 px-1">
              <span>已放行命令列表</span>
              <span class="font-mono">{whitelist()?.length ?? 0} 个</span>
            </div>

            <Show
              when={!whitelist.loading}
              fallback={
                <div class="py-8 text-center text-xs text-mist-solid/40 animate-pulse">
                  加载白名单中…
                </div>
              }
            >
              <For each={whitelist() ?? []}>
                {(cmd) => (
                  <div class="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                    <div class="flex items-center gap-2.5 min-w-0">
                      <div class="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                      <span class="font-mono text-[13px] text-white truncate">{cmd}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => remove(cmd)}
                      disabled={busy()}
                      class="text-mist-solid/40 hover:text-rose-400 text-xs px-2 py-1 rounded bg-white/5 active:scale-95 transition-transform shrink-0"
                    >
                      删除
                    </button>
                  </div>
                )}
              </For>

              <Show when={(whitelist() ?? []).length === 0}>
                <div class="py-12 text-center rounded-2xl border border-dashed border-white/10 p-6 space-y-2">
                  <div class="text-sm text-mist-solid/50">当前白名单为空</div>
                  <div class="text-xs text-mist-solid/30">未登记的命令调用时会触发显式安全拦截</div>
                </div>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
