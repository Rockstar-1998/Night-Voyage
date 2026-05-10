import { Component, Show, createEffect, createSignal } from 'solid-js';
import { Lock, Power, Save, Sparkles, Terminal, Trash2, X } from '../lib/icons';
import { IconButton } from './ui/IconButton';

export interface PresetBlockEditorData {
  id?: number;
  title: string;
  blockType: string;
  content: string;
  scope: string;
  priority: number;
  isEnabled: boolean;
  isLocked: boolean;
  lockReason?: string;
  exclusiveGroupKey?: string;
  exclusiveGroupLabel?: string;
}

const EMPTY_EDITOR_DATA: PresetBlockEditorData = {
  title: '',
  blockType: 'style',
  content: '',
  scope: 'global',
  priority: 100,
  isEnabled: true,
  isLocked: false,
  lockReason: '',
  exclusiveGroupKey: '',
  exclusiveGroupLabel: '',
};

export const CompletionDetailModal: Component<{
  isOpen: boolean;
  onClose: () => void;
  data: PresetBlockEditorData | null;
  saving?: boolean;
  error?: string | null;
  onSave: (data: PresetBlockEditorData) => void;
  onDelete?: (id: number) => void;
}> = (props) => {
  const [form, setForm] = createSignal<PresetBlockEditorData>({ ...EMPTY_EDITOR_DATA });

  createEffect(() => {
    if (props.isOpen) {
      setForm({
        ...EMPTY_EDITOR_DATA,
        ...(props.data ?? {}),
      });
    }
  });

  const existingLockedBlock = () => props.data?.id != null && props.data?.isLocked === true;
  const canSave = () => !existingLockedBlock() && form().blockType.trim().length > 0 && form().content.trim().length > 0;

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-[1000] flex flex-col bg-xuanqing/95 backdrop-blur-2xl animate-in fade-in duration-300">
        <div class="h-16 flex items-center justify-between px-8 border-b border-white/5">
          <div class="flex items-center gap-3">
            <div class="p-2 rounded-lg bg-accent/20 text-accent">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 class="text-lg font-bold text-white tracking-tight">{form().id != null ? '编辑预设条目' : '新增预设条目'}</h2>
              <Show when={existingLockedBlock()}>
                <p class="text-xs text-amber-300/80 mt-1">该条目已锁定，当前 UI 仅允许查看，不允许继续修改或解锁。</p>
              </Show>
            </div>
          </div>
          <IconButton onClick={props.onClose} label="关闭预设条目编辑" size="md">
            <X size={18} />
          </IconButton>
        </div>

        <div class="flex-1 overflow-y-auto p-12 custom-scrollbar">
          <div class="max-w-5xl mx-auto space-y-8">
            <Show when={props.error}>
              <div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {props.error}
              </div>
            </Show>

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-8">
              <div class="space-y-6">
                <div class="space-y-3">
                  <label class="flex items-center gap-2 text-xs font-bold text-mist-solid/30 uppercase tracking-widest">
                    <Terminal size={14} />
                    标题 / 备注
                  </label>
                  <input
                    type="text"
                    value={form().title}
                    disabled={existingLockedBlock()}
                    onInput={(e) => setForm({ ...form(), title: e.currentTarget.value })}
                    class="w-full bg-white/5 border border-white/5 rounded-2xl p-4 text-lg font-medium focus:outline-none focus:border-accent/40 text-mist-solid transition-all disabled:opacity-40"
                    placeholder="输入条目标题..."
                  />
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="space-y-3">
                    <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-widest">条目类型</label>
                    <input
                      type="text"
                      value={form().blockType}
                      disabled={existingLockedBlock()}
                      onInput={(e) => setForm({ ...form(), blockType: e.currentTarget.value })}
                      class="w-full bg-white/5 border border-white/5 rounded-2xl p-4 text-sm focus:outline-none focus:border-accent/40 text-mist-solid transition-all disabled:opacity-40"
                      placeholder="如 style / format / custom:..."
                    />
                  </div>
                  <div class="space-y-3">
                    <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-widest">作用域</label>
                    <select
                      value={form().scope}
                      disabled={existingLockedBlock()}
                      onChange={(e) => setForm({ ...form(), scope: e.currentTarget.value })}
                      class="w-full bg-white/5 border border-white/5 rounded-2xl p-4 text-sm focus:outline-none focus:border-accent/40 text-mist-solid transition-all disabled:opacity-40"
                    >
                      <option value="global">global</option>
                      <option value="chat_only">chat_only</option>
                      <option value="group_only">group_only</option>
                      <option value="single_only">single_only</option>
                      <option value="completion_only">completion_only</option>
                      <option value="agent_only">agent_only</option>
                    </select>
                  </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div class="space-y-3">
                    <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-widest">优先级</label>
                    <input
                      type="number"
                      value={form().priority}
                      disabled={existingLockedBlock()}
                      onInput={(e) => setForm({ ...form(), priority: Number.isFinite(e.currentTarget.valueAsNumber) ? e.currentTarget.valueAsNumber : 100 })}
                      class="w-full bg-white/5 border border-white/5 rounded-2xl p-4 text-sm focus:outline-none focus:border-accent/40 text-mist-solid transition-all disabled:opacity-40"
                    />
                  </div>
                  <div class="space-y-3">
                    <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-widest">启用状态</label>
                    <div class={`w-full rounded-2xl border px-4 py-4 flex items-center justify-between gap-4 transition-all ${form().isEnabled ? 'border-accent/40 bg-accent/15 text-accent' : 'border-white/10 bg-white/5 text-mist-solid/60'}`}>
                      <div>
                        <div class="text-sm font-bold">{form().isEnabled ? '已启用' : '未启用'}</div>
                        <div class="text-[11px] mt-1 text-mist-solid/45">点击右侧图标切换当前条目状态。</div>
                      </div>
                      <IconButton
                        type="button"
                        disabled={existingLockedBlock()}
                        onClick={() => setForm({ ...form(), isEnabled: !form().isEnabled })}
                        label={form().isEnabled ? '禁用条目' : '启用条目'}
                        tone={form().isEnabled ? 'accent' : 'neutral'}
                        active={form().isEnabled}
                        size="md"
                      >
                        <Power size={16} />
                      </IconButton>
                    </div>
                  </div>
                </div>
              </div>

              <div class="space-y-6">
                <div class="rounded-3xl border border-white/5 bg-white/5 p-5 space-y-4">
                  <div class="flex items-center gap-2 text-xs font-bold text-mist-solid/30 uppercase tracking-widest">
                    <Lock size={14} />
                    条目锁
                  </div>
                  <label class="flex items-center gap-3 text-sm text-mist-solid/80">
                    <input
                      type="checkbox"
                      checked={form().isLocked}
                      disabled={existingLockedBlock()}
                      onChange={(e) => setForm({ ...form(), isLocked: e.currentTarget.checked })}
                      class="accent-accent"
                    />
                    保存后锁定该条目
                  </label>
                  <textarea
                    value={form().lockReason ?? ''}
                    disabled={existingLockedBlock() || !form().isLocked}
                    onInput={(e) => setForm({ ...form(), lockReason: e.currentTarget.value })}
                    class="w-full min-h-24 bg-black/20 border border-white/10 rounded-2xl p-4 text-sm text-mist-solid focus:outline-none focus:border-accent/40 disabled:opacity-40"
                    placeholder="填写锁定原因，帮助其他人理解为何不能改动..."
                  />
                  <p class="text-[11px] leading-5 text-mist-solid/40">当前后端会把锁定条目视为不可修改、不可禁用、不可删除、不可重排的完整锁。</p>
                </div>

                <div class="rounded-3xl border border-white/5 bg-white/5 p-5 space-y-4">
                  <div class="flex items-center gap-2 text-xs font-bold text-mist-solid/30 uppercase tracking-widest">
                    <Sparkles size={14} />
                    互斥组
                  </div>
                  <input
                    type="text"
                    value={form().exclusiveGroupKey ?? ''}
                    disabled={existingLockedBlock()}
                    onInput={(e) => setForm({ ...form(), exclusiveGroupKey: e.currentTarget.value })}
                    class="w-full bg-black/20 border border-white/10 rounded-2xl p-4 text-sm text-mist-solid focus:outline-none focus:border-accent/40 disabled:opacity-40"
                    placeholder="机器键，如 style / narration-tone"
                  />
                  <input
                    type="text"
                    value={form().exclusiveGroupLabel ?? ''}
                    disabled={existingLockedBlock()}
                    onInput={(e) => setForm({ ...form(), exclusiveGroupLabel: e.currentTarget.value })}
                    class="w-full bg-black/20 border border-white/10 rounded-2xl p-4 text-sm text-mist-solid focus:outline-none focus:border-accent/40 disabled:opacity-40"
                    placeholder="显示名，如 文风组"
                  />
                  <p class="text-[11px] leading-5 text-mist-solid/40">同一组中只能启用一个条目。当前前端会在保存前阻止明显冲突，最终仍以后端校验为准。</p>
                </div>
              </div>
            </div>

            <div class="space-y-4">
              <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-widest">条目内容</label>
              <textarea
                value={form().content}
                disabled={existingLockedBlock()}
                onInput={(e) => setForm({ ...form(), content: e.currentTarget.value })}
                class="w-full min-h-[280px] bg-white/5 border border-white/5 rounded-3xl p-5 text-sm focus:outline-none focus:border-accent/40 text-mist-solid transition-all resize-y font-mono disabled:opacity-40"
                placeholder="输入会注入到提示词层的具体内容..."
              />
            </div>

            <div class="pt-8 border-t border-white/5 flex items-center justify-between gap-4">
              <Show when={props.data?.id != null && !existingLockedBlock() && props.onDelete}>
                <IconButton
                  onClick={() => props.data?.id != null && props.onDelete?.(props.data.id)}
                  label="删除条目"
                  tone="danger"
                  size="lg"
                >
                  <Trash2 size={16} />
                </IconButton>
              </Show>

              <div class="ml-auto flex items-center gap-3">
                <IconButton onClick={props.onClose} label="取消编辑" size="lg">
                  <X size={18} />
                </IconButton>
                <IconButton
                  disabled={!canSave() || props.saving}
                  onClick={() => props.onSave(form())}
                  label={existingLockedBlock() ? '锁定条目不可编辑' : props.saving ? '保存中' : '保存更改'}
                  tone="accent"
                  size="lg"
                >
                  <Save size={18} class={props.saving ? 'animate-pulse' : ''} />
                </IconButton>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
};
