import { Component, For, Show, createSignal } from 'solid-js';
import { Plus, Pencil, Trash2 } from '../../lib/icons';
import { CustomRuleEditor } from './CustomRuleEditor';
import type { MessageFormatConfig, CustomFormatRule } from '../../lib/messageFormatter';

interface MessageFormatSettingsProps {
  formatConfig: MessageFormatConfig;
  onSetFormatConfig: (config: MessageFormatConfig) => void;
}

interface ToggleRowProps {
  label: string;
  description: string;
  checked: boolean;
  onToggle: () => void;
}

const ToggleRow: Component<ToggleRowProps> = (props) => (
  <div class="flex items-center justify-between gap-4 py-4 border-b border-white/5">
    <div>
      <div class="text-sm text-mist-solid/80">{props.label}</div>
      <div class="text-[11px] text-mist-solid/35 mt-0.5">{props.description}</div>
    </div>
    <button
      onClick={props.onToggle}
      class={`relative w-14 h-8 rounded-full transition-all duration-300 ${
        props.checked
          ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
          : 'bg-white/10'
      }`}
      role="switch"
      aria-checked={props.checked}
    >
      <div
        class={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
          props.checked ? 'left-7' : 'left-1'
        }`}
      />
    </button>
  </div>
);

export const MessageFormatSettings: Component<MessageFormatSettingsProps> = (props) => {
  const [editingCustomRule, setEditingCustomRule] = createSignal<CustomFormatRule | null>(null);
  const [isAddingCustomRule, setIsAddingCustomRule] = createSignal(false);

  const setBuiltinRule = (key: keyof MessageFormatConfig['builtinRules'], patch: Record<string, unknown>) => {
    props.onSetFormatConfig({
      ...props.formatConfig,
      builtinRules: {
        ...props.formatConfig.builtinRules,
        [key]: { ...props.formatConfig.builtinRules[key], ...patch },
      },
    });
  };

  const handleSaveRule = (rule: CustomFormatRule) => {
    if (editingCustomRule()) {
      const updated = props.formatConfig.customRules.map((r) =>
        r.id === editingCustomRule()!.id ? rule : r
      );
      props.onSetFormatConfig({ ...props.formatConfig, customRules: updated });
    } else {
      props.onSetFormatConfig({
        ...props.formatConfig,
        customRules: [...props.formatConfig.customRules, rule],
      });
    }
    setIsAddingCustomRule(false);
    setEditingCustomRule(null);
  };

  const handleDeleteRule = (id: string) => {
    const updated = props.formatConfig.customRules.filter((r) => r.id !== id);
    props.onSetFormatConfig({ ...props.formatConfig, customRules: updated });
  };

  const handleEditRule = (rule: CustomFormatRule) => {
    setEditingCustomRule(rule);
    setIsAddingCustomRule(false);
  };

  const handleAddNew = () => {
    setEditingCustomRule(null);
    setIsAddingCustomRule(true);
  };

  const handleCancel = () => {
    setIsAddingCustomRule(false);
    setEditingCustomRule(null);
  };

  return (
    <div class="space-y-6">
      <div class="flex items-center justify-between gap-4 py-4 border-b border-white/5">
        <div>
          <h3 class="text-sm font-bold text-white">消息格式化</h3>
          <p class="text-[11px] text-mist-solid/35 mt-1">
            控制聊天消息中的文本格式化规则，可自定义高亮样式。
          </p>
        </div>
      </div>

      <div class="space-y-3">
        <ToggleRow
          label="伪 XML 标签折叠"
          description="将 <scene>...</scene> 等标签渲染为可折叠块"
          checked={props.formatConfig.builtinRules.pseudoXml.enabled}
          onToggle={() =>
            setBuiltinRule('pseudoXml', {
              enabled: !props.formatConfig.builtinRules.pseudoXml.enabled,
            })
          }
        />

        <Show when={props.formatConfig.builtinRules.pseudoXml.enabled}>
          <div class="flex items-center justify-between gap-4 pl-4 py-4 border-b border-white/5">
            <div>
              <div class="text-sm text-mist-solid/80">标签默认展开</div>
              <div class="text-[11px] text-mist-solid/35 mt-0.5">控制伪 XML 标签块的初始展开或折叠状态</div>
            </div>
            <button
              onClick={() =>
                setBuiltinRule('pseudoXml', {
                  defaultExpanded: !props.formatConfig.builtinRules.pseudoXml.defaultExpanded,
                })
              }
              class={`relative w-14 h-8 rounded-full transition-all duration-300 ${
                props.formatConfig.builtinRules.pseudoXml.defaultExpanded
                  ? 'bg-accent/60 shadow-[0_0_12px_rgba(58,109,140,0.4)]'
                  : 'bg-white/10'
              }`}
              role="switch"
              aria-checked={props.formatConfig.builtinRules.pseudoXml.defaultExpanded}
            >
              <div
                class={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-lg transition-all duration-300 ${
                  props.formatConfig.builtinRules.pseudoXml.defaultExpanded ? 'left-7' : 'left-1'
                }`}
              />
            </button>
          </div>
        </Show>

        <ToggleRow
          label="斜体灰色文本"
          description="将 **文本** 渲染为斜体灰色"
          checked={props.formatConfig.builtinRules.italicGray.enabled}
          onToggle={() =>
            setBuiltinRule('italicGray', {
              enabled: !props.formatConfig.builtinRules.italicGray.enabled,
            })
          }
        />

        <ToggleRow
          label="青色引号文本"
          description='将 "引号文本" 渲染为青色'
          checked={props.formatConfig.builtinRules.cyanQuote.enabled}
          onToggle={() =>
            setBuiltinRule('cyanQuote', {
              enabled: !props.formatConfig.builtinRules.cyanQuote.enabled,
            })
          }
        />

        <ToggleRow
          label="世界书关键词高亮"
          description="将世界书触发关键词渲染为紫色"
          checked={props.formatConfig.builtinRules.worldBookKeyword.enabled}
          onToggle={() =>
            setBuiltinRule('worldBookKeyword', {
              enabled: !props.formatConfig.builtinRules.worldBookKeyword.enabled,
            })
          }
        />
      </div>

      <div class="border-t border-white/5 pt-4 space-y-3">
        <div class="flex items-center justify-between gap-4 py-4 border-b border-white/5">
          <div>
            <div class="text-sm font-bold text-white">自定义规则</div>
            <div class="text-[11px] text-mist-solid/35 mt-0.5">添加基于正则表达式的自定义文本高亮规则</div>
          </div>
          <button
            onClick={handleAddNew}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/20 text-accent text-xs font-medium border border-accent/20 hover:bg-accent/30 transition-colors"
          >
            <Plus size={14} />
            添加规则
          </button>
        </div>

        <Show when={props.formatConfig.customRules.length === 0}>
          <div class="text-xs text-mist-solid/35 py-2">暂无自定义规则</div>
        </Show>

        <For each={props.formatConfig.customRules}>
          {(rule) => (
            <div class="flex items-center justify-between gap-3 px-3 py-2 rounded-xl border border-white/5 bg-white/5">
              <div class="flex items-center gap-2 min-w-0">
                <div class="w-3 h-3 rounded-full shrink-0" style={{ 'background-color': rule.color }} />
                <div class="min-w-0">
                  <div class="text-sm text-mist-solid/80 truncate">{rule.name}</div>
                  <div class="text-[10px] text-mist-solid/35 truncate font-mono">/{rule.pattern}/</div>
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => handleEditRule(rule)}
                  class="p-1.5 rounded-lg hover:bg-white/10 text-mist-solid/40 hover:text-mist-solid transition-colors"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  class="p-1.5 rounded-lg hover:bg-red-500/10 text-mist-solid/40 hover:text-red-300 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )}
        </For>
      </div>

      <Show when={isAddingCustomRule() || editingCustomRule()}>
        <CustomRuleEditor
          rule={editingCustomRule()}
          isEditing={!!editingCustomRule()}
          onSave={handleSaveRule}
          onCancel={handleCancel}
        />
      </Show>
    </div>
  );
};
