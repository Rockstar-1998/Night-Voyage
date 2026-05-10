import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { listen } from '@tauri-apps/api/event';

interface BackdoorTestState {
  status: 'idle' | 'running' | 'success' | 'failed';
  testMessage: string;
  totalMs: number | null;
  assistantContent: string | null;
  error: string | null;
  memoryBytes: number | null;
  uptimeMs: number | null;
}

export function BackdoorTestPanel() {
  const [state, setState] = createSignal<BackdoorTestState>({
    status: 'idle',
    testMessage: '',
    totalMs: null,
    assistantContent: null,
    error: null,
    memoryBytes: null,
    uptimeMs: null,
  });

  const [expanded, setExpanded] = createSignal(false);

  let unlistenStarted: (() => void) | null = null;
  let unlistenCompleted: (() => void) | null = null;
  let unlistenFailed: (() => void) | null = null;

  onMount(async () => {
    unlistenStarted = await listen('backdoor-chat-test-started', (event) => {
      const payload = event.payload as { testMessage?: string; providerId?: number };
      setState({
        status: 'running',
        testMessage: payload.testMessage ?? 'ping',
        totalMs: null,
        assistantContent: null,
        error: null,
        memoryBytes: null,
        uptimeMs: null,
      });
    });

    unlistenCompleted = await listen('backdoor-chat-test-completed', (event) => {
      const payload = event.payload as {
        ok: boolean;
        totalMs: number;
        assistantContent: string;
        roundStatus: string;
      };
      setState((prev) => ({
        ...prev,
        status: 'success',
        totalMs: payload.totalMs,
        assistantContent: payload.assistantContent,
      }));
    });

    unlistenFailed = await listen('backdoor-chat-test-failed', (event) => {
      const payload = event.payload as { error?: string; roundStatus?: string };
      setState((prev) => ({
        ...prev,
        status: 'failed',
        error: payload.error ?? payload.roundStatus ?? 'unknown_error',
      }));
    });
  });

  onCleanup(() => {
    unlistenStarted?.();
    unlistenCompleted?.();
    unlistenFailed?.();
  });

  const handleRunTest = async () => {
    setState((prev) => ({
      ...prev,
      status: 'running',
      totalMs: null,
      assistantContent: null,
      error: null,
    }));

    try {
      const port = 17530;
      const response = await fetch(`http://127.0.0.1:${port}/backdoor/chat-test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testMessage: 'ping' }),
      });
      const data = await response.json();

      if (data.ok) {
        setState({
          status: 'success',
          testMessage: 'ping',
          totalMs: data.totalMs,
          assistantContent: data.assistantContent,
          error: null,
          memoryBytes: null,
          uptimeMs: null,
        });
      } else {
        setState({
          status: 'failed',
          testMessage: 'ping',
          totalMs: data.totalMs,
          assistantContent: null,
          error: data.error ?? 'unknown_error',
          memoryBytes: null,
          uptimeMs: null,
        });
      }
    } catch (e) {
      setState((prev) => ({
        ...prev,
        status: 'failed',
        error: String(e),
      }));
    }
  };

  const handleCheckHealth = async () => {
    try {
      const port = 17530;
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      const data = await response.json();
      setState((prev) => ({
        ...prev,
        memoryBytes: data.memory?.workingSetBytes ?? null,
        uptimeMs: data.uptimeMs ?? null,
      }));
    } catch {
      setState((prev) => ({
        ...prev,
        memoryBytes: null,
        uptimeMs: null,
      }));
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const statusColor = () => {
    switch (state().status) {
      case 'running': return '#f59e0b';
      case 'success': return '#10b981';
      case 'failed': return '#ef4444';
      default: return '#6b7280';
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '12px',
        right: '12px',
        'z-index': '99999',
        'font-family': 'monospace',
        'font-size': '11px',
        'background': 'rgba(15, 23, 42, 0.95)',
        border: '1px solid rgba(100, 116, 139, 0.3)',
        'border-radius': '8px',
        padding: expanded() ? '12px' : '6px 10px',
        'color': '#e2e8f0',
        'min-width': expanded() ? '280px' : 'auto',
        'backdrop-filter': 'blur(8px)',
        'user-select': 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(!expanded())}
      >
        <div style={{
          width: '8px',
          height: '8px',
          'border-radius': '50%',
          background: statusColor(),
          'flex-shrink': 0,
        }} />
        <span style={{ 'font-weight': 600 }}>
          Backdoor
        </span>
        <Show when={state().status === 'running'}>
          <span style={{ color: '#f59e0b' }}>testing...</span>
        </Show>
        <Show when={state().status === 'success' && state().totalMs != null}>
          <span style={{ color: '#10b981' }}>{state().totalMs}ms</span>
        </Show>
        <Show when={state().status === 'failed'}>
          <span style={{ color: '#ef4444', 'font-size': '10px' }}>FAIL</span>
        </Show>
        <span style={{ 'margin-left': 'auto', opacity: 0.5, 'font-size': '10px' }}>
          {expanded() ? '▼' : '▲'}
        </span>
      </div>

      <Show when={expanded()}>
        <div style={{ 'margin-top': '8px', display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button
              onClick={handleRunTest}
              disabled={state().status === 'running'}
              style={{
                'flex': 1,
                padding: '4px 8px',
                'font-size': '11px',
                'font-family': 'monospace',
                background: state().status === 'running' ? '#374151' : '#1e40af',
                color: state().status === 'running' ? '#6b7280' : '#e2e8f0',
                border: 'none',
                'border-radius': '4px',
                cursor: state().status === 'running' ? 'not-allowed' : 'pointer',
              }}
            >
              {state().status === 'running' ? 'Running...' : 'Chat Test'}
            </button>
            <button
              onClick={handleCheckHealth}
              style={{
                padding: '4px 8px',
                'font-size': '11px',
                'font-family': 'monospace',
                background: '#374151',
                color: '#e2e8f0',
                border: 'none',
                'border-radius': '4px',
                cursor: 'pointer',
              }}
            >
              Health
            </button>
          </div>

          <Show when={state().uptimeMs != null}>
            <div>Uptime: {((state().uptimeMs ?? 0) / 1000).toFixed(1)}s</div>
          </Show>
          <Show when={state().memoryBytes != null}>
            <div>Memory: {formatBytes(state().memoryBytes ?? 0)}</div>
          </Show>
          <Show when={state().totalMs != null}>
            <div>Chat latency: {state().totalMs}ms</div>
          </Show>
          <Show when={state().assistantContent != null && state().assistantContent !== ''}>
            <div style={{
              'max-height': '60px',
              overflow: 'hidden',
              'text-overflow': 'ellipsis',
              'white-space': 'nowrap',
              color: '#94a3b8',
            }}>
              Reply: {state().assistantContent}
            </div>
          </Show>
          <Show when={state().error != null}>
            <div style={{ color: '#ef4444', 'word-break': 'break-all' }}>
              Error: {state().error}
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
