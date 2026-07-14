import { Component, Show } from 'solid-js';
import { IconButton } from '../ui/IconButton';
import { Save } from '../../lib/icons';

interface Mem0ConfigPanelProps {
  embeddingDims: string;
  embeddingDimsError: string | null;
  embeddingDimsSaving: boolean;
  onSetEmbeddingDims: (value: string) => void;
  onSaveEmbeddingDims: () => void;
}

export const Mem0ConfigPanel: Component<Mem0ConfigPanelProps> = (props) => {
  return (
    <div class="space-y-2 mt-4">
      <label class="text-[10px] font-bold text-mist-solid/30 uppercase tracking-wider">
        MEM0 Embedding 维度（全局）
      </label>
      <div class="flex items-center gap-3">
        <input
          type="text"
          value={props.embeddingDims}
          onInput={(e) => props.onSetEmbeddingDims(e.currentTarget.value)}
          class="flex-1 bg-transparent border-b border-white/20 rounded-none px-0 py-2 text-sm focus:outline-none focus:border-accent transition-all text-mist-solid"
        />
        <IconButton
          onClick={() => void props.onSaveEmbeddingDims()}
          disabled={props.embeddingDimsSaving}
          label={props.embeddingDimsSaving ? '保存中...' : '保存维度'}
          tone="accent"
          size="sm"
        >
          <Save size={14} />
        </IconButton>
      </div>
      <p class="text-[10px] text-mist-solid/30">
        必须与 embedding 模型实际维度一致（如 text-embedding-3-small=1536, BAAI/bge-m3=1024）。
      </p>
      <Show when={props.embeddingDimsError}>
        <div class="text-[11px] text-red-300 break-all">{props.embeddingDimsError}</div>
      </Show>
    </div>
  );
};
