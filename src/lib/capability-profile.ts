import type { CapabilityProfile, ConversationMode } from './backend/types';

/**
 * 9 个会话模式的能力查表，与后端 `MODE_CAPABILITIES` 矩阵一一对应。
 *
 * 矩阵来源：spec capability-matrix-completion
 * | # | 模式                    | edit | regen | fork | delete | submit_abort | send | rewind |
 * |---|-------------------------|------|-------|------|--------|--------------|------|--------|
 * | 0 | single/stateless        | Y    | Y     | Y    | Y      | Y            | Y    | Y      |
 * | 1 | single/legacy           | Y    | Y     | Y    | Y      | Y            | Y    | Y      |
 * | 2 | single/mem0             | N    | 受限  | 受限 | N      | Y            | Y    | 受限   |
 * | 3 | online/stateless/host   | Y    | Y     | N    | Y      | Y            | Y    | Y      |
 * | 4 | online/legacy/host      | Y    | Y     | N    | Y      | Y            | Y    | Y      |
 * | 5 | online/mem0/host        | N    | 受限  | N    | N      | Y            | Y    | 受限   |
 * | 6 | online/stateless/guest  | N    | N     | N    | N      | N            | Y    | N      |
 * | 7 | online/legacy/guest     | N    | N     | N    | N      | N            | Y    | N      |
 * | 8 | online/mem0/guest       | N    | N     | N    | N      | N            | Y    | N      |
 *
 * 「受限」= 受 mem0 快照窗口限制，前端可见（`canXxx: true`）但需后端校验，
 * 对应 `xxxLimited: true`。完全禁止对应 `canXxx: false`。
 */
const MODE_CAPABILITIES: Record<ConversationMode, CapabilityProfile> = {
  single_stateless: {
    canEdit: true,
    canRegenerate: true,
    regenerateLimited: false,
    canFork: true,
    forkLimited: false,
    canDelete: true,
    canSubmitAbort: true,
    canSend: true,
    canRewind: true,
    rewindLimited: false,
  },
  single_legacy: {
    canEdit: true,
    canRegenerate: true,
    regenerateLimited: false,
    canFork: true,
    forkLimited: false,
    canDelete: true,
    canSubmitAbort: true,
    canSend: true,
    canRewind: true,
    rewindLimited: false,
  },
  single_mem0: {
    canEdit: false,
    canRegenerate: true,
    regenerateLimited: true,
    canFork: true,
    forkLimited: true,
    canDelete: false,
    canSubmitAbort: true,
    canSend: true,
    canRewind: true,
    rewindLimited: true,
  },
  online_stateless_host: {
    canEdit: true,
    canRegenerate: true,
    regenerateLimited: false,
    canFork: false,
    forkLimited: false,
    canDelete: true,
    canSubmitAbort: true,
    canSend: true,
    canRewind: true,
    rewindLimited: false,
  },
  online_legacy_host: {
    canEdit: true,
    canRegenerate: true,
    regenerateLimited: false,
    canFork: false,
    forkLimited: false,
    canDelete: true,
    canSubmitAbort: true,
    canSend: true,
    canRewind: true,
    rewindLimited: false,
  },
  online_mem0_host: {
    canEdit: false,
    canRegenerate: true,
    regenerateLimited: true,
    canFork: false,
    forkLimited: false,
    canDelete: false,
    canSubmitAbort: true,
    canSend: true,
    canRewind: true,
    rewindLimited: true,
  },
  online_stateless_guest: {
    canEdit: false,
    canRegenerate: false,
    regenerateLimited: false,
    canFork: false,
    forkLimited: false,
    canDelete: false,
    canSubmitAbort: false,
    canSend: true,
    canRewind: false,
    rewindLimited: false,
  },
  online_legacy_guest: {
    canEdit: false,
    canRegenerate: false,
    regenerateLimited: false,
    canFork: false,
    forkLimited: false,
    canDelete: false,
    canSubmitAbort: false,
    canSend: true,
    canRewind: false,
    rewindLimited: false,
  },
  online_mem0_guest: {
    canEdit: false,
    canRegenerate: false,
    regenerateLimited: false,
    canFork: false,
    forkLimited: false,
    canDelete: false,
    canSubmitAbort: false,
    canSend: true,
    canRewind: false,
    rewindLimited: false,
  },
};

/**
 * 保守的能力轮廓：所有操作均不可见。
 *
 * 用于会话模式尚未解析完成（如初始加载、切换会话的瞬间）的过渡态，
 * 避免在模式未确定时错误地暴露操作按钮。与 `selectProfile` 同源，
 * 保证「未确定 = 全关闭」这一保守语义在单一位置定义。
 */
export const FALLBACK_PROFILE: CapabilityProfile = {
  canEdit: false,
  canRegenerate: false,
  regenerateLimited: false,
  canFork: false,
  forkLimited: false,
  canDelete: false,
  canSubmitAbort: false,
  canSend: false,
  canRewind: false,
  rewindLimited: false,
};

/**
 * 按会话模式查表返回能力轮廓（纯函数，无副作用）。
 *
 * 与后端 `ConversationMode::capabilities()` 思想一致：组合而非继承，
 * 用 const 查找表消除 if-else / switch-case 分支。
 */
export function selectProfile(mode: ConversationMode): CapabilityProfile {
  return MODE_CAPABILITIES[mode];
}
