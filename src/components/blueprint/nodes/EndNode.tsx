/**
 * End node config editor (Task 9).
 *
 * The End node has no configurable fields — it is the unique terminal point
 * of the blueprint graph. This component renders a static description.
 *
 * Constraints:
 * - C1 Frontend Render-Only: renders only, forwards nothing.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 */

import type { Component } from 'solid-js';
import type { EndConfig } from '../../../lib/blueprint/types';
import type { NodeConfigComponentProps } from '../NodeConfigPanel';

export const EndNode: Component<NodeConfigComponentProps<EndConfig>> = (_props) => {
  return (
    <div class="space-y-3 text-sm">
      <p class="text-mist-solid/70">结束节点</p>
      <p class="text-xs text-mist-solid/40 leading-relaxed">
        蓝图流程的终点。每个蓝图有且仅有一个结束节点，所有分支最终汇聚到这里。
      </p>
    </div>
  );
};
