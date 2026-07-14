import { Component, Show, createSignal, createMemo } from 'solid-js';
import { RefreshCw } from '../../lib/icons';
import { IconButton } from '../ui/IconButton';
import { toErrorMessage, requireNonEmpty, parsePositiveIntegerField } from './validationUtils';

export interface ClaudeNativeTestFormState {
  testModel: string;
  timeoutSeconds: string;
  testPrompt: string;
  degradedThresholdMs: string;
  maxRetries: string;
}

export interface ProviderClaudeNativeTestResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  attemptCount: number;
  degraded: boolean;
  degradedThresholdMs: number;
  model: string;
  responsePreview: string;
}

export interface ClaudeTestPayload {
  providerId: number;
  testModel: string;
  testPrompt?: string;
  timeoutSeconds?: number;
  degradedThresholdMs?: number;
  maxRetries?: number;
}

const DEFAULT_CLAUDE_TEST_FORM: ClaudeNativeTestFormState = {
  testModel: 'claude-opus-4-6',
  timeoutSeconds: '45',
  testPrompt: 'Who are you?',
  degradedThresholdMs: '6000',
  maxRetries: '2',
};

interface ClaudeNativeTestPanelProps {
  /** Saved provider id; test only runs after the provider is persisted. */
  providerId: number | null;
  /** Suggested model name from the saved provider (falls back to default). */
  suggestedModel?: string;
  onTest: (payload: ClaudeTestPayload) => Promise<ProviderClaudeNativeTestResult> | ProviderClaudeNativeTestResult;
}

export const ClaudeNativeTestPanel: Component<ClaudeNativeTestPanelProps> = (props) => {
  const [claudeTestForm, setClaudeTestForm] = createSignal<ClaudeNativeTestFormState>(DEFAULT_CLAUDE_TEST_FORM);
  const [isTestingClaudeNative, setIsTestingClaudeNative] = createSignal(false);
  const [claudeTestError, setClaudeTestError] = createSignal<string | null>(null);
  const [claudeTestResult, setClaudeTestResult] = createSignal<ProviderClaudeNativeTestResult | null>(null);

  const canRunTest = createMemo(() => props.providerId != null);

  // Sync suggested model when provider changes (only when user hasn't typed yet).
  // We rely on parent effect to pass a fresh suggestedModel and reset here.
  const updateForm = (patch: Partial<ClaudeNativeTestFormState>) =>
    setClaudeTestForm({ ...claudeTestForm(), ...patch });

  const handleTest = async () => {
    const providerId = props.providerId;
    if (providerId == null) {
      setClaudeTestError('请先保存档案后再执行 Claude 原生测试。');
      return;
    }

    let payload: ClaudeTestPayload;
    try {
      const config = claudeTestForm();
      payload = {
        providerId,
        testModel: requireNonEmpty('测试模型', config.testModel),
        testPrompt: config.testPrompt.trim() || undefined,
        timeoutSeconds: parsePositiveIntegerField('超时时间', config.timeoutSeconds),
        degradedThresholdMs: parsePositiveIntegerField('降级阈值', config.degradedThresholdMs),
        maxRetries: parsePositiveIntegerField('最大重试次数', config.maxRetries),
      };
    } catch (error) {
      setClaudeTestError(toErrorMessage(error));
      setClaudeTestResult(null);
      return;
    }

    console.debug('[provider-debug] frontend:claude_native_test:start', payload);
    setIsTestingClaudeNative(true);
    setClaudeTestError(null);
    setClaudeTestResult(null);

    try {
      const result = await props.onTest(payload);
      console.debug('[provider-debug] frontend:claude_native_test:success', result);
      setClaudeTestResult(result);
    } catch (error) {
      const message = toErrorMessage(error);
      console.error('[provider-debug] frontend:claude_native_test:error', {
        providerId,
        error,
      });
      setClaudeTestError(message);
    } finally {
      setIsTestingClaudeNative(false);
    }
  };

  return (
    <div class="space-y-4 pt-4 border-t border-white/5">
      <div class="flex items-center justify-between gap-4 py-4 border-b border-white/5">
        <div>
          <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">
            Claude 原生测试
          </label>
          <p class="text-[11px] text-mist-solid/25 mt-1">
            参考 CC Switch 的测试参数，直接走 Claude 原生 Messages API。
          </p>
        </div>
        <IconButton
          onClick={() => void handleTest()}
          disabled={!canRunTest() || isTestingClaudeNative()}
          label={
            isTestingClaudeNative()
              ? 'Claude 原生测试中'
              : canRunTest()
                ? 'Claude 原生测试'
                : '请先保存档案'
          }
          tone="accent"
          size="md"
        >
          <RefreshCw size={16} class={isTestingClaudeNative() ? 'animate-spin' : ''} />
        </IconButton>
      </div>

      <Show when={!canRunTest()}>
        <div class="rounded-2xl border border-dashed border-white/10 px-4 py-3 text-xs text-mist-solid/35">
          Claude 原生测试使用已保存档案里的 base URL 与 API Key；请先保存档案。
        </div>
      </Show>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="space-y-2 md:col-span-2">
          <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">测试模型</label>
          <input
            type="text"
            value={claudeTestForm().testModel}
            onInput={(e) => updateForm({ testModel: e.currentTarget.value })}
            class="w-full bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
          />
        </div>

        <div class="space-y-2">
          <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">超时时间（秒）</label>
          <input
            type="text"
            value={claudeTestForm().timeoutSeconds}
            onInput={(e) => updateForm({ timeoutSeconds: e.currentTarget.value })}
            class="w-full bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
          />
        </div>

        <div class="space-y-2">
          <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">降级阈值（毫秒）</label>
          <input
            type="text"
            value={claudeTestForm().degradedThresholdMs}
            onInput={(e) => updateForm({ degradedThresholdMs: e.currentTarget.value })}
            class="w-full bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
          />
        </div>

        <div class="space-y-2 md:col-span-2">
          <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">测试提示词</label>
          <input
            type="text"
            value={claudeTestForm().testPrompt}
            onInput={(e) => updateForm({ testPrompt: e.currentTarget.value })}
            class="w-full bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
          />
        </div>

        <div class="space-y-2">
          <label class="text-xs font-bold text-mist-solid/30 uppercase tracking-wider">最大重试次数</label>
          <input
            type="text"
            value={claudeTestForm().maxRetries}
            onInput={(e) => updateForm({ maxRetries: e.currentTarget.value })}
            class="w-full bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
          />
        </div>
      </div>

      <Show when={claudeTestError()}>
        <div class="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {claudeTestError()}
        </div>
      </Show>

      <Show when={claudeTestResult()}>
        {(result) => (
          <div class="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-4 text-sm text-emerald-100 space-y-2">
            <div class="font-semibold">Claude 原生测试成功</div>
            <div>模型：{result().model}</div>
            <div>
              状态：{result().status} · 耗时：{result().latencyMs} ms · 尝试：
              {result().attemptCount}
            </div>
            <div>
              阈值：{result().degradedThresholdMs} ms · 性能标记：
              {result().degraded ? '已降级' : '正常'}
            </div>
            <div class="text-emerald-50/90 break-all">响应预览：{result().responsePreview}</div>
          </div>
        )}
      </Show>
    </div>
  );
};
