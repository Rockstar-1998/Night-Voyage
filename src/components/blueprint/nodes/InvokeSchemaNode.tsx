import { Component, For, Show, createResource } from 'solid-js';
import type { InvokeSchemaConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';
import { presetSchemasList } from '../../../lib/backend/schema';
import { Layers3, Sparkles } from '../../../lib/icons';

const SELECT_CLASS =
  'w-full bg-night-water border border-white/15 rounded-lg py-2 px-3 text-sm text-mist-solid focus:outline-none focus:border-accent transition-all disabled:opacity-50 disabled:cursor-not-allowed';

const LABEL_CLASS = 'text-[10px] text-mist-solid/40 uppercase tracking-widest';

export const InvokeSchemaNode: Component<NodeConfigComponentProps<InvokeSchemaConfig>> = (props) => {
  const update = (updates: Partial<InvokeSchemaConfig>) => props.onUpdate(updates);

  // 可选 Schema 来自真实数据源（preset_schemas_list），不内置任何候选值（C11）；
  // 无预设 id / 读取失败 / 列表为空分别显式提示（C2）。
  const [schemas] = createResource(
    () => props.presetId,
    async (presetId: number) => presetSchemasList(presetId),
  );

  const schemaError = () => {
    const err = schemas.error;
    if (!err) return null;
    return err instanceof Error ? err.message : String(err);
  };

  return (
    <div class="space-y-4">
      <div class="p-3 rounded-xl border border-accent/20 bg-accent/5 space-y-2">
        <div class="flex items-center gap-2 text-xs font-bold text-accent">
          <Layers3 size={16} />
          <span>按需调用独立 Schema 资产</span>
        </div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          仅当蓝图执行流实际遍历到达本节点时，执行器才读取该 <code class="text-accent">schema_id</code> 的定义并激活为本次 structured_output_schema；正文处理完毕后按 Schema 规范格式化输出，状态字段流向常驻 HUD 原地刷新。
        </p>
      </div>

      <div class="space-y-1">
        <label class={LABEL_CLASS}>调用目标 Schema</label>
        <Show
          when={props.presetId != null}
          fallback={
            <div class="p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300">
              无法读取 Schema 列表：当前蓝图没有关联预设 id。
            </div>
          }
        >
          <Show
            when={!schemaError()}
            fallback={
              <div class="p-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 text-[11px] text-rose-300">
                读取 Schema 列表失败：{schemaError()}
              </div>
            }
          >
            <Show
              when={(schemas() ?? []).length > 0}
              fallback={
                <div class="p-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 text-[11px] text-amber-300">
                  该预设下还没有 Schema。请先在预设详情页的「Schema 管理」里创建。
                </div>
              }
            >
              <select
                value={props.config.schema_id || ''}
                disabled={props.isLocked || schemas.loading}
                onChange={(e) => update({ schema_id: e.currentTarget.value })}
                class={SELECT_CLASS}
              >
                <option value="">（未选择）</option>
                <For each={schemas() ?? []}>
                  {(schema) => (
                    <option value={schema.id}>
                      {schema.name}
                      {schema.retentionDepth != null ? ` · 保留 ${schema.retentionDepth} 层` : ' · 不限层数'}
                    </option>
                  )}
                </For>
              </select>
            </Show>
          </Show>
        </Show>
        <p class="text-[10px] text-mist-solid/35">
          在预设详情页的【Schema 管理】中可创建并查看所有可用的 Schema。
        </p>
      </div>

      <div class="p-3 rounded-xl border border-white/5 bg-white/[0.02] space-y-1.5 text-xs text-mist-solid/50">
        <div class="font-bold text-mist-solid/70 flex items-center gap-1.5">
          <Sparkles size={13} class="text-accent" />
          <span>运行机制保障</span>
        </div>
        <ul class="list-disc list-inside space-y-1 text-[11px] text-mist-solid/45">
          <li>严格依照该 Schema 独立编辑器中的物理顺序排布字段</li>
          <li>根据该 Schema 独立设置的保留层数自动倒序滑动裁剪</li>
          <li>若前置分支未流经本节点，则完全不注入该 Schema，零冗余开销</li>
        </ul>
      </div>
    </div>
  );
};
