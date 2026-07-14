import type {
  BlueprintEdge,
  BlueprintGraph,
  BlueprintNode,
  GateOption,
  GroupGateConfig,
  MutexGateConfig,
  PromptConfig,
  SamplingParamsConfig,
  SchemaFieldConfig,
} from './types';

// ─── Legacy preset types (camelCase — matches IPC convention from Rust serde) ───

export interface LegacyBlock {
  id?: number;
  blockType: string;
  title: string | null;
  content: string;
  sortOrder: number | null;
  priority: number | null;
  isEnabled: boolean | null;
  scope: string | null;
  isLocked: boolean | null;
  lockReason: string | null;
  exclusiveGroupKey: string | null;
  exclusiveGroupLabel: string | null;
}

export interface LegacySemanticOption {
  optionKey: string;
  label: string;
  description?: string | null;
  blocks?: LegacyBlock[];
}

export interface LegacySemanticGroup {
  groupKey: string;
  label: string;
  description: string | null;
  selectionMode: 'single' | 'multiple';
  options: LegacySemanticOption[];
}

export interface LegacyPresetForMigration {
  id: number;
  name: string;
  blocks?: LegacyBlock[];
  structuredOutputSchema?: Record<string, unknown> | string;
  semanticGroups?: LegacySemanticGroup[];
  temperature?: number | null;
  maxOutputTokens?: number | null;
  topP?: number | null;
  topK?: number | null;
  presencePenalty?: number | null;
  frequencyPenalty?: number | null;
  responseMode?: string | null;
  stopSequences?: string[] | null;
  thinkingEnabled?: boolean | null;
  thinkingBudgetTokens?: number | null;
  betaFeatures?: string[] | null;
}

export type MigrationResult =
  | { ok: true; graph: BlueprintGraph }
  | { ok: false; error: string };

// ─── Internal helpers ───

const DEFAULT_Y = 300;
const X_STEP = 200;
const BRANCH_Y_SPACING = 150;

interface ChainSegment {
  /** Entry point of this segment (where the previous segment connects to). */
  head: { nodeId: string; port: string };
  /** Exit points of this segment (connect to the next segment's head). */
  tails: Array<{ nodeId: string; port: string }>;
}

interface SegmentBuildResult {
  ok: true;
  nodes: BlueprintNode[];
  segments: ChainSegment[];
  nextX: number;
}

interface SegmentBuildError {
  ok: false;
  error: string;
}

/**
 * Determine the exclusive-group key for a block. Blocks with the same
 * exclusiveGroupKey (or same exclusiveGroupLabel when key is absent) belong
 * to the same MutexGate. Returns null for standalone blocks.
 */
function exclusiveGroupOf(block: LegacyBlock): string | null {
  if (block.exclusiveGroupKey && block.exclusiveGroupKey.trim() !== '') {
    return `key:${block.exclusiveGroupKey}`;
  }
  if (block.exclusiveGroupLabel && block.exclusiveGroupLabel.trim() !== '') {
    return `label:${block.exclusiveGroupLabel}`;
  }
  return null;
}

/**
 * Collect all blocks from the preset: top-level blocks plus blocks nested
 * inside semantic option entries. The task spec states semantic option blocks
 * are processed in the same Prompt-chain step, so we flatten them.
 */
function collectAllBlocks(preset: LegacyPresetForMigration): LegacyBlock[] {
  const all: LegacyBlock[] = [];
  if (preset.blocks) {
    for (const b of preset.blocks) all.push(b);
  }
  if (preset.semanticGroups) {
    for (const group of preset.semanticGroups) {
      for (const option of group.options) {
        if (option.blocks) {
          for (const b of option.blocks) all.push(b);
        }
      }
    }
  }
  return all;
}

/**
 * Build Prompt / MutexGate segments from legacy blocks.
 *
 * - Enabled blocks are sorted by priority (asc), then sortOrder (asc).
 * - Blocks sharing an exclusive group key/label become a single MutexGate
 *   with one Prompt per block, connected via out_{optionKey} outlets.
 * - Standalone blocks become individual Prompt segments.
 */
function buildBlockSegments(
  preset: LegacyPresetForMigration,
  startX: number,
): SegmentBuildResult | SegmentBuildError {
  const allBlocks = collectAllBlocks(preset);
  const enabled = allBlocks.filter((b) => b.isEnabled !== false);

  for (const block of enabled) {
    if (!block.blockType || block.blockType.trim() === '') {
      return {
        ok: false,
        error: `Block has empty blockType (title: ${block.title ?? 'null'})`,
      };
    }
  }

  const sorted = [...enabled].sort((a, b) => {
    const pa = a.priority ?? 0;
    const pb = b.priority ?? 0;
    if (pa !== pb) return pa - pb;
    return (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
  });

  // Group blocks by exclusive group key, preserving sort order within groups.
  const groupOrder: string[] = [];
  const groups = new Map<string, LegacyBlock[]>();
  const standalone: LegacyBlock[] = [];

  for (const block of sorted) {
    const gk = exclusiveGroupOf(block);
    if (gk === null) {
      standalone.push(block);
    } else if (groups.has(gk)) {
      groups.get(gk)!.push(block);
    } else {
      groupOrder.push(gk);
      groups.set(gk, [block]);
    }
  }

  // Build ordered items: standalone blocks and exclusive groups, ordered by min priority.
  interface OrderedItem {
    kind: 'standalone' | 'group';
    block?: LegacyBlock;
    groupKey?: string;
    groupBlocks?: LegacyBlock[];
    minPriority: number;
  }
  const items: OrderedItem[] = [];
  for (const block of standalone) {
    items.push({ kind: 'standalone', block, minPriority: block.priority ?? 0 });
  }
  for (const gk of groupOrder) {
    const groupBlocks = groups.get(gk)!;
    if (groupBlocks.length < 2) {
      // Single-block "group" — treat as standalone.
      items.push({
        kind: 'standalone',
        block: groupBlocks[0],
        minPriority: groupBlocks[0].priority ?? 0,
      });
    } else {
      items.push({
        kind: 'group',
        groupKey: gk,
        groupBlocks,
        minPriority: groupBlocks[0].priority ?? 0,
      });
    }
  }
  items.sort((a, b) => a.minPriority - b.minPriority);

  const nodes: BlueprintNode[] = [];
  const segments: ChainSegment[] = [];
  let cursorX = startX;
  let promptIndex = 0;
  let mutexIndex = 0;

  for (const item of items) {
    if (item.kind === 'standalone') {
      const block = item.block!;
      const nodeId = `n_prompt_${promptIndex++}`;
      const config: PromptConfig = {
        identifier: block.title ?? block.blockType,
        block_type: block.blockType,
        content: block.content,
        priority: block.priority,
        is_locked: block.isLocked ?? false,
        lock_reason: block.lockReason,
      };
      nodes.push({
        id: nodeId,
        type: 'prompt',
        position: { x: cursorX, y: DEFAULT_Y },
        config,
      });
      segments.push({
        head: { nodeId, port: 'in' },
        tails: [{ nodeId, port: 'out' }],
      });
      cursorX += X_STEP;
    } else {
      // Exclusive group → MutexGate + parallel Prompt branches.
      const groupBlocks = item.groupBlocks!;
      const rawKey = item.groupKey!;
      const gateIdValue = rawKey.startsWith('key:')
        ? rawKey.slice(4)
        : rawKey.slice(6);
      const label = groupBlocks[0]?.exclusiveGroupLabel ?? gateIdValue;
      const gateNodeId = `n_mutex_${mutexIndex++}`;

      const options: GateOption[] = groupBlocks.map((block, i) => ({
        key: block.id != null ? String(block.id) : `b${i}`,
        label: block.title ?? block.blockType,
      }));

      const gateConfig: MutexGateConfig = {
        gate_id: gateIdValue,
        label,
        options,
      };
      nodes.push({
        id: gateNodeId,
        type: 'mutex_gate',
        position: { x: cursorX, y: DEFAULT_Y },
        config: gateConfig,
      });
      cursorX += X_STEP;

      // Create a Prompt node for each option, spread vertically.
      const tails: Array<{ nodeId: string; port: string }> = [];
      const count = groupBlocks.length;
      const yOffset = ((count - 1) * BRANCH_Y_SPACING) / 2;
      for (let i = 0; i < count; i++) {
        const block = groupBlocks[i];
        const promptNodeId = `n_mp_${mutexIndex - 1}_${i}`;
        const promptConfig: PromptConfig = {
          identifier: block.title ?? block.blockType,
          block_type: block.blockType,
          content: block.content,
          priority: block.priority,
          is_locked: block.isLocked ?? false,
          lock_reason: block.lockReason,
        };
        nodes.push({
          id: promptNodeId,
          type: 'prompt',
          position: {
            x: cursorX,
            y: DEFAULT_Y - yOffset + i * BRANCH_Y_SPACING,
          },
          config: promptConfig,
        });
        tails.push({ nodeId: promptNodeId, port: 'out' });
      }
      cursorX += X_STEP;

      segments.push({
        head: { nodeId: gateNodeId, port: 'in' },
        tails,
      });
    }
  }

  return { ok: true, nodes, segments, nextX: cursorX };
}

/**
 * Build SchemaField segments from structuredOutputSchema.
 * - String schemas are JSON.parsed; failure returns an error (C2 zero-fallback).
 * - Each top-level property becomes a SchemaField node.
 * - db_mapping is inferred: world_variables→"world_variables", plot_summary→"plot_summary".
 */
function buildSchemaSegments(
  preset: LegacyPresetForMigration,
  startX: number,
): SegmentBuildResult | SegmentBuildError {
  const raw = preset.structuredOutputSchema;
  if (raw == null) {
    return { ok: true, nodes: [], segments: [], nextX: startX };
  }

  let schema: Record<string, unknown>;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { ok: true, nodes: [], segments: [], nextX: startX };
    }
    try {
      schema = JSON.parse(trimmed) as Record<string, unknown>;
    } catch (e) {
      return {
        ok: false,
        error: `Failed to parse structuredOutputSchema JSON: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  } else {
    schema = raw;
  }

  const propertiesRaw: unknown = schema.properties;
  if (!propertiesRaw || typeof propertiesRaw !== 'object') {
    return { ok: true, nodes: [], segments: [], nextX: startX };
  }
  const properties = propertiesRaw as Record<string, unknown>;

  const nodes: BlueprintNode[] = [];
  const segments: ChainSegment[] = [];
  let cursorX = startX;
  let fieldIndex = 0;

  for (const [fieldName, propRaw] of Object.entries(properties)) {
    if (!propRaw || typeof propRaw !== 'object') continue;
    const prop = propRaw as Record<string, unknown>;
    const fieldType = typeof prop.type === 'string' ? prop.type : 'string';
    const description = typeof prop.description === 'string' ? prop.description : '';

    let subSchema: Record<string, unknown> | null = null;
    if (fieldType === 'object' && prop.properties && typeof prop.properties === 'object') {
      subSchema = { properties: prop.properties as Record<string, unknown> };
    } else if (fieldType === 'array' && prop.items && typeof prop.items === 'object') {
      subSchema = { items: prop.items as Record<string, unknown> };
    }

    let dbMapping: string | null = null;
    if (fieldName === 'world_variables') dbMapping = 'world_variables';
    else if (fieldName === 'plot_summary') dbMapping = 'plot_summary';

    const config: SchemaFieldConfig = {
      field_name: fieldName,
      field_type: fieldType,
      description,
      sub_schema: subSchema,
      db_mapping: dbMapping,
      is_locked: false,
      lock_reason: null,
    };

    const nodeId = `n_schema_${fieldIndex++}`;
    nodes.push({
      id: nodeId,
      type: 'schema_field',
      position: { x: cursorX, y: DEFAULT_Y },
      config,
    });
    segments.push({
      head: { nodeId, port: 'in' },
      tails: [{ nodeId, port: 'out' }],
    });
    cursorX += X_STEP;
  }

  return { ok: true, nodes, segments, nextX: cursorX };
}

/**
 * Build Gate segments from semantic groups.
 * - selection_mode 'multiple' → GroupGate
 * - selection_mode 'single' → MutexGate
 * - Each option becomes a GateOption. All option outlets connect to the next
 *   segment's head (merge point), since the option blocks are already
 *   flattened into the Prompt chain by buildBlockSegments.
 */
function buildSemanticGateSegments(
  preset: LegacyPresetForMigration,
  startX: number,
): SegmentBuildResult {
  const nodes: BlueprintNode[] = [];
  const segments: ChainSegment[] = [];
  let cursorX = startX;

  if (!preset.semanticGroups) {
    return { ok: true, nodes, segments, nextX: cursorX };
  }

  let gateIndex = 0;
  for (const group of preset.semanticGroups) {
    if (group.options.length === 0) continue;

    const options: GateOption[] = group.options.map((opt) => ({
      key: opt.optionKey,
      label: opt.label,
    }));

    const gateIdx = gateIndex++;
    const gateIdValue = group.groupKey || `sgate_${gateIdx}`;
    const gateNodeId = `n_sgate_${gateIdx}`;
    const isMultiple = group.selectionMode === 'multiple';
    const baseConfig = {
      gate_id: gateIdValue,
      label: group.label,
      options,
    };

    if (isMultiple) {
      const config: GroupGateConfig = baseConfig;
      nodes.push({
        id: gateNodeId,
        type: 'group_gate',
        position: { x: cursorX, y: DEFAULT_Y },
        config,
      });
    } else {
      const config: MutexGateConfig = baseConfig;
      nodes.push({
        id: gateNodeId,
        type: 'mutex_gate',
        position: { x: cursorX, y: DEFAULT_Y },
        config,
      });
    }

    segments.push({
      head: { nodeId: gateNodeId, port: 'in' },
      tails: options.map((opt) => ({ nodeId: gateNodeId, port: `out_${opt.key}` })),
    });
    cursorX += X_STEP;
  }

  return { ok: true, nodes, segments, nextX: cursorX };
}

/**
 * Build a SamplingParams segment from preset-level sampling fields.
 * Returns null if all params are null/empty (node skipped).
 */
function buildSamplingSegment(
  preset: LegacyPresetForMigration,
  startX: number,
): { node: BlueprintNode; segment: ChainSegment; nextX: number } | null {
  const temperature = preset.temperature ?? null;
  const maxTokens = preset.maxOutputTokens ?? null;
  const topP = preset.topP ?? null;
  const frequencyPenalty = preset.frequencyPenalty ?? null;
  const presencePenalty = preset.presencePenalty ?? null;
  const stop =
    preset.stopSequences && preset.stopSequences.length > 0
      ? preset.stopSequences
      : null;

  if (
    temperature === null &&
    maxTokens === null &&
    topP === null &&
    frequencyPenalty === null &&
    presencePenalty === null &&
    stop === null
  ) {
    return null;
  }

  const config: SamplingParamsConfig = {
    temperature,
    max_tokens: maxTokens,
    top_p: topP,
    frequency_penalty: frequencyPenalty,
    presence_penalty: presencePenalty,
    stop,
    is_locked: false,
  };

  const nodeId = 'n_sampling';
  return {
    node: {
      id: nodeId,
      type: 'sampling_params',
      position: { x: startX, y: DEFAULT_Y },
      config,
    },
    segment: {
      head: { nodeId, port: 'in' },
      tails: [{ nodeId, port: 'out' }],
    },
    nextX: startX + X_STEP,
  };
}

// ─── Main migration function ───

/**
 * Migrate a legacy preset to a BlueprintGraph.
 *
 * Migration is a pure function: the input preset is never mutated. On
 * failure, returns { ok: false, error } without producing a partial graph.
 * On success, returns a valid BlueprintGraph with at least Start → ModeSwitch → End.
 *
 * Migration rules (per spec):
 * 1. Start node at (0, 300).
 * 2. ModeSwitch node right after Start; three outlets (out_legacy / out_mem0 /
 *    out_stateless) all connect to the same downstream chain start.
 * 3. Blocks (top-level + semantic option blocks, flattened) → Prompt chain.
 *    Blocks sharing an exclusive_group_key/label → MutexGate with parallel branches.
 * 4. structuredOutputSchema properties → SchemaField nodes with inferred db_mapping.
 * 5. semanticGroups → GroupGate (multiple) or MutexGate (single); option outlets
 *    merge to the next segment's head.
 * 6. Sampling params → SamplingParams node (skipped if all null).
 * 7. End node; all tail segments connect to it.
 */
export function migrateToBlueprint(preset: LegacyPresetForMigration): MigrationResult {
  const nodes: BlueprintNode[] = [];
  const edges: BlueprintEdge[] = [];
  const segments: ChainSegment[] = [];
  let edgeId = 0;
  const addEdge = (
    source: string,
    sourcePort: string,
    target: string,
    targetPort: string,
  ): void => {
    edges.push({
      id: `e${edgeId++}`,
      source,
      source_port: sourcePort,
      target,
      target_port: targetPort,
    });
  };

  let cursorX = 0;

  // 1. Start node
  nodes.push({
    id: 'n_start',
    type: 'start',
    position: { x: cursorX, y: DEFAULT_Y },
    config: {},
  });
  cursorX += X_STEP;

  // 2. ModeSwitch node (three outlets all connect to the same downstream chain start)
  nodes.push({
    id: 'n_mode',
    type: 'mode_switch',
    position: { x: cursorX, y: DEFAULT_Y },
    config: { label: '记忆模式分支' },
  });
  addEdge('n_start', 'out', 'n_mode', 'in');
  cursorX += X_STEP;

  // 3. Blocks → Prompt / MutexGate segments
  const blockResult = buildBlockSegments(preset, cursorX);
  if (!blockResult.ok) return blockResult;
  nodes.push(...blockResult.nodes);
  segments.push(...blockResult.segments);
  cursorX = blockResult.nextX;

  // 4. structuredOutputSchema → SchemaField segments
  const schemaResult = buildSchemaSegments(preset, cursorX);
  if (!schemaResult.ok) return schemaResult;
  nodes.push(...schemaResult.nodes);
  segments.push(...schemaResult.segments);
  cursorX = schemaResult.nextX;

  // 5. semanticGroups → Gate segments
  const gateResult = buildSemanticGateSegments(preset, cursorX);
  nodes.push(...gateResult.nodes);
  segments.push(...gateResult.segments);
  cursorX = gateResult.nextX;

  // 6. SamplingParams segment (optional — skipped if all params null)
  const samplingResult = buildSamplingSegment(preset, cursorX);
  if (samplingResult) {
    nodes.push(samplingResult.node);
    segments.push(samplingResult.segment);
    cursorX = samplingResult.nextX;
  }

  // 7. End node
  cursorX += X_STEP;
  nodes.push({
    id: 'n_end',
    type: 'end',
    position: { x: cursorX, y: DEFAULT_Y },
    config: {},
  });

  // 8. Wire up the chain: ModeSwitch outlets → first segment → ... → last segment → End
  const modeOutlets = ['out_legacy', 'out_mem0', 'out_stateless'] as const;
  const chainTarget =
    segments.length > 0 ? segments[0].head : { nodeId: 'n_end', port: 'in' };

  for (const port of modeOutlets) {
    addEdge('n_mode', port, chainTarget.nodeId, chainTarget.port);
  }

  for (let i = 0; i < segments.length - 1; i++) {
    const nextHead = segments[i + 1].head;
    for (const tail of segments[i].tails) {
      addEdge(tail.nodeId, tail.port, nextHead.nodeId, nextHead.port);
    }
  }

  if (segments.length > 0) {
    for (const tail of segments[segments.length - 1].tails) {
      addEdge(tail.nodeId, tail.port, 'n_end', 'in');
    }
  }

  return { ok: true, graph: { version: 2, nodes, edges } };
}
