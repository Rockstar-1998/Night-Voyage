// ─── Common type aliases ───

export type ConversationType = 'single' | 'online';
export type ChatMode = 'classic' | 'director_agents';
export type AgentProviderPolicy = 'shared_host_provider' | 'mixed_cost_optimized';
export type CharacterCardType = 'npc' | 'player';
export type CharacterBaseSectionKey = 'identity' | 'persona' | 'background' | 'rules' | 'custom';
export type WorldBookTriggerMode = 'any' | 'all' | 'always';
export type ProviderKind = 'openai_compatible' | 'anthropic' | string;

// ─── Capability profile ──

/** 9 种会话模式，与后端 ConversationMode 枚举对齐（snake_case 形式）。 */
export type ConversationMode =
  | 'single_stateless'
  | 'single_legacy'
  | 'single_mem0'
  | 'online_stateless_host'
  | 'online_legacy_host'
  | 'online_mem0_host'
  | 'online_stateless_guest'
  | 'online_legacy_guest'
  | 'online_mem0_guest';

/** 操作的可见性 profile，用于驱动 UI 按钮显隐。 */
export interface CapabilityProfile {
  /** 编辑消息 */
  canEdit: boolean;
  /** 重新生成 */
  canRegenerate: boolean;
  /** 重新生成受 mem0 快照窗口限制（前端可见但需后端校验） */
  regenerateLimited: boolean;
  /** 从某轮对话分支 */
  canFork: boolean;
  /** 分支受 mem0 快照窗口限制 */
  forkLimited: boolean;
  /** 删除某轮消息 */
  canDelete: boolean;
  /** 命令模型开始回复 / 强行中止回复 */
  canSubmitAbort: boolean;
  /** 发送消息 */
  canSend: boolean;
  /** 回溯到某轮对话 */
  canRewind: boolean;
  /** 回溯受 mem0 快照窗口限制 */
  rewindLimited: boolean;
}

// ─── Conversation / round / message ───

export interface ConversationListItem {
  id: number;
  conversationType: ConversationType;
  title: string | null;
  hostCharacterId?: number;
  worldBookId?: number;
  presetId?: number;
  providerId?: number;
  embeddingProviderId?: number;
  chatMode: ChatMode;
  agentProviderPolicy: AgentProviderPolicy;
  memoryMode: 'stateless' | 'legacy' | 'mem0' | string;
  mem0SnapshotWindow?: number;
  memberCount: number;
  pendingMemberCount: number;
  roomStatus?: 'open' | 'closed' | null;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMember {
  id: number;
  conversationId: number;
  memberRole: 'host' | 'member';
  displayName: string;
  playerCharacterId?: number;
  joinOrder: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface RoundState {
  roundId: number;
  conversationId: number;
  roundIndex: number;
  status: 'collecting' | 'queued' | 'streaming' | 'completed' | 'failed' | string;
  requiredMemberCount: number;
  decidedMemberCount: number;
  waitingMemberIds: number[];
  aggregatedUserContent?: string;
  activeAssistantMessageId?: number;
  updatedAt: number;
}

export interface UiMessage {
  id: number;
  conversationId: number;
  roundId?: number;
  memberId?: number;
  role: 'user' | 'assistant' | 'system' | string;
  messageKind: 'user_visible' | 'assistant_visible' | 'system' | string;
  content: string;
  displayName?: string;
  isSwipe: boolean;
  swipeIndex: number;
  replyToId?: number;
  summaryBatchIndex?: number;
  summaryEntryId?: number;
  isActiveInRound: boolean;
  createdAt: number;
}

export interface ChatSubmitInputResult {
  round: RoundState;
  action: {
    memberId: number;
    actionType: 'spoken' | 'skipped' | string;
    content: string;
  };
  visibleUserMessage?: UiMessage;
  assistantMessage?: UiMessage;
  autoDispatched: boolean;
}

export interface RegenerateRoundResult {
  round: RoundState;
  assistantMessage: UiMessage;
  preservedVersionCount: number;
}

export interface ConversationCreateResult {
  conversation: ConversationListItem;
  hostMember: ConversationMember;
  round: RoundState;
}

export interface RetryFailedRoundResult {
  round: RoundState;
  assistantMessage: UiMessage;
  attemptCount: number;
}

// ─── Token usage ───

export interface TokenLayerUsage {
  kind: string;
  title: string | null;
  estimatedTokens: number;
  color: string;
}

export interface TokenUsageReport {
  contextWindowSize: number | null;
  layers: TokenLayerUsage[];
  totalEstimatedTokens: number;
  totalActualTokens: number | null;
}

// ─── Preset ───

export interface PresetSummary {
  id: number;
  name: string;
  description?: string;
  category: string;
  isBuiltin: boolean;
  version: number;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  responseMode?: 'pseudo_xml' | 'structured_json' | string;
  structuredOutputSchema?: string;
  structuredOutputDisplay?: string;
  contextIncludedKeys?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PresetPromptBlock {
  id: number;
  presetId: number;
  semanticOptionId?: number;
  blockType: string;
  title?: string;
  content: string;
  sortOrder: number;
  priority: number;
  isEnabled: boolean;
  scope:
    | 'global'
    | 'chat_only'
    | 'group_only'
    | 'single_only'
    | 'completion_only'
    | 'agent_only'
    | string;
  isLocked: boolean;
  lockReason?: string;
  exclusiveGroupKey?: string;
  exclusiveGroupLabel?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PresetStopSequenceRecord {
  id: number;
  presetId: number;
  stopText: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface PresetProviderOverrideRecord {
  id: number;
  presetId: number;
  providerKind: string;
  temperatureOverride?: number;
  maxOutputTokensOverride?: number;
  topPOverride?: number;
  presencePenaltyOverride?: number;
  frequencyPenaltyOverride?: number;
  responseModeOverride?: 'pseudo_xml' | 'structured_json' | string;
  structuredOutputSchemaOverride?: string;
  stopSequencesOverride: string[];
  disabledBlockTypes: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PresetSemanticOptionBlockRecord {
  id: number;
  optionId: number;
  blockType: string;
  title?: string;
  content: string;
  sortOrder: number;
  priority: number;
  isEnabled: boolean;
  scope:
    | 'global'
    | 'chat_only'
    | 'group_only'
    | 'single_only'
    | 'completion_only'
    | 'agent_only'
    | string;
  isLocked: boolean;
  lockReason?: string;
  exclusiveGroupKey?: string;
  exclusiveGroupLabel?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PresetSemanticOptionExampleRecord {
  id: number;
  optionId: number;
  role: 'user' | 'assistant' | string;
  content: string;
  sortOrder: number;
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PresetSemanticOptionRecord {
  id: number;
  groupId: number;
  parentOptionId?: number;
  optionKey: string;
  label: string;
  description?: string;
  depth: number;
  sortOrder: number;
  isSelected: boolean;
  isEnabled: boolean;
  expansionKind: 'blocks' | 'examples' | 'params' | 'mixed' | string;
  blocks: PresetSemanticOptionBlockRecord[];
  examples: PresetSemanticOptionExampleRecord[];
  children: PresetSemanticOptionRecord[];
  linkedSchemaKeys?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PresetSemanticGroupRecord {
  id: number;
  presetId: number;
  groupKey: string;
  label: string;
  description?: string;
  sortOrder: number;
  selectionMode: 'single' | 'multiple' | string;
  isEnabled: boolean;
  options: PresetSemanticOptionRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface PresetDetail {
  preset: PresetSummary;
  blocks: PresetPromptBlock[];
  stopSequences: PresetStopSequenceRecord[];
  providerOverrides: PresetProviderOverrideRecord[];
  semanticGroups: PresetSemanticGroupRecord[];
}

export interface PresetCompilePreview {
  preset: PresetSummary;
  providerKind?: string;
  systemText: string;
  systemBlocks: PresetPromptBlock[];
  params: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    responseMode?: 'pseudo_xml' | 'structured_json' | string;
    structuredOutputSchema?: string;
    stopSequences: string[];
  };
}

// ─── Preset input payloads ───

export interface PresetPromptBlockInput {
  blockType: string;
  title?: string;
  content: string;
  sortOrder?: number;
  priority?: number;
  isEnabled?: boolean;
  scope?:
    | 'global'
    | 'chat_only'
    | 'group_only'
    | 'single_only'
    | 'completion_only'
    | 'agent_only'
    | string;
  isLocked?: boolean;
  lockReason?: string;
  exclusiveGroupKey?: string;
  exclusiveGroupLabel?: string;
}

export interface PresetExampleInput {
  role: 'user' | 'assistant';
  content: string;
  sortOrder?: number;
  isEnabled?: boolean;
}

export interface PresetStopSequenceInput {
  stopText: string;
  sortOrder?: number;
}

export interface PresetProviderOverrideInput {
  providerKind: string;
  temperatureOverride?: number;
  maxOutputTokensOverride?: number;
  topPOverride?: number;
  presencePenaltyOverride?: number;
  frequencyPenaltyOverride?: number;
  responseModeOverride?: 'pseudo_xml' | 'structured_json' | string;
  structuredOutputSchemaOverride?: string;
  stopSequencesOverride?: string[];
  disabledBlockTypes?: string[];
}

export interface PresetSemanticOptionInput {
  optionKey: string;
  label: string;
  description?: string;
  sortOrder?: number;
  isSelected?: boolean;
  isEnabled?: boolean;
  expansionKind?: 'blocks' | 'examples' | 'params' | 'mixed' | string;
  blocks?: PresetPromptBlockInput[];
  examples?: PresetExampleInput[];
  children?: PresetSemanticOptionInput[];
  linkedSchemaKeys?: string[];
}

export interface PresetSemanticGroupInput {
  groupKey: string;
  label: string;
  description?: string;
  sortOrder?: number;
  selectionMode?: 'single' | 'multiple' | string;
  isEnabled?: boolean;
  options?: PresetSemanticOptionInput[];
}

export interface CreatePresetPayload {
  name: string;
  description?: string;
  category?: string;
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  responseMode?: 'pseudo_xml' | 'structured_json' | string;
  structuredOutputSchema?: string;
  structuredOutputDisplay?: string;
  contextIncludedKeys?: string;
  blocks?: PresetPromptBlockInput[];
  examples?: PresetExampleInput[];
  stopSequences?: PresetStopSequenceInput[];
  providerOverrides?: PresetProviderOverrideInput[];
  semanticGroups?: PresetSemanticGroupInput[];
}

// ─── Character ───

export interface CharacterBaseSection {
  id: number;
  characterId: number;
  sectionKey: CharacterBaseSectionKey | string;
  title?: string;
  content: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface CharacterBaseSectionInput {
  sectionKey: CharacterBaseSectionKey;
  title?: string;
  content: string;
  sortOrder?: number;
}

export interface CharacterCard {
  id: number;
  cardType: CharacterCardType | string;
  name: string;
  imagePath?: string;
  description: string;
  tags: string[];
  baseSections: CharacterBaseSection[];
  firstMessages: string[];
  defaultWorldBookId?: number;
  defaultPresetId?: number;
  defaultProviderId?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCharacterCardPayload {
  cardType: CharacterCardType;
  name: string;
  imagePath?: string;
  description: string;
  tags: string[];
  baseSections?: CharacterBaseSectionInput[];
  firstMessages?: string[];
  defaultWorldBookId?: number;
  defaultPresetId?: number;
  defaultProviderId?: number;
}

// ─── Guest character card payload (room join) ───

export interface GuestCharacterBaseSection {
  sectionKey: string;
  title?: string;
  content: string;
}

export interface GuestCharacterCardPayload {
  name: string;
  description: string;
  tags: string[];
  baseSections: GuestCharacterBaseSection[];
}

// ─── World book ───

export interface WorldBookSummary {
  id: number;
  title: string;
  description?: string;
  imagePath?: string;
  entryCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorldBookEntryRecord {
  id: number;
  worldBookId: number;
  title: string;
  content: string;
  keywords: string[];
  triggerMode: WorldBookTriggerMode | string;
  isEnabled: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface UpsertWorldBookEntryPayload {
  worldBookId: number;
  entryId?: number;
  title: string;
  content: string;
  keywords: string[];
  triggerMode: WorldBookTriggerMode;
  isEnabled: boolean;
  sortOrder?: number;
}

// ─── Provider ───

export interface ApiProviderSummary {
  id: number;
  name: string;
  providerKind: string;
  purpose: 'llm' | 'embedding' | string;
  baseUrl: string;
  modelName: string;
  hasApiKey: boolean;
  apiKeyPreview?: string;
  createdAt: number;
  updatedAt: number;
}

export interface RemoteModel {
  id: string;
  ownedBy?: string;
}

// ─── Assets ───

export interface ImportedAsset {
  storedPath: string;
}

// ─── Stream events ───

export interface StreamChunkEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
  delta: string;
  done: boolean;
}

export interface LlmStreamToolUseEvent {
  id: string;
  name: string;
}

export interface LlmStreamEventPayload {
  conversationId: number;
  roundId: number;
  messageId: number;
  providerKind: string;
  eventKind:
    | 'text_delta'
    | 'thinking_delta'
    | 'content_block_start'
    | 'content_block_stop'
    | 'tool_use'
    | 'string_field_delta'
    | 'object_field_complete'
    | 'message_stop'
    | 'message_reset'
    | string;
  partIndex?: number;
  partType?:
    | 'text'
    | 'image'
    | 'tool_use'
    | 'tool_result'
    | 'thinking'
    | 'redacted_thinking'
    | string;
  textDelta?: string;
  jsonDelta?: string;
  toolUse?: LlmStreamToolUseEvent;
  stopReason?: string;
}

export interface StreamErrorEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
  error: string;
}

export interface StreamRetryEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
  error: string;
  attemptCount: number;
}

export interface ChatRoundStateEvent {
  round: RoundState;
}

export interface CharacterStateOverlayUpdatedEvent {
  conversationId: number;
  characterId: number;
  roundId: number;
  overlayId: number;
  sourceKind: 'ai' | 'manual' | string;
  status: 'completed' | string;
  summaryText: string;
}

export interface CharacterStateOverlayErrorEvent {
  conversationId: number;
  characterId: number;
  roundId: number;
  overlayId: number;
  sourceKind: 'ai' | 'manual' | string;
  status: 'failed' | string;
  error: string;
}

export interface MessageResetEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
}

// ─── Plot summary ───

export interface PlotSummaryRecord {
  id: number;
  conversationId: number;
  batchIndex: number;
  startRoundId: number;
  endRoundId: number;
  startRoundIndex: number;
  endRoundIndex: number;
  coveredRoundCount: number;
  sourceKind: 'ai' | 'manual' | 'manual_override' | string;
  status: 'pending' | 'queued' | 'completed' | 'failed' | string;
  summaryText?: string;
  providerKind?: string;
  modelName?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface PlotSummaryUpdatedEvent {
  conversationId: number;
  plotSummaryId: number;
  batchIndex: number;
  status: 'queued' | 'completed' | string;
  sourceKind?: 'ai' | 'manual' | 'manual_override' | string;
  summaryText?: string;
}

export interface PlotSummaryErrorEvent {
  conversationId: number;
  plotSummaryId: number;
  batchIndex: number;
  status: 'failed' | string;
  error: string;
}

export interface PlotSummaryPendingEvent {
  conversationId: number;
  plotSummaryId: number;
  batchIndex: number;
  status: 'pending' | string;
  startRoundIndex: number;
  endRoundIndex: number;
  coveredRoundCount: number;
}

// ─── Conversation payloads ───

export interface CreateConversationPayload {
  conversationType: ConversationType;
  title?: string;
  hostCharacterId?: number;
  worldBookId?: number;
  presetId?: number;
  providerId?: number;
  embeddingProviderId?: number;
  hostDisplayName?: string;
  hostPlayerCharacterId: number;
  chatMode?: ChatMode;
  agentProviderPolicy?: AgentProviderPolicy;
  openingMessageIndex?: number;
  memoryMode?: 'stateless' | 'legacy' | 'mem0';
}

export interface UpdateConversationBindingsPayload {
  conversationId: number;
  title?: string;
  hostCharacterId?: number;
  worldBookId?: number;
  presetId?: number;
  providerId?: number;
  embeddingProviderId?: number | null;
  chatMode?: ChatMode;
  agentProviderPolicy?: AgentProviderPolicy;
}

// ─── Exchange ───

export interface ExchangeImportReport {
  characters: number;
  worldBooks: number;
  worldBookEntries: number;
  avatars: number;
}

// ─── Settings ───

export interface Setting {
  key: string;
  value: string;
}

// ─── Memory (mem0) ───

export interface Mem0Status {
  enabled: boolean;
  providerReady: boolean;
  vectorStorePath: string;
}

export interface Mem0MemoryEntry {
  id: string;
  memory: string;
  score?: number | null;
  createdAt?: string | null;
}

export interface SnapshotInfo {
  roundIndex: number;
  timestamp: number;
  fileSize: number;
  fileName: string;
}

export interface MemoryBackendErrorEvent {
  conversationId: number;
  roundId: number;
  operation: string;
  strategy?: string;
  error: string;
}

export interface Mem0InitStatusResponse {
  available: boolean;
  error?: string;
}

export interface Mem0ProviderConfig {
  /** mem0 LLM provider id (optional; empty = use most recently updated provider). */
  llmProviderId: string;
  /** mem0 LLM model name (optional; empty = use the provider's model_name). */
  llmModel: string;
  /** mem0 embedding provider id (REQUIRED). */
  embeddingProviderId: string;
  /** Embedding model name (defaults to text-embedding-3-small). */
  embeddingModel: string;
  /** Embedding dims (defaults to 1536). */
  embeddingDims: string;
}

// ─── Room ───

export interface RoomCreateResult {
  roomId: number;
  hostAddress: string;
  port: number;
  alternativeAddresses: string[];
}

export interface RoomOpenResult {
  roomId: number;
  hostAddress: string;
  port: number;
  alternativeAddresses: string[];
}

export interface RoomStatusResult {
  roomId?: number;
  isOpen: boolean;
  port?: number;
  currentPlayerCount: number;
}

export interface RoomJoinResult {
  success: boolean;
  message: string;
  roomId?: number;
  memberId?: number;
  conversation?: ConversationListItem;
  members?: ConversationMember[];
  recentMessages?: UiMessage[];
  roundState?: RoundState;
  // Extended fields for guest client synchronization (fix-room-guest-client-sync).
  // Backend uses `#[serde(alias = "recentMessages")]` to also serialize under the old
  // field name, so older clients that only know `recentMessages` keep working.
  hostCharacterImageBase64?: string | null;
  hostCharacterName?: string | null;
  hostCharacterDescription?: string | null;
  fullMessages?: UiMessage[];
  schemaToggleState?: Record<string, boolean>;
  contextWindowSize?: number;
  tokenUsageReport?: TokenUsageReport;
  hostBaseSections?: string | null;
  hostPresetName?: string | null;
  hostWorldBookName?: string | null;
  hostProviderName?: string | null;
  plotSummaries?: PlotSummaryRecord[];
}

export interface RoomHostCharacter {
  name: string;
  description: string;
  imagePath?: string | null;
  imageBase64?: string | null;
  baseSections?: CharacterBaseSection[] | null;
  presetName?: string | null;
  worldBookName?: string | null;
  providerName?: string | null;
}

export interface RoomContextSnapshotEvent {
  conversationId: number;
  messages: UiMessage[];
  members: ConversationMember[];
  roundState: RoundState | null;
  hostCharacterImageBase64?: string | null;
  hostCharacterName?: string | null;
  hostCharacterDescription?: string | null;
  schemaToggleState?: Record<string, boolean>;
  contextWindowSize?: number;
  tokenUsageReport?: TokenUsageReport;
  hostBaseSections?: string | null;
  hostPresetName?: string | null;
  hostWorldBookName?: string | null;
  hostProviderName?: string | null;
  plotSummaries?: PlotSummaryRecord[];
}

export interface RoomMemberJoinedEvent {
  memberId: number;
  displayName: string;
}

export interface RoomSchemaToggleEvent {
  conversationId: number;
  toggleKey: string;
  expanded: boolean;
}

export interface RoomTokenUsageEvent {
  conversationId: number;
  tokenUsageReport: TokenUsageReport;
}

export interface RoomPlotSummaryUpdateEvent {
  conversationId: number;
  summaries: PlotSummaryRecord[];
}

export interface RoomMemberLeftEvent {
  memberId: number;
  displayName: string;
}

export interface RoomPlayerMessageEvent {
  memberId: number;
  displayName: string;
  content: string;
  actionType: string;
  conversationId?: number;
  roundId?: number;
  messageId?: number;
}

export interface RoomStreamChunkEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
  delta: string;
  done: boolean;
}

export interface RoomStreamEndEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
}

export interface RoomStreamStructuredFieldDeltaEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
  fieldKey: string;
  delta: string;
}

export interface RoomStreamObjectFieldCompleteEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
  fieldKey: string;
  json: string;
}

export interface RoomStreamRetryEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
  error: string;
  attemptCount: number;
}

export interface RoomMessageResetEvent {
  conversationId: number;
  roundId: number;
  messageId: number;
}

export interface RoomRoundStateUpdateEvent {
  roundState: RoundState;
}

export interface RoomErrorEvent {
  code: string;
  message: string;
}
