import { Component, Show } from 'solid-js';
import { AlertTriangle } from '../lib/icons';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog: Component<ConfirmDialogProps> = (props) => {
  return (
    <Show when={props.open}>
      <div class="fixed inset-0 z-[3000] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div
          class="relative w-full max-w-md mx-4 rounded-2xl border border-white/10 bg-xuanqing shadow-2xl overflow-hidden"
          role="alertdialog"
          aria-modal="true"
        >
          <div class="flex items-start gap-4 p-6">
            <div class="shrink-0 w-10 h-10 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center border border-amber-500/20">
              <AlertTriangle size={20} />
            </div>
            <div class="flex-1 min-w-0">
              <h2 class="text-base font-semibold text-mist-solid mb-1.5">{props.title}</h2>
              <p class="text-sm text-mist-solid/60 leading-relaxed whitespace-pre-wrap">{props.message}</p>
            </div>
          </div>
          <div class="flex items-center justify-end gap-3 px-6 py-4 bg-white/[0.02] border-t border-white/5">
            <button
              onClick={props.onCancel}
              class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-mist-solid/70 hover:bg-white/10 transition-colors"
            >
              {props.cancelText ?? '取消'}
            </button>
            <button
              onClick={props.onConfirm}
              class="px-4 py-2 rounded-xl bg-accent border border-accent/30 text-white text-sm font-medium hover:bg-accent/85 transition-colors"
            >
              {props.confirmText ?? '确认'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
