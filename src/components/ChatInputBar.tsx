import { Component, createMemo, createSignal } from 'solid-js';
import { SendHorizontal, Globe, Loader2 } from '../lib/icons';
import { IconButton } from './ui/IconButton';

export type ReplyStatus = 'idle' | 'connecting' | 'processing' | 'responding';

interface ChatInputBarProps {
  onSend: (content: string) => void | Promise<void>;
  onAbort?: () => void | Promise<void>;
  replyStatus?: ReplyStatus;
  allowEmptySend?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

const BouncingDots = () => (
  <div class="flex items-center justify-center gap-[3px] h-[18px]">
    <span
      class="inline-block w-[5px] h-[5px] rounded-full bg-current"
      style={{ animation: 'bounce-dot 1.4s infinite ease-in-out both', 'animation-delay': '-0.32s' }}
    />
    <span
      class="inline-block w-[5px] h-[5px] rounded-full bg-current"
      style={{ animation: 'bounce-dot 1.4s infinite ease-in-out both', 'animation-delay': '-0.16s' }}
    />
    <span
      class="inline-block w-[5px] h-[5px] rounded-full bg-current"
      style={{ animation: 'bounce-dot 1.4s infinite ease-in-out both', 'animation-delay': '0s' }}
    />
  </div>
);

export const ChatInputBar: Component<ChatInputBarProps> = (props) => {
  const [inputValue, setInputValue] = createSignal('');

  const isActive = createMemo(() => (props.replyStatus ?? 'idle') !== 'idle');

  const canSend = createMemo(() => {
    if (props.disabled) return false;
    if (isActive()) return false;
    if (props.allowEmptySend) return true;
    return inputValue().trim().length > 0;
  });

  const sendLabel = createMemo(() => {
    if (isActive()) return '停止';
    if (props.allowEmptySend && inputValue().trim().length === 0) {
      return '放弃发言';
    }
    return '发送';
  });

  const handleSend = async () => {
    if (isActive()) {
      await props.onAbort?.();
      return;
    }
    if (!canSend()) return;
    const content = inputValue();
    await props.onSend(content);
    setInputValue('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const statusIcon = createMemo(() => {
    switch (props.replyStatus) {
      case 'connecting':
        return <Globe size={18} class="animate-pulse" />;
      case 'processing':
        return <Loader2 size={18} class="animate-spin" />;
      case 'responding':
        return <BouncingDots />;
      default:
        return <SendHorizontal size={18} class="translate-x-[1px]" />;
    }
  });

  const buttonTone = createMemo(() => {
    return isActive() ? 'danger' : 'accent';
  });

  return (
    <div class="w-full max-w-4xl mx-auto p-4">
      <div class="relative flex items-center bg-transparent border-b-2 border-white/10 shadow-none focus-within:border-accent transition-all rounded-none px-2 py-2 group">
        <textarea
          value={inputValue()}
          onInput={(e) => setInputValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
          placeholder={props.placeholder ?? '输入消息，联机会话可留空后点击发送表示本轮放弃发言'}
          class="flex-1 bg-transparent border-none outline-none resize-none px-4 py-3 min-h-[48px] max-h-[150px] text-mist-solid placeholder-mist-solid/30 text-[15px] custom-scrollbar"
          rows="1"
          disabled={props.disabled}
        />

        <IconButton
          onClick={() => void handleSend()}
          disabled={!isActive() && props.disabled}
          label={sendLabel()}
          tone={buttonTone()}
          size="lg"
          class="mx-1"
        >
          {statusIcon()}
        </IconButton>
      </div>
    </div>
  );
};
