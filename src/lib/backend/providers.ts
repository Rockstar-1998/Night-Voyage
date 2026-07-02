import { invokeCommand, toInvokeArgs } from './internal';
import type { ApiProviderSummary, ProviderKind, RemoteModel } from './types';

export async function providersList(purposeFilter?: 'llm' | 'embedding') {
  return invokeCommand<ApiProviderSummary[]>('providers_list', purposeFilter ? { purposeFilter } : undefined);
}

export async function providersCreate(payload: {
  name: string;
  providerKind: ProviderKind;
  purpose?: 'llm' | 'embedding';
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
  purpose?: 'llm' | 'embedding';
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
