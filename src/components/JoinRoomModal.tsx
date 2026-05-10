import { Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { X, Radio, CheckCircle2, AlertCircle, Loader2, Copy, Check } from '../lib/icons';
import { IconButton } from './ui/IconButton';
import {
  roomJoin,
  roomLeave,
  listenRoomMemberJoined,
  listenRoomMemberLeft,
  listenRoomDisconnected,
  listenRoomError,
  listenRoomStreamChunk,
  listenRoomStreamEnd,
  listenRoomRoundStateUpdate,
  type RoomMemberJoinedEvent,
  type RoomStreamChunkEvent,
  type RoomStreamEndEvent,
  type RoomRoundStateUpdateEvent,
  type RoomJoinResult,
} from '../lib/backend';
import type { UnlistenFn } from '@tauri-apps/api/event';

interface JoinRoomModalProps {
  isOpen: boolean;
  onClose: () => void;
  onJoined?: (
    result: RoomJoinResult,
    connection: { hostAddress: string; port: number; displayName: string },
  ) => void;
  onLeft?: () => void;
}

type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'failed';

export const JoinRoomModal: Component<JoinRoomModalProps> = (props) => {
  const [hostAddress, setHostAddress] = createSignal('');
  const [port, setPort] = createSignal('');
  const [displayName, setDisplayName] = createSignal('');
  const [status, setStatus] = createSignal<ConnectionStatus>('idle');
  const [statusMessage, setStatusMessage] = createSignal('');
  const [members, setMembers] = createSignal<RoomMemberJoinedEvent[]>([]);
  const [copied, setCopied] = createSignal(false);

  let unlistens: UnlistenFn[] = [];

  const reset = () => {
    setHostAddress('');
    setPort('');
    setDisplayName('');
    setStatus('idle');
    setStatusMessage('');
    setMembers([]);
  };

  const setupListeners = async () => {
    const u1 = await listenRoomMemberJoined((payload) => {
      setMembers((prev) => {
        if (prev.some((m) => m.memberId === payload.memberId)) return prev;
        return [...prev, payload];
      });
    });
    const u2 = await listenRoomMemberLeft((payload) => {
      setMembers((prev) => prev.filter((m) => m.memberId !== payload.memberId));
    });
    const u3 = await listenRoomDisconnected(() => {
      setStatus('failed');
      setStatusMessage('与房间断开连接');
      setMembers([]);
    });
    const u4 = await listenRoomError((payload) => {
      const msg = typeof payload === 'string' ? payload : payload.message;
      setStatus('failed');
      setStatusMessage(msg);
    });
    const u5 = await listenRoomStreamChunk((payload: RoomStreamChunkEvent) => {
      console.debug('[room:stream_chunk]', payload);
    });
    const u6 = await listenRoomStreamEnd((payload: RoomStreamEndEvent) => {
      console.debug('[room:stream_end]', payload);
    });
    const u7 = await listenRoomRoundStateUpdate((payload: RoomRoundStateUpdateEvent) => {
      console.debug('[room:round_state_update]', payload);
    });

    unlistens = [u1, u2, u3, u4, u5, u6, u7];
  };

  onMount(() => {
    void setupListeners();
  });

  onCleanup(() => {
    unlistens.forEach((u) => u());
  });

  const handleJoin = async () => {
    const addr = hostAddress().trim();
    const p = Number(port());
    const name = displayName().trim();

    if (!addr || !Number.isFinite(p) || p <= 0 || p > 65535 || !name) {
      setStatus('failed');
      setStatusMessage('请填写有效的 IP 地址、端口和显示名称');
      return;
    }

    setStatus('connecting');
    setStatusMessage('正在连接房间...');
    try {
      const result = await roomJoin({ hostAddress: addr, port: p, displayName: name });
      if (result.success) {
        setStatus('connected');
        setStatusMessage('连接成功');
        setMembers((result.members ?? []).map((member) => ({
          memberId: member.id,
          displayName: member.displayName,
        })));
        props.onJoined?.(result, { hostAddress: addr, port: p, displayName: name });
        // Don't add a fake self-entry; the real MemberJoined event from the server
        // will arrive shortly via listenRoomMemberJoined and add the actual member.
      } else {
        setStatus('failed');
        setStatusMessage(result.message || '连接失败');
      }
    } catch (error) {
      setStatus('failed');
      setStatusMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const handleLeave = async () => {
    try {
      await roomLeave();
    } catch (error) {
      setStatus('failed');
      setStatusMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    reset();
    props.onLeft?.();
    props.onClose();
  };

  const handleClose = () => {
    if (status() !== 'connected') {
      reset();
    }
    props.onClose();
  };

  const copyAddress = async () => {
    const text = `${hostAddress()}:${port()}`;
    if (!text || text === ':') return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-[2000] flex flex-col bg-xuanqing/98 backdrop-blur-3xl animate-in fade-in duration-500">
        <div class="h-20 flex items-center justify-between px-6 md:px-10 border-b border-white/5">
          <div class="flex items-center gap-4">
            <div class="w-10 h-10 rounded-full bg-purple-500/20 flex items-center justify-center text-purple-400">
              <Radio size={20} class={status() === 'connecting' ? 'animate-pulse' : ''} />
            </div>
            <h2 class="text-xl font-bold text-white tracking-tight">加入远程会话房间</h2>
          </div>
          <IconButton onClick={handleClose} label="关闭加入房间面板" size="lg">
            <X size={18} />
          </IconButton>
        </div>

        <div class="flex-1 overflow-y-auto custom-scrollbar p-6 md:p-10">
          <div class="max-w-2xl mx-auto flex flex-col gap-8">
            <Show
              when={status() !== 'connected'}
              fallback={
                <div class="flex flex-col gap-6">
                  <div class="w-full bg-white/5 border border-white/5 p-8 md:p-12 rounded-[3rem] shadow-2xl relative overflow-hidden backdrop-blur-md text-center">
                    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 mb-4">
                      <CheckCircle2 size={32} />
                    </div>
                    <h1 class="text-2xl md:text-3xl font-black text-white mb-2">已加入房间</h1>
                    <p class="text-mist-solid/45 leading-relaxed mb-6">
                      你当前已连接到远程房间，可以等待房主开始新轮次。
                    </p>

                    <div class="flex items-center justify-center gap-3 mb-8">
                      <div class="px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-mist-solid/80">
                        {hostAddress()}:{port()}
                      </div>
                      <button
                        onClick={copyAddress}
                        class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-sm text-mist-solid/70 hover:bg-white/10 transition-colors"
                      >
                        {copied() ? <Check size={14} /> : <Copy size={14} />}
                        {copied() ? '已复制' : '复制地址'}
                      </button>
                    </div>

                    <div class="flex items-center justify-center gap-3">
                      <button
                        onClick={handleClose}
                        class="px-6 py-3 rounded-2xl bg-accent border border-accent/30 text-white hover:bg-accent/85 transition-colors text-sm font-medium"
                      >
                        {'\u8fdb\u5165\u804a\u5929'}
                      </button>
                      <button
                        onClick={() => void handleLeave()}
                        class="px-6 py-3 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/15 transition-colors text-sm font-medium"
                      >
                        离开房间
                      </button>
                    </div>
                  </div>

                  <div class="w-full bg-white/5 border border-white/5 p-6 rounded-3xl shadow-xl backdrop-blur-md">
                    <div class="flex items-center justify-between mb-4">
                      <h3 class="text-sm font-bold text-white uppercase tracking-widest">房间成员</h3>
                      <span class="text-xs text-mist-solid/40">{members().length} 人在线</span>
                    </div>
                    <Show
                      when={members().length > 0}
                      fallback={<div class="text-xs text-mist-solid/30">暂无成员数据</div>}
                    >
                      <div class="flex flex-col gap-2">
                        {members().map((member) => (
                          <div class="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/5 border border-white/5">
                            <div class="w-8 h-8 rounded-full bg-accent/20 text-accent flex items-center justify-center text-xs font-bold">
                              {member.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div class="min-w-0">
                              <div class="text-sm text-white truncate">{member.displayName}</div>
                              <div class="text-[10px] text-mist-solid/35">ID: {member.memberId}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </Show>
                  </div>
                </div>
              }
            >
              <div class="w-full bg-white/5 border border-white/5 p-6 md:p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden backdrop-blur-md">
                <div class="space-y-6">
                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">房间 IP 地址</label>
                    <input
                      value={hostAddress()}
                      onInput={(e) => setHostAddress(e.currentTarget.value)}
                      placeholder="例如 192.168.1.100"
                      class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid placeholder-mist-solid/25"
                    />
                  </div>

                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">端口</label>
                    <input
                      type="number"
                      value={port()}
                      onInput={(e) => setPort(e.currentTarget.value)}
                      placeholder="例如 8080"
                      class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid placeholder-mist-solid/25"
                    />
                  </div>

                  <div class="space-y-2">
                    <label class="text-xs font-bold uppercase tracking-wider text-mist-solid/30">显示名称</label>
                    <input
                      value={displayName()}
                      onInput={(e) => setDisplayName(e.currentTarget.value)}
                      placeholder="在房间中显示的昵称"
                      class="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-accent/40 text-mist-solid placeholder-mist-solid/25"
                    />
                  </div>

                  <Show when={status() === 'failed'}>
                    <div class="flex items-start gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                      <AlertCircle size={16} class="shrink-0 mt-0.5" />
                      <span>{statusMessage()}</span>
                    </div>
                  </Show>

                  <Show when={status() === 'connecting'}>
                    <div class="flex items-center gap-3 text-sm text-mist-solid/50">
                      <Loader2 size={16} class="animate-spin" />
                      <span>{statusMessage()}</span>
                    </div>
                  </Show>

                  <div class="flex items-center justify-end gap-3 pt-2">
                    <button
                      onClick={handleClose}
                      class="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm text-mist-solid/70 hover:bg-white/10 transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => void handleJoin()}
                      disabled={status() === 'connecting'}
                      class="px-5 py-2.5 rounded-xl bg-accent border-accent/30 text-white text-sm font-medium hover:bg-accent/85 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {status() === 'connecting' ? '连接中...' : '加入房间'}
                    </button>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </Show>
  );
};
