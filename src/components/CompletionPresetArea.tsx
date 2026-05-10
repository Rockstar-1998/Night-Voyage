import { Component, For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import {
  AlertTriangle,
  ChevronRight,
  CircleDot,
  Download,
  Eye,
  FilePlus2,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Trash2,
  Upload,
} from '../lib/icons';
import {
  presetsCompilePreview,
  presetsCreate,
  presetsDelete,
  presetsExport,
  presetsGet,
  presetsImport,
  presetsList,
  presetsUpdate,
  type CreatePresetPayload,
  type PresetCompilePreview,
  type PresetDetail,
  type PresetPromptBlock,
  type PresetPromptBlockInput,
  type PresetProviderOverrideInput,
  type PresetSemanticGroupInput,
  type PresetSemanticGroupRecord,
  type PresetSemanticOptionInput,
  type PresetSemanticOptionRecord,
  type PresetSummary,
} from '../lib/backend';
import {
  CompletionDetailModal,
  type PresetBlockEditorData,
} from './CompletionDetailModal';
import {
  CompletionParametersPanel,
  type PresetSettingsDraft,
} from './CompletionParametersPanel';
import { CompletionPreviewModal } from './CompletionPreviewModal';
import { IconButton } from './ui/IconButton';

const DEFAULT_NEW_BLOCK: PresetBlockEditorData = {
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

const DEFAULT_PREVIEW_PROVIDER_KIND = 'openai_compatible';

const normalizeOptional = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const splitConfigItems = (value: string) =>
  value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

const parseOptionalInteger = (fieldName: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`${fieldName} 必须是整数`);
  }
  return Number.parseInt(trimmed, 10);
};

const parseOptionalFloat = (fieldName: string, value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldName} 必须是有效数字`);
  }
  return parsed;
};

const normalizeResponseMode = (value: string) => {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized === 'text' || normalized === 'json_object') {
    return normalized;
  }
  throw new Error('responseMode 只支持 text 或 json_object');
};

const buildProviderOverrideInputs = (
  providerOverrides: PresetSettingsDraft['providerOverrides'],
): PresetProviderOverrideInput[] => {
  const normalized: PresetProviderOverrideInput[] = [];

  providerOverrides.forEach((override, index) => {
    const providerKind = normalizeOptional(override.providerKind);
    const hasOtherFields = [
      override.temperatureOverride,
      override.maxOutputTokensOverride,
      override.topPOverride,
      override.presencePenaltyOverride,
      override.frequencyPenaltyOverride,
      override.responseModeOverride,
      override.stopSequencesOverrideText,
      override.disabledBlockTypesText,
    ].some((value) => value.trim().length > 0);

    if (!providerKind) {
      if (hasOtherFields) {
        throw new Error(`provider override #${index + 1} 必须填写 providerKind`);
      }
      return;
    }

    const stopSequencesOverride = splitConfigItems(override.stopSequencesOverrideText);
    const disabledBlockTypes = splitConfigItems(override.disabledBlockTypesText);

    normalized.push({
      providerKind,
      temperatureOverride: parseOptionalFloat('temperatureOverride', override.temperatureOverride),
      maxOutputTokensOverride: parseOptionalInteger('maxOutputTokensOverride', override.maxOutputTokensOverride),
      topPOverride: parseOptionalFloat('topPOverride', override.topPOverride),
      presencePenaltyOverride: parseOptionalFloat('presencePenaltyOverride', override.presencePenaltyOverride),
      frequencyPenaltyOverride: parseOptionalFloat('frequencyPenaltyOverride', override.frequencyPenaltyOverride),
      responseModeOverride: normalizeResponseMode(override.responseModeOverride),
      stopSequencesOverride: stopSequencesOverride.length > 0 ? stopSequencesOverride : undefined,
      disabledBlockTypes: disabledBlockTypes.length > 0 ? disabledBlockTypes : undefined,
    });
  });

  return normalized;
};

const buildPresetSettingsPayload = (draft: PresetSettingsDraft): CreatePresetPayload => {
  const name = draft.name.trim();
  if (!name) {
    throw new Error('预设名称不能为空');
  }

  return {
    name,
    description: normalizeOptional(draft.description),
    category: normalizeOptional(draft.category) ?? 'general',
    temperature: parseOptionalFloat('temperature', draft.temperature),
    maxOutputTokens: parseOptionalInteger('maxOutputTokens', draft.maxOutputTokens),
    topP: parseOptionalFloat('topP', draft.topP),
    presencePenalty: parseOptionalFloat('presencePenalty', draft.presencePenalty),
    frequencyPenalty: parseOptionalFloat('frequencyPenalty', draft.frequencyPenalty),
    responseMode: normalizeResponseMode(draft.responseMode),
    stopSequences: splitConfigItems(draft.stopSequencesText).map((stopText, index) => ({
      stopText,
      sortOrder: index,
    })),
    providerOverrides: buildProviderOverrideInputs(draft.providerOverrides),
  };
};

const toEditorData = (block: PresetPromptBlock): PresetBlockEditorData => ({
  id: block.id,
  title: block.title ?? '',
  blockType: block.blockType,
  content: block.content,
  scope: block.scope,
  priority: block.priority,
  isEnabled: block.isEnabled,
  isLocked: block.isLocked,
  lockReason: block.lockReason ?? '',
  exclusiveGroupKey: block.exclusiveGroupKey ?? '',
  exclusiveGroupLabel: block.exclusiveGroupLabel ?? '',
});

const toBlockInput = (block: PresetPromptBlock | PresetBlockEditorData): PresetPromptBlockInput => ({
  blockType: block.blockType,
  title: normalizeOptional(block.title),
  content: block.content,
  sortOrder: 'sortOrder' in block ? block.sortOrder : undefined,
  priority: block.priority,
  isEnabled: block.isEnabled,
  scope: block.scope,
  isLocked: block.isLocked,
  lockReason: normalizeOptional(block.lockReason),
  exclusiveGroupKey: normalizeOptional(block.exclusiveGroupKey),
  exclusiveGroupLabel: normalizeOptional(block.exclusiveGroupLabel),
});

const toSemanticOptionBlockInput = (block: PresetSemanticOptionRecord['blocks'][number]): PresetPromptBlockInput => ({
  blockType: block.blockType,
  title: normalizeOptional(block.title),
  content: block.content,
  sortOrder: block.sortOrder,
  priority: block.priority,
  isEnabled: block.isEnabled,
  scope: block.scope,
  isLocked: block.isLocked,
  lockReason: normalizeOptional(block.lockReason),
  exclusiveGroupKey: normalizeOptional(block.exclusiveGroupKey),
  exclusiveGroupLabel: normalizeOptional(block.exclusiveGroupLabel),
});

const toSemanticOptionExampleInput = (
  example: PresetSemanticOptionRecord['examples'][number],
): { role: 'user' | 'assistant'; content: string; sortOrder?: number; isEnabled?: boolean } => ({
  role: example.role === 'user' ? 'user' : 'assistant',
  content: example.content,
  sortOrder: example.sortOrder,
  isEnabled: example.isEnabled,
});

const toSemanticOptionInput = (option: PresetSemanticOptionRecord): PresetSemanticOptionInput => ({
  optionKey: option.optionKey,
  label: option.label,
  description: option.description,
  sortOrder: option.sortOrder,
  isSelected: option.isSelected,
  isEnabled: option.isEnabled,
  expansionKind: option.expansionKind,
  blocks: option.blocks.map(toSemanticOptionBlockInput),
  examples: option.examples.map(toSemanticOptionExampleInput),
  children: option.children.map(toSemanticOptionInput),
});

type SemanticOptionEditorTarget = {
  groupId: number;
  optionId: number;
  blockIndex: number;
};

type ExclusiveBlockGroup = {
  key: string;
  label: string;
  sortOrder: number;
  blocks: PresetPromptBlock[];
};

const flattenSemanticOptions = (
  options: PresetSemanticOptionRecord[],
): PresetSemanticOptionRecord[] =>
  options.flatMap((option) => [option, ...flattenSemanticOptions(option.children)]);

const matchesSearchQuery = (
  query: string,
  ...parts: Array<string | undefined | null>
) =>
  !query ||
  parts
    .filter((part): part is string => Boolean(part))
    .join(' ')
    .toLowerCase()
    .includes(query);

const toSemanticGroupInput = (group: PresetSemanticGroupRecord): PresetSemanticGroupInput => ({
  groupKey: group.groupKey,
  label: group.label,
  description: group.description,
  sortOrder: group.sortOrder,
  selectionMode: group.selectionMode,
  isEnabled: group.isEnabled,
  options: group.options.map(toSemanticOptionInput),
});

const getDirectBlocks = (detail: PresetDetail) =>
  detail.blocks.filter((block) => block.semanticOptionId == null);

const buildPresetUpdatePayload = (
  detail: PresetDetail,
  patch: Partial<CreatePresetPayload>,
): CreatePresetPayload & { id: number } => ({
  id: detail.preset.id,
  name: detail.preset.name,
  description: detail.preset.description,
  category: detail.preset.category,
  temperature: detail.preset.temperature,
  maxOutputTokens: detail.preset.maxOutputTokens,
  topP: detail.preset.topP,
  presencePenalty: detail.preset.presencePenalty,
  frequencyPenalty: detail.preset.frequencyPenalty,
  responseMode: detail.preset.responseMode,
  ...patch,
});

const selectSingleSemanticOption = (
  options: PresetSemanticOptionRecord[],
  targetId: number,
): PresetSemanticOptionRecord[] =>
  options.map((option) => ({
    ...option,
    isSelected: option.id === targetId,
    children: selectSingleSemanticOption(option.children, targetId),
  }));

const toggleMultiSemanticOption = (
  options: PresetSemanticOptionRecord[],
  targetId: number,
): PresetSemanticOptionRecord[] =>
  options.map((option) => ({
    ...option,
    isSelected: option.id === targetId ? !option.isSelected : option.isSelected,
    children: toggleMultiSemanticOption(option.children, targetId),
  }));


export const CompletionPresetArea: Component = () => {
  const [presetSummaries, setPresetSummaries] = createSignal<PresetSummary[]>([]);
  const [selectedPresetId, setSelectedPresetId] = createSignal<number | null>(null);
  const [presetDetail, setPresetDetail] = createSignal<PresetDetail | null>(null);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [listLoading, setListLoading] = createSignal(false);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [successMessage, setSuccessMessage] = createSignal<string | null>(null);
  const [editingBlock, setEditingBlock] = createSignal<PresetBlockEditorData | null>(null);
  const [editingSemanticOptionTarget, setEditingSemanticOptionTarget] = createSignal<SemanticOptionEditorTarget | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = createSignal(false);
  const [settingsMode, setSettingsMode] = createSignal<'create' | 'edit'>('edit');
  const [previewOpen, setPreviewOpen] = createSignal(false);
  const [previewLoading, setPreviewLoading] = createSignal(false);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [previewData, setPreviewData] = createSignal<PresetCompilePreview | null>(null);
  const [previewProviderKind, setPreviewProviderKind] = createSignal(DEFAULT_PREVIEW_PROVIDER_KIND);

  const searchNeedle = createMemo(() => searchQuery().trim().toLowerCase());

  const lockedBlocks = createMemo(() => {
    const detail = presetDetail();
    const query = searchNeedle();
    if (!detail) return [];

    return detail.blocks.filter(
      (block) =>
        !block.semanticOptionId &&
        block.isLocked &&
        matchesSearchQuery(
          query,
          block.title,
          block.blockType,
          block.content,
          block.lockReason,
          block.exclusiveGroupLabel,
          block.exclusiveGroupKey,
        ),
    );
  });

  const choiceSemanticGroups = createMemo(() => {
    const detail = presetDetail();
    const query = searchNeedle();
    if (!detail) return [];

    return detail.semanticGroups
      .filter((group) => group.selectionMode === 'single')
      .map((group) => ({
        ...group,
        flatOptions: flattenSemanticOptions(group.options),
      }))
      .filter((group) =>
        matchesSearchQuery(
          query,
          group.label,
          group.groupKey,
          group.description,
          ...group.flatOptions.flatMap((option) => [
            option.label,
            option.optionKey,
            option.description,
            ...option.blocks.map((block) => block.title ?? block.blockType),
            ...option.blocks.map((block) => block.content),
          ]),
        ),
      )
      .sort((left, right) => left.sortOrder - right.sortOrder);
  });

  const exclusiveBlockGroups = createMemo(() => {
    const detail = presetDetail();
    const query = searchNeedle();
    if (!detail) return [] as ExclusiveBlockGroup[];

    const groups = new Map<string, ExclusiveBlockGroup>();
    detail.blocks.forEach((block) => {
      if (block.semanticOptionId || block.isLocked) return;
      const key = normalizeOptional(block.exclusiveGroupKey);
      if (!key) return;

      const existing = groups.get(key);
      if (existing) {
        existing.blocks.push(block);
        existing.sortOrder = Math.min(existing.sortOrder, block.sortOrder);
        return;
      }

      groups.set(key, {
        key,
        label: normalizeOptional(block.exclusiveGroupLabel) ?? key,
        sortOrder: block.sortOrder,
        blocks: [block],
      });
    });

    return Array.from(groups.values())
      .filter((group) =>
        matchesSearchQuery(
          query,
          group.label,
          group.key,
          ...group.blocks.flatMap((block) => [block.title, block.blockType, block.content]),
        ),
      )
      .sort(
        (left, right) =>
          left.sortOrder - right.sortOrder || left.label.localeCompare(right.label),
      );
  });

  const ordinarySemanticGroups = createMemo(() => {
    const detail = presetDetail();
    const query = searchNeedle();
    if (!detail) return [];

    return detail.semanticGroups
      .filter((group) => group.selectionMode !== 'single')
      .map((group) => ({
        ...group,
        flatOptions: flattenSemanticOptions(group.options),
      }))
      .filter((group) =>
        matchesSearchQuery(
          query,
          group.label,
          group.groupKey,
          group.description,
          ...group.flatOptions.flatMap((option) => [
            option.label,
            option.optionKey,
            option.description,
            ...option.blocks.map((block) => block.title ?? block.blockType),
            ...option.blocks.map((block) => block.content),
          ]),
        ),
      )
      .sort((left, right) => left.sortOrder - right.sortOrder);
  });

  const ordinaryBlocks = createMemo(() => {
    const detail = presetDetail();
    const query = searchNeedle();
    if (!detail) return [];

    return detail.blocks.filter(
      (block) =>
        !block.semanticOptionId &&
        !block.isLocked &&
        !normalizeOptional(block.exclusiveGroupKey) &&
        matchesSearchQuery(
          query,
          block.title,
          block.blockType,
          block.content,
          block.lockReason,
          block.exclusiveGroupLabel,
          block.exclusiveGroupKey,
        ),
    );
  });
  

  const refreshPresetSummaries = async (nextSelectedPresetId?: number | null) => {
    setListLoading(true);
    try {
      const data = await presetsList();
      setPresetSummaries(data);
      const targetId = nextSelectedPresetId ?? selectedPresetId() ?? data[0]?.id ?? null;
      if (targetId != null && data.some((preset) => preset.id === targetId)) {
        setSelectedPresetId(targetId);
      } else {
        setSelectedPresetId(data[0]?.id ?? null);
        if (data.length === 0) {
          setPresetDetail(null);
        }
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setListLoading(false);
    }
  };

  const loadPresetDetail = async (presetId: number) => {
    setDetailLoading(true);
    setErrorMessage(null);
    try {
      const detail = await presetsGet(presetId);
      setPresetDetail(detail);
      setSelectedPresetId(presetId);
      setPreviewData(null);
      setPreviewError(null);
    } catch (error) {
      setPresetDetail(null);
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDetailLoading(false);
    }
  };

  const persistBlocks = async (blocks: PresetPromptBlockInput[]) => {
    const detail = presetDetail();
    if (!detail) return false;
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const nextDetail = await presetsUpdate(buildPresetUpdatePayload(detail, { blocks }));
      setPresetDetail(nextDetail);
      setPresetSummaries((current) =>
        current.map((preset) => (preset.id === nextDetail.preset.id ? nextDetail.preset : preset)),
      );
      setSuccessMessage('预设条目已保存');
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const persistSemanticGroups = async (semanticGroups: PresetSemanticGroupInput[]) => {
    const detail = presetDetail();
    if (!detail) {
      return false;
    }
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const nextDetail = await presetsUpdate(buildPresetUpdatePayload(detail, { semanticGroups }));
      setPresetDetail(nextDetail);
      setPresetSummaries((current) =>
        current.map((preset) => (preset.id === nextDetail.preset.id ? nextDetail.preset : preset)),
      );
      setSuccessMessage('语义组选项已保存');
      return true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSemanticOption = async (groupId: number, optionId: number, selectionMode: string) => {
    const detail = presetDetail();
    if (!detail) {
      return;
    }
    const nextGroups = detail.semanticGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            options:
              selectionMode === 'single'
                ? selectSingleSemanticOption(group.options, optionId)
                : toggleMultiSemanticOption(group.options, optionId),
          }
        : group,
    );
    await persistSemanticGroups(nextGroups.map(toSemanticGroupInput));
  };

  const savePresetSettings = async (draft: PresetSettingsDraft) => {
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const payload = buildPresetSettingsPayload(draft);
      if (settingsMode() === 'create') {
        const created = await presetsCreate(payload);
        setPresetDetail(created);
        await refreshPresetSummaries(created.preset.id);
        setSelectedPresetId(created.preset.id);
        setSuccessMessage('预设已创建');
      } else {
        const detail = presetDetail();
        if (!detail) {
          throw new Error('当前没有可编辑的预设');
        }
        const updated = await presetsUpdate(buildPresetUpdatePayload(detail, payload));
        setPresetDetail(updated);
        setPresetSummaries((current) =>
          current.map((preset) => (preset.id === updated.preset.id ? updated.preset : preset)),
        );
        setSuccessMessage('预设设置已保存');
      }
      setIsSettingsOpen(false);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const loadCompilePreview = async () => {
    const presetId = selectedPresetId();
    if (presetId == null) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      const preview = await presetsCompilePreview(
        presetId,
        normalizeOptional(previewProviderKind()),
      );
      setPreviewData(preview);
    } catch (error) {
      setPreviewData(null);
      setPreviewError(error instanceof Error ? error.message : String(error));
    } finally {
      setPreviewLoading(false);
    }
  };

  const exportPreset = async () => {
    const detail = presetDetail();
    if (!detail) return;
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const payloadJson = await presetsExport(detail.preset.id);
      const blob = new Blob([payloadJson], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${detail.preset.name}.night-voyage-preset.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSuccessMessage('预设已导出');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const importPreset = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const payloadJson = await file.text();
      const imported = await presetsImport(payloadJson);
      setPresetDetail(imported);
      await refreshPresetSummaries(imported.preset.id);
      setSelectedPresetId(imported.preset.id);
      setSuccessMessage('预设已导入');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const deletePreset = async () => {
    const detail = presetDetail();
    if (!detail) return;
    const confirmed = window.confirm(`确认删除预设“${detail.preset.name}”吗？`);
    if (!confirmed) return;

    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      await presetsDelete(detail.preset.id);
      setPreviewData(null);
      setPreviewError(null);
      setPreviewOpen(false);
      setPresetDetail(null);
      await refreshPresetSummaries(null);
      setSuccessMessage('预设已删除');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const findExclusiveConflict = (candidate: PresetBlockEditorData | PresetPromptBlock) => {
    const detail = presetDetail();
    const groupKey = normalizeOptional(candidate.exclusiveGroupKey);
    if (!detail || !candidate.isEnabled || !groupKey) return null;

    return detail.blocks.find(
      (block) =>
        block.id !== candidate.id &&
        block.isEnabled &&
        normalizeOptional(block.exclusiveGroupKey) === groupKey,
    );
  };

  const findSemanticOptionById = (
    options: PresetSemanticOptionRecord[],
    optionId: number,
  ): PresetSemanticOptionRecord | null => {
    for (const option of options) {
      if (option.id === optionId) {
        return option;
      }
      const childMatch = findSemanticOptionById(option.children, optionId);
      if (childMatch) {
        return childMatch;
      }
    }
    return null;
  };

  const replaceSemanticOptionInTree = (
    options: PresetSemanticOptionRecord[],
    optionId: number,
    updater: (option: PresetSemanticOptionRecord) => PresetSemanticOptionRecord,
  ): PresetSemanticOptionRecord[] =>
    options.map((option) => {
      if (option.id === optionId) {
        return updater(option);
      }
      if (option.children.length === 0) {
        return option;
      }
      return {
        ...option,
        children: replaceSemanticOptionInTree(option.children, optionId, updater),
      };
    });

  const openBlockEditor = (block: PresetPromptBlock) => {
    setEditingSemanticOptionTarget(null);
    setErrorMessage(null);
    setSuccessMessage(null);
    setEditingBlock(toEditorData(block));
  };

  const openSemanticOptionEditor = (groupId: number, optionId: number) => {
    const detail = presetDetail();
    if (!detail) return;

    const targetGroup = detail.semanticGroups.find((group) => group.id === groupId);
    const targetOption = targetGroup ? findSemanticOptionById(targetGroup.options, optionId) : null;
    const primaryBlock = targetOption?.blocks[0];

    if (!targetOption || !primaryBlock) {
      setErrorMessage('当前语义选项还没有可编辑的条目内容');
      return;
    }

    setErrorMessage(null);
    setSuccessMessage(null);
    setEditingSemanticOptionTarget({ groupId, optionId, blockIndex: 0 });
    setEditingBlock({
      id: primaryBlock.id,
      title: primaryBlock.title ?? targetOption.label,
      blockType: primaryBlock.blockType,
      content: primaryBlock.content,
      scope: primaryBlock.scope,
      priority: primaryBlock.priority,
      isEnabled: primaryBlock.isEnabled,
      isLocked: primaryBlock.isLocked,
      lockReason: primaryBlock.lockReason ?? '',
      exclusiveGroupKey: primaryBlock.exclusiveGroupKey ?? '',
      exclusiveGroupLabel: primaryBlock.exclusiveGroupLabel ?? '',
    });
  };

  const handleToggleBlock = async (block: PresetPromptBlock) => {
    if (block.isLocked) {
      setErrorMessage(block.lockReason ?? '该条目已锁定，不能切换启用状态');
      return;
    }

    const toggled: PresetBlockEditorData = {
      ...toEditorData(block),
      isEnabled: !block.isEnabled,
    };
    const conflict = findExclusiveConflict(toggled);
    if (conflict) {
      setErrorMessage(
        `互斥组“${conflict.exclusiveGroupLabel ?? conflict.exclusiveGroupKey ?? '未命名分组'}”中已启用条目“${conflict.title ?? conflict.blockType}”，请先关闭它。`,
      );
      return;
    }

    const detail = presetDetail();
    if (!detail) return;
    await persistBlocks(
      getDirectBlocks(detail).map((current) =>
        current.id === block.id ? toBlockInput(toggled) : toBlockInput(current),
      ),
    );
  };

  const handleSaveBlock = async (editorData: PresetBlockEditorData) => {
    const detail = presetDetail();
    if (!detail) return;

    if (!editorData.isLocked && normalizeOptional(editorData.lockReason)) {
      setErrorMessage('只有在勾选锁定时才能填写锁定原因');
      return;
    }
    if (!normalizeOptional(editorData.exclusiveGroupKey) && normalizeOptional(editorData.exclusiveGroupLabel)) {
      setErrorMessage('填写互斥组显示名之前，需要先填写互斥组机器键');
      return;
    }

    const conflict = findExclusiveConflict(editorData);
    if (conflict) {
      setErrorMessage(
        `互斥组“${conflict.exclusiveGroupLabel ?? conflict.exclusiveGroupKey ?? '未命名分组'}”中已启用条目“${conflict.title ?? conflict.blockType}”，不能同时保存为启用状态。`,
      );
      return;
    }

    const directBlocks = getDirectBlocks(detail);
    const nextBlocks = directBlocks.map((block) => toBlockInput(block));
    const nextInput = toBlockInput(editorData);
    const existingIndex = directBlocks.findIndex((block) => block.id === editorData.id);

    if (existingIndex >= 0) {
      nextBlocks[existingIndex] = {
        ...nextBlocks[existingIndex],
        ...nextInput,
        sortOrder: directBlocks[existingIndex]?.sortOrder,
      };
    } else {
      nextBlocks.push({
        ...nextInput,
        sortOrder: directBlocks.length,
      });
    }

    const saved = await persistBlocks(nextBlocks);
    if (saved) {
      setEditingBlock(null);
    }
  };

  const handleSaveSemanticOptionBlock = async (editorData: PresetBlockEditorData) => {
    const detail = presetDetail();
    const target = editingSemanticOptionTarget();
    if (!detail || !target) return;

    if (!editorData.isLocked && normalizeOptional(editorData.lockReason)) {
      setErrorMessage('只有在勾选锁定时才能填写锁定原因');
      return;
    }
    if (!normalizeOptional(editorData.exclusiveGroupKey) && normalizeOptional(editorData.exclusiveGroupLabel)) {
      setErrorMessage('填写互斥组显示名之前，需要先填写互斥组机器键');
      return;
    }

    const nextGroups = detail.semanticGroups.map((group) =>
      group.id === target.groupId
        ? {
            ...group,
            options: replaceSemanticOptionInTree(group.options, target.optionId, (option) => ({
              ...option,
              blocks: option.blocks.map((block, index) =>
                index === target.blockIndex
                  ? {
                      ...block,
                      title: normalizeOptional(editorData.title),
                      blockType: editorData.blockType,
                      content: editorData.content,
                      priority: editorData.priority,
                      isEnabled: editorData.isEnabled,
                      scope: editorData.scope,
                      isLocked: editorData.isLocked,
                      lockReason: normalizeOptional(editorData.lockReason),
                      exclusiveGroupKey: normalizeOptional(editorData.exclusiveGroupKey),
                      exclusiveGroupLabel: normalizeOptional(editorData.exclusiveGroupLabel),
                    }
                  : block,
              ),
            })),
          }
        : group,
    );

    const saved = await persistSemanticGroups(nextGroups.map(toSemanticGroupInput));
    if (saved) {
      setEditingSemanticOptionTarget(null);
      setEditingBlock(null);
    }
  };

  const handleSaveEditor = async (editorData: PresetBlockEditorData) => {
    if (editingSemanticOptionTarget()) {
      await handleSaveSemanticOptionBlock(editorData);
      return;
    }
    await handleSaveBlock(editorData);
  };

  const handleCloseEditor = () => {
    setEditingSemanticOptionTarget(null);
    setEditingBlock(null);
  };

  const handleDeleteBlock = async (blockId: number) => {
    const detail = presetDetail();
    if (!detail) return;

    const target = detail.blocks.find((block) => block.id === blockId);
    if (!target) return;
    if (target.isLocked) {
      setErrorMessage(target.lockReason ?? '该条目已锁定，不能删除');
      return;
    }

    const saved = await persistBlocks(
      getDirectBlocks(detail)
        .filter((block) => block.id !== blockId)
        .map((block) => toBlockInput(block)),
    );
    if (saved) {
      setEditingBlock(null);
    }
  };

  const deleteBlockFromPreset = async (blockId: number) => {
    const detail = presetDetail();
    if (!detail) return;
    await persistBlocks(
      getDirectBlocks(detail)
        .filter((block) => block.id !== blockId)
        .map((block) => toBlockInput(block)),
    );
  };

  onMount(async () => {
    await refreshPresetSummaries();
  });

  createEffect(() => {
    const presetId = selectedPresetId();
    if (presetId != null) {
      void loadPresetDetail(presetId);
    }
  });

  return (
    <div class="flex-1 flex h-full bg-transparent overflow-hidden relative">
      <div class="w-80 border-r border-white/5 bg-night-water/40 backdrop-blur-xl flex flex-col">
        <div class="p-6 border-b border-white/5 space-y-4">
          <div>
            <h2 class="text-3xl font-black text-white tracking-tighter uppercase italic">预设列表</h2>
            <p class="text-xs text-mist-solid/35 mt-1">真实读取后端预设数据，支持完整 CRUD、治理设置和编译预览。</p>
          </div>
          <div class="space-y-3">
            <div class="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <div class="min-w-0 flex-1">
                <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">列表操作</div>
                <div class="text-sm text-mist-solid/40 mt-1">刷新预设列表或创建新预设。</div>
              </div>
              <div class="flex items-center gap-2">
                <IconButton
                  onClick={() => void refreshPresetSummaries(selectedPresetId())}
                  label={listLoading() ? '刷新预设中' : '刷新预设'}
                  size="md"
                >
                  <RefreshCw size={16} class={listLoading() ? 'animate-spin' : ''} />
                </IconButton>
                <IconButton
                  onClick={() => {
                    setSettingsMode('create');
                    setErrorMessage(null);
                    setSuccessMessage(null);
                    setIsSettingsOpen(true);
                  }}
                  label="新建预设"
                  tone="accent"
                  size="md"
                >
                  <FilePlus2 size={16} />
                </IconButton>
              </div>
            </div>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4 custom-scrollbar">
          <Show when={!listLoading()} fallback={<div class="text-sm text-mist-solid/35">正在加载预设...</div>}>
            <div class="flex flex-col gap-2">
              <For each={presetSummaries()}>
                {(preset) => (
                  <button
                    onClick={() => setSelectedPresetId(preset.id)}
                    class={`w-full text-left rounded-2xl border px-4 py-3 transition-all ${selectedPresetId() === preset.id
                      ? 'border-accent/40 bg-accent/10 shadow-lg shadow-accent/10'
                      : 'border-white/5 bg-white/5 hover:bg-white/10 hover:border-white/10'
                    }`}
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0">
                        <div class="truncate text-sm font-bold text-mist-solid">{preset.name}</div>
                        <div class="truncate text-[11px] text-mist-solid/40 mt-1">{preset.description ?? preset.category}</div>
                      </div>
                      <ChevronRight size={16} class={selectedPresetId() === preset.id ? 'text-accent' : 'text-mist-solid/25'} />
                    </div>
                  </button>
                )}
              </For>
              <Show when={presetSummaries().length === 0}>
                <div class="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-mist-solid/35">
                  当前没有可展示的预设，点击上方“新建预设”即可创建。
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <div class="flex-1 flex flex-col h-full overflow-hidden">
        <div class="p-8 flex items-center justify-between border-b border-white/5 bg-xuanqing/20 gap-6">
          <div class="flex items-center gap-4 flex-1 min-w-0">
            <div class="relative flex-1 max-w-xl group">
              <Search class="absolute left-4 top-1/2 -translate-y-1/2 text-mist-solid/20 group-focus-within:text-accent transition-colors" size={18} />
              <input
                type="text"
                placeholder="搜索条目 (标题、类型、内容、互斥组、锁定原因)..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                class="w-full bg-xuanqing border border-white/5 rounded-xl py-3 pl-12 pr-4 text-sm focus:outline-none focus:border-accent/40 transition-all placeholder:text-mist-solid/20"
              />
            </div>
          </div>
          <div class="flex items-center gap-3 shrink-0">
            <div class="text-right mr-1">
              <div class="text-[10px] font-black uppercase tracking-[0.3em] text-mist-solid/25">工具栏</div>
              <div class="text-sm text-mist-solid/40 mt-1">预设与条目操作</div>
            </div>
            <label
              title="导入预设"
              aria-label="导入预设"
              class="p-2.5 rounded-xl bg-white/5 text-mist-solid/40 hover:text-mist-solid hover:bg-white/10 transition-all border border-white/5 cursor-pointer focus-within:ring-2 focus-within:ring-accent/40"
            >
              <Upload size={18} />
              <input type="file" accept="application/json,.json" class="hidden" onChange={(event) => void importPreset(event)} />
            </label>
            <IconButton
              onClick={() => void exportPreset()}
              disabled={!presetDetail() || saving()}
              label="导出当前预设"
              size="md"
            >
              <Download size={18} />
            </IconButton>
            <IconButton
              onClick={() => {
                setErrorMessage(null);
                setSuccessMessage(null);
                setEditingBlock({ ...DEFAULT_NEW_BLOCK });
              }}
              disabled={!presetDetail()}
              label="添加新条目"
              tone="accent"
              size="md"
            >
              <Plus size={18} />
            </IconButton>
            <IconButton
              onClick={() => {
                setSettingsMode('edit');
                setIsSettingsOpen(true);
              }}
              disabled={!presetDetail()}
              label="编辑预设设置"
              size="md"
            >
              <Settings size={18} />
            </IconButton>
            <IconButton
              onClick={() => {
                setPreviewOpen(true);
                void loadCompilePreview();
              }}
              disabled={!presetDetail()}
              label="查看编译预览"
              size="md"
            >
              <Eye size={18} />
            </IconButton>
            <IconButton
              onClick={() => void deletePreset()}
              disabled={!presetDetail() || saving()}
              label="删除当前预设"
              tone="danger"
              size="md"
            >
              <Trash2 size={18} />
            </IconButton>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar">
          <Show when={errorMessage()}>
            <div class="mb-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              {errorMessage()}
            </div>
          </Show>
          <Show when={successMessage()}>
            <div class="mb-4 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {successMessage()}
            </div>
          </Show>

          <Show when={!detailLoading()} fallback={<div class="text-sm text-mist-solid/35">正在加载预设详情...</div>}>
            <Show
              when={presetDetail()}
              fallback={<div class="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-mist-solid/35">请选择一个预设查看其条目，或在左侧新建预设。</div>}
            >
              {(detailAccessor) => {
                const detail = () => detailAccessor();
                return (
                  <div class="space-y-6">
                    <div class="rounded-3xl border border-white/5 bg-white/5 px-6 py-5">
                      <div class="flex items-start justify-between gap-4">
                        <div class="min-w-0">
                          <div class="text-lg font-bold text-mist-solid truncate">{detail().preset.name}</div>
                          <div class="text-sm text-mist-solid/45 mt-1">{detail().preset.description ?? '暂无描述'}</div>
                          <div class="flex flex-wrap gap-2 mt-3 text-[10px] text-mist-solid/55">
                            <span class="px-2 py-0.5 rounded-md border border-white/10 bg-white/5">分类 {detail().preset.category}</span>
                            <span class="px-2 py-0.5 rounded-md border border-white/10 bg-white/5">semanticGroups {detail().semanticGroups.length}</span>
                            <span class="px-2 py-0.5 rounded-md border border-white/10 bg-white/5">blocks {detail().blocks.length}</span>
                            <span class="px-2 py-0.5 rounded-md border border-white/10 bg-white/5">examples {detail().examples.length}</span>
                            <span class="px-2 py-0.5 rounded-md border border-white/10 bg-white/5">stop {detail().stopSequences.length}</span>
                            <span class="px-2 py-0.5 rounded-md border border-white/10 bg-white/5">providerOverrides {detail().providerOverrides.length}</span>
                          </div>
                        </div>
                        <div class="text-xs text-mist-solid/35 shrink-0 text-right">
                          <div>temperature：{detail().preset.temperature ?? '未设置'}</div>
                          <div>responseMode：{detail().preset.responseMode ?? '默认'}</div>
                        </div>
                      </div>
                    </div>

                    <Show when={lockedBlocks().length > 0}>
                      <div class="rounded-3xl border border-white/5 bg-white/5 p-5 text-sm text-mist-solid/70 space-y-4">
                        <div class="flex items-start gap-3">
                          <Lock size={18} class="text-amber-300 shrink-0 mt-0.5" />
                          <div class="space-y-2 min-w-0">
                            <div class="font-bold text-mist-solid">锁定条目</div>
                            <p class="text-xs leading-5 text-mist-solid/55">
                              这些条目属于安全区，默认只允许查看与进入编辑，不参与快捷切换。
                            </p>
                          </div>
                        </div>
                        <div class="flex flex-col gap-3">
                          <For each={lockedBlocks()}>
                            {(block) => (
                              <div class="relative rounded-2xl border border-amber-500/20 bg-amber-500/5 transition-all hover:border-amber-400/30 hover:bg-amber-500/10">
                                <button
                                  onClick={() => openBlockEditor(block)}
                                  class="w-full text-left p-4 pr-12"
                                >
                                  <div class="flex items-center gap-2 flex-wrap">
                                    <span class="text-sm font-bold text-mist-solid">{block.title ?? block.blockType}</span>
                                    <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/55">{block.blockType}</span>
                                    <span class="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md border border-amber-500/20 bg-amber-500/10 text-amber-200">
                                      <Lock size={12} /> 锁定
                                    </span>
                                  </div>
                                  <p class="text-xs text-mist-solid/45 mt-2 leading-5 line-clamp-2">{block.content}</p>
                                  <Show when={block.lockReason}>
                                    <p class="text-[11px] text-amber-200/75 mt-2 leading-5">锁定原因：{block.lockReason}</p>
                                  </Show>
                                </button>
                                <IconButton
                                  type="button"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    const confirmed = window.confirm(`该条目已锁定${block.lockReason ? `（锁定原因：${block.lockReason}）` : ''}，确定要删除吗？`);
                                    if (!confirmed) return;
                                    void deleteBlockFromPreset(block.id);
                                  }}
                                  disabled={saving()}
                                  label="删除锁定条目"
                                  tone="danger"
                                  size="sm"
                                  class="absolute top-3 right-3 bg-black/20"
                                >
                                  <Trash2 size={14} />
                                </IconButton>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <Show when={choiceSemanticGroups().length > 0 || exclusiveBlockGroups().length > 0}>
                      <div class="rounded-3xl border border-white/5 bg-white/5 p-5 text-sm text-mist-solid/70 space-y-4">
                        <div class="flex items-start gap-3">
                          <CircleDot size={18} class="text-accent shrink-0 mt-0.5" />
                          <div class="space-y-2 min-w-0">
                            <div class="font-bold text-mist-solid">选择组（互斥组）</div>
                            <p class="text-xs leading-5 text-mist-solid/55">
                              这里统一展示“多选一”条目。整卡点击负责切换，右上角编辑按钮负责进入编辑。
                            </p>
                          </div>
                        </div>
                        <div class="space-y-4">
                          <For each={choiceSemanticGroups()}>
                            {(group) => (
                              <div class="rounded-2xl border border-white/5 bg-xuanqing/40 p-4 space-y-3">
                                <div class="flex items-start justify-between gap-4">
                                  <div class="min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                      <span class="text-sm font-bold text-mist-solid">{group.label}</span>
                                      <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/50">{group.groupKey}</span>
                                      <span class="text-[10px] px-2 py-0.5 rounded-md border border-blue-500/20 bg-blue-500/10 text-blue-200">多选一</span>
                                    </div>
                                    <Show when={group.description}>
                                      <p class="text-xs text-mist-solid/45 mt-2 leading-5">{group.description}</p>
                                    </Show>
                                  </div>
                                </div>
                                <div class="space-y-2">
                                  <For each={group.flatOptions}>
                                    {(option) => (
                                      <div class={`relative rounded-2xl border ${option.isSelected ? 'border-accent/40 bg-accent/10' : 'border-white/10 bg-black/10 hover:border-accent/20 hover:bg-xuanqing/50'}`}>
                                        <button
                                          type="button"
                                          onClick={() => void handleToggleSemanticOption(group.id, option.id, group.selectionMode)}
                                          disabled={saving() || !option.isEnabled}
                                          class="w-full text-left px-4 py-3 pr-20 transition-all disabled:opacity-40"
                                        >
                                          <div class="flex items-start gap-3">
                                            <span class={`mt-0.5 text-lg leading-none ${option.isSelected ? 'text-accent' : 'text-mist-solid/25'}`}>
                                              {option.isSelected ? '◉' : '○'}
                                            </span>
                                            <div class="min-w-0 flex-1 space-y-2">
                                              <div class="flex items-center gap-2 flex-wrap">
                                                <span class="text-sm font-bold text-mist-solid">{option.label}</span>
                                                <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/50">{option.optionKey}</span>
                                                <span class={`text-[10px] px-2 py-0.5 rounded-md border ${option.isSelected ? 'border-accent/30 bg-accent/10 text-accent' : 'border-white/10 bg-white/5 text-mist-solid/45'}`}>
                                                  {option.isSelected ? '当前选中' : '点击切换'}
                                                </span>
                                              </div>
                                              <Show when={option.description}>
                                                <p class="text-xs text-mist-solid/55 leading-5">{option.description}</p>
                                              </Show>
                                            </div>
                                          </div>
                                        </button>
                                        <IconButton
                                          type="button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            openSemanticOptionEditor(group.id, option.id);
                                          }}
                                          disabled={saving()}
                                          label="编辑语义选项"
                                          size="sm"
                                          class="absolute top-3 right-3 bg-black/20"
                                        >
                                          <Pencil size={14} />
                                        </IconButton>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </div>
                            )}
                          </For>

                          <For each={exclusiveBlockGroups()}>
                            {(group) => (
                              <div class="rounded-2xl border border-white/5 bg-xuanqing/40 p-4 space-y-3">
                                <div class="flex items-start justify-between gap-4">
                                  <div class="min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                      <span class="text-sm font-bold text-mist-solid">{group.label}</span>
                                      <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/50">{group.key}</span>
                                      <span class="text-[10px] px-2 py-0.5 rounded-md border border-blue-500/20 bg-blue-500/10 text-blue-200">互斥组</span>
                                    </div>
                                  </div>
                                </div>
                                <div class="space-y-2">
                                  <For each={group.blocks}>
                                    {(block) => (
                                      <div class={`relative rounded-2xl border ${block.isEnabled ? 'border-accent/40 bg-accent/10' : 'border-white/10 bg-black/10 hover:border-accent/20 hover:bg-xuanqing/50'}`}>
                                        <button
                                          type="button"
                                          onClick={() => void handleToggleBlock(block)}
                                          disabled={saving() || block.isLocked}
                                          class="w-full text-left px-4 py-3 pr-28 transition-all disabled:opacity-40"
                                        >
                                          <div class="flex items-start gap-3">
                                            <span class={`mt-0.5 text-lg leading-none ${block.isEnabled ? 'text-accent' : 'text-mist-solid/25'}`}>
                                              {block.isEnabled ? '◉' : '○'}
                                            </span>
                                            <div class="min-w-0 flex-1 space-y-2">
                                              <div class="flex items-center gap-2 flex-wrap">
                                                <span class="text-sm font-bold text-mist-solid">{block.title ?? block.blockType}</span>
                                                <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/55">{block.blockType}</span>
                                                <span class={`text-[10px] px-2 py-0.5 rounded-md border ${block.isEnabled ? 'border-accent/30 bg-accent/10 text-accent' : 'border-white/10 bg-white/5 text-mist-solid/45'}`}>
                                                  {block.isEnabled ? '当前启用' : '点击切换'}
                                                </span>
                                              </div>
                                              <p class="text-xs text-mist-solid/45 leading-5 line-clamp-2">{block.content}</p>
                                            </div>
                                          </div>
                                        </button>
                                        <div class="absolute top-3 right-3 flex items-center gap-1">
                                          <IconButton
                                            type="button"
                                            onClick={(event) => {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              openBlockEditor(block);
                                            }}
                                            disabled={saving()}
                                            label="编辑互斥组条目"
                                            size="sm"
                                            class="bg-black/20"
                                          >
                                            <Pencil size={14} />
                                          </IconButton>
                                          <IconButton
                                            type="button"
                                            onClick={(event) => {
                                              event.preventDefault();
                                              event.stopPropagation();
                                              const confirmMsg = group.blocks.length <= 2
                                                ? '该互斥组仅剩一个条目，删除后互斥组将自动解散。确定要删除吗？'
                                                : `确定要删除条目"${block.title ?? block.blockType}"吗？`;
                                              const confirmed = window.confirm(confirmMsg);
                                              if (!confirmed) return;
                                              void deleteBlockFromPreset(block.id);
                                            }}
                                            disabled={saving()}
                                            label="删除互斥组条目"
                                            tone="danger"
                                            size="sm"
                                            class="bg-black/20"
                                          >
                                            <Trash2 size={14} />
                                          </IconButton>
                                        </div>
                                      </div>
                                    )}
                                  </For>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingSemanticOptionTarget(null);
                                      setErrorMessage(null);
                                      setSuccessMessage(null);
                                      setEditingBlock({
                                        ...DEFAULT_NEW_BLOCK,
                                        exclusiveGroupKey: group.key,
                                        exclusiveGroupLabel: group.label,
                                      });
                                    }}
                                    class="w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-white/5 px-4 py-2.5 text-xs text-mist-solid/45 hover:text-mist-solid hover:border-accent/30 hover:bg-accent/5 transition-all"
                                  >
                                    <Plus size={14} />
                                    添加互斥条目
                                  </button>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </div>
                    </Show>

                    <Show when={ordinarySemanticGroups().length > 0 || ordinaryBlocks().length > 0}>
                      <div class="rounded-3xl border border-white/5 bg-white/5 p-5 text-sm text-mist-solid/70 space-y-4">
                        <div class="flex items-start gap-3">
                          <Plus size={18} class="text-mist-solid/60 shrink-0 mt-0.5" />
                          <div class="space-y-2 min-w-0">
                            <div class="font-bold text-mist-solid">普通条目</div>
                            <p class="text-xs leading-5 text-mist-solid/55">
                              这里展示自由开关条目与非互斥选项，排在锁定区和选择组之后。
                            </p>
                          </div>
                        </div>
                        <div class="space-y-4">
                          <For each={ordinarySemanticGroups()}>
                            {(group) => (
                              <div class="rounded-2xl border border-white/5 bg-xuanqing/40 p-4 space-y-3">
                                <div class="flex items-start justify-between gap-4">
                                  <div class="min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                      <span class="text-sm font-bold text-mist-solid">{group.label}</span>
                                      <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/50">{group.groupKey}</span>
                                      <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/50">普通组</span>
                                    </div>
                                    <Show when={group.description}>
                                      <p class="text-xs text-mist-solid/45 mt-2 leading-5">{group.description}</p>
                                    </Show>
                                  </div>
                                </div>
                                <div class="space-y-2">
                                  <For each={group.flatOptions}>
                                    {(option) => (
                                      <div class={`relative rounded-2xl border ${option.isSelected ? 'border-accent/40 bg-accent/10' : 'border-white/10 bg-black/10 hover:border-accent/20 hover:bg-xuanqing/50'}`}>
                                        <button
                                          type="button"
                                          onClick={() => void handleToggleSemanticOption(group.id, option.id, group.selectionMode)}
                                          disabled={saving() || !option.isEnabled}
                                          class="w-full text-left px-4 py-3 pr-20 transition-all disabled:opacity-40"
                                        >
                                          <div class="flex items-start gap-3">
                                            <span class={`mt-0.5 text-lg leading-none ${option.isSelected ? 'text-accent' : 'text-mist-solid/25'}`}>
                                              {option.isSelected ? '☑' : '☐'}
                                            </span>
                                            <div class="min-w-0 flex-1 space-y-2">
                                              <div class="flex items-center gap-2 flex-wrap">
                                                <span class="text-sm font-bold text-mist-solid">{option.label}</span>
                                                <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/50">{option.optionKey}</span>
                                                <span class={`text-[10px] px-2 py-0.5 rounded-md border ${option.isSelected ? 'border-accent/30 bg-accent/10 text-accent' : 'border-white/10 bg-white/5 text-mist-solid/45'}`}>
                                                  {option.isSelected ? '当前启用' : '点击切换'}
                                                </span>
                                              </div>
                                              <Show when={option.description}>
                                                <p class="text-xs text-mist-solid/55 leading-5">{option.description}</p>
                                              </Show>
                                            </div>
                                          </div>
                                        </button>
                                        <IconButton
                                          type="button"
                                          onClick={(event) => {
                                            event.preventDefault();
                                            event.stopPropagation();
                                            openSemanticOptionEditor(group.id, option.id);
                                          }}
                                          disabled={saving()}
                                          label="编辑普通组选项"
                                          size="sm"
                                          class="absolute top-3 right-3 bg-black/20"
                                        >
                                          <Pencil size={14} />
                                        </IconButton>
                                      </div>
                                    )}
                                  </For>
                                </div>
                              </div>
                            )}
                          </For>

                          <div class="flex flex-col gap-3">
                            <For each={ordinaryBlocks()}>
                              {(block) => (
                                <div class="rounded-2xl border border-white/5 bg-xuanqing/40 p-4 transition-all hover:border-accent/30 hover:bg-xuanqing/60">
                                  <div class="flex items-start gap-4">
                                    <IconButton
                                      onClick={() => void handleToggleBlock(block)}
                                      disabled={saving() || block.isLocked}
                                      label={block.isEnabled ? '关闭条目' : '启用条目'}
                                      size="sm"
                                      active={block.isEnabled}
                                      class={`mt-0.5 ${block.isEnabled ? 'text-accent' : 'text-mist-solid/20'}`}
                                    >
                                      <Show when={block.isEnabled} fallback={<span class="text-2xl leading-none">◯</span>}>
                                        <span class="text-2xl leading-none">⬤</span>
                                      </Show>
                                    </IconButton>

                                    <button
                                      onClick={() => openBlockEditor(block)}
                                      class="flex-1 min-w-0 text-left"
                                    >
                                      <div class="flex items-center gap-2 flex-wrap">
                                        <h3 class={`text-sm font-bold truncate ${block.isEnabled ? 'text-mist-solid' : 'text-mist-solid/35'}`}>{block.title ?? block.blockType}</h3>
                                        <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/55">{block.blockType}</span>
                                        <span class="text-[10px] px-2 py-0.5 rounded-md border border-white/10 bg-white/5 text-mist-solid/55">{block.scope}</span>
                                      </div>
                                      <p class="text-xs text-mist-solid/40 line-clamp-2 mt-2 leading-5">{block.content}</p>
                                    </button>

                                    <div class="flex items-center gap-2 shrink-0">
                                      <IconButton
                                        onClick={() => void handleDeleteBlock(block.id)}
                                        disabled={saving() || block.isLocked}
                                        label="删除条目"
                                        tone="danger"
                                        size="sm"
                                      >
                                        <Trash2 size={16} />
                                      </IconButton>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </div>
                    </Show>

                    <Show
                      when={
                        lockedBlocks().length === 0 &&
                        choiceSemanticGroups().length === 0 &&
                        exclusiveBlockGroups().length === 0 &&
                        ordinarySemanticGroups().length === 0 &&
                        ordinaryBlocks().length === 0
                      }
                    >
                      <div class="rounded-2xl border border-dashed border-white/10 px-6 py-10 text-center text-sm text-mist-solid/35">
                        当前预设下没有匹配到条目。可以先点击上方“添加新条目”。
                      </div>
                    </Show>

                    <div class="rounded-3xl border border-white/5 bg-white/5 p-5 text-sm text-mist-solid/70">
                      <div class="flex items-start gap-3">
                        <AlertTriangle size={18} class="text-amber-300 shrink-0 mt-0.5" />
                        <div class="space-y-2">
                          <div class="font-bold text-mist-solid">预设治理规则</div>
                          <ul class="list-disc pl-4 space-y-1 text-xs leading-5 text-mist-solid/55">
                            <li>锁定条目在当前前端中不可修改、不可切换启用、不可删除；后端也会再次强制校验。</li>
                            <li>互斥组中的条目同一时间只能启用一个，前端会在保存前阻止明显冲突。</li>
                            <li>当前宿主 UI 已收敛为三类条目：锁定条目、选择组（互斥组）与普通条目。</li>
                            <li>已接入 Night Voyage 自有 JSON 预设的导入 / 导出入口，不兼容 ST 格式。</li>
                            <li>新建 preset 已接入基础参数、stop sequences 和 provider overrides 入口。</li>
                            <li>编译预览已接入，可用来查看最终 system 文本和合并参数。</li>
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              }}
            </Show>
          </Show>
        </div>
      </div>

      <CompletionDetailModal
        isOpen={!!editingBlock()}
        onClose={handleCloseEditor}
        data={editingBlock()}
        saving={saving()}
        error={errorMessage()}
        onSave={(data) => void handleSaveEditor(data)}
        onDelete={editingSemanticOptionTarget() ? undefined : (id) => void handleDeleteBlock(id)}
      />

      <CompletionParametersPanel
        isOpen={isSettingsOpen()}
        mode={settingsMode()}
        detail={presetDetail()}
        saving={saving()}
        error={errorMessage()}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(draft) => void savePresetSettings(draft)}
      />

      <CompletionPreviewModal
        isOpen={previewOpen()}
        loading={previewLoading()}
        error={previewError()}
        preview={previewData()}
        providerKind={previewProviderKind()}
        onProviderKindChange={setPreviewProviderKind}
        onRefresh={() => void loadCompilePreview()}
        onClose={() => setPreviewOpen(false)}
      />
    </div>
  );
};
