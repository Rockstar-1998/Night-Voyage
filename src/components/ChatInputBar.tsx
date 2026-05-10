import { Component, createMemo, createSignal } from 'solid-js';
import { SendHorizontal } from '../lib/icons';
import { IconButton } from './ui/IconButton';

interface ChatInputBarProps {
  onSend: (content: string) => void | Promise<void>;
  allowEmptySend?: boolean;
  disabled?: boolean;
  placeholder?: string;
}

export const ChatInputBar: Component<ChatInputBarProps> = (props) => {
  const [inputValue, setInputValue] = createSignal('');

  const canSend = createMemo(() => {
    if (props.disabled) return false;
    if (props.allowEmptySend) return true;
    return inputValue().trim().length > 0;
  });

  const sendLabel = createMemo(() => {
    if (props.allowEmptySend && inputValue().trim().length === 0) {
      return '放弃发言';
    }
    return '发送';
  });

  const handleSend = async () => {
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

  return (
    <div class="w-full max-w-4xl mx-auto p-4">
      <div class="relative flex items-center bg-wupeng border border-white/5 shadow-2xl focus-within:border-accent/50 transition-all rounded-2xl overflow-hidden px-2 py-2 group">
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
          disabled={!canSend()}
          label={sendLabel()}
          tone="accent"
          size="lg"
          class="mx-1"
        >
          <SendHorizontal size={18} class="translate-x-[1px]" />
        </IconButton>
      </div>
    </div>
  );
};
