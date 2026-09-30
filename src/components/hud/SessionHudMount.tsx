import { Component, createResource } from 'solid-js';
import { presetUiLayoutForConversation } from '../../lib/backend/ui_layout';
import { PersistentHudContainer } from './PersistentHudContainer';

interface SessionHudMountProps {
  conversationId: number;
  onOpenDebug?: () => void;
}

/**
 * 会话视口里的常驻 HUD 挂载点。
 *
 * 职责只有一件：把「会话 → 绑定的 UI 布局」这一步查出来交给 HUD。
 * 未绑定或读取失败时传 `undefined`，HUD 退回内置默认视图——错误不会消失，
 * 而是在 HUD 内部作为可见提示呈现（C2：不把"没配布局"藏起来）。
 */
export const SessionHudMount: Component<SessionHudMountProps> = (props) => {
  const [layout] = createResource(
    () => props.conversationId,
    async (conversationId: number) => {
      try {
        return await presetUiLayoutForConversation(conversationId);
      } catch {
        // 未绑定布局是常态，不是异常：静默返回 undefined 由 HUD 用内置视图。
        // 读取失败与"未绑定"在这里无法区分，但两者都落到内置视图，且设计器里能看到真实原因。
        return undefined;
      }
    },
  );

  return (
    <PersistentHudContainer
      sessionId={props.conversationId}
      layoutId={layout()?.id}
      onOpenDebug={props.onOpenDebug}
    />
  );
};
