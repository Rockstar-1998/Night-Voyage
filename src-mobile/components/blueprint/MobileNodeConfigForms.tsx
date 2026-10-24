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
  InvokeSchemaConfig,
  ToolDefinitionConfig,
  CalculatorConfig,
  ConditionGateConfig,
  ToolReturnConfig,
  UiLayoutConfig,
  InitialStateConfig,
  InitialStatDef,
  InitialStateInventoryItem,
  InspectorConfig,
  WriterConfig,
  QuerierConfig,
  BannedWordsConfig,
  ScriptwriterStage,
  ScriptwriterPipelineConfig,
  AgentModeSwitchConfig,
  DirectorConfig,
  ActorDefinition,
  BlueprintMacro,
  MacroInstanceConfig,
  MacroInputsConfig,
  MacroOutputsConfig,
  MacroPinDefinition,
  PinType,
} from '../../lib/blueprint/types';
import { PIN_TYPE_COLORS } from './mobileNodeLayout';
import { MobileToolPermissionsCard, type MobileToolItem } from './MobileToolPermissionsModal';

// ─── 公共 Props ───

export interface MobileNodeConfigFormProps {
  node: BlueprintNode;
  onConfigChange: (config: NodeConfig) => void;
  macros?: BlueprintMacro[];
  onOpenMacro?: (macroId: string) => void;
  availableTools?: MobileToolItem[];
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
          <Toggle
            checked={props.config.display.body ?? false}
            onChange={(v) => props.onChange({ ...props.config, display: { ...props.config.display, body: v } })}
            label="body（叙事正文展示，不折叠）"
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
        <option value="memory_mode">memory_mode（legacy / mem0）</option>
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

const InvokeSchemaForm: Component<{
  config: InvokeSchemaConfig;
  onChange: (c: InvokeSchemaConfig) => void;
}> = (props) => {
  return (
    <div class="space-y-4">
      <div>
        <FieldLabel label="Schema ID" hint="调用的预设 Schema 标识" />
        <input
          type="text"
          value={props.config.schema_id || ''}
          onInput={(e) => props.onChange({ schema_id: e.currentTarget.value.trim() })}
          placeholder="例如：character_status"
          class="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-mist-solid/30 focus:border-cyan-500/50 focus:outline-none"
        />
      </div>
      <div class="rounded-lg bg-black/30 p-3 text-xs leading-relaxed text-mist-solid/60">
        蓝图执行到此节点时，将激活对应的预设独立 Schema，并根据其配置挂载常驻 HUD 或注入结构化输出规范与历史修剪策略。
      </div>
    </div>
  );
};

const ToolDefinitionForm: Component<{
  config: ToolDefinitionConfig;
  onChange: (c: ToolDefinitionConfig) => void;
}> = (props) => {
  return (
    <div class="space-y-4">
      <div>
        <FieldLabel label="工具名称" hint="例如 buy_item, check_inventory" />
        <TextInput
          value={props.config.tool_name || ''}
          onInput={(v) => props.onChange({ ...props.config, tool_name: v.trim() })}
          placeholder="buy_item"
        />
      </div>
      <div>
        <FieldLabel label="功能描述" hint="供模型决策是否调用的说明" />
        <TextInput
          value={props.config.description || ''}
          onInput={(v) => props.onChange({ ...props.config, description: v })}
          placeholder="购买道具，扣减金币并放入背包"
        />
      </div>
      <div>
        <FieldLabel label="参数定义 (JSON Schema)" />
        <TextArea
          value={props.config.parameters_schema || ''}
          onInput={(v) => props.onChange({ ...props.config, parameters_schema: v })}
          rows={5}
          placeholder={'{\n  "type": "object",\n  "properties": {\n    "item_id": { "type": "string" }\n  }\n}'}
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

const CalculatorForm: Component<{
  config: CalculatorConfig;
  onChange: (c: CalculatorConfig) => void;
}> = (props) => {
  return (
    <div class="space-y-4">
      <div>
        <FieldLabel label="运算模式" />
        <select
          value={props.config.calc_mode || 'math'}
          onChange={(e) => props.onChange({ ...props.config, calc_mode: e.currentTarget.value as 'math' | 'collection' })}
          class="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
        >
          <option value="math">数值算术 (Math)</option>
          <option value="collection">容器集合操作 (Collection)</option>
        </select>
      </div>
      <div>
        <FieldLabel label="目标变量" hint="如 stats.gold, inventory" />
        <TextInput
          value={props.config.target || ''}
          onInput={(v) => props.onChange({ ...props.config, target: v.trim() })}
          placeholder="stats.gold"
        />
      </div>
      <div>
        <FieldLabel label="操作符" />
        <select
          value={props.config.op || '+'}
          onChange={(e) => props.onChange({ ...props.config, op: e.currentTarget.value })}
          class="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
        >
          <option value="+">加 (+) / 累加</option>
          <option value="-">减 (-) / 扣除</option>
          <option value="*">乘 (*)</option>
          <option value="/">除 (/)</option>
          <option value="set">设值 (set)</option>
          <option value="clamp">区间截断 (clamp)</option>
          <option value="min">取最小值 (min)</option>
          <option value="max">取最大值 (max)</option>
          <option value="add_item">增加道具 (add_item)</option>
          <option value="remove_item">移除道具 (remove_item)</option>
          <option value="recompute_weight">重算负重 (recompute_weight)</option>
        </select>
      </div>
      <div>
        <FieldLabel label="操作数 A" hint="数值或参数名 (args.count, 50)" />
        <TextInput
          value={props.config.operand_a || ''}
          onInput={(v) => props.onChange({ ...props.config, operand_a: v })}
          placeholder="50"
        />
      </div>
      <div>
        <FieldLabel label="操作数 B" hint="可选上限值等" />
        <TextInput
          value={props.config.operand_b || ''}
          onInput={(v) => props.onChange({ ...props.config, operand_b: v ? v : null })}
          placeholder="100"
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

const ConditionGateForm: Component<{
  config: ConditionGateConfig;
  onChange: (c: ConditionGateConfig) => void;
}> = (props) => {
  return (
    <div class="space-y-4">
      <div>
        <FieldLabel label="门禁类型" />
        <select
          value={props.config.gate_type || 'gold'}
          onChange={(e) => props.onChange({ ...props.config, gate_type: e.currentTarget.value as ConditionGateConfig['gate_type'] })}
          class="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
        >
          <option value="gold">金币校验 (gold &gt;= cost)</option>
          <option value="weight">负重校验 (weight + add_w &lt;= max_w)</option>
          <option value="slots">槽位校验 (slots &lt; max_slots)</option>
          <option value="custom">自定义表达式 (Custom)</option>
        </select>
      </div>
      <div>
        <FieldLabel label="判定值 / 表达式" hint="如 50, cost" />
        <TextInput
          value={props.config.expression || ''}
          onInput={(v) => props.onChange({ ...props.config, expression: v })}
          placeholder="50"
        />
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel label="放行标签" />
          <TextInput
            value={props.config.pass_label || '放行'}
            onInput={(v) => props.onChange({ ...props.config, pass_label: v })}
            placeholder="放行"
          />
        </div>
        <div>
          <FieldLabel label="拦截标签" />
          <TextInput
            value={props.config.blocked_label || '拦截'}
            onInput={(v) => props.onChange({ ...props.config, blocked_label: v })}
            placeholder="拦截"
          />
        </div>
      </div>
      <div>
        <FieldLabel label="拦截理由说明" hint="阻断时回执文本" />
        <TextInput
          value={props.config.block_reason || ''}
          onInput={(v) => props.onChange({ ...props.config, block_reason: v })}
          placeholder="金币不足，无法购买"
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

const ToolReturnForm: Component<{
  config: ToolReturnConfig;
  onChange: (c: ToolReturnConfig) => void;
}> = (props) => {
  return (
    <div class="space-y-4">
      <div>
        <FieldLabel label="回执模板" hint="支持 {var} 变量替换" />
        <TextArea
          value={props.config.return_template || ''}
          onInput={(v) => props.onChange({ ...props.config, return_template: v })}
          rows={4}
          placeholder="购买成功！扣除金币 {cost}，当前金币 {gold}"
        />
      </div>
      <div>
        <Toggle
          checked={props.config.is_blocked}
          onChange={(v) => props.onChange({ ...props.config, is_blocked: v })}
          label="阻断标志（标记为门禁拦截回执）"
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

const UiLayoutConfigForm: Component<{
  config: UiLayoutConfig;
  onChange: (c: UiLayoutConfig) => void;
}> = (props) => {
  return (
    <div class="space-y-4">
      <div>
        <FieldLabel label="挂载锚点位置" />
        <select
          value={props.config.mount_type || 'MobileDrawer'}
          onChange={(e) => props.onChange({ ...props.config, mount_type: e.currentTarget.value as UiLayoutConfig['mount_type'] })}
          class="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-cyan-500/50 focus:outline-none"
        >
          <option value="MobileDrawer">Mobile: 顶部吸顶抽屉 (MobileDrawer)</option>
          <option value="MobileBottomSticky">Mobile: 底部微型条 (MobileBottomSticky)</option>
          <option value="RightDock">PC: 右侧固定仪表盘 (RightDock)</option>
          <option value="TopSticky">PC: 顶部吸顶折叠栏 (TopSticky)</option>
          <option value="FloatingHUD">PC: 自由浮动画中画 (FloatingHUD)</option>
        </select>
      </div>
      <div>
        <FieldLabel label="UI 布局模板 ID" hint="留空或 default_hud_layout 使用默认玄青色面板" />
        <TextInput
          value={props.config.layout_id || ''}
          onInput={(v) => props.onChange({ ...props.config, layout_id: v.trim() })}
          placeholder="default_hud_layout"
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

const InitialStateConfigForm: Component<{
  config: InitialStateConfig;
  onChange: (config: InitialStateConfig) => void;
}> = (props) => {
  const [newStatKey, setNewStatKey] = createSignal('');
  const [newStatInitial, setNewStatInitial] = createSignal(100);

  const [newItemId, setNewItemId] = createSignal('');
  const [newItemName, setNewItemName] = createSignal('');

  const [newFlagKey, setNewFlagKey] = createSignal('');
  const [newFlagVal, setNewFlagVal] = createSignal('true');

  const statsList = () => Object.entries(props.config.stats || {});
  const flagsList = () => Object.entries(props.config.flags || {});

  const handleAddStat = () => {
    const k = newStatKey().trim();
    if (!k) return;
    const current = { ...(props.config.stats || {}) };
    current[k] = { initial: newStatInitial(), min: 0, max: null };
    props.onChange({ ...props.config, stats: current });
    setNewStatKey('');
    setNewStatInitial(100);
  };

  const handleRemoveStat = (key: string) => {
    const current = { ...(props.config.stats || {}) };
    delete current[key];
    props.onChange({ ...props.config, stats: current });
  };

  const handleUpdateStat = (key: string, updates: Partial<InitialStatDef>) => {
    const current = { ...(props.config.stats || {}) };
    if (current[key]) {
      current[key] = { ...current[key], ...updates };
      props.onChange({ ...props.config, stats: current });
    }
  };

  const handleAddItem = () => {
    const id = newItemId().trim();
    const name = newItemName().trim() || id;
    if (!id) return;
    const current = [...(props.config.inventory || [])];
    current.push({ id, name, count: 1, unit_weight: 0, unit_price: 0 });
    props.onChange({ ...props.config, inventory: current });
    setNewItemId('');
    setNewItemName('');
  };

  const handleRemoveItem = (index: number) => {
    const current = [...(props.config.inventory || [])];
    current.splice(index, 1);
    props.onChange({ ...props.config, inventory: current });
  };

  const handleUpdateItem = (index: number, updates: Partial<InitialStateInventoryItem>) => {
    const current = [...(props.config.inventory || [])];
    if (current[index]) {
      current[index] = { ...current[index], ...updates };
      props.onChange({ ...props.config, inventory: current });
    }
  };

  const handleAddFlag = () => {
    const k = newFlagKey().trim();
    if (!k) return;
    const current = { ...(props.config.flags || {}) };
    current[k] = newFlagVal().trim();
    props.onChange({ ...props.config, flags: current });
    setNewFlagKey('');
    setNewFlagVal('true');
  };

  const handleRemoveFlag = (key: string) => {
    const current = { ...(props.config.flags || {}) };
    delete current[key];
    props.onChange({ ...props.config, flags: current });
  };

  const handleUpdateFlag = (key: string, val: string) => {
    const current = { ...(props.config.flags || {}) };
    current[key] = val;
    props.onChange({ ...props.config, flags: current });
  };

  return (
    <div class="space-y-4">
      <div class="rounded-xl border border-sky-500/20 bg-sky-500/10 p-3">
        <div class="text-[13px] font-bold text-sky-400">流派中立初始状态与背包</div>
        <p class="mt-1 text-[11px] leading-relaxed text-mist-solid/60">
          设定会话开局时的自定义属性（如 sanity/credits/fuel）、初始装备物品与剧情标志位，彻底消除硬编码奇幻 RPG 默认值。
        </p>
      </div>

      {/* 属性字典 */}
      <div class="space-y-2">
        <FieldLabel label={`初始属性字典 (${statsList().length})`} />
        <For each={statsList()}>
          {([statKey, statDef]) => (
            <div class="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[13px] font-mono font-bold text-sky-300">{statKey}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveStat(statKey)}
                  class="text-mist-solid/40 hover:text-rose-400 text-xs px-1.5 py-0.5"
                >
                  删除
                </button>
              </div>
              <div class="grid grid-cols-3 gap-1.5">
                <div>
                  <span class="text-[10px] text-mist-solid/40 block">初始值</span>
                  <NumberInput
                    value={statDef.initial}
                    onInput={(v) => handleUpdateStat(statKey, { initial: v ?? 0 })}
                  />
                </div>
                <div>
                  <span class="text-[10px] text-mist-solid/40 block">最小值</span>
                  <NumberInput
                    value={statDef.min ?? null}
                    onInput={(v) => handleUpdateStat(statKey, { min: v })}
                    placeholder="无"
                  />
                </div>
                <div>
                  <span class="text-[10px] text-mist-solid/40 block">最大值</span>
                  <NumberInput
                    value={statDef.max ?? null}
                    onInput={(v) => handleUpdateStat(statKey, { max: v })}
                    placeholder="无"
                  />
                </div>
              </div>
            </div>
          )}
        </For>
        <div class="flex items-center gap-1.5">
          <TextInput
            value={newStatKey()}
            onInput={setNewStatKey}
            placeholder="属性名 (如 sanity, credits)"
          />
          <div class="w-24">
            <NumberInput
              value={newStatInitial()}
              onInput={(v) => setNewStatInitial(v ?? 0)}
              placeholder="初始值"
            />
          </div>
          <button
            type="button"
            onClick={handleAddStat}
            class="px-3 py-2.5 rounded-xl bg-sky-500/20 text-sky-300 text-xs font-semibold whitespace-nowrap"
          >
            添加
          </button>
        </div>
      </div>

      {/* 背包物品 */}
      <div class="space-y-2 pt-2 border-t border-white/10">
        <FieldLabel label={`初始物品清单 (${(props.config.inventory || []).length})`} />
        <For each={props.config.inventory || []}>
          {(item, idx) => (
            <div class="rounded-xl border border-white/10 bg-white/5 p-2.5 space-y-2">
              <div class="flex items-center justify-between">
                <span class="text-[13px] font-semibold text-mist-solid">{item.name || item.id}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveItem(idx())}
                  class="text-mist-solid/40 hover:text-rose-400 text-xs px-1.5 py-0.5"
                >
                  删除
                </button>
              </div>
              <div class="grid grid-cols-3 gap-1.5">
                <div>
                  <span class="text-[10px] text-mist-solid/40 block">数量</span>
                  <NumberInput
                    value={item.count}
                    onInput={(v) => handleUpdateItem(idx(), { count: Math.max(1, Math.round(v ?? 1)) })}
                  />
                </div>
                <div>
                  <span class="text-[10px] text-mist-solid/40 block">单重</span>
                  <NumberInput
                    value={item.unit_weight ?? 0}
                    onInput={(v) => handleUpdateItem(idx(), { unit_weight: v ?? 0 })}
                  />
                </div>
                <div>
                  <span class="text-[10px] text-mist-solid/40 block">单价</span>
                  <NumberInput
                    value={item.unit_price ?? 0}
                    onInput={(v) => handleUpdateItem(idx(), { unit_price: v ?? 0 })}
                  />
                </div>
              </div>
            </div>
          )}
        </For>
        <div class="flex items-center gap-1.5">
          <TextInput
            value={newItemId()}
            onInput={setNewItemId}
            placeholder="物品 ID"
          />
          <TextInput
            value={newItemName()}
            onInput={setNewItemName}
            placeholder="物品名"
          />
          <button
            type="button"
            onClick={handleAddItem}
            class="px-3 py-2.5 rounded-xl bg-sky-500/20 text-sky-300 text-xs font-semibold whitespace-nowrap"
          >
            添加
          </button>
        </div>
      </div>

      {/* 标志位 */}
      <div class="space-y-2 pt-2 border-t border-white/10">
        <FieldLabel label={`初始剧情标志位 (${flagsList().length})`} />
        <For each={flagsList()}>
          {([flagKey, flagVal]) => (
            <div class="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-2">
              <span class="text-xs font-mono text-sky-300 w-1/3 truncate">{flagKey}</span>
              <TextInput
                value={flagVal}
                onInput={(v) => handleUpdateFlag(flagKey, v)}
              />
              <button
                type="button"
                onClick={() => handleRemoveFlag(flagKey)}
                class="text-mist-solid/40 hover:text-rose-400 text-xs px-1"
              >
                删除
              </button>
            </div>
          )}
        </For>
        <div class="flex items-center gap-1.5">
          <TextInput
            value={newFlagKey()}
            onInput={setNewFlagKey}
            placeholder="标志位键名"
          />
          <TextInput
            value={newFlagVal()}
            onInput={setNewFlagVal}
            placeholder="初始值"
          />
          <button
            type="button"
            onClick={handleAddFlag}
            class="px-3 py-2.5 rounded-xl bg-sky-500/20 text-sky-300 text-xs font-semibold whitespace-nowrap"
          >
            添加
          </button>
        </div>
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

// ─── Inspector 节点表单 ───

const INSPECT_KIND_OPTIONS = [
  { value: 'inventory', label: 'inventory (背包清单/金币/负重)' },
  { value: 'stats', label: 'stats (全部数值属性)' },
  { value: 'item', label: 'item (单件详情)' },
  { value: 'scratchpad', label: 'scratchpad (工作区变量)' },
];

const InspectorForm: Component<{
  config: InspectorConfig;
  onChange: (c: InspectorConfig) => void;
}> = (props) => {
  return (
    <div class="flex flex-col gap-4 px-4">
      <div class="p-3 rounded-xl border border-sky-500/20 bg-sky-500/5 space-y-1">
        <div class="text-xs font-bold text-sky-400">Inspector 容器读原语</div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          读取游戏数据容器的指定片段（背包、属性、单品或纯内存工作区），结果写入上下文 inspect，供回执引用。
        </p>
      </div>
      <div>
        <FieldLabel label="读取类型 (inspect_kind)" />
        <Select
          value={props.config.inspect_kind || 'inventory'}
          onChange={(v) => props.onChange({ ...props.config, inspect_kind: v as InspectorConfig['inspect_kind'] })}
          options={INSPECT_KIND_OPTIONS}
        />
      </div>
      <div>
        <FieldLabel label="键表达式 (key_expr)" hint="item / scratchpad 时必填" />
        <TextInput
          value={props.config.key_expr || ''}
          placeholder="如 args.item_id 或 draft"
          onInput={(v) => props.onChange({ ...props.config, key_expr: v })}
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

// ─── Querier 节点表单 ───

const QuerierForm: Component<{
  config: QuerierConfig;
  onChange: (c: QuerierConfig) => void;
}> = (props) => {
  const [newKey, setNewKey] = createSignal('');
  const [newVal, setNewVal] = createSignal('');

  const templateEntries = () => {
    const raw = props.config.args_template || {};
    return Object.entries(raw).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as [string, string]);
  };

  const syncTemplate = (entries: [string, string][]) => {
    const record: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k.trim()) {
        record[k.trim()] = v;
      }
    }
    props.onChange({ ...props.config, args_template: record });
  };

  const handleKeyChange = (oldKey: string, nextKey: string) => {
    const trimmed = nextKey.trim();
    if (!trimmed || trimmed === oldKey) return;
    const current = templateEntries();
    const updated = current.map(([k, v]) => (k === oldKey ? ([trimmed, v] as [string, string]) : ([k, v] as [string, string])));
    syncTemplate(updated);
  };

  const handleValChange = (key: string, nextVal: string) => {
    const current = templateEntries();
    const updated = current.map(([k, v]) => (k === key ? ([k, nextVal] as [string, string]) : ([k, v] as [string, string])));
    syncTemplate(updated);
  };

  const handleDeleteEntry = (keyToDelete: string) => {
    const current = templateEntries();
    const updated = current.filter(([k]) => k !== keyToDelete);
    syncTemplate(updated);
  };

  const handleAddParam = () => {
    const k = newKey().trim();
    if (!k) return;
    const v = newVal();
    const current = templateEntries();
    const idx = current.findIndex(([ek]) => ek === k);
    if (idx >= 0) {
      current[idx] = [k, v];
    } else {
      current.push([k, v]);
    }
    syncTemplate(current);
    setNewKey('');
    setNewVal('');
  };

  return (
    <div class="flex flex-col gap-4 px-4">
      <div class="p-3 rounded-xl border border-sky-500/20 bg-sky-500/5 space-y-1">
        <div class="text-xs font-bold text-sky-400">Querier 跨域读配置</div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          经 ActionBridge 白名单代理调用既有 Tauri 命令，查询结果写入上下文 query。
        </p>
      </div>

      <div>
        <FieldLabel label="命令名称 (command)" hint="须在动作白名单中" />
        <TextInput
          value={props.config.command || ''}
          placeholder="如 get_world_book_entry"
          onInput={(v) => props.onChange({ ...props.config, command: v.trim() })}
        />
      </div>

      <div class="space-y-2 pt-2 border-t border-white/10">
        <FieldLabel label={`参数模板 (${templateEntries().length})`} hint="支持 {表达式}" />
        <For each={templateEntries()}>
          {([k, v]) => (
            <div class="flex flex-col gap-1.5 p-2.5 rounded-xl bg-white/5 border border-white/10">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-mono text-accent truncate">{k}</span>
                <button
                  type="button"
                  onClick={() => handleDeleteEntry(k)}
                  class="text-mist-solid/40 hover:text-rose-400 text-xs px-1.5 py-0.5 shrink-0"
                >
                  删除
                </button>
              </div>
              <div class="grid grid-cols-2 gap-1.5">
                <TextInput
                  value={k}
                  placeholder="参数名"
                  onInput={(nextK) => handleKeyChange(k, nextK)}
                />
                <TextInput
                  value={v}
                  placeholder="模板值，如 {args.entry_id}"
                  onInput={(nextV) => handleValChange(k, nextV)}
                />
              </div>
            </div>
          )}
        </For>

        <div class="flex flex-col gap-1.5 pt-1">
          <div class="grid grid-cols-2 gap-1.5">
            <TextInput
              value={newKey()}
              onInput={setNewKey}
              placeholder="新增参数名"
            />
            <TextInput
              value={newVal()}
              onInput={setNewVal}
              placeholder="参数模板值"
            />
          </div>
          <button
            type="button"
            onClick={handleAddParam}
            class="w-full py-2 rounded-xl bg-sky-500/20 text-sky-300 text-xs font-semibold"
          >
            + 添加参数模板行
          </button>
        </div>
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

// ─── Writer 节点表单 ───

const WriterForm: Component<{
  config: WriterConfig;
  onChange: (c: WriterConfig) => void;
}> = (props) => {
  return (
    <div class="flex flex-col gap-4 px-4">
      <div class="p-3 rounded-xl border border-sky-500/20 bg-sky-500/5 space-y-1">
        <div class="text-xs font-bold text-sky-400">Writer 工作区写原语</div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          将渲染结果写入 DataContainer 纯内存工作区，零磁盘 I/O，随回合生命周期自动释放。
        </p>
      </div>

      <div>
        <FieldLabel label="工作区变量名 (key_expr)" hint="支持 {表达式}" />
        <TextInput
          value={props.config.key_expr || ''}
          placeholder="如 draft 或 task_{args.id}"
          onInput={(v) => props.onChange({ ...props.config, key_expr: v })}
        />
      </div>

      <div>
        <FieldLabel label="写入值模板 (value_template)" hint="支持 {表达式}" />
        <TextArea
          value={props.config.value_template || ''}
          placeholder="写入工作区变量的值模板，例如：&#10;{query.result.content}"
          rows={5}
          onInput={(v) => props.onChange({ ...props.config, value_template: v })}
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

// ─── BannedWordsConfig 节点表单 ───

const BannedWordsConfigForm: Component<{
  config: BannedWordsConfig;
  onChange: (c: BannedWordsConfig) => void;
}> = (props) => {
  const wordsText = () => (props.config.words || []).join('\n');

  return (
    <div class="flex flex-col gap-4 px-4">
      <div class="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 space-y-1">
        <div class="text-xs font-bold text-amber-400">违规禁词与 Nudge 自纠过滤</div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          配置当前预设的违规词库，触发时由模型根据自纠模板尝试重写正文。
        </p>
      </div>

      <div>
        <FieldLabel label={`禁词词库 (每行一个，已录入 ${(props.config.words || []).length} 词)`} />
        <TextArea
          value={wordsText()}
          placeholder="输入需要拦截的词语，每行一个…"
          rows={6}
          onInput={(v) => {
            const list = v.split('\n').map((s) => s.trim()).filter(Boolean);
            props.onChange({ ...props.config, words: list });
          }}
        />
      </div>

      <div>
        <FieldLabel label="最大自纠重试轮次 (max_nudge_retries)" />
        <NumberInput
          value={props.config.max_nudge_retries ?? 2}
          placeholder="缺省 2"
          step="1"
          onInput={(v) => props.onChange({ ...props.config, max_nudge_retries: Math.max(0, Math.round(v ?? 2)) })}
        />
      </div>

      <div>
        <FieldLabel label="Nudge 自纠提示模板" hint="含 {hits} 与 {remaining} 占位符" />
        <TextArea
          value={props.config.nudge_instruction_template || ''}
          placeholder="以下词语违反内容约束：{hits}。请只重写正文，保持剧情走向与已完成的事实不变；不要解释这条指令本身。剩余自纠机会 {remaining} 次。"
          rows={4}
          onInput={(v) => props.onChange({ ...props.config, nudge_instruction_template: v })}
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

// ─── ScriptwriterPipeline 节点表单 ───

const ScriptwriterPipelineForm: Component<{
  config: ScriptwriterPipelineConfig;
  onChange: (c: ScriptwriterPipelineConfig) => void;
  availableTools?: MobileToolItem[];
}> = (props) => {
  const stages = () => props.config.stages || [];

  const handleAddStage = () => {
    const current = [...stages()];
    const idx = current.length;
    const defaultName = idx === 0 ? 'draft' : idx === 1 ? 'polish' : `stage_${idx + 1}`;
    const newStage: ScriptwriterStage = {
      stage: defaultName,
      workspace_key: defaultName,
      prompt: '',
      tools: [],
    };
    props.onChange({ ...props.config, stages: [...current, newStage] });
  };

  const handleDeleteStage = (index: number) => {
    const current = [...stages()];
    current.splice(index, 1);
    props.onChange({ ...props.config, stages: current });
  };

  const handleMoveUp = (index: number) => {
    if (index <= 0) return;
    const current = [...stages()];
    const temp = current[index - 1];
    current[index - 1] = current[index];
    current[index] = temp;
    props.onChange({ ...props.config, stages: current });
  };

  const handleMoveDown = (index: number) => {
    const current = [...stages()];
    if (index >= current.length - 1) return;
    const temp = current[index + 1];
    current[index + 1] = current[index];
    current[index] = temp;
    props.onChange({ ...props.config, stages: current });
  };

  const handleUpdateStage = (index: number, partial: Partial<ScriptwriterStage>) => {
    const current = [...stages()];
    if (current[index]) {
      current[index] = { ...current[index], ...partial };
      props.onChange({ ...props.config, stages: current });
    }
  };

  return (
    <div class="flex flex-col gap-4 px-4">
      <div class="p-3 rounded-xl border border-purple-500/20 bg-purple-500/5 space-y-1">
        <div class="text-xs font-bold text-purple-400">剧本流水线编排 (Scriptwriter Pipeline)</div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          自定义多阶段流水线（如 draft → critique → polish），支持各阶段独立提示词与工具集。
        </p>
      </div>

      <div class="space-y-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <div>
          <FieldLabel label="尾锚字数 (anchor_tail_chars)" hint="历史保留末尾字数" />
          <NumberInput
            value={props.config.anchor_tail_chars ?? 50}
            placeholder="50"
            step="1"
            onInput={(v) => props.onChange({ ...props.config, anchor_tail_chars: Math.max(0, Math.round(v ?? 50)) })}
          />
        </div>
        <div>
          <FieldLabel label="背景锁定标记 (blackout_marker)" />
          <TextInput
            value={props.config.blackout_marker ?? ''}
            placeholder="【前文背景已锁定】..."
            onInput={(v) => props.onChange({ ...props.config, blackout_marker: v })}
          />
        </div>
      </div>

      <div class="space-y-2 pt-2 border-t border-white/10">
        <div class="flex items-center justify-between">
          <FieldLabel label={`流水线阶段序列 (${stages().length})`} />
          <button
            type="button"
            onClick={handleAddStage}
            class="px-2.5 py-1 rounded-lg bg-accent/20 text-accent text-xs font-semibold"
          >
            + 添加阶段
          </button>
        </div>

        <For each={stages()}>
          {(stage, idx) => (
            <div class="rounded-xl border border-white/10 bg-white/5 p-3 space-y-2.5">
              <div class="flex items-center justify-between">
                <span class="text-xs font-bold text-accent font-mono">
                  #{idx() + 1} {stage.stage || '未命名阶段'}
                </span>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx() === 0}
                    onClick={() => handleMoveUp(idx())}
                    class="p-1 rounded bg-white/5 text-mist-solid/60 hover:text-white disabled:opacity-30 text-xs"
                    title="上移"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={idx() === stages().length - 1}
                    onClick={() => handleMoveDown(idx())}
                    class="p-1 rounded bg-white/5 text-mist-solid/60 hover:text-white disabled:opacity-30 text-xs"
                    title="下移"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteStage(idx())}
                    class="p-1 rounded bg-white/5 text-mist-solid/40 hover:text-rose-400 text-xs ml-1"
                    title="删除"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel label="阶段标识" />
                  <TextInput
                    value={stage.stage}
                    placeholder="如 draft"
                    onInput={(v) => handleUpdateStage(idx(), { stage: v })}
                  />
                </div>
                <div>
                  <FieldLabel label="工作区输出变量" />
                  <TextInput
                    value={stage.workspace_key}
                    placeholder="如 draft"
                    onInput={(v) => handleUpdateStage(idx(), { workspace_key: v })}
                  />
                </div>
              </div>

              <div>
                <FieldLabel label="阶段提示词 (Prompt)" />
                <TextArea
                  value={stage.prompt}
                  placeholder="该阶段的提示词指令…"
                  rows={3}
                  onInput={(v) => handleUpdateStage(idx(), { prompt: v })}
                />
              </div>

              <div>
                <FieldLabel label="可用工具 (逗号分隔)" hint="对应 ToolDefinition 名称" />
                <TextInput
                  value={(stage.tools || []).join(', ')}
                  placeholder="如 read_text, write_text"
                  onInput={(v) => {
                    const toolList = v.split(',').map((s) => s.trim()).filter(Boolean);
                    handleUpdateStage(idx(), { tools: toolList });
                  }}
                />
              </div>

              <div class="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel label="打回目标阶段" hint="可选" />
                  <TextInput
                    value={stage.reject_target || ''}
                    placeholder="如 draft"
                    onInput={(v) => handleUpdateStage(idx(), { reject_target: v || undefined })}
                  />
                </div>
                <div>
                  <FieldLabel label="熔断上限 (轮)" hint="默认 2" />
                  <NumberInput
                    value={stage.max_loop_count ?? 2}
                    placeholder="2"
                    step="1"
                    onInput={(v) => handleUpdateStage(idx(), { max_loop_count: v ? Math.max(1, Math.round(v)) : 2 })}
                  />
                </div>
              </div>

              <MobileToolPermissionsCard
                permissions={stage.tool_permissions}
                availableTools={props.availableTools}
                onUpdate={(perms) => handleUpdateStage(idx(), { tool_permissions: perms })}
              />
            </div>
          )}
        </For>
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

// ─── AgentModeSwitch 节点表单 ───

const AGENT_MODE_OPTIONS = [
  { value: 'single', label: 'single (经典单智能体)' },
  { value: 'director_actor', label: 'director_actor (导演-演员编排)' },
  { value: 'scriptwriter', label: 'scriptwriter (剧本流水线)' },
];

const AgentModeSwitchForm: Component<{
  config: AgentModeSwitchConfig;
  onChange: (c: AgentModeSwitchConfig) => void;
}> = (props) => {
  return (
    <div class="flex flex-col gap-4 px-4">
      <div class="p-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 space-y-1">
        <div class="text-xs font-bold text-indigo-400">智能体架构模式选择 (Agent Mode Switch)</div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          设置预设默认的智能体编排模式与工具轮次上限，台前 Gate 面板可随时切换。
        </p>
      </div>

      <div>
        <FieldLabel label="默认模式 (default_mode)" />
        <Select
          value={props.config.default_mode || 'single'}
          onChange={(v) => props.onChange({ ...props.config, default_mode: v as AgentModeSwitchConfig['default_mode'] })}
          options={AGENT_MODE_OPTIONS}
        />
      </div>

      <div>
        <FieldLabel label="工具循环轮次上限 (max_tool_rounds)" />
        <NumberInput
          value={props.config.max_tool_rounds ?? 5}
          placeholder="5"
          step="1"
          onInput={(v) => props.onChange({ ...props.config, max_tool_rounds: Math.max(1, Math.round(v ?? 5)) })}
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

// ─── DirectorConfig 节点表单 ───

const DirectorConfigForm: Component<{
  config: DirectorConfig;
  onChange: (c: DirectorConfig) => void;
  availableTools?: MobileToolItem[];
}> = (props) => {
  return (
    <div class="flex flex-col gap-4 px-4">
      <div class="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 space-y-1">
        <div class="text-xs font-bold text-emerald-400">导演节点配置 (Director)</div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          配置导演智能体的分镜提示词指令及可调用的工具契约。
        </p>
      </div>

      <div>
        <FieldLabel label="导演提示词 (director_prompt)" hint="指导分镜与调度" />
        <TextArea
          value={props.config.director_prompt || ''}
          placeholder="导演分镜指令，例如：分析玩家输入并拆解为角色行为 beats…"
          rows={5}
          onInput={(v) => props.onChange({ ...props.config, director_prompt: v })}
        />
      </div>

      <div>
        <FieldLabel label="轮次限制 (max_rounds)" hint="可选" />
        <NumberInput
          value={(props.config as any).max_rounds ?? null}
          placeholder="留空使用默认"
          step="1"
          onInput={(v) => props.onChange({ ...props.config, ...({ max_rounds: v ? Math.max(1, Math.round(v)) : undefined } as any) })}
        />
      </div>

      <div>
        <FieldLabel label="可用工具列表 (tools)" hint="逗号分隔" />
        <TextInput
          value={(props.config.tools || []).join(', ')}
          placeholder="如 read_text, write_text, dice_roll"
          onInput={(v) => {
            const list = v.split(',').map((s) => s.trim()).filter(Boolean);
            props.onChange({ ...props.config, tools: list });
          }}
        />
      </div>

      <MobileToolPermissionsCard
        permissions={props.config.tool_permissions}
        availableTools={props.availableTools}
        onUpdate={(perms) => props.onChange({ ...props.config, tool_permissions: perms })}
      />

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

// ─── ActorDefinition 节点表单 ───

const ActorDefinitionForm: Component<{
  config: ActorDefinition;
  onChange: (c: ActorDefinition) => void;
  availableTools?: MobileToolItem[];
}> = (props) => {
  return (
    <div class="flex flex-col gap-4 px-4">
      <div class="p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 space-y-1">
        <div class="text-xs font-bold text-amber-400">演员设定 (Actor Definition)</div>
        <p class="text-[11px] text-mist-solid/60 leading-relaxed">
          定义导演调度的具名演员/槽位，设定其视界人设 Persona 与工具权限。
        </p>
      </div>

      <div>
        <FieldLabel label="演员名称 / Slot ID (slot_id / actor_name)" />
        <TextInput
          value={props.config.actor_name || (props.config as any).slot_id || ''}
          placeholder="如 detective 或 warrior"
          onInput={(v) => props.onChange({ ...props.config, actor_name: v, ...({ slot_id: v } as any) })}
        />
      </div>

      <div>
        <FieldLabel label="视界人设 (persona)" hint="演员视界注入内容" />
        <TextArea
          value={props.config.persona || ''}
          placeholder="设定此演员的角色人设、说话习惯与行动逻辑…"
          rows={5}
          onInput={(v) => props.onChange({ ...props.config, persona: v })}
        />
      </div>

      <div>
        <FieldLabel label="可用工具列表 (tools)" hint="逗号分隔" />
        <TextInput
          value={(props.config.tools || []).join(', ')}
          placeholder="如 read_text, attack_enemy"
          onInput={(v) => {
            const list = v.split(',').map((s) => s.trim()).filter(Boolean);
            props.onChange({ ...props.config, tools: list });
          }}
        />
      </div>

      <MobileToolPermissionsCard
        permissions={props.config.tool_permissions}
        availableTools={props.availableTools}
        onUpdate={(perms) => props.onChange({ ...props.config, tool_permissions: perms })}
      />

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

// ─── 宏引脚配置表单（macro_inputs / macro_outputs）───

const PIN_TYPES: { value: PinType; label: string }[] = [
  { value: 'exec', label: 'Exec (执行流)' },
  { value: 'number', label: 'Number (数值)' },
  { value: 'string', label: 'String (字符串)' },
  { value: 'boolean', label: 'Boolean (布尔)' },
  { value: 'object', label: 'Object / Any (对象/任意)' },
];

interface MacroPinsFormProps {
  pins: MacroPinDefinition[];
  isInput: boolean;
  onChange: (pins: MacroPinDefinition[]) => void;
}

const MacroPinsForm: Component<MacroPinsFormProps> = (props) => {
  const [newPinName, setNewPinName] = createSignal('');
  const [newPinType, setNewPinType] = createSignal<PinType>('exec');

  const handleAddPin = () => {
    const name = newPinName().trim();
    if (!name) return;
    const id = `pin_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).slice(-3)}`;
    const updated = [
      ...(props.pins || []),
      {
        id,
        name,
        pin_type: newPinType(),
      },
    ];
    props.onChange(updated);
    setNewPinName('');
  };

  const handleRemovePin = (index: number) => {
    const updated = [...(props.pins || [])];
    updated.splice(index, 1);
    props.onChange(updated);
  };

  const handleUpdatePin = (index: number, patch: Partial<MacroPinDefinition>) => {
    const updated = [...(props.pins || [])];
    updated[index] = { ...updated[index], ...patch };
    props.onChange(updated);
  };

  return (
    <div class="px-5 space-y-4">
      <div class="p-3 rounded-xl bg-white/5 border border-white/10">
        <h4 class="text-sm font-bold text-white">
          {props.isInput ? '宏输入代理引脚 (Inputs)' : '宏输出代理引脚 (Outputs)'}
        </h4>
        <p class="text-xs text-mist-solid/60 mt-0.5">
          {props.isInput
            ? '定义外部调用者传入宏的数据与执行入口'
            : '定义宏执行完毕后向外传出的数据与执行出口'}
        </p>
      </div>

      <div class="space-y-2">
        <label class="text-[13px] font-semibold text-mist-solid/80">已定义引脚</label>
        <Show
          when={props.pins && props.pins.length > 0}
          fallback={<div class="text-xs text-mist-solid/40 italic py-2">暂无引脚定义，请在下方添加</div>}
        >
          <div class="space-y-2">
            <For each={props.pins}>
              {(pin, idx) => (
                <div class="p-3 rounded-xl border border-white/10 bg-white/5 space-y-2.5">
                  <div class="flex items-center justify-between gap-2">
                    <div class="flex items-center gap-2 flex-1">
                      <span
                        class="w-3 h-3 rounded-full shrink-0"
                        style={{ 'background-color': PIN_TYPE_COLORS[pin.pin_type] || '#ffffff' }}
                      />
                      <input
                        type="text"
                        value={pin.name}
                        onInput={(e) => handleUpdatePin(idx(), { name: e.currentTarget.value })}
                        class="flex-1 px-3 py-1.5 text-xs rounded-lg bg-black/30 border border-white/10 text-white focus:outline-none focus:border-accent"
                        placeholder="引脚名称"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemovePin(idx())}
                      class="px-2 py-1 rounded-lg text-red-400 bg-red-500/10 text-xs font-medium"
                    >
                      删除
                    </button>
                  </div>

                  <div class="flex items-center gap-2">
                    <span class="text-xs text-mist-solid/60 w-12 shrink-0">类型</span>
                    <select
                      value={pin.pin_type}
                      onChange={(e) => handleUpdatePin(idx(), { pin_type: e.currentTarget.value as PinType })}
                      class="flex-1 px-3 py-1.5 text-xs rounded-lg bg-black/30 border border-white/10 text-white focus:outline-none focus:border-accent"
                    >
                      <For each={PIN_TYPES}>
                        {(t) => <option value={t.value}>{t.label}</option>}
                      </For>
                    </select>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* 添加新引脚 */}
      <div class="p-3 rounded-xl border border-dashed border-white/20 bg-white/5 space-y-3">
        <span class="text-xs font-bold text-white">添加新引脚</span>
        <div class="space-y-2">
          <input
            type="text"
            placeholder="引脚名称（如：In / Target / Out）"
            value={newPinName()}
            onInput={(e) => setNewPinName(e.currentTarget.value)}
            class="w-full px-3 py-2 text-xs rounded-xl bg-night-sky border border-white/15 text-white placeholder-mist-solid/30 focus:outline-none focus:border-accent"
          />
          <div class="flex items-center gap-2">
            <select
              value={newPinType()}
              onChange={(e) => setNewPinType(e.currentTarget.value as PinType)}
              class="flex-1 px-3 py-2 text-xs rounded-xl bg-night-sky border border-white/15 text-white focus:outline-none focus:border-accent"
            >
              <For each={PIN_TYPES}>
                {(t) => <option value={t.value}>{t.label}</option>}
              </For>
            </select>
            <button
              type="button"
              onClick={handleAddPin}
              class="px-4 py-2 text-xs font-bold rounded-xl bg-accent text-white active:scale-95 transition-transform"
            >
              + 添加
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── 宏实例节点配置表单（macro_instance）───

interface MacroInstanceFormProps {
  config: MacroInstanceConfig;
  macros?: BlueprintMacro[];
  onOpenMacro?: (macroId: string) => void;
  onChange: (config: MacroInstanceConfig) => void;
}

const MacroInstanceForm: Component<MacroInstanceFormProps> = (props) => {
  const currentMacro = () => props.macros?.find((m) => m.id === props.config.macro_id);

  return (
    <div class="px-5 space-y-4">
      <div>
        <FieldLabel label="实例显示名称" hint="在画布上显示的别名" />
        <TextInput
          value={props.config.name || ''}
          placeholder={currentMacro()?.name || '宏实例名称'}
          onInput={(v) => props.onChange({ ...props.config, name: v })}
        />
      </div>

      <div>
        <FieldLabel label="引用宏资产" hint="调用的宏定义" />
        <select
          value={props.config.macro_id}
          onChange={(e) => props.onChange({ ...props.config, macro_id: e.currentTarget.value })}
          class="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-[14px] text-white focus:outline-none focus:border-accent"
        >
          <option value="" disabled>选择要调用的宏...</option>
          <For each={props.macros || []}>
            {(macro) => (
              <option value={macro.id}>
                {macro.name} ({macro.category || '通用'})
              </option>
            )}
          </For>
        </select>
      </div>

      <Show when={currentMacro()}>
        {(macro) => (
          <div class="p-3.5 rounded-2xl border border-white/10 bg-white/5 space-y-3">
            <div class="flex items-center justify-between">
              <span class="font-bold text-white text-sm">{macro().name}</span>
              <button
                type="button"
                onClick={() => props.onOpenMacro?.(macro().id)}
                class="px-3 py-1 text-xs rounded-lg bg-accent/20 text-accent font-semibold active:bg-accent/30"
              >
                进入宏子图 &gt;
              </button>
            </div>

            <Show when={macro().description}>
              <p class="text-xs text-mist-solid/60">{macro().description}</p>
            </Show>

            {/* Inputs preview */}
            <div>
              <div class="text-[11px] text-mist-solid/50 mb-1 font-medium">
                输入引脚 ({macro().inputs?.length || 0}):
              </div>
              <div class="flex flex-wrap gap-1.5">
                <For each={macro().inputs || []}>
                  {(pin) => (
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 text-[11px] text-white">
                      <span
                        class="w-2 h-2 rounded-full"
                        style={{ 'background-color': PIN_TYPE_COLORS[pin.pin_type] || '#ffffff' }}
                      />
                      {pin.name}
                    </span>
                  )}
                </For>
              </div>
            </div>

            {/* Outputs preview */}
            <div>
              <div class="text-[11px] text-mist-solid/50 mb-1 font-medium">
                输出引脚 ({macro().outputs?.length || 0}):
              </div>
              <div class="flex flex-wrap gap-1.5">
                <For each={macro().outputs || []}>
                  {(pin) => (
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 text-[11px] text-white">
                      <span
                        class="w-2 h-2 rounded-full"
                        style={{ 'background-color': PIN_TYPE_COLORS[pin.pin_type] || '#ffffff' }}
                      />
                      {pin.name}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </div>
        )}
      </Show>
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
      <Match when={props.node.type === 'invoke_schema'}>
        <InvokeSchemaForm
          config={props.node.config as InvokeSchemaConfig}
          onChange={(c: InvokeSchemaConfig) => props.onConfigChange({ type: 'invoke_schema', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'tool_definition'}>
        <ToolDefinitionForm
          config={props.node.config as ToolDefinitionConfig}
          onChange={(c: ToolDefinitionConfig) => props.onConfigChange({ type: 'tool_definition', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'calculator'}>
        <CalculatorForm
          config={props.node.config as CalculatorConfig}
          onChange={(c: CalculatorConfig) => props.onConfigChange({ type: 'calculator', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'condition_gate'}>
        <ConditionGateForm
          config={props.node.config as ConditionGateConfig}
          onChange={(c: ConditionGateConfig) => props.onConfigChange({ type: 'condition_gate', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'tool_return'}>
        <ToolReturnForm
          config={props.node.config as ToolReturnConfig}
          onChange={(c: ToolReturnConfig) => props.onConfigChange({ type: 'tool_return', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'ui_layout_config'}>
        <UiLayoutConfigForm
          config={props.node.config as UiLayoutConfig}
          onChange={(c: UiLayoutConfig) => props.onConfigChange({ type: 'ui_layout_config', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'initial_state_config'}>
        <InitialStateConfigForm
          config={props.node.config as InitialStateConfig}
          onChange={(c: InitialStateConfig) => props.onConfigChange({ type: 'initial_state_config', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'inspector'}>
        <InspectorForm
          config={props.node.config as InspectorConfig}
          onChange={(c: InspectorConfig) => props.onConfigChange({ type: 'inspector', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'querier'}>
        <QuerierForm
          config={props.node.config as QuerierConfig}
          onChange={(c: QuerierConfig) => props.onConfigChange({ type: 'querier', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'writer'}>
        <WriterForm
          config={props.node.config as WriterConfig}
          onChange={(c: WriterConfig) => props.onConfigChange({ type: 'writer', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'banned_words_config'}>
        <BannedWordsConfigForm
          config={props.node.config as BannedWordsConfig}
          onChange={(c: BannedWordsConfig) => props.onConfigChange({ type: 'banned_words_config', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'scriptwriter_pipeline'}>
        <ScriptwriterPipelineForm
          config={props.node.config as ScriptwriterPipelineConfig}
          availableTools={props.availableTools}
          onChange={(c: ScriptwriterPipelineConfig) => props.onConfigChange({ type: 'scriptwriter_pipeline', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'agent_mode_switch'}>
        <AgentModeSwitchForm
          config={props.node.config as AgentModeSwitchConfig}
          onChange={(c: AgentModeSwitchConfig) => props.onConfigChange({ type: 'agent_mode_switch', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'director_config'}>
        <DirectorConfigForm
          config={props.node.config as DirectorConfig}
          availableTools={props.availableTools}
          onChange={(c: DirectorConfig) => props.onConfigChange({ type: 'director_config', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'actor_definition'}>
        <ActorDefinitionForm
          config={props.node.config as ActorDefinition}
          availableTools={props.availableTools}
          onChange={(c: ActorDefinition) => props.onConfigChange({ type: 'actor_definition', config: c })}
        />
      </Match>
      <Match when={props.node.type === 'macro_inputs'}>
        <MacroPinsForm
          pins={(props.node.config as MacroInputsConfig)?.pins || []}
          isInput={true}
          onChange={(pins) => props.onConfigChange({ type: 'macro_inputs', config: { pins } })}
        />
      </Match>
      <Match when={props.node.type === 'macro_outputs'}>
        <MacroPinsForm
          pins={(props.node.config as MacroOutputsConfig)?.pins || []}
          isInput={false}
          onChange={(pins) => props.onConfigChange({ type: 'macro_outputs', config: { pins } })}
        />
      </Match>
      <Match when={props.node.type === 'macro_instance'}>
        <MacroInstanceForm
          config={props.node.config as MacroInstanceConfig}
          macros={props.macros}
          onOpenMacro={props.onOpenMacro}
          onChange={(c) => props.onConfigChange({ type: 'macro_instance', config: c })}
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
    case 'invoke_schema':
      return {
        type: 'invoke_schema',
        config: {
          schema_id: '',
        },
      };
    case 'tool_definition':
      return {
        type: 'tool_definition',
        config: {
          tool_name: '',
          description: '',
          parameters_schema: '{\n  "type": "object",\n  "properties": {}\n}',
          is_locked: false,
        },
      };
    case 'calculator':
      return {
        type: 'calculator',
        config: {
          calc_mode: 'math',
          target: 'stats.gold',
          op: '+',
          operand_a: '0',
          operand_b: null,
          item_def: null,
          is_locked: false,
        },
      };
    case 'condition_gate':
      return {
        type: 'condition_gate',
        config: {
          gate_type: 'gold',
          expression: '0',
          pass_label: '放行',
          blocked_label: '拦截',
          block_reason: '金币不足',
          is_locked: false,
        },
      };
    case 'tool_return':
      return {
        type: 'tool_return',
        config: {
          return_template: '',
          is_blocked: false,
          is_locked: false,
        },
      };
    case 'ui_layout_config':
      return {
        type: 'ui_layout_config',
        config: {
          layout_id: 'default_hud_layout',
          mount_type: 'MobileDrawer',
          is_locked: false,
        },
      };
    case 'inspector':
      return { type: 'inspector', config: { inspect_kind: 'inventory', key_expr: '', is_locked: false } };
    case 'querier':
      return { type: 'querier', config: { command: '', args_template: {}, is_locked: false } };
    case 'writer':
      return { type: 'writer', config: { key_expr: '', value_template: '', is_locked: false } };
    case 'banned_words_config':
      return { type: 'banned_words_config', config: { words: [], max_nudge_retries: 2, nudge_instruction_template: '', is_locked: false } };
    case 'scriptwriter_pipeline':
      return { type: 'scriptwriter_pipeline', config: { stages: [], anchor_tail_chars: 50, blackout_marker: '【前文背景已锁定】', is_locked: false } };
    case 'agent_mode_switch':
      return { type: 'agent_mode_switch', config: { default_mode: 'single', max_tool_rounds: 5, is_locked: false } };
    case 'director_config':
      return { type: 'director_config', config: { director_prompt: '', tools: [], is_locked: false } };
    case 'actor_definition':
      return { type: 'actor_definition', config: { actor_name: '', persona: '', tools: [], is_locked: false } };
    case 'initial_state_config':
      return { type: 'initial_state_config', config: { stats: {}, inventory: [], flags: {}, is_locked: false } };
    case 'macro_instance':
      return {
        type: 'macro_instance',
        config: {
          macro_id: '',
          name: '宏实例',
        },
      };
    case 'macro_inputs':
      return {
        type: 'macro_inputs',
        config: {
          pins: [
            { id: 'exec_in', name: 'Exec In', pin_type: 'exec' },
          ],
        },
      };
    case 'macro_outputs':
      return {
        type: 'macro_outputs',
        config: {
          pins: [
            { id: 'exec_out', name: 'Exec Out', pin_type: 'exec' },
          ],
        },
      };
  }
}
