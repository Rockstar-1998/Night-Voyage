/**
 * ToolPermissionsCard — Property inspector card for agent tool permissions (Ticket 04).
 *
 * Provides a clean overview of allowed and approval-required tools for:
 * - DirectorConfig
 * - ActorDefinition
 * - ScriptwriterStage
 *
 * Constraints:
 * - C1 Frontend Render-Only
 * - C5 Mobile Independence (PC-only)
 */

import { Component, createSignal, Show, For } from 'solid-js';
import type { AgentToolPermissions } from '../../lib/blueprint/types';
import { ToolPermissionsModal, DEFAULT_CAPABILITY_POOL } from './ToolPermissionsModal';
import { SlidersHorizontal, Pencil, CheckCircle2, AlertTriangle, Lock } from '../../lib/icons';

export interface ToolPermissionsCardProps {
  permissions?: AgentToolPermissions;
  onUpdate: (permissions: AgentToolPermissions) => void;
  customTools?: string[];
  isLocked?: boolean;
}

export const ToolPermissionsCard: Component<ToolPermissionsCardProps> = (props) => {
  const [isModalOpen, setIsModalOpen] = createSignal(false);

  const isAllowAll = () => Boolean(props.permissions?.allow_all);
  const allowedTools = () => props.permissions?.allowed_tools || [];
  const approvalTools = () => props.permissions?.require_approval || [];

  const getToolType = (name: string): string => {
    const found = DEFAULT_CAPABILITY_POOL.find((t) => t.name === name);
    if (!found) return 'Local';
    if (found.type === 'action_bridge') return 'ActionBridge';
    if (found.type === 'mcp') return 'MCP';
    return 'Local';
  };

  return (
    <div class="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-3">
      {/* Header */}
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <SlidersHorizontal class="h-4 w-4 text-accent" />
          <span class="text-xs font-bold uppercase tracking-wider text-mist-solid/80">
            工具权限 (Tool Permissions)
          </span>
        </div>
        <div class="flex items-center gap-2">
          <Show
            when={!isAllowAll()}
            fallback={
              <span class="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                全部允许
              </span>
            }
          >
            <Show
              when={allowedTools().length > 0 || approvalTools().length > 0}
              fallback={
                <span class="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-mist-solid/40">
                  未配置
                </span>
              }
            >
              <span class="rounded bg-cyan-500/20 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">
                白名单 ({allowedTools().length} 允许)
              </span>
            </Show>
          </Show>

          <button
            type="button"
            disabled={props.isLocked}
            onClick={() => setIsModalOpen(true)}
            class="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-mist-solid hover:bg-white/10 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Pencil class="h-3 w-3" />
            编辑
          </button>
        </div>
      </div>

      {/* Explanatory note */}
      <p class="text-[11px] text-mist-solid/50 leading-relaxed">
        关于工具权限：工具权限定义了当前智能体可以使用的能力。未配置时遵循全局默认设置。
      </p>

      {/* Tool Table / Summary */}
      <Show
        when={!isAllowAll()}
        fallback={
          <div class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5 text-xs text-emerald-300/80 flex items-center gap-2">
            <CheckCircle2 class="h-4 w-4 text-emerald-400 shrink-0" />
            <span>智能体拥有全局工具调用权限，可在推理中访问全部已注册工具。</span>
          </div>
        }
      >
        <Show
          when={allowedTools().length > 0 || approvalTools().length > 0}
          fallback={
            <div class="rounded-lg border border-white/5 bg-black/20 p-2.5 text-center text-xs text-mist-solid/40">
              当前尚未配置专用工具白名单。点击「编辑」按钮开启能力管控。
            </div>
          }
        >
          <div class="max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/30">
            <table class="w-full text-left text-xs">
              <thead class="border-b border-white/10 bg-white/[0.03] text-[9px] font-semibold uppercase text-mist-solid/40">
                <tr>
                  <th class="py-1.5 px-2.5">访问</th>
                  <th class="py-1.5 px-2.5">工具规则</th>
                  <th class="py-1.5 px-2.5 text-right">类型</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-white/5">
                <For each={allowedTools()}>
                  {(tool) => (
                    <tr>
                      <td class="py-1.5 px-2.5">
                        <span class="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">
                          允许
                        </span>
                      </td>
                      <td class="py-1.5 px-2.5 font-mono text-[11px] text-white">{tool}</td>
                      <td class="py-1.5 px-2.5 text-right text-[10px] text-mist-solid/50">
                        {getToolType(tool)}
                      </td>
                    </tr>
                  )}
                </For>
                <For each={approvalTools()}>
                  {(tool) => (
                    <tr>
                      <td class="py-1.5 px-2.5">
                        <span class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-400">
                          需审批
                        </span>
                      </td>
                      <td class="py-1.5 px-2.5 font-mono text-[11px] text-white">{tool}</td>
                      <td class="py-1.5 px-2.5 text-right text-[10px] text-mist-solid/50">
                        {getToolType(tool)}
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>

      {/* Permissions Modal */}
      <ToolPermissionsModal
        isOpen={isModalOpen()}
        onClose={() => setIsModalOpen(false)}
        permissions={props.permissions}
        onSave={props.onUpdate}
        customTools={props.customTools}
      />
    </div>
  );
};
