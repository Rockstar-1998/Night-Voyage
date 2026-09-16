import { Component, For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { listen } from '@tauri-apps/api/event';
import { X, Wrench, ShieldAlert, Calculator, RefreshCw, Terminal } from '../../lib/icons';
import type { DataContainer, DiceRollResult } from '../../lib/backend/types';
import {
  sessionGameStateGet,
  sessionGameStateReset,
  sessionToolCallExecute,
  agentDiceRoll,
  agentValidateBannedWords,
} from '../../lib/backend/game_state';

interface AgentDebugDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId?: number;
}

interface TimelineEvent {
  id: string;
  time: string;
  kind: 'tool_call' | 'gate' | 'calc' | 'hud_patch' | 'schema_prune';
  title: string;
  detail: string;
  status: 'success' | 'blocked' | 'info';
}

export const AgentDebugDrawer: Component<AgentDebugDrawerProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<'timeline' | 'container' | 'tools'>('timeline');
  const [container, setContainer] = createSignal<DataContainer | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);

  // 运行态事件泳道（初始为空，由实际操作与事件驱动，禁止伪造假日志）
  const [timeline, setTimeline] = createSignal<TimelineEvent[]>([]);

  // 调试工具执行状态
  const [customToolName, setCustomToolName] = createSignal('buy_item');
  const [customToolArgs, setCustomToolArgs] = createSignal('{"item_id": "health_potion", "count": 1, "cost": 50, "weight": 2}');
  const [toolResult, setToolResult] = createSignal<string | null>(null);

  // 骰点与禁词测试
  const [diceSkill, setDiceSkill] = createSignal('察觉');
  const [diceDc, setDiceDc] = createSignal(12);
  const [diceMod, setDiceMod] = createSignal(3);
  const [diceResult, setDiceResult] = createSignal<DiceRollResult | null>(null);

  const [bannedTestText, setBannedTestText] = createSignal('');
  const [bannedResult, setBannedResult] = createSignal<string | null>(null);

  const loadState = async () => {
    if (!props.sessionId) return;
    setLoading(true);
    try {
      const s = await sessionGameStateGet(props.sessionId);
      setContainer(s);
      setErrorMessage(null);
    } catch (e: any) {
      setErrorMessage(String(e));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    if (props.isOpen && props.sessionId) {
      void loadState();
    }
  });

  onMount(() => {
    // 监听 Ctrl+Shift+D 快捷键
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        e.preventDefault();
        if (props.isOpen) {
          props.onClose();
        } else {
          // Trigger open via custom event or parent
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    // 监听 session:hud_state_patch 事件
    const unlistenPromise = listen<any>('session:hud_state_patch', (event) => {
      const patch = event.payload;
      if (props.sessionId && patch.sessionId && patch.sessionId !== props.sessionId) {
        return;
      }
      const statsCount = Object.keys(patch.stats || {}).length;
      const invCount = patch.inventory ? patch.inventory.length : 0;
      const flagsCount = Object.keys(patch.flags || {}).length;

      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        kind: 'hud_patch',
        title: '广播 HUD 增量补丁 (session:hud_state_patch)',
        detail: `状态增量同步: stats(${statsCount}) | inventory(${invCount}) | flags(${flagsCount})`,
        status: 'info',
      };
      setTimeline((prev) => [newEv, ...prev]);

      if (props.isOpen && props.sessionId) {
        void loadState();
      }
    });

    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
      unlistenPromise.then((unlisten) => unlisten());
    });
  });

  const handleResetState = async () => {
    if (!props.sessionId) return;
    try {
      const s = await sessionGameStateReset(props.sessionId);
      setContainer(s);
      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        kind: 'hud_patch',
        title: '会话状态重置 (session_game_state_reset)',
        detail: '清空会话数据容器，重置为默认初始状态',
        status: 'info',
      };
      setTimeline((prev) => [newEv, ...prev]);
    } catch (e: any) {
      setErrorMessage(String(e));
    }
  };

  const handleExecuteTool = async () => {
    if (!props.sessionId) return;
    setLoading(true);
    setToolResult(null);
    try {
      const res = await sessionToolCallExecute(props.sessionId, customToolName(), customToolArgs());
      setToolResult(res);
      await loadState();

      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        kind: 'tool_call',
        title: `手动 ToolCall 触发: ${customToolName()}`,
        detail: res,
        status: res.includes('拦截') || res.includes('不足') ? 'blocked' : 'success',
      };
      setTimeline((prev) => [newEv, ...prev]);
    } catch (e: any) {
      setToolResult(`执行失败: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleRollDice = async () => {
    try {
      const res = await agentDiceRoll(diceSkill(), Number(diceDc()), Number(diceMod()));
      setDiceResult(res);
      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        kind: 'gate',
        title: `D20 骰点检定: ${res.skill} (DC ${res.dc})`,
        detail: `${res.formula} = ${res.total} [${res.summary}]`,
        status: res.isSuccess ? 'success' : 'blocked',
      };
      setTimeline((prev) => [newEv, ...prev]);
    } catch (e: any) {
      setErrorMessage(String(e));
    }
  };

  const handleTestBanned = async () => {
    try {
      await agentValidateBannedWords(bannedTestText(), []);
      setBannedResult('✅ 校验通过：未命中任何安全与违规词库');
      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        kind: 'gate',
        title: '禁词门禁校验 (通过)',
        detail: `校验文本: "${bannedTestText().slice(0, 30)}" - 未命中任何安全与违规词库`,
        status: 'success',
      };
      setTimeline((prev) => [newEv, ...prev]);
    } catch (e: any) {
      setBannedResult(`🚫 校验阻断：${e}`);
      const newEv: TimelineEvent = {
        id: String(Date.now()),
        time: new Date().toLocaleTimeString(),
        kind: 'gate',
        title: '禁词门禁校验 (阻断)',
        detail: `校验文本: "${bannedTestText().slice(0, 30)}" - 触发安全拦截: ${e}`,
        status: 'blocked',
      };
      setTimeline((prev) => [newEv, ...prev]);
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm transition-all animate-fadeIn">
        <div class="w-full max-w-xl h-full bg-night-sky border-l border-white/10 shadow-2xl flex flex-col">
          {/* Header */}
          <div class="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-lg bg-accent/10 text-accent">
                <Terminal size={18} />
              </div>
              <div>
                <h2 class="text-sm font-bold text-white tracking-wide">Agent 运行态与时序调试泳道</h2>
                <p class="text-[11px] text-mist-solid/40">会话 ID: {props.sessionId ?? '无活动会话'}</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button
                onClick={loadState}
                class="p-1.5 rounded-md hover:bg-white/10 text-mist-solid/60 hover:text-white transition-colors"
                title="刷新状态"
              >
                <RefreshCw size={15} />
              </button>
              <button
                onClick={props.onClose}
                class="p-1.5 rounded-md hover:bg-white/10 text-mist-solid/60 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* 标签栏 */}
          <div class="flex border-b border-white/10 px-6 bg-black/20">
            <button
              onClick={() => setActiveTab('timeline')}
              class={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-colors ${
                activeTab() === 'timeline'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-mist-solid/60 hover:text-white'
              }`}
            >
              生命周期泳道 (Timeline)
            </button>
            <button
              onClick={() => {
                setActiveTab('container');
                loadState();
              }}
              class={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-colors ${
                activeTab() === 'container'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-mist-solid/60 hover:text-white'
              }`}
            >
              数据容器快照 (DataContainer)
            </button>
            <button
              onClick={() => setActiveTab('tools')}
              class={`py-2.5 px-4 text-xs font-semibold border-b-2 transition-colors ${
                activeTab() === 'tools'
                  ? 'border-accent text-accent'
                  : 'border-transparent text-mist-solid/60 hover:text-white'
              }`}
            >
              规则与门禁测试器
            </button>
          </div>

          {/* 内容区 */}
          <div class="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
            <Show when={errorMessage()}>
              <div class="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {errorMessage()}
              </div>
            </Show>

            {/* Tab 1: 时序生命周期泳道 */}
            <Show when={activeTab() === 'timeline'}>
              <div class="space-y-3">
                <div class="flex items-center justify-between">
                  <span class="text-[11px] text-mist-solid/40 uppercase tracking-wider font-mono">
                    最近动作流水线事件 ({timeline().length})
                  </span>
                  <Show when={timeline().length > 0}>
                    <button
                      type="button"
                      onClick={() => setTimeline([])}
                      class="text-[11px] text-mist-solid/40 hover:text-rose-400 transition-colors"
                      title="清空流水线记录"
                    >
                      清空流水
                    </button>
                  </Show>
                </div>
                <Show
                  when={timeline().length > 0}
                  fallback={
                    <div class="py-12 px-4 text-center border border-dashed border-white/10 rounded-xl space-y-2">
                      <div class="text-xs font-semibold text-mist-solid/60">暂无运行时动作流水记录</div>
                      <div class="text-[11px] text-mist-solid/40 max-w-sm mx-auto leading-relaxed">
                        当会话触发 ToolCall 调度、ConditionGate 门禁判定、D20 骰点检定或 HUD 增量补丁广播时，将在此处实时流水记录。
                      </div>
                    </div>
                  }
                >
                  <div class="space-y-3 border-l-2 border-white/10 pl-4 ml-2">
                    <For each={timeline()}>
                      {(ev) => (
                        <div class="relative group">
                          <div
                            class={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full ring-4 ring-night-sky ${
                              ev.status === 'success'
                                ? 'bg-emerald-400'
                                : ev.status === 'blocked'
                                ? 'bg-rose-500'
                                : 'bg-cyan-400'
                            }`}
                          />
                          <div class="p-3 rounded-lg bg-white/[0.03] border border-white/5 space-y-1 hover:border-white/15 transition-all">
                            <div class="flex items-center justify-between">
                              <span class="text-xs font-bold text-white">{ev.title}</span>
                              <span class="text-[10px] font-mono text-mist-solid/40">{ev.time}</span>
                            </div>
                            <p class="text-xs text-mist-solid/70 font-mono leading-relaxed">{ev.detail}</p>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Tab 2: 数据容器快照 */}
            <Show when={activeTab() === 'container'}>
              <div class="space-y-4">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-mist-solid/60">实时内存状态（同步写入 SQLite session_states）</span>
                  <button
                    onClick={handleResetState}
                    class="px-2.5 py-1 text-xs text-rose-400 hover:text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded hover:bg-rose-500/20 transition-all"
                  >
                    重置初始状态
                  </button>
                </div>

                <Show when={container()} fallback={<div class="text-xs text-mist-solid/40">加载中或无状态...</div>}>
                  {/* 数值 Stats */}
                  <div class="p-3 rounded-lg bg-black/30 border border-white/5 space-y-2">
                    <div class="text-xs font-bold text-accent">Stats 键值表</div>
                    <div class="grid grid-cols-2 gap-2 text-xs font-mono">
                      <For each={Object.entries(container()?.stats || {})}>
                        {([k, v]) => (
                          <div class="p-2 rounded bg-white/[0.02] border border-white/5 flex justify-between">
                            <span class="text-mist-solid/60">{k}:</span>
                            <span class="text-white font-bold">{v}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>

                  {/* 背包 Inventory */}
                  <div class="p-3 rounded-lg bg-black/30 border border-white/5 space-y-2">
                    <div class="text-xs font-bold text-amber-400">Inventory 道具清单 ({container()?.inventory.length})</div>
                    <div class="space-y-2">
                      <For each={container()?.inventory || []}>
                        {(item) => (
                          <div class="p-2.5 rounded bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs">
                            <div class="flex items-center gap-2">
                              <span class="text-base">{item.icon || '📦'}</span>
                              <div>
                                <div class="font-bold text-white">{item.name}</div>
                                <div class="text-[10px] text-mist-solid/40">ID: {item.id} | 重量: {item.unitWeight} | 单价: {item.unitPrice}</div>
                              </div>
                            </div>
                            <span class="font-mono font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/20">
                              x{item.count}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>

                  {/* 标记 Flags */}
                  <div class="p-3 rounded-lg bg-black/30 border border-white/5 space-y-2">
                    <div class="text-xs font-bold text-purple-400">Flags 状态标记</div>
                    <div class="flex flex-wrap gap-2 text-xs font-mono">
                      <For each={Object.entries(container()?.flags || {})}>
                        {([k, v]) => (
                          <span class="px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20 text-purple-300">
                            {k} = {v}
                          </span>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Tab 3: 工具与门禁测试器 */}
            <Show when={activeTab() === 'tools'}>
              <div class="space-y-6">
                {/* 手动 ToolCall 触发器 */}
                <div class="p-4 rounded-xl bg-white/[0.02] border border-white/10 space-y-3">
                  <div class="flex items-center gap-2 text-xs font-bold text-sky-400">
                    <Wrench size={16} />
                    <span>原子 ToolCall 触发测试 (Rust 确定性执行)</span>
                  </div>
                  <div class="space-y-1">
                    <label class="text-[10px] text-mist-solid/40 uppercase">工具名称</label>
                    <input
                      type="text"
                      value={customToolName()}
                      onInput={(e) => setCustomToolName(e.currentTarget.value)}
                      class="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white"
                    />
                  </div>
                  <div class="space-y-1">
                    <label class="text-[10px] text-mist-solid/40 uppercase">参数 JSON</label>
                    <textarea
                      rows={3}
                      value={customToolArgs()}
                      onInput={(e) => setCustomToolArgs(e.currentTarget.value)}
                      class="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs font-mono text-white"
                    />
                  </div>
                  <button
                    onClick={handleExecuteTool}
                    disabled={loading()}
                    class="w-full py-2 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 rounded text-xs font-bold text-sky-300 transition-all"
                  >
                    执行 ToolCall 并广播 HUD 补丁
                  </button>
                  <Show when={toolResult()}>
                    <div class="p-2.5 rounded bg-black/50 border border-white/10 text-xs font-mono text-mist-solid leading-relaxed">
                      {toolResult()}
                    </div>
                  </Show>
                </div>

                {/* D20 骰点检定 */}
                <div class="p-4 rounded-xl bg-white/[0.02] border border-white/10 space-y-3">
                  <div class="flex items-center gap-2 text-xs font-bold text-amber-400">
                    <Calculator size={16} />
                    <span>确定性 SplitMix64 D20 随机骰点检定</span>
                  </div>
                  <div class="grid grid-cols-3 gap-2">
                    <div>
                      <label class="text-[10px] text-mist-solid/40 uppercase">技能名称</label>
                      <input
                        type="text"
                        value={diceSkill()}
                        onInput={(e) => setDiceSkill(e.currentTarget.value)}
                        class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label class="text-[10px] text-mist-solid/40 uppercase">难度 DC</label>
                      <input
                        type="number"
                        value={diceDc()}
                        onInput={(e) => setDiceDc(Number(e.currentTarget.value))}
                        class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label class="text-[10px] text-mist-solid/40 uppercase">调整值 Modifier</label>
                      <input
                        type="number"
                        value={diceMod()}
                        onInput={(e) => setDiceMod(Number(e.currentTarget.value))}
                        class="w-full bg-black/40 border border-white/10 rounded px-2 py-1 text-xs text-white"
                      />
                    </div>
                  </div>
                  <button
                    onClick={handleRollDice}
                    class="w-full py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 rounded text-xs font-bold text-amber-300 transition-all"
                  >
                    掷出 D20 骰点
                  </button>
                  <Show when={diceResult()}>
                    <div class="p-2.5 rounded bg-black/50 border border-white/10 text-xs font-mono flex items-center justify-between">
                      <span class="text-white">{diceResult()?.formula} = {diceResult()?.total}</span>
                      <span class={diceResult()?.isSuccess ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                        {diceResult()?.summary}
                      </span>
                    </div>
                  </Show>
                </div>

                {/* 禁词 Aho-Corasick 扫描 */}
                <div class="p-4 rounded-xl bg-white/[0.02] border border-white/10 space-y-3">
                  <div class="flex items-center gap-2 text-xs font-bold text-rose-400">
                    <ShieldAlert size={16} />
                    <span>Aho-Corasick 禁词门禁校验扫描</span>
                  </div>
                  <input
                    type="text"
                    value={bannedTestText()}
                    onInput={(e) => setBannedTestText(e.currentTarget.value)}
                    placeholder="输入测试文本..."
                    class="w-full bg-black/40 border border-white/10 rounded px-3 py-1.5 text-xs text-white"
                  />
                  <button
                    onClick={handleTestBanned}
                    class="w-full py-1.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 rounded text-xs font-bold text-rose-300 transition-all"
                  >
                    扫描违规词
                  </button>
                  <Show when={bannedResult()}>
                    <div class="p-2 rounded bg-black/50 border border-white/10 text-xs font-mono text-mist-solid">
                      {bannedResult()}
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
