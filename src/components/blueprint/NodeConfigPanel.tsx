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

import { Component, Show, Switch, Match } from 'solid-js';
import type {
  BlueprintNode,
  BranchConfig,
  ConstantConfig,
  EndConfig,
  GroupGateConfig,
  ModeSwitchConfig,
  MutexGateConfig,
  NodeConfig,
  PromptConfig,
  RoleSwitchConfig,
  SamplingParamsConfig,
  SchemaFieldConfig,
  StartConfig,
} from '../../lib/blueprint/types';
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
import { RoleSwitchNode } from './nodes/RoleSwitchNode';
import { ConstantNode } from './nodes/ConstantNode';
import { BranchNode } from './nodes/BranchNode';
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
  role_switch: 'Role Switch',
  constant: 'Constant',
  branch: 'Branch',
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

  // ─── Per-type update helpers ───
  // Each helper narrows the config type so the per-type component receives
  // a properly typed config. The `as` cast is safe because <Match when=...>
  // guarantees the runtime type before this component is rendered.
  //
  // IMPORTANT: We use <Switch>/<Match> instead of a `renderConfig(node())`
  // function call because the latter re-creates the component on every
  // config change (each keystroke), causing the input to lose focus.
  // <Match> only re-mounts when the node *type* changes; config changes
  // update props in-place, preserving focus.

  const updateStart = (_nodeId: string) => {};
  const updatePrompt = (nodeId: string, updates: Partial<PromptConfig>) =>
    props.onUpdate(nodeId, {
      type: 'prompt',
      config: { ...(props.node!.config as PromptConfig), ...updates },
    });
  const updateSchemaField = (nodeId: string, updates: Partial<SchemaFieldConfig>) =>
    props.onUpdate(nodeId, {
      type: 'schema_field',
      config: { ...(props.node!.config as SchemaFieldConfig), ...updates },
    });
  const updateMutexGate = (nodeId: string, updates: Partial<MutexGateConfig>) =>
    props.onUpdate(nodeId, {
      type: 'mutex_gate',
      config: { ...(props.node!.config as MutexGateConfig), ...updates },
    });
  const updateGroupGate = (nodeId: string, updates: Partial<GroupGateConfig>) =>
    props.onUpdate(nodeId, {
      type: 'group_gate',
      config: { ...(props.node!.config as GroupGateConfig), ...updates },
    });
  const updateModeSwitch = (nodeId: string, updates: Partial<ModeSwitchConfig>) =>
    props.onUpdate(nodeId, {
      type: 'mode_switch',
      config: { ...(props.node!.config as ModeSwitchConfig), ...updates },
    });
  const updateRoleSwitch = (nodeId: string, updates: Partial<RoleSwitchConfig>) =>
    props.onUpdate(nodeId, {
      type: 'role_switch',
      config: { ...(props.node!.config as RoleSwitchConfig), ...updates },
    });
  const updateConstant = (nodeId: string, updates: Partial<ConstantConfig>) =>
    props.onUpdate(nodeId, {
      type: 'constant',
      config: { ...(props.node!.config as ConstantConfig), ...updates },
    });
  const updateBranch = (nodeId: string, updates: Partial<BranchConfig>) =>
    props.onUpdate(nodeId, {
      type: 'branch',
      config: { ...(props.node!.config as BranchConfig), ...updates },
    });
  const updateSamplingParams = (nodeId: string, updates: Partial<SamplingParamsConfig>) =>
    props.onUpdate(nodeId, {
      type: 'sampling_params',
      config: { ...(props.node!.config as SamplingParamsConfig), ...updates },
    });

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

            {/*
              Body: dispatch to per-type config component via <Switch>/<Match>.
              <Match> only re-mounts when node().type changes; config changes
              update props in-place, preserving input focus.
            */}
            <div class="flex-1 overflow-y-auto px-5 py-5 custom-scrollbar">
              <Switch fallback={null}>
                <Match when={node().type === 'start'}>
                  <StartNode
                    config={node().config as StartConfig}
                    isLocked={isLocked()}
                    onUpdate={() => updateStart(node().id)}
                  />
                </Match>
                <Match when={node().type === 'end'}>
                  <EndNode
                    config={node().config as EndConfig}
                    isLocked={isLocked()}
                    onUpdate={() => {}}
                  />
                </Match>
                <Match when={node().type === 'prompt'}>
                  <PromptNode
                    config={node().config as PromptConfig}
                    isLocked={isLocked()}
                    onUpdate={(updates) => updatePrompt(node().id, updates)}
                  />
                </Match>
                <Match when={node().type === 'schema_field'}>
                  <SchemaFieldNode
                    config={node().config as SchemaFieldConfig}
                    isLocked={isLocked()}
                    onUpdate={(updates) => updateSchemaField(node().id, updates)}
                  />
                </Match>
                <Match when={node().type === 'mutex_gate'}>
                  <MutexGateNode
                    config={node().config as MutexGateConfig}
                    isLocked={isLocked()}
                    onUpdate={(updates) => updateMutexGate(node().id, updates)}
                  />
                </Match>
                <Match when={node().type === 'group_gate'}>
                  <GroupGateNode
                    config={node().config as GroupGateConfig}
                    isLocked={isLocked()}
                    onUpdate={(updates) => updateGroupGate(node().id, updates)}
                  />
                </Match>
                <Match when={node().type === 'mode_switch'}>
                  <ModeSwitchNode
                    config={node().config as ModeSwitchConfig}
                    isLocked={isLocked()}
                    onUpdate={(updates) => updateModeSwitch(node().id, updates)}
                  />
                </Match>
                <Match when={node().type === 'role_switch'}>
                  <RoleSwitchNode
                    config={node().config as RoleSwitchConfig}
                    isLocked={isLocked()}
                    onUpdate={(updates) => updateRoleSwitch(node().id, updates)}
                  />
                </Match>
                <Match when={node().type === 'constant'}>
                  <ConstantNode
                    config={node().config as ConstantConfig}
                    isLocked={isLocked()}
                    onUpdate={(updates) => updateConstant(node().id, updates)}
                  />
                </Match>
                <Match when={node().type === 'branch'}>
                  <BranchNode
                    config={node().config as BranchConfig}
                    isLocked={isLocked()}
                    onUpdate={(updates) => updateBranch(node().id, updates)}
                  />
                </Match>
                <Match when={node().type === 'sampling_params'}>
                  <SamplingParamsNode
                    config={node().config as SamplingParamsConfig}
                    isLocked={isLocked()}
                    onUpdate={(updates) => updateSamplingParams(node().id, updates)}
                  />
                </Match>
              </Switch>
            </div>
          </>
        )}
      </Show>
    </aside>
  );
};
