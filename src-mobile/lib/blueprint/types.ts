/**
 * Blueprint graph type definitions for Mobile frontend (C5 Mobile Independence).
 *
 * Self-contained under src-mobile/lib/blueprint/ to prevent cross-root
 * imports from src/.
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
  'sampling_params_openai',
  'sampling_params_anthropic',
  'invoke_schema',
  'tool_definition',
  'calculator',
  'condition_gate',
  'tool_return',
  'inspector',
  'writer',
  'querier',
  'banned_words_config',
  'scriptwriter_pipeline',
  'agent_mode_switch',
  'director_config',
  'actor_definition',
  'ui_layout_config',
  'initial_state_config',
  'macro_instance',
  'macro_inputs',
  'macro_outputs',
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export interface Position {
  x: number;
  y: number;
}

export interface NodePositionPatch {
  id: string;
  position: Position;
}

export type PortKind = 'exec' | 'value' | 'bool';
export type PortDirection = 'input' | 'output';

export interface BlueprintEdge {
  id: string;
  source: string;
  source_port: string;
  target: string;
  target_port: string;
  order?: number;
}

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
  body?: boolean;
}

export interface SchemaFieldConfig {
  field_name: string;
  field_type: string;
  description: string;
  sub_schema: Record<string, unknown> | null;
  db_mapping: string | null;
  required: boolean;
  context_included: boolean;
  display: FieldDisplayConfig;
  is_locked: boolean;
  lock_reason: string | null;
  order: number;
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
}

export interface RoleSwitchConfig {
  label: string;
}

export interface ConstantConfig {
  label: string;
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

export interface OpenAiSamplingParamsConfig {
  temperature: number | null;
  max_tokens: number | null;
  top_p: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  stop: string[] | null;
  is_locked: boolean;
}

export interface AnthropicSamplingParamsConfig {
  temperature: number | null;
  max_tokens: number | null;
  top_p: number | null;
  stop: string[] | null;
  thinking_enabled: boolean | null;
  thinking_budget_tokens: number | null;
  is_locked: boolean;
}

export interface InvokeSchemaConfig {
  schema_id: string;
}

export interface ToolDefinitionConfig {
  tool_name: string;
  description: string;
  parameters_schema: string;
  is_locked: boolean;
}

export interface CalculatorConfig {
  calc_mode: 'math' | 'collection';
  target: string;
  op: string;
  operand_a: string;
  operand_b: string | null;
  item_def: any | null;
  is_locked: boolean;
}

export interface ConditionGateConfig {
  gate_type: 'gold' | 'weight' | 'slots' | 'custom';
  expression: string;
  pass_label: string;
  blocked_label: string;
  block_reason: string;
  is_locked: boolean;
}

export interface ToolReturnConfig {
  return_template: string;
  is_blocked: boolean;
  is_locked: boolean;
}

export interface UiLayoutConfig {
  layout_id: string;
  mount_type: 'RightDock' | 'TopSticky' | 'FloatingHUD' | 'MobileDrawer' | 'MobileBottomSticky';
  is_locked: boolean;
}

export interface InspectorConfig {
  inspect_kind: 'inventory' | 'stats' | 'item' | 'scratchpad';
  key_expr: string;
  is_locked: boolean;
}

export interface WriterConfig {
  key_expr: string;
  value_template: string;
  is_locked: boolean;
}

export interface QuerierConfig {
  command: string;
  args_template: Record<string, unknown>;
  is_locked: boolean;
}

export interface BannedWordsConfig {
  words: string[];
  max_nudge_retries: number;
  nudge_instruction_template: string;
  is_locked: boolean;
}

export interface AgentToolPermissions {
  allow_all?: boolean;
  allowed_tools?: string[];
  require_approval?: string[];
}

export interface ScriptwriterStage {
  stage: string;
  workspace_key: string;
  prompt: string;
  tools: string[];
  tool_permissions?: AgentToolPermissions;
  reject_target?: string;
  max_loop_count?: number;
}

export interface ScriptwriterPipelineConfig {
  stages: ScriptwriterStage[];
  anchor_tail_chars: number;
  blackout_marker: string;
  is_locked: boolean;
}

export interface AgentModeSwitchConfig {
  default_mode: 'single' | 'director_actor' | 'scriptwriter';
  max_tool_rounds: number;
  is_locked: boolean;
}

export interface DirectorConfig {
  director_prompt: string;
  tools: string[];
  tool_permissions?: AgentToolPermissions;
  is_locked: boolean;
}

export interface ActorDefinition {
  actor_name: string;
  persona: string;
  tools: string[];
  tool_permissions?: AgentToolPermissions;
  is_locked: boolean;
}

export interface InitialStatDef {
  initial: number;
  min?: number | null;
  max?: number | null;
}

export interface InitialStateInventoryItem {
  id: string;
  name: string;
  count: number;
  unit_weight?: number;
  unit_price?: number;
  icon?: string | null;
  properties?: Record<string, string>;
}

export interface InitialStateConfig {
  stats: Record<string, InitialStatDef>;
  inventory: InitialStateInventoryItem[];
  flags: Record<string, string>;
  is_locked: boolean;
}

// ─── UE5-Style Blueprint Macro Models ───

export type PinType = 'exec' | 'number' | 'string' | 'boolean' | 'object';

export interface MacroPinDefinition {
  id: string;
  name: string;
  pin_type: PinType;
}

export interface MacroInstanceConfig {
  macro_id: string;
  name?: string;
}

export interface MacroInputsConfig {
  pins: MacroPinDefinition[];
}

export interface MacroOutputsConfig {
  pins: MacroPinDefinition[];
}

export interface BlueprintMacro {
  id: string;
  name: string;
  description?: string;
  category?: string;
  inputs: MacroPinDefinition[];
  outputs: MacroPinDefinition[];
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
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
  | { type: 'sampling_params'; config: SamplingParamsConfig }
  | { type: 'sampling_params_openai'; config: OpenAiSamplingParamsConfig }
  | { type: 'sampling_params_anthropic'; config: AnthropicSamplingParamsConfig }
  | { type: 'invoke_schema'; config: InvokeSchemaConfig }
  | { type: 'tool_definition'; config: ToolDefinitionConfig }
  | { type: 'calculator'; config: CalculatorConfig }
  | { type: 'condition_gate'; config: ConditionGateConfig }
  | { type: 'tool_return'; config: ToolReturnConfig }
  | { type: 'inspector'; config: InspectorConfig }
  | { type: 'writer'; config: WriterConfig }
  | { type: 'querier'; config: QuerierConfig }
  | { type: 'banned_words_config'; config: BannedWordsConfig }
  | { type: 'scriptwriter_pipeline'; config: ScriptwriterPipelineConfig }
  | { type: 'agent_mode_switch'; config: AgentModeSwitchConfig }
  | { type: 'director_config'; config: DirectorConfig }
  | { type: 'actor_definition'; config: ActorDefinition }
  | { type: 'ui_layout_config'; config: UiLayoutConfig }
  | { type: 'initial_state_config'; config: InitialStateConfig }
  | { type: 'macro_instance'; config: MacroInstanceConfig }
  | { type: 'macro_inputs'; config: MacroInputsConfig }
  | { type: 'macro_outputs'; config: MacroOutputsConfig };

export type BlueprintNode = NodeConfig & {
  id: string;
  position: Position;
};

export interface BlueprintComment {
  id: string;
  text: string;
  position: Position;
  width: number;
  height: number;
}

export interface BlueprintGraph {
  version: 2;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  comments?: BlueprintComment[];
  macros?: BlueprintMacro[];
}

export interface GateSelection {
  keys: string[];
}

export interface BlueprintExecutionContext {
  memoryMode: 'legacy' | 'mem0';
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

export {
  deriveStructuredOutputDisplay,
  deriveStructuredOutputDisplayFromGraphJson,
} from '../structured';
