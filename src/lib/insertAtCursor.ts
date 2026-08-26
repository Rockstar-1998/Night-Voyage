/**
 * Insert a placeholder token at the caret of a textarea, then restore the
 * caret just after the inserted text. Used by the blueprint-prompt and
 * opening-message editors so authors can drop `{{ character.name }}` etc.
 * without typing them by hand (and without risking a typo that the
 * compile-time Strict renderer would later reject).
 *
 * Constraints (see .trae/specs/blueprint-opening-placeholder-buttons):
 * - C1 Frontend Render-Only: pure UI helper, no backend calls.
 * - C3 Responsiveness: synchronous string splice + a single rAF caret
 *   restore. No IO, no async logic, no per-keystroke allocation in hot path.
 * - C2 Zero-Fallback Errors: if the textarea has no selection support we
 *   append explicitly rather than silently doing nothing.
 *
 * NOTE: this file is PC-only. src-mobile defines its own independent copy
 * under src-mobile/lib/insertAtCursor.ts (C5 Mobile Frontend Independence).
 */

export interface PlaceholderToken {
  /** Button label shown to the author. */
  label: string;
  /** minijinja expression inserted verbatim into the editor. */
  template: string;
}

/** PC-side fixed token set (mirrored independently under src-mobile). */
export const PLACEHOLDER_TOKENS: PlaceholderToken[] = [
  { label: '角色名', template: '{{ character.name }}' },
  { label: '玩家名', template: '{{ player_character.name }}' },
  { label: '角色描述', template: '{{ character.description }}' },
  { label: '玩家描述', template: '{{ player_character.description }}' },
];

/**
 * Insert `text` at the current caret of `el`, write the new value back via
 * `commit`, and restore the caret to just after the inserted text.
 *
 * `commit` updates the owner's controlled value (e.g. `update({ content })`
 * or `setFormData`). Because Solid rebinds a controlled textarea's `.value`
 * and resets the caret to the end, we restore it on the next animation frame
 * after the DOM has reflected the new value.
 */
export function insertAtCursor(
  el: HTMLTextAreaElement,
  text: string,
  currentValue: string,
  commit: (next: string) => void,
): void {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start == null || end == null) {
    // No selection support — append instead of silently doing nothing.
    commit(currentValue + text);
    return;
  }
  const next = currentValue.slice(0, start) + text + currentValue.slice(end);
  commit(next);
  const pos = start + text.length;
  requestAnimationFrame(() => {
    el.focus();
    el.setSelectionRange(pos, pos);
  });
}
