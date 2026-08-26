/**
 * PlaceholderToolbar — PC-side presentational control for inserting
 * minijinja placeholder tokens ({{ character.name }} etc.) at the caret of
 * the owning textarea.
 *
 * Shared by the blueprint-prompt editor and the opening-message editor
 * (both live under src/, so a shared PC component is fine — C5 only
 * forbids PC<->mobile code coupling, not reuse within the PC host).
 *
 * Constraints:
 * - C1 Frontend Render-Only: pure view, no backend calls.
 * - C3 Responsiveness: trivial static markup, no effects.
 */

import { For } from 'solid-js';
import type { PlaceholderToken } from '../../lib/insertAtCursor';

interface PlaceholderToolbarProps {
  tokens: PlaceholderToken[];
  onInsert: (template: string) => void;
  disabled?: boolean;
}

export const PlaceholderToolbar = (props: PlaceholderToolbarProps) => (
  <div class="flex items-center gap-2 flex-wrap">
    <span class="shrink-0 text-[10px] font-medium uppercase tracking-widest text-mist-solid/30 select-none">
      插入变量
    </span>
    <div class="flex flex-wrap items-center gap-1.5">
      <For each={props.tokens}>
        {(token) => (
          <button
            type="button"
            disabled={props.disabled}
            title={`插入 ${token.template}`}
            onClick={() => props.onInsert(token.template)}
            class="group inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] leading-none text-mist-solid/70 transition-all hover:border-accent/50 hover:bg-accent/10 hover:text-accent active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>{token.label}</span>
            <code class="font-mono text-[9px] text-mist-solid/30 transition-colors group-hover:text-accent/70">
              {token.template}
            </code>
          </button>
        )}
      </For>
    </div>
  </div>
);
