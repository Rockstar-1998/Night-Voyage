/**
 * Blueprint graph type definitions.
 *
 * Field naming convention:
 * - Graph JSON types (BlueprintGraph, BlueprintNode, BlueprintEdge, node configs,
 *   Position, GateOption) use snake_case to match the JSON format stored in the
 *   `blueprint_graph` database column exactly. This lets JSON.parse/stringify work
 *   without a conversion layer. The Rust backend MUST use
 *   `#[serde(rename_all = "snake_case")]` when (de)serializing these graph types.
 * - Runtime IPC types (GateSelection, BlueprintExecutionContext, CompiledBlock,
 *   CompiledSamplingParams, BlueprintExecutionResult) use camelCase to match the
 *   project-wide Rust `#[serde(rename_all = "camelCase")]` IPC convention.
 *
 * These two naming conventions coexist deliberately: the graph is a self-contained
 * storage format controlled by the frontend, while runtime types cross the Tauri
 * IPC boundary alongside all other backend models.
 */

export const NODE_TYPES = [
  'start',
  'end',
  'prompt',
  'schema_field',
  'mutex_gate',
  'group_gate',
  'mode_switch',
  'role_switch',
  'sampling_params',
  'constant',
  'branch',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface Position {
  x: number;
  y: number;
}

export interface BlueprintEdge {
  id: string;
  source: string;
  source_port: string;
  target: string;
  target_port: string;
  /**
   * 同一源节点 + 同一出口端口连出多条边时的分支/合并遍历顺序。
   * 端口优先级（Gate/ModeSwitch 的多选端口顺序）优先，order 其次。
   * 缺省视为 0，向后兼容旧版蓝图（与 Rust `#[serde(default)]` 语义一致）。
   */
  order?: number;
}

// ─── Node configs (snake_case — matches graph JSON in blueprint_graph column) ───

export interface StartConfig {}

export interface EndConfig {}

export interface PromptConfig {
  identifier: string;
  block_type: string;
  content: string;
  priority: number | null;
  is_locked: boolean;
  lock_reason: string | null;
}

export interface FieldDisplayConfig {
  default_expanded: boolean;
  hide_label: boolean;
}

export interface SchemaFieldConfig {
  field_name: string;
  field_type: string;
  description: string;
  sub_schema: Record<string, unknown> | null;
  db_mapping: string | null;
  /** 加入 schema `required` 数组。默认 true。 */
  required: boolean;
  /** 是否将该字段值注入下一轮对话上下文。默认 true。 */
  context_included: boolean;
  /** 前端消息列表展示偏好。 */
  display: FieldDisplayConfig;
  is_locked: boolean;
  lock_reason: string | null;
}

export interface GateOption {
  key: string;
  label: string;
  description: string;
}

export interface MutexGateConfig {
  label: string;
  options: GateOption[];
}

export interface GroupGateConfig {
  label: string;
  options: GateOption[];
}

export interface ModeSwitchConfig {
  label: string;
  // Three outlet ports are fixed: out_legacy / out_mem0 / out_stateless
}

export interface RoleSwitchConfig {
  label: string;
  // Two outlet ports are fixed: out_single / out_online (future: out_agent)
}

export interface ConstantConfig {
  label: string;
  // 会话属性键名："conversation_type"（输出 single/online）| "memory_mode" | "protocol"（输出 anthropic / chat_completions）
  source: string;
}

export interface BranchCase {
  match_value: string;
  port: string;
}

export interface BranchConfig {
  label: string;
  cases: BranchCase[];
  default_port: string;
}

export interface SamplingParamsConfig {
  temperature: number | null;
  max_tokens: number | null;
  top_p: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  stop: string[] | null;
  thinking_enabled: boolean | null;
  thinking_budget_tokens: number | null;
  is_locked: boolean;
}

// ─── Discriminated union: NodeType + Config strong binding ───

export type NodeConfig =
  | { type: 'start'; config: StartConfig }
  | { type: 'end'; config: EndConfig }
  | { type: 'prompt'; config: PromptConfig }
  | { type: 'schema_field'; config: SchemaFieldConfig }
  | { type: 'mutex_gate'; config: MutexGateConfig }
  | { type: 'group_gate'; config: GroupGateConfig }
  | { type: 'mode_switch'; config: ModeSwitchConfig }
  | { type: 'role_switch'; config: RoleSwitchConfig }
  | { type: 'constant'; config: ConstantConfig }
  | { type: 'branch'; config: BranchConfig }
  | { type: 'sampling_params'; config: SamplingParamsConfig };

export type BlueprintNode = NodeConfig & {
  id: string;
  /** Optional in JSON: missing positions default to {x: 0, y: 0}.
   *  Import paths (PortablePresetFile) may omit position to save space —
   *  the loader normalizes missing positions before assigning to the store. */
  position: Position;
};

export interface BlueprintGraph {
  version: 2;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
}

// ─── Runtime IPC types (camelCase — matches Rust serde camelCase over IPC) ───

export interface GateSelection {
  keys: string[];
}

export interface BlueprintExecutionContext {
  memoryMode: 'legacy' | 'mem0' | 'stateless';
  conversationType: 'single' | 'online';
  protocol: string;
  gateSelections: Record<string, GateSelection>;
}

export interface CompiledBlock {
  identifier: string;
  blockType: string;
  content: string;
  priority: number | null;
  isLocked: boolean;
}

export interface CompiledSamplingParams {
  temperature: number | null;
  maxTokens: number | null;
  topP: number | null;
  frequencyPenalty: number | null;
  presencePenalty: number | null;
  stop: string[];
}

export interface BlueprintExecutionResult {
  blocks: CompiledBlock[];
  structuredOutputSchema: Record<string, unknown>;
  samplingParams: CompiledSamplingParams;
  dbMappings: Record<string, string>;
}
