import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

function toInvokeArgs<T extends object>(payload: T): Record<string, unknown> {
  return payload as unknown as Record<string, unknown>;
}

function invokeCommand<T>(command: string, payload?: Record<string, unknown>) {
  return invoke<T>(command, payload);
}

export type ConversationType = 'single' | 'online';
export type ChatMode = 'classic' | 'director_agents';
export type AgentProviderPolicy = 'shared_host_provider' | 'mixed_cost_optimized';
export type CharacterCardType = 'npc' | 'player';
export type CharacterBaseSectionKey = 'identity' | 'persona' | 'background' | 'rules' | 'custom';
export type WorldBookTriggerMode = 'any' | 'all';
export type ProviderKind = 'openai_compatible' | 'anthropic' | string;

export interface ConversationListItem {
  id: number;
  conversationType: ConversationType;
  title: string | null;
  hostCharacterId?: number;
  worldBookId?: number;
  presetId?: number;
  providerId?: number;
  chatMode: ChatMode;
  agentProviderPolicy: AgentProviderPolicy;
  plotSummaryMode: 'ai' | 'manual' | string;
  memberCount: number;
  pendingMemberCount: number;
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
  responseMode?: 'text' | 'json_object' | string;
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

export interface PresetExampleRecord {
  id: number;
  presetId: number;
  semanticOptionId?: number;
  role: 'user' | 'assistant' | string;
  content: string;
  sortOrder: number;
  isEnabled: boolean;
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
  responseModeOverride?: 'text' | 'json_object' | string;
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
  examples: PresetExampleRecord[];
  stopSequences: PresetStopSequenceRecord[];
  providerOverrides: PresetProviderOverrideRecord[];
  semanticGroups: PresetSemanticGroupRecord[];
}

export interface PresetCompilePreview {
  preset: PresetSummary;
  providerKind?: string;
  systemText: string;
  systemBlocks: PresetPromptBlock[];
  exampleMessages: Array<{
    role: 'user' | 'assistant' | string;
    content: string;
  }>;
  params: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    presencePenalty?: number;
    frequencyPenalty?: number;
    responseMode?: 'text' | 'json_object' | string;
    stopSequences: string[];
  };
}

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

export interface ApiProviderSummary {
  id: number;
  name: string;
  providerKind: string;
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

export interface ImportedAsset {
  storedPath: string;
}

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
    | 'message_stop'
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

export interface CreateConversationPayload {
  conversationType: ConversationType;
  title?: string;
  hostCharacterId?: number;
  worldBookId?: number;
  presetId?: number;
  providerId?: number;
  hostDisplayName: string;
  hostPlayerCharacterId?: number;
  chatMode?: ChatMode;
  agentProviderPolicy?: AgentProviderPolicy;
}

export interface UpdateConversationBindingsPayload {
  conversationId: number;
  title?: string;
  hostCharacterId?: number;
  worldBookId?: number;
  presetId?: number;
  providerId?: number;
  chatMode?: ChatMode;
  agentProviderPolicy?: AgentProviderPolicy;
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
  responseModeOverride?: 'text' | 'json_object' | string;
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
  responseMode?: 'text' | 'json_object' | string;
  blocks?: PresetPromptBlockInput[];
  examples?: PresetExampleInput[];
  stopSequences?: PresetStopSequenceInput[];
  providerOverrides?: PresetProviderOverrideInput[];
  semanticGroups?: PresetSemanticGroupInput[];
}

export async function showWindow() {
  return invokeCommand('show_window');
}

export async function conversationsList() {
  return invokeCommand<ConversationListItem[]>('conversations_list');
}

export async function conversationsCreate(payload: CreateConversationPayload) {
  return invokeCommand<ConversationCreateResult>('conversations_create', toInvokeArgs(payload));
}

export async function conversationsUpdateBindings(payload: UpdateConversationBindingsPayload) {
  return invokeCommand<ConversationListItem>('conversations_update_bindings', toInvokeArgs(payload));
}

export async function conversationsDelete(id: number) {
  return invokeCommand<void>('conversations_delete', { id });
}

export async function conversationMembersList(conversationId: number) {
  return invokeCommand<ConversationMember[]>('conversation_members_list', { conversationId });
}

export async function conversationMembersCreate(payload: {
  conversationId: number;
  displayName: string;
  playerCharacterId?: number;
}) {
  return invokeCommand<ConversationMember>('conversation_members_create', toInvokeArgs(payload));
}

export async function conversationMembersUpdate(payload: {
  memberId: number;
  displayName?: string;
  playerCharacterId?: number;
  isActive?: boolean;
}) {
  return invokeCommand<ConversationMember>('conversation_members_update', toInvokeArgs(payload));
}

export async function conversationMembersDelete(memberId: number) {
  return invokeCommand<void>('conversation_members_delete', { memberId });
}

export async function presetsList() {
  return invokeCommand<PresetSummary[]>('presets_list');
}

export async function presetsGet(id: number) {
  return invokeCommand<PresetDetail>('presets_get', { id });
}

export async function presetsCompilePreview(id: number, providerKind?: string) {
  return invokeCommand<PresetCompilePreview>('presets_compile_preview', { id, providerKind });
}

export async function presetsCreate(payload: CreatePresetPayload) {
  return invokeCommand<PresetDetail>('presets_create', toInvokeArgs(payload));
}

export async function presetsUpdate(payload: CreatePresetPayload & { id: number }) {
  return invokeCommand<PresetDetail>('presets_update', toInvokeArgs(payload));
}

export async function presetsExport(id: number) {
  return invokeCommand<string>('presets_export', { id });
}

export async function presetsImport(payloadJson: string) {
  return invokeCommand<PresetDetail>('presets_import', { payloadJson });
}

export async function presetsDelete(id: number) {
  return invokeCommand<void>('presets_delete', { id });
}

export async function messagesList(conversationId: number, limit = 200) {
  return invokeCommand<UiMessage[]>('messages_list', { conversationId, limit });
}

export async function sendMessage(conversationId: number, providerId: number, content: string) {
  return invokeCommand<ChatSubmitInputResult>('send_message', { conversationId, providerId, content });
}

export async function chatSubmitInput(conversationId: number, memberId: number, content: string) {
  return invokeCommand<ChatSubmitInputResult>('chat_submit_input', { conversationId, memberId, content });
}

export async function regenerateMessage(conversationId: number, providerId: number, replyToId: number) {
  return invokeCommand<RegenerateRoundResult>('regenerate_message', { conversationId, providerId, replyToId });
}

export async function chatRegenerateRound(conversationId: number, roundId: number) {
  return invokeCommand<RegenerateRoundResult>('chat_regenerate_round', { conversationId, roundId });
}

export async function roundStateGet(conversationId: number) {
  return invokeCommand<RoundState>('round_state_get', { conversationId });
}

export async function plotSummariesList(conversationId: number) {
  return invokeCommand<PlotSummaryRecord[]>('plot_summaries_list', { conversationId });
}

export async function plotSummariesGetPending(conversationId: number) {
  return invokeCommand<PlotSummaryRecord[]>('plot_summaries_get_pending', { conversationId });
}

export async function plotSummariesUpsertManual(payload: {
  conversationId: number;
  batchIndex: number;
  summaryText: string;
}) {
  return invokeCommand<PlotSummaryRecord>('plot_summaries_upsert_manual', toInvokeArgs(payload));
}

export async function plotSummariesUpdateMode(payload: {
  conversationId: number;
  plotSummaryMode: 'ai' | 'manual' | string;
}) {
  return invokeCommand<string>('plot_summaries_update_mode', toInvokeArgs(payload));
}

export async function characterCardsList(cardType?: CharacterCardType) {
  return invokeCommand<CharacterCard[]>('character_cards_list', { cardType });
}

export async function characterCardsCreate(payload: CreateCharacterCardPayload) {
  return invokeCommand<CharacterCard>('character_cards_create', toInvokeArgs(payload));
}

export async function characterCardsUpdate(payload: CreateCharacterCardPayload & { id: number }) {
  return invokeCommand<CharacterCard>('character_cards_update', toInvokeArgs(payload));
}

export async function characterCardsDelete(id: number) {
  return invokeCommand<void>('character_cards_delete', { id });
}

export async function worldBooksList() {
  return invokeCommand<WorldBookSummary[]>('world_books_list');
}

export async function worldBooksCreate(payload: { title: string; description?: string; imagePath?: string }) {
  return invokeCommand<WorldBookSummary>('world_books_create', toInvokeArgs(payload));
}

export async function worldBooksUpdate(payload: { id: number; title?: string; description?: string; imagePath?: string }) {
  return invokeCommand<WorldBookSummary>('world_books_update', toInvokeArgs(payload));
}

export async function worldBooksDelete(id: number) {
  return invokeCommand<void>('world_books_delete', { id });
}

export async function worldBookEntriesList(worldBookId: number) {
  return invokeCommand<WorldBookEntryRecord[]>('world_book_entries_list', { worldBookId });
}

export async function worldBookEntriesUpsert(payload: UpsertWorldBookEntryPayload) {
  return invokeCommand<WorldBookEntryRecord>('world_book_entries_upsert', toInvokeArgs(payload));
}

export async function worldBookEntriesDelete(entryId: number) {
  return invokeCommand<void>('world_book_entries_delete', { entryId });
}

export async function providersList() {
  return invokeCommand<ApiProviderSummary[]>('providers_list');
}

export async function providersCreate(payload: {
  name: string;
  providerKind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  modelName: string;
}) {
  return invokeCommand<ApiProviderSummary>('providers_create', toInvokeArgs(payload));
}

export async function providersUpdate(payload: {
  id: number;
  name: string;
  providerKind: ProviderKind;
  baseUrl: string;
  modelName: string;
  apiKey?: string;
}) {
  return invokeCommand<ApiProviderSummary>('providers_update', toInvokeArgs(payload));
}

export async function providersDelete(id: number) {
  return invokeCommand<void>('providers_delete', { id });
}

export async function providersTest(payload: {
  providerKind?: ProviderKind;
  baseUrl: string;
  apiKey: string;
  modelName: string;
}) {
  return invokeCommand<{ ok: boolean; status: number; latencyMs: number }>('providers_test', toInvokeArgs(payload));
}

export async function providersTestClaudeNative(payload: {
  providerId: number;
  testModel: string;
  testPrompt?: string;
  timeoutSeconds?: number;
  degradedThresholdMs?: number;
  maxRetries?: number;
}) {
  return invokeCommand<{
    ok: boolean;
    status: number;
    latencyMs: number;
    attemptCount: number;
    degraded: boolean;
    degradedThresholdMs: number;
    model: string;
    responsePreview: string;
  }>('providers_test_claude_native', toInvokeArgs(payload));
}

export async function providersFetchModels(providerId: number) {
  return invokeCommand<RemoteModel[]>('providers_fetch_models', { providerId });
}

export async function assetsImportImage(sourcePath: string) {
  return invokeCommand<ImportedAsset>('assets_import_image', { sourcePath });
}

export async function assetsImportImageBytes(fileName: string, bytes: number[]) {
  return invokeCommand<ImportedAsset>('assets_import_image_bytes', { fileName, bytes });
}

export async function importManagedImageFile(file: File) {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return assetsImportImageBytes(file.name, bytes);
}

export function toAssetUrl(path?: string | null) {
  if (!path) return undefined;
  return convertFileSrc(path);
}

export function resolveImageSrc(path: string | undefined | null, fallback: string) {
  if (!path) return fallback;
  if (/^(https?:|data:|blob:|asset:)/i.test(path)) return path;
  return toAssetUrl(path) ?? fallback;
}

export async function listenStreamChunk(
  handler: (payload: StreamChunkEvent) => void,
): Promise<UnlistenFn> {
  return listen<StreamChunkEvent>('llm-stream-chunk', (event) => handler(event.payload));
}

export async function listenLlmStreamEvent(
  handler: (payload: LlmStreamEventPayload) => void,
): Promise<UnlistenFn> {
  return listen<LlmStreamEventPayload>('llm-stream-event', (event) => handler(event.payload));
}

export async function listenStreamError(
  handler: (payload: StreamErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<StreamErrorEvent>('llm-stream-error', (event) => handler(event.payload));
}

export async function listenRoundState(
  handler: (payload: ChatRoundStateEvent) => void,
): Promise<UnlistenFn> {
  return listen<ChatRoundStateEvent>('chat-round-state', (event) => handler(event.payload));
}

export async function listenCharacterStateOverlayUpdated(
  handler: (payload: CharacterStateOverlayUpdatedEvent) => void,
): Promise<UnlistenFn> {
  return listen<CharacterStateOverlayUpdatedEvent>('character-state-overlay-updated', (event) =>
    handler(event.payload),
  );
}

export async function listenCharacterStateOverlayError(
  handler: (payload: CharacterStateOverlayErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<CharacterStateOverlayErrorEvent>('character-state-overlay-error', (event) =>
    handler(event.payload),
  );
}

export async function listenPlotSummaryUpdated(
  handler: (payload: PlotSummaryUpdatedEvent) => void,
): Promise<UnlistenFn> {
  return listen<PlotSummaryUpdatedEvent>('plot-summary-updated', (event) => handler(event.payload));
}

export async function listenPlotSummaryError(
  handler: (payload: PlotSummaryErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<PlotSummaryErrorEvent>('plot-summary-error', (event) => handler(event.payload));
}

export async function listenPlotSummaryPending(
  handler: (payload: PlotSummaryPendingEvent) => void,
): Promise<UnlistenFn> {
  return listen<PlotSummaryPendingEvent>('plot-summary-pending', (event) => handler(event.payload));
}

export interface Setting {
  key: string;
  value: string;
}

export async function settingsGetAll() {
  return invokeCommand<Setting[]>('settings_get_all');
}

export async function settingsSet(key: string, value: string) {
  return invokeCommand<Setting>('settings_set', { key, value });
}

export async function getMessageFormatConfig(): Promise<string> {
  const all = await settingsGetAll();
  const entry = all.find(s => s.key === 'messageFormatConfig');
  return entry?.value ?? '';
}

export async function setMessageFormatConfig(value: string): Promise<void> {
  await settingsSet('messageFormatConfig', value);
}

export async function messagesUpdateContent(messageId: number, content: string) {
  return invokeCommand<void>('messages_update_content', { messageId, content });
}

export async function messagesSwitchSwipe(roundId: number, targetMessageId: number) {
  return invokeCommand<UiMessage>('messages_switch_swipe', { roundId, targetMessageId });
}

export async function conversationsFork(conversationId: number, upToMessageId: number) {
  return invokeCommand<number>('conversations_fork', { conversationId, upToMessageId });
}

// ─── Room Commands ───

export interface RoomCreateResult {
  roomId: number;
  hostAddress: string;
  port: number;
  alternativeAddresses: string[];
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
}

export async function roomCreate(payload: {
  roomName: string;
  conversationId: number;
  port: number;
  passphrase?: string;
}) {
  return invokeCommand<RoomCreateResult>('room_create', toInvokeArgs(payload));
}

export async function roomJoin(payload: {
  hostAddress: string;
  port: number;
  displayName: string;
}) {
  return invokeCommand<RoomJoinResult>('room_join', toInvokeArgs(payload));
}

export async function roomLeave() {
  return invokeCommand<void>('room_leave');
}

export async function roomClose() {
  return invokeCommand<void>('room_close');
}

export async function roomSendMessage(payload: {
  content: string;
  actionType: string;
  displayName: string;
  memberId: number;
}) {
  return invokeCommand<void>('room_send_message', toInvokeArgs(payload));
}

// ─── Room Events ───

export interface RoomMemberJoinedEvent {
  memberId: number;
  displayName: string;
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

export interface RoomRoundStateUpdateEvent {
  roundState: RoundState;
}

export interface RoomErrorEvent {
  code: string;
  message: string;
}

export async function listenRoomMemberJoined(
  handler: (payload: RoomMemberJoinedEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMemberJoinedEvent>('room:member_joined', (event) => handler(event.payload));
}

export async function listenRoomMemberLeft(
  handler: (payload: RoomMemberLeftEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomMemberLeftEvent>('room:member_left', (event) => handler(event.payload));
}

export async function listenRoomPlayerMessage(
  handler: (payload: RoomPlayerMessageEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomPlayerMessageEvent>('room:player_message', (event) => handler(event.payload));
}

export async function listenRoomDisconnected(
  handler: () => void,
): Promise<UnlistenFn> {
  return listen<void>('room:disconnected', () => handler());
}

export async function listenRoomError(
  handler: (payload: string | RoomErrorEvent) => void,
): Promise<UnlistenFn> {
  return listen<string | RoomErrorEvent>('room:error', (event) => handler(event.payload));
}

export async function listenRoomStreamChunk(
  handler: (payload: RoomStreamChunkEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamChunkEvent>('room:stream_chunk', (event) => handler(event.payload));
}

export async function listenRoomStreamEnd(
  handler: (payload: RoomStreamEndEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomStreamEndEvent>('room:stream_end', (event) => handler(event.payload));
}

export async function listenRoomRoundStateUpdate(
  handler: (payload: RoomRoundStateUpdateEvent) => void,
): Promise<UnlistenFn> {
  return listen<RoomRoundStateUpdateEvent>('room:round_state_update', (event) => handler(event.payload));
}
