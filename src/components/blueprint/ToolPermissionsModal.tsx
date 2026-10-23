/**
 * ToolPermissionsModal — Modal for editing agent tool permissions (Ticket 04).
 *
 * Supports:
 * - Allow All toggle (allow_all)
 * - Allowed tools (allowed_tools) whitelist editing
 * - Require approval (require_approval) tool list editing
 * - Quick-add from available capability pool (Local Tools, ActionBridge, MCP)
 *
 * Constraints:
 * - C1 Frontend Render-Only: purely drives callback state, no backend mutation.
 * - C5 Mobile Independence: PC-only under src/components/blueprint/.
 */

import { Component, createSignal, createMemo, For, Show } from 'solid-js';
import type { AgentToolPermissions } from '../../lib/blueprint/types';
import { X, Search, Plus, Check, SlidersHorizontal, Info, Terminal } from '../../lib/icons';

export interface ToolItem {
  name: string;
  type: 'local' | 'action_bridge' | 'mcp';
  description?: string;
}

export const DEFAULT_CAPABILITY_POOL: ToolItem[] = [
  { name: 'read_text', type: 'action_bridge', description: '读取工作区变量与前置阶段输出' },
  { name: 'write_text', type: 'action_bridge', description: '向工作区写入文本或阶段草稿' },
  { name: 'inspect_state', type: 'action_bridge', description: '检查角色属性、全局状态或道具详情' },
  { name: 'execute_action', type: 'action_bridge', description: '执行游戏内动作指令契约' },
  { name: 'inventory_add', type: 'action_bridge', description: '向角色背包增添道具或装备' },
  { name: 'inventory_remove', type: 'action_bridge', description: '扣减或消耗角色背包中的道具' },
  { name: 'update_stat', type: 'action_bridge', description: '更新数值属性（生命、San值、信用点等）' },
  { name: 'check_inventory', type: 'action_bridge', description: '检索背包物品及其数量' },
  { name: 'dice_roll', type: 'action_bridge', description: '执行跑团 D20/D100 检定' },
  { name: 'banned_words_check', type: 'action_bridge', description: '执行敏感词门禁审核' },
  { name: 'buy_item', type: 'local', description: '本地工具：执行商店购买逻辑' },
  { name: 'cast_spell', type: 'local', description: '本地工具：法术释放与消耗结算' },
  { name: 'mcp_query', type: 'mcp', description: 'MCP 服务：调用外部查询工具' },
];

export interface ToolPermissionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  permissions?: AgentToolPermissions;
  onSave: (permissions: AgentToolPermissions) => void;
  customTools?: string[];
}

export const ToolPermissionsModal: Component<ToolPermissionsModalProps> = (props) => {
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

  const fullCapabilityPool = createMemo<ToolItem[]>(() => {
    const pool = [...DEFAULT_CAPABILITY_POOL];
    const existing = new Set(pool.map((t) => t.name));
    for (const tool of props.customTools || []) {
      if (!existing.has(tool)) {
        pool.push({
          name: tool,
          type: 'local',
          description: '蓝图自定义工具',
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
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div class="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-white/15 bg-ink-solid shadow-2xl overflow-hidden">
          {/* Header */}
          <div class="flex items-center justify-between border-b border-white/10 px-6 py-4 bg-white/[0.02]">
            <div class="flex items-center gap-2.5">
              <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent">
                <SlidersHorizontal class="h-4 w-4" />
              </div>
              <div>
                <h3 class="text-sm font-bold text-white tracking-wide">编辑工具权限 (Tool Permissions)</h3>
                <p class="text-xs text-mist-solid/50">配置当前智能体专属能力池与门禁白名单</p>
              </div>
            </div>
            <button
              onClick={props.onClose}
              class="rounded-lg p-1.5 text-mist-solid/50 hover:bg-white/10 hover:text-white transition-colors"
            >
              <X class="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div class="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Allow All Switch */}
            <div class="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div class="space-y-1">
                <div class="flex items-center gap-2">
                  <span class="text-sm font-semibold text-white">全部允许 (Allow All)</span>
                  <Show when={allowAll()}>
                    <span class="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                      无限制
                    </span>
                  </Show>
                </div>
                <p class="text-xs text-mist-solid/60">
                  开启后该智能体拥有对系统中所有已注册工具的调用权限，忽略白名单限制。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAllowAll(!allowAll())}
                class={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  allowAll() ? 'bg-accent' : 'bg-white/15'
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
              {/* Tabs for Allowed vs Approval */}
              <div class="space-y-3">
                <div class="flex border-b border-white/10">
                  <button
                    type="button"
                    onClick={() => setActiveTab('allowed')}
                    class={`pb-2.5 px-4 text-xs font-semibold tracking-wider transition-colors border-b-2 ${
                      activeTab() === 'allowed'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-mist-solid/50 hover:text-mist-solid'
                    }`}
                  >
                    允许的工具 ({currentAllowedList().length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('approval')}
                    class={`pb-2.5 px-4 text-xs font-semibold tracking-wider transition-colors border-b-2 ${
                      activeTab() === 'approval'
                        ? 'border-amber-400 text-amber-400'
                        : 'border-transparent text-mist-solid/50 hover:text-mist-solid'
                    }`}
                  >
                    需要审批的工具 ({currentApprovalList().length})
                  </button>
                </div>

                {/* Multiline Textarea Input */}
                <div class="space-y-1.5">
                  <div class="flex justify-between items-center">
                    <label class="text-[11px] font-semibold uppercase text-mist-solid/60">
                      {activeTab() === 'allowed' ? '允许调用的工具名称（每行一个）' : '需人工审批门禁的工具（每行一个）'}
                    </label>
                    <span class="text-[10px] font-mono text-mist-solid/40">支持手动输入或从下方快速添加</span>
                  </div>
                  <Show
                    when={activeTab() === 'allowed'}
                    fallback={
                      <textarea
                        class="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 font-mono text-xs text-white placeholder-mist-solid/30 focus:border-amber-400 focus:outline-none"
                        rows={4}
                        placeholder="每行一个工具名称，例如：\ninventory_remove\nexecute_action"
                        value={approvalText()}
                        onInput={(e) => setApprovalText(e.currentTarget.value)}
                      />
                    }
                  >
                    <textarea
                      class="w-full rounded-xl border border-white/10 bg-black/40 px-3.5 py-2.5 font-mono text-xs text-white placeholder-mist-solid/30 focus:border-accent focus:outline-none"
                      rows={4}
                      placeholder="每行一个工具名称，例如：\nread_text\nwrite_text\ninspect_state"
                      value={allowedText()}
                      onInput={(e) => setAllowedText(e.currentTarget.value)}
                    />
                  </Show>
                </div>

                {/* Capability Pool Quick Add Section */}
                <div class="space-y-3 pt-2">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5 text-xs font-semibold text-mist-solid/80">
                      <Terminal class="h-3.5 w-3.5 text-accent" />
                      <span>常用工具参考与快速添加</span>
                    </div>
                    {/* Search Input */}
                    <div class="relative w-48">
                      <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-mist-solid/40" />
                      <input
                        type="text"
                        placeholder="搜索能力..."
                        value={searchQuery()}
                        onInput={(e) => setSearchQuery(e.currentTarget.value)}
                        class="w-full rounded-lg border border-white/10 bg-black/30 py-1 pl-7 pr-2 text-xs text-white placeholder-mist-solid/30 focus:border-accent focus:outline-none"
                      />
                    </div>
                  </div>

                  {/* Tools Table */}
                  <div class="max-h-52 overflow-y-auto rounded-xl border border-white/10 bg-black/20">
                    <table class="w-full text-left text-xs">
                      <thead class="border-b border-white/10 bg-white/[0.03] text-[10px] font-semibold uppercase text-mist-solid/50">
                        <tr>
                          <th class="py-2 px-3">工具名称</th>
                          <th class="py-2 px-3">类型</th>
                          <th class="py-2 px-3">用途与说明</th>
                          <th class="py-2 px-3 text-right">操作</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-white/5">
                        <For
                          each={filteredPool()}
                          fallback={
                            <tr>
                              <td colspan={4} class="py-4 text-center text-xs text-mist-solid/40">
                                未找到匹配的可用工具
                              </td>
                            </tr>
                          }
                        >
                          {(tool) => {
                            const isAdded = () =>
                              activeTab() === 'allowed'
                                ? currentAllowedList().includes(tool.name)
                                : currentApprovalList().includes(tool.name);

                            return (
                              <tr class="hover:bg-white/[0.02] transition-colors">
                                <td class="py-2 px-3 font-mono font-medium text-white">{tool.name}</td>
                                <td class="py-2 px-3">
                                  <span
                                    class={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                                      tool.type === 'action_bridge'
                                        ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                        : tool.type === 'local'
                                        ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    }`}
                                  >
                                    {tool.type === 'action_bridge' ? 'ActionBridge' : tool.type === 'local' ? 'Local' : 'MCP'}
                                  </span>
                                </td>
                                <td class="py-2 px-3 text-mist-solid/60 text-[11px] truncate max-w-xs">
                                  {tool.description || '—'}
                                </td>
                                <td class="py-2 px-3 text-right">
                                  <Show
                                    when={!isAdded()}
                                    fallback={
                                      <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                                        <Check class="h-3 w-3" />
                                        已加
                                      </span>
                                    }
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleAddTool(tool.name)}
                                      class="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-mist-solid hover:bg-accent hover:text-white transition-colors"
                                    >
                                      <Plus class="h-3 w-3" />
                                      添加
                                    </button>
                                  </Show>
                                </td>
                              </tr>
                            );
                          }}
                        </For>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </Show>
          </div>

          {/* Footer */}
          <div class="flex items-center justify-end gap-3 border-t border-white/10 px-6 py-3.5 bg-white/[0.02]">
            <button
              type="button"
              onClick={props.onClose}
              class="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-mist-solid hover:bg-white/10 transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              class="rounded-xl bg-accent px-5 py-2 text-xs font-semibold text-white shadow-lg hover:bg-accent/90 transition-colors"
            >
              保存权限配置
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
