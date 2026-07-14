import { Component, createSignal, Show } from 'solid-js';
import { validateCustomRulePattern } from './validationUtils';
import type { CustomFormatRule } from '../../lib/messageFormatter';

export interface CustomRuleDraft {
  name: string;
  pattern: string;
  groupIndex: number;
  color: string;
  italic: boolean;
  bold: boolean;
}

interface CustomRuleEditorProps {
  /** Existing rule being edited; `null` when creating a new rule. */
  rule: CustomFormatRule | null;
  isEditing: boolean;
  onSave: (rule: CustomFormatRule) => void;
  onCancel: () => void;
}

const DEFAULT_DRAFT: CustomRuleDraft = {
  name: '',
  pattern: '',
  groupIndex: 0,
  color: '#A78BFA',
  italic: false,
  bold: false,
};

export const CustomRuleEditor: Component<CustomRuleEditorProps> = (props) => {
  const buildInitialDraft = (): CustomRuleDraft => {
    if (props.rule) {
      return {
        name: props.rule.name,
        pattern: props.rule.pattern,
        groupIndex: props.rule.groupIndex,
        color: props.rule.color,
        italic: props.rule.italic,
        bold: props.rule.bold,
      };
    }
    return { ...DEFAULT_DRAFT };
  };

  const [draft, setDraft] = createSignal<CustomRuleDraft>(buildInitialDraft());
  const [patternError, setPatternError] = createSignal<string | null>(null);

  const updateDraft = (patch: Partial<CustomRuleDraft>) => {
    const next = { ...draft(), ...patch };
    setDraft(next);
    setPatternError(validateCustomRulePattern(next.pattern, next.groupIndex));
  };

  const canSave = () =>
    draft().name.trim().length > 0 &&
    draft().pattern.trim().length > 0 &&
    patternError() === null;

  const handleSave = () => {
    if (!canSave()) return;

    const current = draft();
    const rule: CustomFormatRule = {
      id: props.rule?.id ?? crypto.randomUUID(),
      name: current.name,
      pattern: current.pattern,
      groupIndex: current.groupIndex,
      color: current.color,
      italic: current.italic,
      bold: current.bold,
    };
    props.onSave(rule);
  };

  return (
    <div class="border-t border-white/5 pt-4 space-y-3">
      <div class="text-sm font-bold text-white">
        {props.isEditing ? '编辑规则' : '新规则'}
      </div>

      <div>
        <label class="text-xs text-mist-solid/55">规则名称</label>
        <input
          type="text"
          value={draft().name}
          onInput={(e) => updateDraft({ name: e.currentTarget.value })}
          class="w-full mt-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
        />
      </div>

      <div>
        <label class="text-xs text-mist-solid/55">正则表达式</label>
        <input
          type="text"
          value={draft().pattern}
          onInput={(e) => updateDraft({ pattern: e.currentTarget.value })}
          class="w-full mt-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent/40 text-mist-solid"
        />
        <Show when={patternError()}>
          <div class="text-xs text-red-300 mt-1">{patternError()}</div>
        </Show>
      </div>

      <div class="flex gap-3">
        <div class="flex-1">
          <label class="text-xs text-mist-solid/55">匹配组索引</label>
          <input
            type="number"
            min="0"
            value={draft().groupIndex}
            onInput={(e) => updateDraft({ groupIndex: Number(e.currentTarget.value) || 0 })}
            class="w-full mt-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent/40 text-mist-solid"
          />
        </div>
        <div class="flex-1">
          <label class="text-xs text-mist-solid/55">文字颜色</label>
          <div class="flex items-center gap-2 mt-1">
            <input
              type="color"
              value={draft().color}
              onInput={(e) => updateDraft({ color: e.currentTarget.value })}
              class="w-8 h-8 rounded-lg border border-white/10 cursor-pointer bg-transparent"
            />
            <input
              type="text"
              value={draft().color}
              onInput={(e) => updateDraft({ color: e.currentTarget.value })}
              class="flex-1 bg-xuanqing border border-white/5 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent/40 text-mist-solid"
            />
          </div>
        </div>
      </div>

      <div class="flex items-center gap-4">
        <label class="flex items-center gap-2 text-sm text-mist-solid/80 cursor-pointer">
          <input
            type="checkbox"
            checked={draft().italic}
            onChange={(e) => updateDraft({ italic: e.currentTarget.checked })}
            class="accent-accent"
          />
          斜体
        </label>
        <label class="flex items-center gap-2 text-sm text-mist-solid/80 cursor-pointer">
          <input
            type="checkbox"
            checked={draft().bold}
            onChange={(e) => updateDraft({ bold: e.currentTarget.checked })}
            class="accent-accent"
          />
          加粗
        </label>
      </div>

      <div class="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={!canSave()}
          class="px-4 py-2 rounded-xl bg-accent/60 text-white text-sm font-medium hover:bg-accent/80 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {props.isEditing ? '保存修改' : '添加规则'}
        </button>
        <button
          onClick={props.onCancel}
          class="px-4 py-2 rounded-xl bg-white/5 text-mist-solid/60 text-sm hover:bg-white/10 transition-colors"
        >
          取消
        </button>
      </div>
    </div>
  );
};
