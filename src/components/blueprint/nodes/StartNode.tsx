/**
 * Start node config editor (Task 9).
 *
 * The Start node has no configurable fields — it is the unique entry point
 * of the blueprint graph. This component renders a static description so the
 * config panel shows something meaningful when a Start node is selected.
 *
 * Constraints:
 * - C1 Frontend Render-Only: renders only, forwards nothing.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 */

import type { Component } from 'solid-js';
import type { StartConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';

export const StartNode: Component<NodeConfigComponentProps<StartConfig>> = (_props) => {
  return (
    <div class="space-y-3 text-sm">
      <p class="text-mist-solid/70">开始节点</p>
      <p class="text-xs text-mist-solid/40 leading-relaxed">
        蓝图流程的起点。每个蓝图有且仅有一个开始节点，从这里连出到下一个节点。
      </p>
    </div>
  );
};
