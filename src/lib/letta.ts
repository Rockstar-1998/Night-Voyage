import Letta from '@letta-ai/letta-client';
import { invoke } from '@tauri-apps/api/core';

// API Provider 完整信息（含 api_key，从 Rust 获取）
export interface ApiProviderDetail {
  id: number;
  name: string;
  providerKind: string;
  baseUrl: string;
  apiKey: string;
  modelName: string;
  maxTokens?: number;
  maxContextTokens?: number;
  temperature?: number;
}

// Letta 服务端信息
export interface LettaServerInfo {
  url: string;
  running: boolean;
}

// 获取 Letta 服务端状态
export async function lettaServerStatus(): Promise<LettaServerInfo> {
  return invoke<LettaServerInfo>('letta_server_status');
}

// 启动 Letta 服务端
export async function lettaServerStart(): Promise<LettaServerInfo> {
  return invoke<LettaServerInfo>('letta_server_start');
}

// 停止 Letta 服务端
export async function lettaServerStop(): Promise<void> {
  return invoke('letta_server_stop');
}

// 安装 Python 环境
export async function lettaSetup(): Promise<void> {
  return invoke('letta_setup');
}

// 获取完整 API Provider（含 api_key）
export async function lettaGetProviderDetail(providerId: number): Promise<ApiProviderDetail> {
  return invoke<ApiProviderDetail>('letta_get_provider_detail', { providerId });
}

// 保存 agent_id 到数据库
export async function lettaSaveAgentId(conversationId: number, agentId: string): Promise<void> {
  return invoke('letta_save_agent_id', { conversationId, agentId });
}

// 获取 agent_id
export async function lettaGetAgentId(conversationId: number): Promise<string | null> {
  return invoke<string | null>('letta_get_agent_id', { conversationId });
}

// 设置会话引擎类型
export async function lettaSetEngineKind(
  conversationId: number,
  engineKind: 'native' | 'letta',
): Promise<void> {
  return invoke('letta_set_engine_kind', { conversationId, engineKind });
}

// 创建 Letta 客户端
export function createLettaClient(url: string): Letta {
  return new Letta({
    baseURL: url,
    apiKey: 'local-dev', // 本地部署不需要真实 key
  });
}

// 将 providerKind 映射为 Letta 的 provider_endpoint_type
function toEndpointType(providerKind: string): 'anthropic' | 'openai' {
  return providerKind === 'anthropic' ? 'anthropic' : 'openai';
}

// 注册 BYOK Provider（若已存在则复用），返回 provider_id
async function ensureProvider(client: Letta, provider: ApiProviderDetail): Promise<string> {
  const providerName = `nv-${provider.id}`;

  // 尝试列出已有 providers，查找同名
  try {
    const existing = await client.get<{ items: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>(
      '/v1/providers',
    );
    const list = Array.isArray(existing) ? existing : (existing?.items ?? []);
    const found = list.find((p) => p.name === providerName);
    if (found) return found.id;
  } catch (err) {
    console.warn('[letta] list providers failed, will try create directly:', err);
  }

  // 创建新 provider
  const created = await client.post<{ id: string }>('/v1/providers', {
    body: {
      name: providerName,
      provider_type: 'byok',
      provider_endpoint_type: toEndpointType(provider.providerKind),
      base_url: provider.baseUrl,
      api_key: provider.apiKey,
    },
  });
  return created.id;
}

// 注册 Model（若已存在则跳过）
async function ensureModel(client: Letta, provider: ApiProviderDetail, providerName: string): Promise<void> {
  const modelHandle = `${providerName}/${provider.modelName}`;

  // 先检查是否已注册
  try {
    const models = await client.models.list();
    const exists = Array.isArray(models) && models.some((m) => m.handle === modelHandle);
    if (exists) return;
  } catch (err) {
    console.warn('[letta] list models failed, will try register directly:', err);
  }

  // 注册新 model
  try {
    await client.post('/v1/internal/register-model', {
      body: {
        provider_name: providerName,
        model_name: provider.modelName,
        model_endpoint_type: toEndpointType(provider.providerKind),
        context_window: provider.maxContextTokens ?? 128000,
      },
    });
  } catch (err) {
    // 已存在时 Letta 会返回冲突错误，忽略即可
    console.warn('[letta] register-model failed (may already exist):', err);
  }
}

// 初始化 Letta Agent（注册 provider + model + 创建 agent）
// 返回 agent_id
export async function lettaAgentInit(
  client: Letta,
  provider: ApiProviderDetail,
  existingAgentId?: string | null,
): Promise<string> {
  // 1. 如果已有 agentId，先尝试获取现有 agent
  if (existingAgentId) {
    try {
      const agent = await client.agents.retrieve(existingAgentId);
      return agent.id;
    } catch {
      // agent 不存在，继续创建新的
    }
  }

  // 2. 注册 BYOK Provider
  const providerName = `nv-${provider.id}`;
  await ensureProvider(client, provider);

  // 3. 注册 Model
  await ensureModel(client, provider, providerName);

  // 4. 创建 Agent
  const modelHandle = `${providerName}/${provider.modelName}`;
  const agent = await client.agents.create({
    name: `nv-agent-${Date.now()}`,
    model: modelHandle,
    include_base_tools: true,
  });

  return agent.id;
}

// 从一个流式事件中提取 assistant 文本增量
function extractAssistantDelta(event: any): string {
  if (event?.message_type !== 'assistant_message') return '';
  const content = event.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (c && typeof c === 'object' && typeof c.text === 'string' ? c.text : ''))
      .join('');
  }
  return '';
}

// 流式发送消息到 Letta Agent
// onDelta 回调接收增量文本
// 返回完整响应文本
export async function lettaStreamMessage(
  client: Letta,
  agentId: string,
  message: string,
  onDelta: (text: string) => void,
): Promise<string> {
  let fullText = '';

  const stream = await client.agents.messages.create(agentId, {
    messages: [{ role: 'user', content: message }],
    streaming: true,
    stream_tokens: true,
  });

  for await (const event of stream) {
    const delta = extractAssistantDelta(event);
    if (delta) {
      fullText += delta;
      onDelta(delta);
    }
  }

  return fullText;
}

// 获取 Agent 的核心记忆块列表
export async function lettaGetMemory(client: Letta, agentId: string): Promise<any[]> {
  const page = await client.agents.blocks.list(agentId);
  // ArrayPage<BlockResponse> 暴露 .items
  return (page as any)?.items ?? [];
}

// 更新 Agent 的核心记忆块（按 label 定位）
export async function lettaUpdateMemory(
  client: Letta,
  agentId: string,
  blockLabel: string,
  value: string,
): Promise<void> {
  await client.agents.blocks.update(blockLabel, {
    agent_id: agentId,
    value,
  });
}

// 重导出 Letta 类型供外部使用（仅类型）
export type { Letta };
