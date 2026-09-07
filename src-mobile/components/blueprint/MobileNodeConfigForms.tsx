/**
 * 移动端蓝图节点配置表单（Task 13.1）。
 *
 * 8 种节点类型的配置表单合并到此文件，由 `MobileNodeConfigForm` 分发器按
 * `node.type` 渲染对应表单。表单为受控组件：父级持有 config 状态，通过
 * `onConfigChange` 回调提交变更。
 *
 * 设计要点：
 * - 移动端触摸优先：输入框/按钮有较大热区，select 用原生控件
 * - 不使用 hover 状态
 * - 复用 PC 端共享类型（types.ts），但表单组件在 src-mobile 内独立实现（C5）
 * - 表单不做后端校验，仅做最小前端格式约束（如数字解析）；保存时由父级决定
 */

import { Component, For, Index, Match, Show, Switch, createSignal } from 'solid-js';
import type {
  BlueprintNode,
  BranchCase,
  BranchConfig,
  ConstantConfig,
  EndConfig,
  GateOption,
  GroupGateConfig,
  ModeSwitchConfig,
  MutexGateConfig,
  NodeConfig,
  PromptConfig,
  RoleSwitchConfig,
  SamplingParamsConfig,
  AnthropicSamplingParamsConfig,
  OpenAiSamplingParamsConfig,
  SchemaFieldConfig,
  StartConfig,
} from '../../../src/lib/blueprint/types';

// ─── 公共 Props ───

export interface MobileNodeConfigFormProps {
  node: BlueprintNode;
  onConfigChange: (config: NodeConfig) => void;
}

// ─── 公共输入组件（移动端触摸优化）───

const FieldLabel: Component<{ label: string; hint?: string }> = (props) => (
  <div class="mb-1.5 flex items-baseline justify-between">
    <label class="text-[13px] font-semibold text-mist-solid/80">{props.label}</label>
    <Show when={props.hint}>
      <span class="text-[11px] text-mist-solid/40">{props.hint}</span>
    </Show>
  </div>
);

const TextInput: Component<{
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
}> = (props) => (
  <input
    type="text"
    value={props.value}
    placeholder={props.placeholder}
    onInput={(e) => props.onInput(e.currentTarget.value)}
    class="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[14px] text-mist-solid focus:outline-none focus:border-accent/50 placeholder-mist-solid/30"
  />
);

const TextArea: Component<{
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
  rows?: number;
}> = (props) => (
  <textarea
    value={props.value}
    placeholder={props.placeholder}
    rows={props.rows ?? 4}
    onInput={(e) => props.onInput(e.currentTarget.value)}
    class="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[14px] text-mist-solid focus:outline-none focus:border-accent/50 placeholder-mist-solid/30 resize-y min-h-[100px]"
  />
);

const NumberInput: Component<{
  value: number | null;
  onInput: (v: number | null) => void;
  placeholder?: string;
  step?: string;
}> = (props) => (
  <input
    type="number"
    value={props.value ?? ''}
    placeholder={props.placeholder}
    step={props.step ?? 'any'}
    onInput={(e) => {
      const raw = e.currentTarget.value;
      if (raw === '') {
        props.onInput(null);
        return;
      }
      const parsed = Number(raw);
      if (!Number.isNaN(parsed)) {
        props.onInput(parsed);
      }
    }}
    class="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[14px] text-mist-solid focus:outline-none focus:border-accent/50 placeholder-mist-solid/30"
  />
);

const Select: Component<{
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}> = (props) => (
  <div class="relative">
    <select
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
      class="w-full appearance-none px-3 py-2.5 pr-8 rounded-xl bg-white/5 border border-white/10 text-[14px] text-mist-solid focus:outline-none focus:border-accent/50"
    >
      <For each={props.options}>
        {(opt) => <option value={opt.value} class="bg-xuanqing text-white">{opt.label}</option>}
      </For>
    </select>
    <svg class="absolute right-2.5 top-1/2 -translate-y-1/2 text-mist-solid/50 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
  </div>
);

const Toggle: Component<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}> = (props) => (
  <button
    type="button"
    onClick={() => props.onChange(!props.checked)}
    class="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-white/5 border border-white/10"
  >
    <span class="text-[14px] text-mist-solid">{props.label}</span>
    <span class={`relative w-11 h-6 rounded-full transition-colors ${props.checked ? 'bg-accent' : 'bg-white/15'}`}>
      <span class={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${props.checked ? 'translate-x-5' : ''}`} />
    </span>
  </button>
);

// ─── Start / End（无配置）───

const StartEndForm: Component<{ type: 'start' | 'end' }> = () => (
  <div class="px-4 py-6 text-center text-mist-solid/50 text-sm">
    此节点无可配置项。
  </div>
);

// ─── Prompt 节点表单 ───

const BLOCK_TYPE_OPTIONS = [
  { value: 'system', label: 'system' },
  { value: 'character', label: 'character' },
  { value: 'world_book', label: 'world_book' },
  { value: 'plot_summary', label: 'plot_summary' },
  { value: 'world_variable', label: 'world_variable' },
  { value: 'recent_history', label: 'recent_history' },
  { value: 'current_user', label: 'current_user' },
];

const PromptForm: Component<{
  config: PromptConfig;
  onChange: (c: PromptConfig) => void;
}> = (props) => {
  return (
    <div class="flex flex-col gap-4 px-4">
      <div>
        <FieldLabel label="标识 (identifier)" />
        <TextInput
          value={props.config.identifier}
          placeholder="如 role_definition"
          onInput={(v) => props.onChange({ ...props.config, identifier: v })}
        />
      </div>
      <div>
        <FieldLabel label="block 类型" />
        <Select
          value={props.config.block_type}
          onChange={(v) => props.onChange({ ...props.config, block_type: v })}
          options={BLOCK_TYPE_OPTIONS}
        />
      </div>
      <div>
        <FieldLabel label="内容 (content)" />
        <TextArea
          value={props.config.content}
          placeholder="提示词内容……"
          rows={6}
          onInput={(v) => props.onChange({ ...props.config, content: v })}
        />
      </div>
      <div>
        <FieldLabel label="优先级 (priority)" hint="留空使用默认" />
        <NumberInput
          value={props.config.priority}
          placeholder="留空使用默认"
          step="1"
          onInput={(v) => props.onChange({ ...props.config, priority: v === null ? null : Math.trunc(v) })}
        />
      </div>
      <div>
        <Toggle
          checked={props.config.is_locked}
          onChange={(v) => props.onChange({ ...props.config, is_locked: v, lock_reason: v ? (props.config.lock_reason ?? '') : null })}
          label="锁定（条目锁）"
        />
      </div>
      <Show when={props.config.is_locked}>
        <div>
          <FieldLabel label="锁定原因" />
          <TextInput
            value={props.config.lock_reason ?? ''}
            placeholder="如：核心角色定义不可改"
            onInput={(v) => props.onChange({ ...props.config, lock_reason: v })}
          />
        </div>
      </Show>
    </div>
  );
};

// ─── SchemaField 节点表单 ───

const FIELD_TYPE_OPTIONS = [
  { value: 'string', label: 'string' },
  { value: 'object', label: 'object' },
  { value: 'array', label: 'array' },
  { value: 'number', label: 'number' },
  { value: 'integer', label: 'integer' },
  { value: 'boolean', label: 'boolean' },
];

const DB_MAPPING_OPTIONS = [
  { value: '', label: '不持久化' },
  { value: 'world_variables', label: 'world_variables' },
  { value: 'plot_summary', label: 'plot_summary' },
];

const SchemaFieldForm: Component<{
  config: SchemaFieldConfig;
  onChange: (c: SchemaFieldConfig) => void;
}> = (props) => {
  const subSchemaText = () => {
    const ss = props.config.sub_schema;
    if (!ss) return '';
    try {
      return JSON.stringify(ss, null, 2);
    } catch {
      return '';
    }
  };
  return (
    <div class="flex flex-col gap-4 px-4">
      <div>
        <FieldLabel label="字段名 (field_name)" />
        <TextInput
          value={props.config.field_name}
          placeholder="如 thinking"
          onInput={(v) => props.onChange({ ...props.config, field_name: v })}
        />
      </div>
      <div>
        <FieldLabel label="字段类型" />
        <Select
          value={props.config.field_type}
          onChange={(v) => props.onChange({ ...props.config, field_type: v })}
          options={FIELD_TYPE_OPTIONS}
        />
      </div>
      <div>
        <FieldLabel label="描述 (description)" />
        <TextInput
          value={props.config.description}
          placeholder="字段描述"
          onInput={(v) => props.onChange({ ...props.config, description: v })}
        />
      </div>
      <div>
        <FieldLabel label="子结构 (sub_schema)" hint="JSON，留空表示无" />
        <TextArea
          value={subSchemaText()}
          placeholder='如 {"properties": {"location": {"type": "string"}}}'
          rows={4}
          onInput={(v) => {
            const trimmed = v.trim();
            if (trimmed === '') {
              props.onChange({ ...props.config, sub_schema: null });
              return;
            }
            try {
              const parsed = JSON.parse(trimmed) as Record<string, unknown>;
              props.onChange({ ...props.config, sub_schema: parsed });
            } catch {
              // 解析失败时不更新——避免输入中途丢失；最终保存时父级会再校验
            }
          }}
        />
      </div>
      <div>
        <FieldLabel label="DB 映射 (db_mapping)" hint="对应持久化列" />
        <Select
          value={props.config.db_mapping ?? ''}
          onChange={(v) => props.onChange({ ...props.config, db_mapping: v === '' ? null : v })}
          options={DB_MAPPING_OPTIONS}
        />
      </div>
      <div>
        <FieldLabel label="顺序权重 (order)" hint="数值越小越靠前；缺省 0" />
        <NumberInput
          value={props.config.order ?? 0}
          step="1"
          placeholder="缺省 0"
          onInput={(v) => props.onChange({ ...props.config, order: v === null ? 0 : Math.trunc(v) })}
        />
        <p class="text-[10px] text-mist-solid/40 mt-1">
          控制该字段在结构化输出 schema 的 properties / required 中的排列顺序
          （按 (order, 遍历序) 升序排序，数值越小越靠前；相同 order 按画布连线遍历序）。
        </p>
      </div>
      <div>
        <FieldLabel label="Schema 行为" />
        <div class="flex flex-col gap-1.5">
          <Toggle
            checked={props.config.required}
            onChange={(v) => props.onChange({ ...props.config, required: v })}
            label="required（加入 schema required 数组）"
          />
          <Toggle
            checked={props.config.context_included}
            onChange={(v) => props.onChange({ ...props.config, context_included: v })}
            label="context_included（注入下一轮上下文）"
          />
        </div>
      </div>
      <div>
        <FieldLabel label="显示偏好" />
        <div class="flex flex-col gap-1.5">
          <Toggle
            checked={props.config.display.default_expanded}
            onChange={(v) => props.onChange({ ...props.config, display: { ...props.config.display, default_expanded: v } })}
            label="default_expanded（消息列表默认展开）"
          />
          <Toggle
            checked={props.config.display.hide_label}
            onChange={(v) => props.onChange({ ...props.config, display: { ...props.config.display, hide_label: v } })}
            label="hide_label（消息列表隐藏字段标签）"
          />
        </div>
      </div>
      <div>
        <Toggle
          checked={props.config.is_locked}
          onChange={(v) => props.onChange({ ...props.config, is_locked: v, lock_reason: v ? (props.config.lock_reason ?? '') : null })}
          label="锁定（条目锁）"
        />
      </div>
      <Show when={props.config.is_locked}>
        <div>
          <FieldLabel label="锁定原因" />
          <TextInput
            value={props.config.lock_reason ?? ''}
            placeholder="锁定原因"
            onInput={(v) => props.onChange({ ...props.config, lock_reason: v })}
          />
        </div>
      </Show>
    </div>
  );
};

// ─── Gate（MutexGate / GroupGate）节点表单 ───

const GateForm: Component<{
  config: MutexGateConfig | GroupGateConfig;
  isMultiple: boolean;
  onChange: (c: MutexGateConfig | GroupGateConfig) => void;
}> = (props) => {
  const updateOption = (idx: number, patch: Partial<GateOption>) => {
    const next = props.config.options.map((opt, i) => (i === idx ? { ...opt, ...patch } : opt));
    props.onChange({ ...props.config, options: next });
  };
  const addOption = () => {
    const n = props.config.options.length + 1;
    const next = [...props.config.options, { key: `opt_${n}`, label: `选项 ${n}`, description: '' }];
    props.onChange({ ...props.config, options: next });
  };
  const removeOption = (idx: number) => {
    if (props.config.options.length <= 1) return;
    const next = props.config.options.filter((_, i) => i !== idx);
    props.onChange({ ...props.config, options: next });
  };

  return (
    <div class="flex flex-col gap-4 px-4">
      <div>
        <FieldLabel label="显示名 (label)" />
        <TextInput
          value={props.config.label}
          placeholder="如 角色互斥组"
          onInput={(v) => props.onChange({ ...props.config, label: v })}
        />
      </div>
      <div>
        <FieldLabel label="选项列表" hint={props.isMultiple ? '多选' : '单选'} />
        <div class="flex flex-col gap-2">
          <Index each={props.config.options}>
            {(opt, idx) => (
              <div class="flex flex-col gap-1.5 p-2 rounded-lg bg-white/[0.02] border border-white/5">
                <div class="flex gap-2 items-center">
                  <input
                    type="text"
                    value={opt().key}
                    placeholder="key"
                    onInput={(e) => updateOption(idx, { key: e.currentTarget.value })}
                    class="w-1/3 px-2 py-2 rounded-lg bg-white/5 border border-white/10 text-[12px] text-mist-solid/80 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={opt().label}
                    placeholder="显示名"
                    onInput={(e) => updateOption(idx, { label: e.currentTarget.value })}
                    class="flex-1 px-2 py-2 rounded-lg bg-white/5 border border-white/10 text-[13px] text-mist-solid focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(idx)}
                    disabled={props.config.options.length <= 1}
                    class="shrink-0 w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-300 disabled:opacity-30 flex items-center justify-center"
                    aria-label="删除选项"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                </div>
                <input
                  type="text"
                  value={opt().description}
                  placeholder="描述（在预设工作区选择时展示给用户）"
                  onInput={(e) => updateOption(idx, { description: e.currentTarget.value })}
                  class="w-full px-2 py-2 rounded-lg bg-white/5 border border-white/10 text-[12px] text-mist-solid/60 focus:outline-none"
                />
              </div>
            )}
          </Index>
          <button
            type="button"
            onClick={addOption}
            class="self-start px-3 py-1.5 rounded-lg bg-accent/15 border border-accent/30 text-accent text-[12px] font-medium"
          >
            + 添加选项
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── ModeSwitch 节点表单 ───

const ModeSwitchForm: Component<{
  config: ModeSwitchConfig;
  onChange: (c: ModeSwitchConfig) => void;
}> = (props) => (
  <div class="flex flex-col gap-4 px-4">
    <div>
      <FieldLabel label="显示名 (label)" />
      <TextInput
        value={props.config.label}
        placeholder="如 记忆模式分支"
        onInput={(v) => props.onChange({ ...props.config, label: v })}
      />
    </div>
    <div class="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[12px] text-mist-solid/60 leading-relaxed">
      ModeSwitch 有三个固定出口：out_legacy / out_mem0 / out_stateless，运行时按会话 memoryMode 走对应分支。三个出口都应连通。
    </div>
  </div>
);

// ─── RoleSwitch 节点表单（已废弃，仍可编辑旧图）───

const RoleSwitchForm: Component<{
  config: RoleSwitchConfig;
  onChange: (c: RoleSwitchConfig) => void;
}> = (props) => (
  <div class="flex flex-col gap-4 px-4">
    <div class="px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-300/80 leading-relaxed">
      RoleSwitch 已废弃，建议迁移为 Constant + Branch 节点。旧图仍可执行。
    </div>
    <div>
      <FieldLabel label="显示名 (label)" />
      <TextInput
        value={props.config.label}
        placeholder="如 角色模式分支"
        onInput={(v) => props.onChange({ ...props.config, label: v })}
      />
    </div>
    <div class="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[12px] text-mist-solid/60 leading-relaxed">
      RoleSwitch 有两个固定出口：out_single / out_online，运行时按会话 conversationType 走对应分支。与 ModeSwitch 串联可实现 6 种排列组合路径。两个出口都应连通。
    </div>
  </div>
);

// ─── Constant 节点表单（spec 里程碑 C）───

const ConstantForm: Component<{
  config: ConstantConfig;
  onChange: (c: ConstantConfig) => void;
}> = (props) => (
  <div class="flex flex-col gap-4 px-4">
    <div>
      <FieldLabel label="显示名 (label)" />
      <TextInput
        value={props.config.label}
        placeholder="如 会话角色"
        onInput={(v) => props.onChange({ ...props.config, label: v })}
      />
    </div>
    <div>
      <FieldLabel label="source（会话属性键名）" />
      <select
        class="w-full h-12 px-3 rounded-xl bg-night-deep/80 border border-white/10 text-sm text-mist-solid focus:outline-none focus:border-accent/40"
        value={props.config.source}
        onChange={(e) => props.onChange({ ...props.config, source: e.currentTarget.value })}
      >
        <option value="conversation_type">conversation_type（single / online）</option>
        <option value="memory_mode">memory_mode（stateless / legacy / mem0）</option>
        <option value="protocol">protocol（anthropic / chat_completions）</option>
      </select>
    </div>
    <div class="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[12px] text-mist-solid/60 leading-relaxed">
      运行时读取会话对应属性值，输出到 out 端口供下游 Branch 节点按值匹配走分支。
    </div>
  </div>
);

// ─── Branch 节点表单（spec 里程碑 C）───

const BranchForm: Component<{
  config: BranchConfig;
  onChange: (c: BranchConfig) => void;
}> = (props) => {
  const handleAddCase = () => {
    const nextIndex = props.config.cases.length;
    const newCase: BranchCase = {
      match_value: '',
      port: `out_${nextIndex + 1}`,
    };
    props.onChange({ ...props.config, cases: [...props.config.cases, newCase] });
  };

  const handleRemoveCase = (index: number) => {
    props.onChange({ ...props.config, cases: props.config.cases.filter((_, i) => i !== index) });
  };

  const handleUpdateCase = (index: number, updates: Partial<BranchCase>) => {
    const next = props.config.cases.map((c, i) =>
      i === index ? { ...c, ...updates } : c,
    );
    props.onChange({ ...props.config, cases: next });
  };

  return (
    <div class="flex flex-col gap-4 px-4">
      <div>
        <FieldLabel label="显示名 (label)" />
        <TextInput
          value={props.config.label}
          placeholder="如 角色分支"
          onInput={(v) => props.onChange({ ...props.config, label: v })}
        />
      </div>

      <div>
        <div class="flex items-center justify-between mb-2">
          <FieldLabel label="匹配规则（按顺序匹配）" />
          <button
            type="button"
            class="inline-flex items-center gap-1 text-[12px] text-accent px-2 h-8 rounded-lg bg-accent/10 active:bg-accent/20"
            onClick={handleAddCase}
          >
            + 添加
          </button>
        </div>
        {/*
          用 <Index> 而非 <For>：每次按键都会生成新的 case 对象，<For> 按引用
          比对会判定为"换了一项"从而销毁重建整行 DOM，输入框随即失焦。<Index>
          按下标比对，只更新行内 signal，不重建 DOM。
        */}
        <Index each={props.config.cases}>
          {(caseItem, index) => (
            <div class="flex items-center gap-2 mb-2 p-2 rounded-xl bg-night-deep/40 border border-white/5">
              <input
                type="text"
                class="flex-1 min-w-0 h-10 px-2 rounded-lg bg-night-deep/80 border border-white/10 text-xs text-mist-solid focus:outline-none focus:border-accent/40"
                placeholder="匹配值 (如 single)"
                value={caseItem().match_value}
                onInput={(e) => handleUpdateCase(index, { match_value: e.currentTarget.value })}
              />
              <span class="text-mist-solid/40 text-xs">→</span>
              <input
                type="text"
                class="flex-1 min-w-0 h-10 px-2 rounded-lg bg-night-deep/80 border border-white/10 text-xs text-mist-solid focus:outline-none focus:border-accent/40"
                placeholder="出口端口 (如 out_single)"
                value={caseItem().port}
                onInput={(e) => handleUpdateCase(index, { port: e.currentTarget.value })}
              />
              <button
                type="button"
                class="text-mist-solid/40 active:text-red-400 w-8 h-8 flex items-center justify-center"
                onClick={() => handleRemoveCase(index)}
                aria-label="删除规则"
              >
                ×
              </button>
            </div>
          )}
        </Index>
        <Show when={props.config.cases.length === 0}>
          <p class="text-[12px] text-mist-solid/40 leading-5 py-2">
            尚无匹配规则。点击"添加"创建一条。
          </p>
        </Show>
      </div>

      <div>
        <FieldLabel label="default_port（默认出口端口名）" />
        <TextInput
          value={props.config.default_port}
          placeholder="如 out_default"
          onInput={(v) => props.onChange({ ...props.config, default_port: v })}
        />
      </div>

      <div class="px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[12px] text-mist-solid/60 leading-relaxed">
        每条规则的出口端口必须连一条出边；默认出口也必须有出边。Branch 的入边必须来自 Constant 节点。
      </div>
    </div>
  );
};

// ─── SamplingParams 节点表单 ───

const SamplingParamsForm: Component<{
  config: SamplingParamsConfig;
  onChange: (c: SamplingParamsConfig) => void;
}> = (props) => {
  const [stopInput, setStopInput] = createSignal(props.config.stop?.join('\n') ?? '');
  return (
    <div class="flex flex-col gap-4 px-4">
      <div>
        <FieldLabel label="temperature" />
        <NumberInput
          value={props.config.temperature}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, temperature: v })}
        />
      </div>
      <div>
        <FieldLabel label="max_tokens" />
        <NumberInput
          value={props.config.max_tokens}
          placeholder="留空表示不设置"
          step="1"
          onInput={(v) => props.onChange({ ...props.config, max_tokens: v === null ? null : Math.trunc(v) })}
        />
      </div>
      <div>
        <FieldLabel label="top_p" />
        <NumberInput
          value={props.config.top_p}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, top_p: v })}
        />
      </div>
      <div>
        <FieldLabel label="frequency_penalty" />
        <NumberInput
          value={props.config.frequency_penalty}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, frequency_penalty: v })}
        />
      </div>
      <div>
        <FieldLabel label="presence_penalty" />
        <NumberInput
          value={props.config.presence_penalty}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, presence_penalty: v })}
        />
      </div>
      <div>
        <FieldLabel label="stop 序列" hint="每行一个" />
        <TextArea
          value={stopInput()}
          placeholder={'每行一个 stop 序列\n如 </thought>'}
          rows={3}
          onInput={(v) => {
            setStopInput(v);
            const lines = v.split('\n').map((s) => s.trim()).filter((s) => s !== '');
            props.onChange({ ...props.config, stop: lines.length > 0 ? lines : null });
          }}
        />
      </div>
      <div>
        <Toggle
          checked={props.config.thinking_enabled ?? false}
          onChange={(v) => props.onChange({ ...props.config, thinking_enabled: v ? true : null })}
          label="thinking_enabled（开启思考/推理，仅 Anthropic 生效）"
        />
      </div>
      <div>
        <FieldLabel label="thinking_budget_tokens（思考预算，≥1024）" />
        <NumberInput
          value={props.config.thinking_budget_tokens}
          placeholder="留空表示不设置"
          step="1"
          onInput={(v) =>
            props.onChange({
              ...props.config,
              thinking_budget_tokens: v === null ? null : Math.max(1024, Math.trunc(v)),
            })
          }
        />
      </div>
      <div>
        <Toggle
          checked={props.config.is_locked}
          onChange={(v) => props.onChange({ ...props.config, is_locked: v })}
          label="锁定（条目锁）"
        />
      </div>
    </div>
  );
};

/// OpenAI 版采样参数表单：只含 chat_completions 协议支持的字段。
const OpenAiSamplingParamsForm: Component<{
  config: OpenAiSamplingParamsConfig;
  onChange: (c: OpenAiSamplingParamsConfig) => void;
}> = (props) => {
  const [stopInput, setStopInput] = createSignal(props.config.stop?.join('\n') ?? '');
  return (
    <div class="flex flex-col gap-4 px-4">
      <p class="text-[11px] text-mist-solid/45 leading-5">
        仅在当前会话协议为 chat_completions 时生效。
      </p>
      <div>
        <FieldLabel label="temperature" />
        <NumberInput
          value={props.config.temperature}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, temperature: v })}
        />
      </div>
      <div>
        <FieldLabel label="max_tokens" />
        <NumberInput
          value={props.config.max_tokens}
          placeholder="留空表示不设置"
          step="1"
          onInput={(v) => props.onChange({ ...props.config, max_tokens: v === null ? null : Math.trunc(v) })}
        />
      </div>
      <div>
        <FieldLabel label="top_p" />
        <NumberInput
          value={props.config.top_p}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, top_p: v })}
        />
      </div>
      <div>
        <FieldLabel label="frequency_penalty" />
        <NumberInput
          value={props.config.frequency_penalty}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, frequency_penalty: v })}
        />
      </div>
      <div>
        <FieldLabel label="presence_penalty" />
        <NumberInput
          value={props.config.presence_penalty}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, presence_penalty: v })}
        />
      </div>
      <div>
        <FieldLabel label="stop 序列" hint="每行一个" />
        <TextArea
          value={stopInput()}
          placeholder={'每行一个 stop 序列\n如 </thought>'}
          rows={3}
          onInput={(v) => {
            setStopInput(v);
            const lines = v.split('\n').map((s) => s.trim()).filter((s) => s !== '');
            props.onChange({ ...props.config, stop: lines.length > 0 ? lines : null });
          }}
        />
      </div>
      <div>
        <Toggle
          checked={props.config.is_locked}
          onChange={(v) => props.onChange({ ...props.config, is_locked: v })}
          label="锁定（条目锁）"
        />
      </div>
    </div>
  );
};

/// Anthropic 版采样参数表单：只含 Anthropic 支持的字段（含 thinking 配置）。
const AnthropicSamplingParamsForm: Component<{
  config: AnthropicSamplingParamsConfig;
  onChange: (c: AnthropicSamplingParamsConfig) => void;
}> = (props) => {
  const [stopInput, setStopInput] = createSignal(props.config.stop?.join('\n') ?? '');
  return (
    <div class="flex flex-col gap-4 px-4">
      <p class="text-[11px] text-mist-solid/45 leading-5">
        仅在当前会话协议为 anthropic 时生效。
      </p>
      <div>
        <FieldLabel label="temperature" />
        <NumberInput
          value={props.config.temperature}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, temperature: v })}
        />
      </div>
      <div>
        <FieldLabel
          label={
            props.config.thinking_enabled
              ? 'max_tokens（需 > 思考预算）'
              : 'max_tokens'
          }
        />
        <NumberInput
          value={props.config.max_tokens}
          placeholder={
            props.config.thinking_enabled
              ? '留空自动保底 (> 预算)'
              : '留空表示不设置'
          }
          step="1"
          onInput={(v) => {
            const minAllowed = props.config.thinking_enabled
              ? Math.max(1025, (props.config.thinking_budget_tokens ?? 1024) + 1)
              : 1;
            props.onChange({
              ...props.config,
              max_tokens: v === null ? null : Math.max(minAllowed, Math.trunc(v)),
            });
          }}
        />
      </div>
      <div>
        <FieldLabel label="top_p" />
        <NumberInput
          value={props.config.top_p}
          placeholder="留空表示不设置"
          step="0.01"
          onInput={(v) => props.onChange({ ...props.config, top_p: v })}
        />
      </div>
      <div>
        <FieldLabel label="stop 序列" hint="每行一个" />
        <TextArea
          value={stopInput()}
          placeholder={'每行一个 stop 序列\n如 </thought>'}
          rows={3}
          onInput={(v) => {
            setStopInput(v);
            const lines = v.split('\n').map((s) => s.trim()).filter((s) => s !== '');
            props.onChange({ ...props.config, stop: lines.length > 0 ? lines : null });
          }}
        />
      </div>
      <div>
        <Toggle
          checked={props.config.thinking_enabled ?? false}
          onChange={(v) => props.onChange({ ...props.config, thinking_enabled: v ? true : null })}
          label="thinking_enabled（开启思考/推理）"
        />
      </div>
      <div>
        <FieldLabel label="thinking_budget_tokens（思考预算，≥1024）" />
        <NumberInput
          value={props.config.thinking_budget_tokens}
          placeholder="留空沿用 max_tokens 预算"
          step="1"
          onInput={(v) =>
            props.onChange({
              ...props.config,
              thinking_budget_tokens: v === null ? null : Math.max(1024, Math.trunc(v)),
            })
          }
        />
      </div>
      <div>
        <Toggle
          checked={props.config.is_locked}
          onChange={(v) => props.onChange({ ...props.config, is_locked: v })}
          label="锁定（条目锁）"
        />
      </div>
    </div>
  );
};

// ─── 分发器 ───
//
// 使用 <Switch>/<Match> 而非 `switch (node.type) { return <Form /> }`。
// 原因：SolidJS 组件函数只执行一次，`const node = props.node` 是非响应式
// 快照，后续 props.node 变化时表单不会更新；且 switch 返回新 JSX 会导致
// 组件在每次 config 变化时重新挂载（input 失焦）。
// <Match> 只在 node.type 变化时切换分支；config 变化时仅更新 props，
// 保持表单实例和焦点稳定。

export const MobileNodeConfigForm: Component<MobileNodeConfigFormProps> = (props) => {
  return (
    <Switch fallback={null}>
      <Match when={props.node.type === 'start'}>
        <StartEndForm type="start" />
      </Match>
      <Match when={props.node.type === 'end'}>
        <StartEndForm type="end" />
      </Match>
      <Match when={props.node.type === 'prompt'}>
        <PromptForm
          config={props.node.config as PromptConfig}
          onChange={(c: PromptConfig) => props.onConfigChange({ type: 'prompt', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'schema_field'}>
        <SchemaFieldForm
          config={props.node.config as SchemaFieldConfig}
          onChange={(c: SchemaFieldConfig) => props.onConfigChange({ type: 'schema_field', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'mutex_gate'}>
        <GateForm
          config={props.node.config as MutexGateConfig}
          isMultiple={false}
          onChange={(c: MutexGateConfig) => props.onConfigChange({ type: 'mutex_gate', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'group_gate'}>
        <GateForm
          config={props.node.config as GroupGateConfig}
          isMultiple={true}
          onChange={(c: GroupGateConfig) => props.onConfigChange({ type: 'group_gate', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'mode_switch'}>
        <ModeSwitchForm
          config={props.node.config as ModeSwitchConfig}
          onChange={(c: ModeSwitchConfig) => props.onConfigChange({ type: 'mode_switch', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'role_switch'}>
        <RoleSwitchForm
          config={props.node.config as RoleSwitchConfig}
          onChange={(c: RoleSwitchConfig) => props.onConfigChange({ type: 'role_switch', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'constant'}>
        <ConstantForm
          config={props.node.config as ConstantConfig}
          onChange={(c: ConstantConfig) => props.onConfigChange({ type: 'constant', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'branch'}>
        <BranchForm
          config={props.node.config as BranchConfig}
          onChange={(c: BranchConfig) => props.onConfigChange({ type: 'branch', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'sampling_params'}>
        <SamplingParamsForm
          config={props.node.config as SamplingParamsConfig}
          onChange={(c: SamplingParamsConfig) => props.onConfigChange({ type: 'sampling_params', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'sampling_params_openai'}>
        <OpenAiSamplingParamsForm
          config={props.node.config as OpenAiSamplingParamsConfig}
          onChange={(c: OpenAiSamplingParamsConfig) => props.onConfigChange({ type: 'sampling_params_openai', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'sampling_params_anthropic'}>
        <AnthropicSamplingParamsForm
          config={props.node.config as AnthropicSamplingParamsConfig}
          onChange={(c: AnthropicSamplingParamsConfig) => props.onConfigChange({ type: 'sampling_params_anthropic', config: c })}
        />
      </Match>
    </Switch>
  );
};

// ─── 导出空配置工厂（用于 BlueprintEditor 创建新节点时初始化）───

export function defaultConfigForType(type: BlueprintNode['type']): NodeConfig {
  switch (type) {
    case 'start':
      return { type: 'start', config: {} as StartConfig };
    case 'end':
      return { type: 'end', config: {} as EndConfig };
    case 'prompt':
      return {
        type: 'prompt',
        config: {
          identifier: 'new_block',
          block_type: 'system',
          content: '',
          priority: null,
          is_locked: false,
          lock_reason: null,
        },
      };
    case 'schema_field':
      return {
        type: 'schema_field',
        config: {
          field_name: 'new_field',
          field_type: 'string',
          description: '',
          sub_schema: null,
          db_mapping: null,
          required: true,
          context_included: true,
          display: { default_expanded: true, hide_label: false },
          is_locked: false,
          lock_reason: null,
          order: 0,
        },
      };
    case 'mutex_gate':
      return {
        type: 'mutex_gate',
        config: {
          label: '互斥组',
          options: [
            { key: 'opt_a', label: '选项 A', description: '' },
            { key: 'opt_b', label: '选项 B', description: '' },
          ],
        },
      };
    case 'group_gate':
      return {
        type: 'group_gate',
        config: {
          label: '多选组',
          options: [
            { key: 'opt_a', label: '选项 A', description: '' },
            { key: 'opt_b', label: '选项 B', description: '' },
          ],
        },
      };
    case 'mode_switch':
      return {
        type: 'mode_switch',
        config: { label: '记忆模式分支' },
      };
    case 'role_switch':
      return {
        type: 'role_switch',
        config: { label: '角色模式分支' },
      };
    case 'constant':
      return {
        type: 'constant',
        config: {
          label: '会话角色',
          source: 'conversation_type',
        },
      };
    case 'branch':
      return {
        type: 'branch',
        config: {
          label: '角色分支',
          cases: [
            { match_value: 'single', port: 'out_single' },
            { match_value: 'online', port: 'out_online' },
          ],
          default_port: 'out_single',
        },
      };
    case 'sampling_params':
      return {
        type: 'sampling_params',
        config: {
          temperature: null,
          max_tokens: null,
          top_p: null,
          frequency_penalty: null,
          presence_penalty: null,
          stop: null,
          thinking_enabled: null,
          thinking_budget_tokens: null,
          is_locked: false,
        },
      };
    case 'sampling_params_openai':
      return {
        type: 'sampling_params_openai',
        config: {
          temperature: null,
          max_tokens: null,
          top_p: null,
          frequency_penalty: null,
          presence_penalty: null,
          stop: null,
          is_locked: false,
        },
      };
    case 'sampling_params_anthropic':
      return {
        type: 'sampling_params_anthropic',
        config: {
          temperature: null,
          max_tokens: null,
          top_p: null,
          stop: null,
          thinking_enabled: null,
          thinking_budget_tokens: null,
          is_locked: false,
        },
      };
  }
}
