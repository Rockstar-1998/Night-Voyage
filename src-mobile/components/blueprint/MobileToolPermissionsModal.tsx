/**
 * MobileToolPermissionsModal — Mobile touch-friendly agent tool permissions editor (Ticket 04).
 *
 * Implements:
 * - Allow All toggle (allow_all)
 * - Allowed tools (allowed_tools) whitelist
 * - Require approval (require_approval) tool list
 * - Searchable reference capability pool with touch-friendly quick-add
 *
 * Constraints:
 * - C1 Frontend Render-Only: purely drives callback state, no backend mutation.
 * - C5 Mobile Independence: lives strictly under src-mobile/ with zero PC UI imports.
 * - C7 PC/Android Parity: identical permission model & capability pool as PC.
 */

import { Component, createSignal, createMemo, For, Show } from 'solid-js';
import type { AgentToolPermissions } from '../../../src/lib/blueprint/types';
import { X, Search, Plus, Check, SlidersHorizontal, ShieldCheck, CheckCircle2 } from 'lucide-solid';

export interface MobileToolItem {
  name: string;
  type: 'local' | 'action_bridge' | 'mcp';
  description?: string;
}

export interface MobileToolPermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  permissions?: AgentToolPermissions;
  onSave: (permissions: AgentToolPermissions) => void;
  customTools?: string[];
  availableTools?: MobileToolItem[];
}

export const MobileToolPermissionsModal: Component<MobileToolPermissionsModalProps> = (props) => {
  const [allowAll, setAllowAll] = createSignal<boolean>(props.permissions?.allow_all ?? false);
  const [activeTab, setActiveTab] = createSignal<'allowed' | 'approval'>('allowed');
  const [allowedText, setAllowedText] = createSignal<string>(
    (props.permissions?.allowed_tools || []).join('\n')
  );
  const [approvalText, setApprovalText] = createSignal<string>(
    (props.permissions?.require_approval || []).join('\n')
  );
  const [searchQuery, setSearchQuery] = createSignal<string>('');

  const currentAllowedList = createMemo(() =>
    allowedText()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const currentApprovalList = createMemo(() =>
    approvalText()
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  );

  const fullCapabilityPool = createMemo<MobileToolItem[]>(() => {
    const pool: MobileToolItem[] = props.availableTools ? [...props.availableTools] : [];
    const existing = new Set(pool.map((t) => t.name));
    for (const tool of props.customTools || []) {
      if (!existing.has(tool)) {
        pool.push({
          name: tool,
          type: 'local',
          description: '蓝图 ToolDefinition 契约',
        });
        existing.add(tool);
      }
    }
    for (const tool of props.permissions?.allowed_tools || []) {
      if (!existing.has(tool)) {
        pool.push({
          name: tool,
          type: 'local',
          description: '已配置白名单工具',
        });
        existing.add(tool);
      }
    }
    for (const tool of props.permissions?.require_approval || []) {
      if (!existing.has(tool)) {
        pool.push({
          name: tool,
          type: 'local',
          description: '已配置需审批工具',
        });
        existing.add(tool);
      }
    }
    return pool;
  });

  const filteredPool = createMemo(() => {
    const q = searchQuery().trim().toLowerCase();
    if (!q) return fullCapabilityPool();
    return fullCapabilityPool().filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q))
    );
  });

  const handleAddTool = (toolName: string) => {
    if (activeTab() === 'allowed') {
      const list = currentAllowedList();
      if (!list.includes(toolName)) {
        setAllowedText([...list, toolName].join('\n'));
      }
    } else {
      const list = currentApprovalList();
      if (!list.includes(toolName)) {
        setApprovalText([...list, toolName].join('\n'));
      }
    }
  };

  const handleSave = () => {
    const result: AgentToolPermissions = {
      allow_all: allowAll(),
      allowed_tools: currentAllowedList(),
      require_approval: currentApprovalList(),
    };
    props.onSave(result);
    props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/80 backdrop-blur-sm sm:items-center sm:justify-center p-0 sm:p-4">
        <div class="flex max-h-[85vh] w-full flex-col rounded-t-3xl sm:rounded-2xl border border-white/15 bg-[#141419] shadow-2xl overflow-hidden">
          {/* Header */}
          <div class="flex items-center justify-between border-b border-white/10 px-5 py-4 bg-white/[0.03]">
            <div class="flex items-center gap-2.5">
              <div class="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/20 text-purple-400">
                <SlidersHorizontal class="h-4 w-4" />
              </div>
              <div>
                <h3 class="text-sm font-bold text-white tracking-wide">编辑工具权限</h3>
                <p class="text-[11px] text-mist-solid/50">配置当前智能体专属能力池与门禁白名单</p>
              </div>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              class="h-8 w-8 flex items-center justify-center rounded-full bg-white/10 text-mist-solid/60 active:scale-95"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Allow All Switch */}
            <div class="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-3.5">
              <div class="space-y-0.5 pr-2">
                <div class="flex items-center gap-1.5">
                  <span class="text-xs font-bold text-white">全部允许 (Allow All)</span>
                  <Show when={allowAll()}>
                    <span class="rounded bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-400">
                      无限制
                    </span>
                  </Show>
                </div>
                <p class="text-[11px] text-mist-solid/50 leading-relaxed">
                  开启后可自由调用全部工具，关闭后仅允许白名单内工具。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAllowAll(!allowAll())}
                class={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  allowAll() ? 'bg-purple-600' : 'bg-white/15'
                }`}
              >
                <span
                  class={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    allowAll() ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <Show when={!allowAll()}>
              {/* Tabs */}
              <div class="space-y-3">
                <div class="grid grid-cols-2 rounded-xl bg-black/40 p-1 border border-white/10">
                  <button
                    type="button"
                    onClick={() => setActiveTab('allowed')}
                    class={`py-2 text-xs font-semibold rounded-lg transition-all ${
                      activeTab() === 'allowed'
                        ? 'bg-purple-600/40 text-purple-300 border border-purple-500/30 shadow'
                        : 'text-mist-solid/50'
                    }`}
                  >
                    允许的工具 ({currentAllowedList().length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('approval')}
                    class={`py-2 text-xs font-semibold rounded-lg transition-all ${
                      activeTab() === 'approval'
                        ? 'bg-amber-600/40 text-amber-300 border border-amber-500/30 shadow'
                        : 'text-mist-solid/50'
                    }`}
                  >
                    需审批 ({currentApprovalList().length})
                  </button>
                </div>

                {/* Multiline textarea */}
                <div class="space-y-1">
                  <label class="text-[11px] font-semibold text-mist-solid/60">
                    {activeTab() === 'allowed' ? '允许调用的工具名称（每行一个）' : '需人工审批门禁的工具（每行一个）'}
                  </label>
                  <Show
                    when={activeTab() === 'allowed'}
                    fallback={
                      <textarea
                        class="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-white placeholder-mist-solid/30 focus:border-amber-400 focus:outline-none"
                        rows={3}
                        placeholder="每行一个工具名称..."
                        value={approvalText()}
                        onInput={(e) => setApprovalText(e.currentTarget.value)}
                      />
                    }
                  >
                    <textarea
                      class="w-full rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs text-white placeholder-mist-solid/30 focus:border-purple-400 focus:outline-none"
                      rows={3}
                      placeholder="每行一个工具名称..."
                      value={allowedText()}
                      onInput={(e) => setAllowedText(e.currentTarget.value)}
                    />
                  </Show>
                </div>

                {/* Capability Pool Quick Add */}
                <div class="space-y-2 pt-1">
                  <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-mist-solid/70">常用能力池参考</span>
                    {/* Search */}
                    <div class="relative w-36">
                      <Search class="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-mist-solid/40" />
                      <input
                        type="text"
                        placeholder="搜索..."
                        value={searchQuery()}
                        onInput={(e) => setSearchQuery(e.currentTarget.value)}
                        class="w-full rounded-lg border border-white/10 bg-black/30 py-1 pl-6 pr-2 text-xs text-white placeholder-mist-solid/30 focus:border-purple-400 focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Tool List */}
                  <div class="max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-black/30 divide-y divide-white/5">
                    <For
                      each={filteredPool()}
                      fallback={
                        <div class="py-4 text-center text-xs text-mist-solid/40">无匹配工具</div>
                      }
                    >
                      {(tool) => {
                        const isAdded = () =>
                          activeTab() === 'allowed'
                            ? currentAllowedList().includes(tool.name)
                            : currentApprovalList().includes(tool.name);

                        return (
                          <div class="flex items-center justify-between p-2.5">
                            <div class="space-y-0.5 pr-2 min-w-0">
                              <div class="flex items-center gap-1.5">
                                <span class="font-mono text-xs font-medium text-white truncate">
                                  {tool.name}
                                </span>
                                <span
                                  class={`rounded px-1 py-0.2 text-[8px] font-semibold ${
                                    tool.type === 'action_bridge'
                                      ? 'bg-blue-500/20 text-blue-400'
                                      : tool.type === 'local'
                                      ? 'bg-purple-500/20 text-purple-400'
                                      : 'bg-emerald-500/20 text-emerald-400'
                                  }`}
                                >
                                  {tool.type === 'action_bridge' ? 'Bridge' : tool.type === 'local' ? 'Local' : 'MCP'}
                                </span>
                              </div>
                              <p class="text-[10px] text-mist-solid/50 truncate max-w-[200px]">
                                {tool.description}
                              </p>
                            </div>
                            <Show
                              when={!isAdded()}
                              fallback={
                                <span class="inline-flex items-center gap-0.5 text-[10px] font-semibold text-emerald-400 shrink-0">
                                  <Check class="h-3 w-3" />
                                  已加
                                </span>
                              }
                            >
                              <button
                                type="button"
                                onClick={() => handleAddTool(tool.name)}
                                class="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-white active:bg-purple-600 transition-colors shrink-0"
                              >
                                <Plus class="h-3 w-3" />
                                添加
                              </button>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-end gap-3 border-t border-white/10 p-4 bg-white/[0.03]">
            <button
              type="button"
              onClick={props.onClose}
              class="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-semibold text-mist-solid active:bg-white/10 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              class="flex-1 rounded-xl bg-purple-600 py-2.5 text-xs font-semibold text-white shadow-lg active:bg-purple-700 transition-colors"
            >
              保存权限
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export const MobileToolPermissionsCard: Component<{
  permissions?: AgentToolPermissions;
  onUpdate: (permissions: AgentToolPermissions) => void;
  customTools?: string[];
  availableTools?: MobileToolItem[];
}> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);

  const isAllowAll = () => Boolean(props.permissions?.allow_all);
  const allowedTools = () => props.permissions?.allowed_tools || [];
  const approvalTools = () => props.permissions?.require_approval || [];

  return (
    <div class="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2.5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <ShieldCheck class="h-4 w-4 text-purple-400" />
          <span class="text-xs font-bold text-mist-solid/90">工具权限 (Tool Permissions)</span>
        </div>
        <div class="flex items-center gap-2">
          <Show
            when={!isAllowAll()}
            fallback={
              <span class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                全部允许
              </span>
            }
          >
            <Show
              when={allowedTools().length > 0 || approvalTools().length > 0}
              fallback={
                <span class="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-semibold text-mist-solid/40">
                  未配置
                </span>
              }
            >
              <span class="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-cyan-400">
                白名单 ({allowedTools().length})
              </span>
            </Show>
          </Show>

          <button
            type="button"
            onClick={() => setIsOpen(true)}
            class="rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-[11px] font-semibold text-mist-solid active:bg-white/15"
          >
            编辑权限
          </button>
        </div>
      </div>

      <p class="text-[11px] text-mist-solid/50 leading-relaxed">
        工具权限定义当前智能体可调用的能力。未配置时遵循全局默认设置。
      </p>

      <Show
        when={!isAllowAll()}
        fallback={
          <div class="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px] text-emerald-300/80">
            <CheckCircle2 class="h-3.5 w-3.5 text-emerald-400 shrink-0" />
            <span>智能体拥有全局工具权限，可自由调用所有已注册能力。</span>
          </div>
        }
      >
        <Show
          when={allowedTools().length > 0 || approvalTools().length > 0}
          fallback={
            <div class="rounded-lg border border-white/5 bg-black/20 p-2 text-center text-[11px] text-mist-solid/40">
              当前尚未配置专用白名单。
            </div>
          }
        >
          <div class="flex flex-wrap gap-1.5">
            <For each={allowedTools()}>
              {(t) => (
                <span class="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                  {t}
                </span>
              )}
            </For>
            <For each={approvalTools()}>
              {(t) => (
                <span class="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                  [需审批] {t}
                </span>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <MobileToolPermissionsModal
        isOpen={isOpen()}
        onClose={() => setIsOpen(false)}
        permissions={props.permissions}
        onSave={props.onUpdate}
        customTools={props.customTools}
        availableTools={props.availableTools}
      />
    </div>
  );
};
