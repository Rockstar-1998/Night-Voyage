import { Component, Show, createSignal } from 'solid-js';
import { conversationsList } from '../../lib/backend/conversations';
import { messagesList } from '../../lib/backend/messages';
import {
  sessionGameStateGet,
  sessionGameStateReset,
  sessionToolCallExecute,
} from '../../lib/backend/game_state';

interface McpDebugPanelProps {
  sessionId?: number;
}

/**
 * MCP 调试台：把验收演示用到的工具能力挂载为前端真实按钮。
 *
 * 每个按钮调用与 MCP 工具完全相同的后端命令（`conversations_list` / `messages_list` /
 * `session_game_state_*` / `session_tool_call_execute`），因此界面触发与 MCP 触发落在
 * 同一条 service 路径上：门禁、持久化、HUD 广播行为一致。所有失败显式展示（C2），
 * 所有调用异步执行（C3）。
 *
 * 本组件不内置任何游戏数据或预设参数（C11）：契约名与参数 JSON 一律由使用者输入，
 * 可选值清单等真实数据源（如契约名列表命令）出现后再挂 UI。
 */
export const McpDebugPanel: Component<McpDebugPanelProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [output, setOutput] = createSignal('');
  const [outputIsError, setOutputIsError] = createSignal(false);
  const [toolName, setToolName] = createSignal('');
  const [argumentsJson, setArgumentsJson] = createSignal('');

  const showResult = (label: string, result: unknown) => {
    setOutputIsError(false);
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    setOutput(`[${label}]\n${text}`);
  };

  const showError = (label: string, err: unknown) => {
    setOutputIsError(true);
    setOutput(`[${label}] 失败\n${err instanceof Error ? err.message : String(err)}`);
  };

  const run = (label: string, fn: () => Promise<unknown>) => {
    if (busy()) return;
    setBusy(true);
    void fn()
      .then((result) => showResult(label, result))
      .catch((err) => showError(label, err))
      .finally(() => setBusy(false));
  };

  /** 依赖当前会话的按钮共用这个守卫：没有会话就显式报错，不静默。 */
  const requireSession = (label: string): number | null => {
    const id = props.sessionId;
    if (id == null) {
      setOutputIsError(true);
      setOutput(`[${label}] 失败\n未选中任何会话（sessionId 为空）。请先在左侧选择一个会话。`);
      return null;
    }
    return id;
  };

  const runToolCall = () => {
    const id = requireSession('session_tool_call_execute');
    if (id == null) return;
    if (!toolName().trim()) {
      setOutputIsError(true);
      setOutput('[session_tool_call_execute] 失败\ntoolName 为空。请先填入 ToolCall 契约名。');
      return;
    }
    run('session_tool_call_execute', () =>
      sessionToolCallExecute(id, toolName().trim(), argumentsJson()),
    );
  };

  const chip = 'px-2 py-0.5 rounded border text-[10px] font-mono transition-colors';
  const chipIdle =
    'border-slate-600 text-slate-300 hover:border-cyan-500/60 hover:text-cyan-300 hover:bg-cyan-500/10';
  const chipActive = 'border-slate-700 text-slate-500 cursor-not-allowed opacity-60';

  return (
    <>
      {/* 触发按钮：固定悬浮，任何界面都可达 */}
      <button
        class="fixed bottom-4 left-4 z-40 rounded-full border border-cyan-500/40 bg-slate-900/90 px-3 py-1.5 text-[11px] font-mono text-cyan-300 shadow-lg backdrop-blur transition-colors hover:border-cyan-400 hover:bg-cyan-500/15"
        onClick={() => setOpen(!open())}
        title="MCP 调试台：与 MCP 工具同路径的前端按钮"
      >
        {open() ? '[×] MCP 调试台' : '[MCP] 调试台'}
      </button>

      <Show when={open()}>
        <div class="fixed bottom-14 left-4 z-40 flex max-h-[70vh] w-[420px] flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900/95 shadow-2xl backdrop-blur">
          <div class="flex items-center justify-between border-b border-slate-700/70 px-3 py-2">
            <span class="text-[11px] font-bold uppercase tracking-widest text-slate-400">
              MCP 调试台 · session {props.sessionId ?? 'N/A'}
            </span>
            <button class="text-[11px] text-slate-500 hover:text-slate-200" onClick={() => setOpen(false)}>
              关闭
            </button>
          </div>

          <div class="flex flex-col gap-3 overflow-y-auto p-3">
            {/* 数据读取 */}
            <div class="flex flex-wrap gap-1.5">
              <button class={`${chip} ${busy() ? chipActive : chipIdle}`} disabled={busy()}
                onClick={() => run('conversations_list', () => conversationsList())}>
                会话列表
              </button>
              <button class={`${chip} ${busy() ? chipActive : chipIdle}`} disabled={busy()}
                onClick={() => {
                  const id = requireSession('messages_list');
                  if (id == null) return;
                  run('messages_list', () => messagesList(id, 50));
                }}>
                消息列表
              </button>
              <button class={`${chip} ${busy() ? chipActive : chipIdle}`} disabled={busy()}
                onClick={() => {
                  const id = requireSession('session_game_state_get');
                  if (id == null) return;
                  run('session_game_state_get', () => sessionGameStateGet(id));
                }}>
                读取状态
              </button>
              <button class={`${chip} ${busy() ? chipActive : chipIdle}`} disabled={busy()}
                onClick={() => {
                  const id = requireSession('session_game_state_reset');
                  if (id == null) return;
                  run('session_game_state_reset', () => sessionGameStateReset(id));
                }}
                title="重置为默认状态并广播 HUD——上方状态面板会当场刷新">
                重置状态 (HUD)
              </button>
            </div>

            {/* ToolCall 契约执行 */}
            <div class="rounded-lg border border-slate-700/70 p-2">
              <div class="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                ToolCall 契约（门禁 + 持久化 + HUD 广播）
              </div>
              <input
                class="mb-1.5 w-full rounded border border-slate-700 bg-slate-800/80 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none focus:border-cyan-500/60"
                value={toolName()}
                onInput={(e) => setToolName(e.currentTarget.value)}
                placeholder="ToolCall 契约名"
              />
              <textarea
                class="mb-1.5 h-16 w-full resize-y rounded border border-slate-700 bg-slate-800/80 px-2 py-1 font-mono text-[11px] text-slate-200 outline-none focus:border-cyan-500/60"
                value={argumentsJson()}
                onInput={(e) => setArgumentsJson(e.currentTarget.value)}
                placeholder="参数 JSON 对象"
              />
              <button
                class={`${chip} w-full ${busy() ? chipActive : 'border-amber-500/60 text-amber-300 hover:bg-amber-500/10'}`}
                disabled={busy()}
                onClick={runToolCall}
              >
                {busy() ? '执行中…' : '执行 session_tool_call_execute'}
              </button>
            </div>

            {/* 输出区：失败显式红显，成功原文展示 */}
            <Show when={output()}>
              <div
                class={`max-h-48 overflow-y-auto whitespace-pre-wrap break-all rounded-lg border p-2 font-mono text-[11px] leading-relaxed ${
                  outputIsError()
                    ? 'border-rose-500/50 bg-rose-500/10 text-rose-200'
                    : 'border-slate-700 bg-slate-800/60 text-slate-300'
                }`}
                role={outputIsError() ? 'alert' : undefined}
              >
                {output()}
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </>
  );
};
