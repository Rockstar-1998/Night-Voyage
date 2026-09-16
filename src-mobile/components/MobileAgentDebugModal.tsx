import { Component, For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { listen } from '@tauri-apps/api/event';
import type { DataContainer, DiceRollResult } from '../../src/lib/backend/types';
import {
  sessionGameStateGet,
  sessionGameStateReset,
  sessionToolCallExecute,
  agentDiceRoll,
} from '../../src/lib/backend/game_state';

interface MobileAgentDebugModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId?: number;
}

interface TimelineEvent {
  id: string;
  time: string;
  title: string;
  detail: string;
  status: 'success' | 'blocked' | 'info';
}

export const MobileAgentDebugModal: Component<MobileAgentDebugModalProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<'timeline' | 'container' | 'tools'>('timeline');
  const [container, setContainer] = createSignal<DataContainer | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [timeline, setTimeline] = createSignal<TimelineEvent[]>([]);
  const [toolResult, setToolResult] = createSignal<string | null>(null);
  const [diceResult, setDiceResult] = createSignal<DiceRollResult | null>(null);

  const [toolName, setToolName] = createSignal('buy_item');
  const [toolArgs, setToolArgs] = createSignal('{"item_id": "health_potion", "count": 1, "cost": 50, "weight": 2}');

  const [skill, setSkill] = createSignal('感知');
  const [dc, setDc] = createSignal(12);
  const [mod, setMod] = createSignal(2);

  const loadState = async () => {
    if (!props.conversationId) return;
    setLoading(true);
    try {
      const s = await sessionGameStateGet(props.conversationId);
      setContainer(s);
      setErrorMessage(null);
    } catch (e: any) {
      setErrorMessage(String(e));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (props.isOpen && props.conversationId) {
      void loadState();
    }
  });

  onMount(() => {
    const unlistenPromise = listen<any>('session:hud_state_patch', (event) => {
      const patch = event.payload;
      if (props.conversationId && patch.sessionId && patch.sessionId !== props.conversationId) {
        return;
      }
      const statsCount = Object.keys(patch.stats || {}).length;
      const invCount = patch.inventory ? patch.inventory.length : 0;
      const flagsCount = Object.keys(patch.flags || {}).length;

      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        title: 'HUD 增量补丁广播',
        detail: `更新: stats(${statsCount}) | inventory(${invCount}) | flags(${flagsCount})`,
        status: 'info',
      };
      setTimeline((prev) => [newEv, ...prev]);

      if (props.isOpen && props.conversationId) {
        void loadState();
      }
    });

    onCleanup(() => {
      unlistenPromise.then((unlisten) => unlisten());
    });
  });

  const handleExecuteTool = async () => {
    if (!props.conversationId) return;
    setLoading(true);
    try {
      const res = await sessionToolCallExecute(props.conversationId, toolName(), toolArgs());
      setToolResult(res);
      await loadState();

      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        title: `ToolCall: ${toolName()}`,
        detail: res,
        status: res.includes('拦截') || res.includes('不足') ? 'blocked' : 'success',
      };
      setTimeline((prev) => [newEv, ...prev]);
    } catch (e: any) {
      setToolResult(`错误: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDiceRoll = async () => {
    try {
      const res = await agentDiceRoll(skill(), Number(dc()), Number(mod()));
      setDiceResult(res);

      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        title: `D20 骰点: ${res.skill} (DC ${res.dc})`,
        detail: `${res.formula} = ${res.total} [${res.summary}]`,
        status: res.isSuccess ? 'success' : 'blocked',
      };
      setTimeline((prev) => [newEv, ...prev]);
    } catch (e: any) {
      setErrorMessage(String(e));
    }
  };

  const handleResetState = async () => {
    if (!props.conversationId) return;
    try {
      const s = await sessionGameStateReset(props.conversationId);
      setContainer(s);
      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        title: '会话状态重置',
        detail: '清空会话数据容器',
        status: 'info',
      };
      setTimeline((prev) => [newEv, ...prev]);
    } catch (e: any) {
      setErrorMessage(String(e));
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/70 backdrop-blur-sm animate-fadeIn">
        <div class="w-full max-h-[85vh] bg-xuanqing border-t border-white/10 rounded-t-2xl flex flex-col overflow-hidden shadow-2xl">
          {/* Header */}
          <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <div>
              <div class="text-sm font-bold text-white">时序泳道与规则调试</div>
              <div class="text-[10px] text-mist-solid/40">会话: #{props.conversationId}</div>
            </div>
            <button
              onClick={props.onClose}
              class="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 text-white font-bold"
            >
              ✕
            </button>
          </div>

          {/* Tabs */}
          <div class="flex border-b border-white/10 bg-black/20">
            <button
              onClick={() => setActiveTab('timeline')}
              class={`flex-1 py-2 text-xs font-semibold text-center border-b-2 transition-colors ${
                activeTab() === 'timeline' ? 'border-accent text-accent' : 'border-transparent text-mist-solid/50'
              }`}
            >
              时序泳道
            </button>
            <button
              onClick={() => {
                setActiveTab('container');
                loadState();
              }}
              class={`flex-1 py-2 text-xs font-semibold text-center border-b-2 transition-colors ${
                activeTab() === 'container' ? 'border-accent text-accent' : 'border-transparent text-mist-solid/50'
              }`}
            >
              数据容器
            </button>
            <button
              onClick={() => setActiveTab('tools')}
              class={`flex-1 py-2 text-xs font-semibold text-center border-b-2 transition-colors ${
                activeTab() === 'tools' ? 'border-accent text-accent' : 'border-transparent text-mist-solid/50'
              }`}
            >
              Tool/骰点测试
            </button>
          </div>

          {/* Tab Contents */}
          <div class="flex-1 overflow-y-auto p-4 space-y-4">
            <Show when={errorMessage()}>
              <div class="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {errorMessage()}
              </div>
            </Show>

            {/* Timeline */}
            <Show when={activeTab() === 'timeline'}>
              <div class="space-y-2 text-xs">
                <div class="flex items-center justify-between px-1">
                  <span class="text-[11px] text-mist-solid/40 font-mono">
                    动作流水线 ({timeline().length})
                  </span>
                  <Show when={timeline().length > 0}>
                    <button
                      type="button"
                      onClick={() => setTimeline([])}
                      class="text-[10px] text-mist-solid/40 hover:text-rose-400"
                    >
                      清空流水
                    </button>
                  </Show>
                </div>
                <Show
                  when={timeline().length > 0}
                  fallback={
                    <div class="py-10 px-4 text-center border border-dashed border-white/10 rounded-xl space-y-1">
                      <div class="text-xs font-semibold text-mist-solid/60">暂无运行时动作记录</div>
                      <div class="text-[10px] text-mist-solid/40">
                        会话运行时事件将在此处实时显示
                      </div>
                    </div>
                  }
                >
                  <For each={timeline()}>
                    {(ev) => (
                      <div class="p-3 rounded-lg bg-white/[0.03] border border-white/5 space-y-1">
                        <div class="flex justify-between items-center">
                          <span
                            class={`font-bold ${
                              ev.status === 'success'
                                ? 'text-emerald-400'
                                : ev.status === 'blocked'
                                ? 'text-rose-400'
                                : 'text-cyan-400'
                            }`}
                          >
                            {ev.title}
                          </span>
                          <span class="text-[10px] text-mist-solid/40 font-normal">{ev.time}</span>
                        </div>
                        <div class="text-mist-solid/70 font-mono text-[11px] leading-relaxed">{ev.detail}</div>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </Show>

            {/* Container */}
            <Show when={activeTab() === 'container'}>
              <div class="space-y-3 text-xs">
                <div class="flex justify-between items-center">
                  <span class="text-mist-solid/50">当前内存容器</span>
                  <button
                    onClick={handleResetState}
                    class="px-2 py-1 rounded bg-rose-500/20 text-rose-300 text-[11px]"
                  >
                    重置数据
                  </button>
                </div>

                <div class="p-3 rounded-lg bg-black/40 border border-white/5 space-y-1">
                  <div class="font-bold text-accent">Stats</div>
                  <div class="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                    <For each={Object.entries(container()?.stats || {})}>
                      {([k, v]) => (
                        <div class="flex justify-between bg-white/[0.02] p-1.5 rounded">
                          <span class="text-mist-solid/60">{k}</span>
                          <span class="text-white font-bold">{v}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>

                <div class="p-3 rounded-lg bg-black/40 border border-white/5 space-y-1">
                  <div class="font-bold text-amber-400">Inventory ({container()?.inventory.length || 0})</div>
                  <div class="space-y-1 font-mono text-[11px]">
                    <For each={container()?.inventory || []}>
                      {(item) => (
                        <div class="flex justify-between items-center bg-white/[0.02] p-1.5 rounded">
                          <span>{item.icon || '🎒'} {item.name}</span>
                          <span class="text-cyan-400 font-bold">x{item.count}</span>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </Show>

            {/* Tools / D20 */}
            <Show when={activeTab() === 'tools'}>
              <div class="space-y-4 text-xs">
                {/* Tool call */}
                <div class="p-3 rounded-lg bg-black/30 border border-white/5 space-y-2">
                  <div class="font-bold text-sky-400">手动 ToolCall</div>
                  <input
                    type="text"
                    value={toolName()}
                    onInput={(e) => setToolName(e.currentTarget.value)}
                    class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-white"
                  />
                  <textarea
                    rows={2}
                    value={toolArgs()}
                    onInput={(e) => setToolArgs(e.currentTarget.value)}
                    class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 font-mono text-white"
                  />
                  <button
                    onClick={handleExecuteTool}
                    disabled={loading()}
                    class="w-full py-1.5 bg-sky-500/20 text-sky-300 font-bold rounded"
                  >
                    执行
                  </button>
                  <Show when={toolResult()}>
                    <div class="p-2 rounded bg-black/50 text-[11px] font-mono text-mist-solid">
                      {toolResult()}
                    </div>
                  </Show>
                </div>

                {/* D20 */}
                <div class="p-3 rounded-lg bg-black/30 border border-white/5 space-y-2">
                  <div class="font-bold text-amber-400">D20 骰点检定</div>
                  <div class="flex gap-2">
                    <input
                      type="text"
                      value={skill()}
                      onInput={(e) => setSkill(e.currentTarget.value)}
                      placeholder="技能"
                      class="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1 text-white"
                    />
                    <input
                      type="number"
                      value={dc()}
                      onInput={(e) => setDc(Number(e.currentTarget.value))}
                      placeholder="DC"
                      class="w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-white"
                    />
                    <input
                      type="number"
                      value={mod()}
                      onInput={(e) => setMod(Number(e.currentTarget.value))}
                      placeholder="Mod"
                      class="w-16 bg-black/40 border border-white/10 rounded px-2 py-1 text-white"
                    />
                  </div>
                  <button
                    onClick={handleDiceRoll}
                    class="w-full py-1.5 bg-amber-500/20 text-amber-300 font-bold rounded"
                  >
                    掷骰
                  </button>
                  <Show when={diceResult()}>
                    <div class="flex justify-between p-2 rounded bg-black/50 text-[11px] font-mono">
                      <span>{diceResult()?.formula} = {diceResult()?.total}</span>
                      <span class={diceResult()?.isSuccess ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                        {diceResult()?.summary}
                      </span>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
