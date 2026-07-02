import { invokeCommand } from './internal';
import { settingsGetAll, settingsSet } from './settings';
import type {
  Mem0InitStatusResponse,
  Mem0MemoryEntry,
  Mem0ProviderConfig,
  Mem0Status,
  SnapshotInfo,
} from './types';

const DEFAULT_MEM0_CONFIG: Mem0ProviderConfig = {
  llmProviderId: '',
  llmModel: '',
  embeddingProviderId: '',
  embeddingModel: 'text-embedding-3-small',
  embeddingDims: '1536',
};

export async function mem0Status() {
  return invokeCommand<Mem0Status>('mem0_status');
}

export async function memoryModeSet(conversationId: number, mode: 'stateless' | 'legacy' | 'mem0') {
  return invokeCommand<string>('memory_mode_set', { conversationId, mode });
}

export async function mem0SetEnabled(conversationId: number, enabled: boolean) {
  return invokeCommand<boolean>('mem0_set_enabled', { conversationId, enabled });
}

export async function mem0SearchTest(
  conversationId: number,
  query: string,
  limit?: number,
) {
  return invokeCommand<Mem0MemoryEntry[]>('mem0_search_test', { conversationId, query, limit });
}

export async function mem0ListMemories(conversationId: number, limit?: number) {
  return invokeCommand<Mem0MemoryEntry[]>('mem0_list_memories', { conversationId, limit });
}

export async function mem0DeleteMemory(conversationId: number, memoryId: string) {
  return invokeCommand<void>('mem0_delete_memory', { conversationId, memoryId });
}

export async function mem0DeleteAll(conversationId: number) {
  return invokeCommand<number>('mem0_delete_all', { conversationId });
}

// ---- mem0 snapshot ----

export async function mem0SnapshotList(conversationId: number) {
  return invokeCommand<SnapshotInfo[]>('mem0_snapshot_list', { conversationId });
}

export async function mem0SnapshotWindowSet(conversationId: number, window: number) {
  return invokeCommand<void>('mem0_snapshot_window_set', { conversationId, window });
}

// ---- mem0 init status ----

export async function mem0InitStatus() {
  return invokeCommand<Mem0InitStatusResponse>('mem0_init_status');
}

// ---- mem0 provider config (LLM + embedding decoupled) ----

export async function getMem0ProviderConfig(): Promise<Mem0ProviderConfig> {
  const all = await settingsGetAll();
  const lookup = (key: string): string =>
    all.find((s) => s.key === key)?.value?.trim() ?? '';
  return {
    llmProviderId: lookup('mem0_provider_id'),
    llmModel: lookup('mem0_llm_model'),
    embeddingProviderId: lookup('mem0_embedding_provider_id'),
    embeddingModel: lookup('mem0_embedding_model') || DEFAULT_MEM0_CONFIG.embeddingModel,
    embeddingDims: lookup('mem0_embedding_dims') || DEFAULT_MEM0_CONFIG.embeddingDims,
  };
}

export async function setMem0ProviderConfig(config: Mem0ProviderConfig): Promise<void> {
  await settingsSet('mem0_provider_id', config.llmProviderId.trim());
  await settingsSet('mem0_llm_model', config.llmModel.trim());
  await settingsSet('mem0_embedding_provider_id', config.embeddingProviderId.trim());
  await settingsSet('mem0_embedding_model', config.embeddingModel.trim());
  await settingsSet('mem0_embedding_dims', config.embeddingDims.trim());
}
