/**
 * NodeConfigPanel — blueprint node config editor host (Task 9).
 *
 * Renders the right-hand config panel for the currently selected node.
 * Dispatches to the per-type node config component under `nodes/`. Owns
 * no state of its own — the parent (BlueprintEditor, Task 10) owns the
 * graph and is notified of edits via `onUpdate` / `onDelete`.
 *
 * Lock handling:
 * - `isNodeLocked` (from nodeLayout.ts) is the single source of truth for
 *   whether a node's content is read-only. It returns true only for
 *   prompt / schema_field / sampling_params nodes with is_locked=true.
 * - When locked, the panel shows a "锁定" badge and the delete button is
 *   disabled (per spec: locked nodes cannot be deleted).
 * - The per-type component receives `isLocked` and is responsible for
 *   disabling its content inputs; the is_locked toggle itself stays
 *   interactive so the user can unlock.
 *
 * Dispatch design:
 * - A `renderConfig(node)` helper uses `switch (node.type)` to narrow the
 *   discriminated union. Inside each `case`, TypeScript narrows
 *   `node.config` to the matching config type, so no `as` cast is needed.
 *   This is cleaner than `<Switch>`/`<Match>` (which cannot narrow through
 *   accessor calls).
 *
 * Constraints:
 * - C1 Frontend Render-Only: forwards user intent via callbacks, no backend calls.
 * - C3 Responsiveness: dispatch is a pure switch; SolidJS <Show> re-renders
 *   the panel only when the selected node id changes.
 * - C5 Mobile Frontend Independence: PC-only, lives under `src/`.
 */

import { Component, Show } from 'solid-js';
import type { BlueprintNode, NodeConfig } from '../../lib/blueprint/types';
import { isNodeLocked } from './nodeLayout';
import { Lock, Trash2 } from '../../lib/icons';
import { IconButton } from '../ui/IconButton';
import { StartNode } from './nodes/StartNode';
import { EndNode } from './nodes/EndNode';
import { PromptNode } from './nodes/PromptNode';
import { SchemaFieldNode } from './nodes/SchemaFieldNode';
import { MutexGateNode } from './nodes/MutexGateNode';
import { GroupGateNode } from './nodes/GroupGateNode';
import { ModeSwitchNode } from './nodes/ModeSwitchNode';
import { SamplingParamsNode } from './nodes/SamplingParamsNode';

// ─── Shared prop type for every per-type node config component ───

export interface NodeConfigComponentProps<C> {
  config: C;
  isLocked: boolean;
  onUpdate: (updates: Partial<C>) => void;
}

// ─── Panel props ───

export interface NodeConfigPanelProps {
  node: BlueprintNode | null;
  onUpdate: (nodeId: string, updates: Partial<NodeConfig>) => void;
  onDelete: (nodeId: string) => void;
}

// ─── Node type → display label ───

const NODE_TYPE_LABELS: Record<BlueprintNode['type'], string> = {
  start: 'Start',
  end: 'End',
  prompt: 'Prompt',
  schema_field: 'Schema Field',
  mutex_gate: 'Mutex Gate',
  group_gate: 'Group Gate',
  mode_switch: 'Mode Switch',
  sampling_params: 'Sampling Params',
};

// ─── Component ───

export const NodeConfigPanel: Component<NodeConfigPanelProps> = (props) => {
  const isLocked = () => (props.node ? isNodeLocked(props.node) : false);

  const handleDelete = () => {
    const node = props.node;
    if (!node || isLocked()) return;
    props.onDelete(node.id);
  };

  /**
   * Dispatch to the per-type config component. The `switch` on `node.type`
   * narrows the discriminated union so `node.config` is typed precisely
   * inside each branch — no `as` cast required.
   */
  const renderConfig = (node: BlueprintNode) => {
    const locked = isLocked();
    switch (node.type) {
      case 'start':
        return <StartNode config={node.config} isLocked={locked} onUpdate={() => {}} />;
      case 'end':
        return <EndNode config={node.config} isLocked={locked} onUpdate={() => {}} />;
      case 'prompt':
        return (
          <PromptNode
            config={node.config}
            isLocked={locked}
            onUpdate={(updates) =>
              props.onUpdate(node.id, {
                type: 'prompt',
                config: { ...node.config, ...updates },
              })
            }
          />
        );
      case 'schema_field':
        return (
          <SchemaFieldNode
            config={node.config}
            isLocked={locked}
            onUpdate={(updates) =>
              props.onUpdate(node.id, {
                type: 'schema_field',
                config: { ...node.config, ...updates },
              })
            }
          />
        );
      case 'mutex_gate':
        return (
          <MutexGateNode
            config={node.config}
            isLocked={locked}
            onUpdate={(updates) =>
              props.onUpdate(node.id, {
                type: 'mutex_gate',
                config: { ...node.config, ...updates },
              })
            }
          />
        );
      case 'group_gate':
        return (
          <GroupGateNode
            config={node.config}
            isLocked={locked}
            onUpdate={(updates) =>
              props.onUpdate(node.id, {
                type: 'group_gate',
                config: { ...node.config, ...updates },
              })
            }
          />
        );
      case 'mode_switch':
        return (
          <ModeSwitchNode
            config={node.config}
            isLocked={locked}
            onUpdate={(updates) =>
              props.onUpdate(node.id, {
                type: 'mode_switch',
                config: { ...node.config, ...updates },
              })
            }
          />
        );
      case 'sampling_params':
        return (
          <SamplingParamsNode
            config={node.config}
            isLocked={locked}
            onUpdate={(updates) =>
              props.onUpdate(node.id, {
                type: 'sampling_params',
                config: { ...node.config, ...updates },
              })
            }
          />
        );
    }
  };

  return (
    <aside class="flex flex-col h-full bg-night-water/60 backdrop-blur-xl border-l border-white/5">
      <Show
        when={props.node}
        fallback={
          <div class="flex-1 flex items-center justify-center px-6">
            <p class="text-sm text-mist-solid/35 text-center">选择一个节点编辑</p>
          </div>
        }
      >
        {(node) => (
          <>
            {/* Header */}
            <header class="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/5 flex-shrink-0">
              <div class="flex items-center gap-2 min-w-0">
                <h2 class="text-sm font-bold tracking-widest uppercase text-mist-solid truncate">
                  {NODE_TYPE_LABELS[node().type]}
                </h2>
                <Show when={isLocked()}>
                  <span class="inline-flex items-center gap-1 text-[10px] text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full flex-shrink-0">
                    <Lock size={10} />
                    锁定
                  </span>
                </Show>
              </div>
              <IconButton
                onClick={handleDelete}
                disabled={isLocked()}
                label="删除节点"
                tone="danger"
                size="sm"
              >
                <Trash2 size={14} />
              </IconButton>
            </header>

            {/* Body: dispatch to per-type config component */}
            <div class="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar">
              {renderConfig(node())}
            </div>
          </>
        )}
      </Show>
    </aside>
  );
};
