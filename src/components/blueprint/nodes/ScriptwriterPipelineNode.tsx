import { Component, For, Show } from 'solid-js';
import type { ScriptwriterPipelineConfig, ScriptwriterStage } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { ArrowUp, ArrowDown, Plus, Trash2, Layers3 } from '../../../lib/icons';
import { ToolPermissionsCard } from '../ToolPermissionsCard';

const INPUT_CLASS =
  'w-full bg-black/30 border border-white/15 rounded-lg py-1.5 px-2.5 text-xs font-mono text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest font-semibold';

export const ScriptwriterPipelineNode: Component<NodeConfigComponentProps<ScriptwriterPipelineConfig>> = (props) => {
  const update = (updates: Partial<ScriptwriterPipelineConfig>) => props.onUpdate(updates);

  const stages = () => props.config.stages || [];

  const handleAddStage = () => {
    const current = [...stages()];
    const index = current.length;
    const defaultName = index === 0 ? 'draft' : index === 1 ? 'polish' : `stage_${index + 1}`;
    const newStage: ScriptwriterStage = {
      stage: defaultName,
      workspace_key: defaultName,
      prompt: '',
      tools: [],
    };
    update({ stages: [...current, newStage] });
  };

  const handleDeleteStage = (index: number) => {
    const current = [...stages()];
    current.splice(index, 1);
    update({ stages: current });
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const current = [...stages()];
    const temp = current[index - 1];
    current[index - 1] = current[index];
    current[index] = temp;
    update({ stages: current });
  };

  const handleMoveDown = (index: number) => {
    const current = [...stages()];
    if (index >= current.length - 1) return;
    const temp = current[index + 1];
    current[index + 1] = current[index];
    current[index] = temp;
    update({ stages: current });
  };

  const handleUpdateStage = (index: number, updates: Partial<ScriptwriterStage>) => {
    const current = [...stages()];
    if (current[index]) {
      current[index] = { ...current[index], ...updates };
      update({ stages: current });
    }
  };

  return (
    <div class="space-y-4">
      {/* 全局流水线参数 */}
      <div class="space-y-3 rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <div>
          <label class={LABEL_CLASS}>Anchor Tail Chars（尾锚字数）</label>
          <input
            type="number"
            min="0"
            class={INPUT_CLASS}
            value={props.config.anchor_tail_chars ?? 50}
            disabled={props.isLocked}
            onInput={(e) => update({ anchor_tail_chars: Math.max(0, Number(e.currentTarget.value) || 0) })}
          />
        </div>
        <div>
          <label class={LABEL_CLASS}>Blackout Marker（背景锁定标记）</label>
          <input
            type="text"
            class={INPUT_CLASS}
            value={props.config.blackout_marker ?? ''}
            disabled={props.isLocked}
            onInput={(e) => update({ blackout_marker: e.currentTarget.value })}
            placeholder="【前文背景已锁定】..."
          />
        </div>
      </div>

      {/* 阶段列表管理器 */}
      <div class="space-y-2.5">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <Layers3 class="h-3.5 w-3.5 text-accent" />
            <span class={LABEL_CLASS}>流水线阶段序列 (Stages)</span>
          </div>
          <span class="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-mono text-mist-solid/60">
            {stages().length} 阶段
          </span>
        </div>

        <Show
          when={stages().length > 0}
          fallback={
            <div class="rounded-lg border border-dashed border-white/15 p-4 text-center text-xs text-mist-solid/40">
              暂无阶段。请添加阶段（流水线至少需要 2 个阶段，如 draft 与 polish）。
            </div>
          }
        >
          <div class="space-y-2.5">
            <For each={stages()}>
              {(stageItem, idx) => (
                <div class="space-y-2 rounded-lg border border-white/10 bg-black/25 p-3 transition-all hover:border-white/20">
                  {/* 阶段头部控制条 */}
                  <div class="flex items-center gap-2">
                    <span class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent/20 text-[10px] font-mono font-bold text-accent">
                      {idx() + 1}
                    </span>

                    <input
                      type="text"
                      class="flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-xs font-mono font-medium text-white focus:border-accent focus:outline-none disabled:opacity-50"
                      value={stageItem.stage}
                      disabled={props.isLocked}
                      placeholder="阶段名 (如 draft / critique / polish)"
                      onInput={(e) => {
                        const newName = e.currentTarget.value;
                        const oldName = stageItem.stage;
                        // 若 workspace_key 原先与 stage 相同或为空，则自动联动更新
                        if (!stageItem.workspace_key || stageItem.workspace_key === oldName) {
                          handleUpdateStage(idx(), { stage: newName, workspace_key: newName });
                        } else {
                          handleUpdateStage(idx(), { stage: newName });
                        }
                      }}
                    />

                    {/* 排序与删除操作按钮 */}
                    <div class="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        class="rounded p-1 text-mist-solid/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                        title="上移阶段"
                        disabled={props.isLocked || idx() === 0}
                        onClick={() => handleMoveUp(idx())}
                      >
                        <ArrowUp class="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        class="rounded p-1 text-mist-solid/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                        title="下移阶段"
                        disabled={props.isLocked || idx() === stages().length - 1}
                        onClick={() => handleMoveDown(idx())}
                      >
                        <ArrowDown class="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        class="rounded p-1 text-mist-solid/60 transition-colors hover:bg-red-500/20 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                        title="删除阶段"
                        disabled={props.isLocked}
                        onClick={() => handleDeleteStage(idx())}
                      >
                        <Trash2 class="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 变量键名配置 */}
                  <div class="flex items-center gap-2">
                    <span class="w-16 shrink-0 text-[10px] text-mist-solid/40">工作区键:</span>
                    <input
                      type="text"
                      class="flex-1 rounded border border-white/10 bg-black/40 px-2 py-0.5 text-[11px] font-mono text-mist-solid focus:border-accent focus:outline-none disabled:opacity-50"
                      value={stageItem.workspace_key ?? ''}
                      disabled={props.isLocked}
                      placeholder="存储在工作区的键名（如 draft, final）"
                      onInput={(e) => handleUpdateStage(idx(), { workspace_key: e.currentTarget.value })}
                    />
                  </div>

                  {/* 阶段提示词 Textarea */}
                  <div>
                    <label class="mb-1 block text-[10px] text-mist-solid/40">阶段提示词 (Prompt):</label>
                    <textarea
                      rows={3}
                      class="w-full resize-y rounded border border-white/10 bg-black/40 px-2.5 py-1.5 text-xs text-white placeholder-mist-solid/30 focus:border-accent focus:outline-none disabled:opacity-50"
                      value={stageItem.prompt ?? ''}
                      disabled={props.isLocked}
                      placeholder="输入该阶段给模型的系统提示词或执行指令..."
                      onInput={(e) => handleUpdateStage(idx(), { prompt: e.currentTarget.value })}
                    />
                  </div>

                  {/* 阶段工具权限 */}
                  <ToolPermissionsCard
                    permissions={stageItem.tool_permissions}
                    isLocked={props.isLocked}
                    onUpdate={(perms) => handleUpdateStage(idx(), { tool_permissions: perms })}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* 添加新阶段按钮 */}
        <button
          type="button"
          class="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/20 bg-white/[0.03] py-2 text-xs font-medium text-mist-solid transition-all hover:border-accent hover:bg-accent/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={props.isLocked}
          onClick={handleAddStage}
        >
          <Plus class="h-3.5 w-3.5" />
          <span>添加阶段 (Add Stage)</span>
        </button>
      </div>
    </div>
  );
};
