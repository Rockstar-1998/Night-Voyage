import { Component, For, Show, createSignal } from 'solid-js';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, X } from 'lucide-solid';

// ============================================================================
// 移动端全局通知系统：Toast + ConfirmDialog
// ============================================================================
// 与 PC 端 (src/components/Toast.tsx) 独立实现，遵守 C5 双前端隔离。
// 设计目标：替代 window.alert / window.confirm 阻塞弹窗，提供非阻塞、可统一样式
// 的软件内原生实现。Toast 自动消失；ConfirmDialog 返回 Promise<boolean>，
// 调用方用 await 接收结果，UI 不阻塞 JS 主线程。
//
// 用法：
//   showToast('发送失败', 'error');
//   const ok = await showConfirm({ title: '删除', message: '确定删除？' });
//
// 挂载：在根组件渲染树末尾放置 <NotificationContainer />。
// ============================================================================

type ToastType = 'info' | 'success' | 'error' | 'warning';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}

interface ConfirmState extends ConfirmOptions {
  resolver: (value: boolean) => void;
}

// --- Toast 单例 store ---
const [toasts, setToasts] = createSignal<ToastItem[]>([]);
let toastIdCounter = 0;

export function showToast(message: string, type: ToastType = 'info', duration = 3500): void {
  const id = ++toastIdCounter;
  setToasts((prev) => [...prev, { id, message, type }]);
  if (duration > 0) {
    window.setTimeout(() => dismissToast(id), duration);
  }
}

export function dismissToast(id: number): void {
  setToasts((prev) => prev.filter((t) => t.id !== id));
}

// --- ConfirmDialog 单例 store（同一时刻只显示一个）---
const [confirmState, setConfirmState] = createSignal<ConfirmState | null>(null);

export function showConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    setConfirmState({ ...options, resolver: resolve });
  });
}

function handleConfirmResult(result: boolean): void {
  const state = confirmState();
  if (!state) return;
  state.resolver(result);
  setConfirmState(null);
}

// --- 样式映射 ---
const toastStyles: Record<ToastType, { icon: typeof Info; bg: string; border: string; text: string }> = {
  info: { icon: Info, bg: 'bg-xuanqing/95', border: 'border-white/15', text: 'text-mist-solid' },
  success: { icon: CheckCircle2, bg: 'bg-emerald-900/90', border: 'border-emerald-500/30', text: 'text-emerald-100' },
  error: { icon: AlertCircle, bg: 'bg-red-900/90', border: 'border-red-500/30', text: 'text-red-100' },
  warning: { icon: AlertTriangle, bg: 'bg-amber-900/90', border: 'border-amber-500/30', text: 'text-amber-100' },
};

export const NotificationContainer: Component = () => {
  return (
    <>
      {/* Toast 容器：顶部堆叠，适配移动端窄屏 */}
      <div class="fixed top-3 left-3 right-3 z-[4000] flex flex-col gap-2 pointer-events-none">
        <For each={toasts()}>
          {(toast) => {
            const style = toastStyles[toast.type];
            const Icon = style.icon;
            return (
              <div
                class={`pointer-events-auto flex items-start gap-3 max-w-full rounded-2xl border ${style.bg} ${style.border} ${style.text} px-4 py-3 shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-300`}
                role="status"
              >
                <Icon size={18} class="shrink-0 mt-0.5" />
                <p class="flex-1 text-sm leading-relaxed whitespace-pre-wrap break-words">{toast.message}</p>
                <button
                  onClick={() => dismissToast(toast.id)}
                  class="shrink-0 opacity-50 hover:opacity-100 transition-opacity"
                  aria-label="关闭通知"
                >
                  <X size={14} />
                </button>
              </div>
            );
          }}
        </For>
      </div>

      {/* 全局 ConfirmDialog — 适配移动端窄屏，底部按钮全宽 */}
      <Show when={confirmState()}>
        {(state) => (
          <div class="fixed inset-0 z-[4000] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div
              class="relative w-full max-w-md mx-0 sm:mx-4 rounded-t-3xl sm:rounded-2xl border border-white/10 bg-xuanqing shadow-2xl overflow-hidden safe-area-bottom"
              role="alertdialog"
              aria-modal="true"
            >
              <div class="flex items-start gap-4 p-6">
                <div class="shrink-0 w-10 h-10 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center border border-amber-500/20">
                  <AlertTriangle size={20} />
                </div>
                <div class="flex-1 min-w-0">
                  <h2 class="text-base font-semibold text-mist-solid mb-1.5">{state().title ?? '确认操作'}</h2>
                  <p class="text-sm text-mist-solid/60 leading-relaxed whitespace-pre-wrap">{state().message}</p>
                </div>
              </div>
              <div class="flex items-center gap-3 px-6 py-4 bg-white/[0.02] border-t border-white/5">
                <button
                  onClick={() => handleConfirmResult(false)}
                  class="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-mist-solid/70 hover:bg-white/10 transition-colors"
                >
                  {state().cancelText ?? '取消'}
                </button>
                <button
                  onClick={() => handleConfirmResult(true)}
                  class="flex-1 px-4 py-2.5 rounded-xl bg-accent border border-accent/30 text-white text-sm font-medium hover:bg-accent/85 transition-colors"
                >
                  {state().confirmText ?? '确认'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>
    </>
  );
};
