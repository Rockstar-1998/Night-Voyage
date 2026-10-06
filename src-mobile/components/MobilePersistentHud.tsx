import { Component, For, Show, createEffect, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { listen } from '@tauri-apps/api/event';
import type { DataContainerPatch, InventoryItem } from '../../src/lib/backend/types';
import { sessionGameStateGet } from '../../src/lib/backend/game_state';
import { presetUiLayoutForConversation } from '../../src/lib/backend/ui_layout';
import { MobileLayoutTree, type MobileHudSnapshot } from './MobileLayoutTree';

interface MobilePersistentHudProps {
  conversationId?: number;
  className?: string;
  onOpenDebug?: () => void;
}

const MOBILE_HUD_CSS = `
:host {
  display: block;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #e2e8f0;
  box-sizing: border-box;
}

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.hud-error {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 12px;
  background: rgba(244, 63, 94, 0.12);
  border-bottom: 1px solid rgba(244, 63, 94, 0.35);
  color: #fda4af;
  font-size: 11px;
  line-height: 1.4;
}

.mobile-hud {
  background: rgba(11, 15, 25, 0.9);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.hud-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  min-height: 44px;
}

.stats-pill-group {
  display: flex;
  align-items: center;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.stats-pill-group::-webkit-scrollbar {
  display: none;
}

.stat-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  padding: 3px 8px;
  font-size: 11px;
}

.stat-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.dot-hp { background: #f43f5e; box-shadow: 0 0 6px #f43f5e; }
.dot-mp { background: #0284c7; box-shadow: 0 0 6px #0284c7; }
.dot-gold { background: #eab308; box-shadow: 0 0 6px #eab308; }
.dot-default { background: #06b6d4; box-shadow: 0 0 6px #06b6d4; }

.stat-pill-label {
  color: #94a3b8;
  font-size: 10px;
}

.stat-pill-val {
  color: #f8fafc;
  font-weight: 700;
  font-family: monospace;
}

.btn-toggle {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #cbd5e1;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
}

.drawer-content {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(0, 0, 0, 0.25);
  max-height: 60vh;
  overflow-y: auto;
}

.section-title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #64748b;
  display: flex;
  justify-content: space-between;
}

.inventory-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.inventory-card {
  aspect-ratio: 1;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  position: relative;
}

.card-icon {
  font-size: 18px;
  margin-top: 2px;
}

.card-name {
  font-size: 9px;
  color: #cbd5e1;
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-count {
  position: absolute;
  top: 2px;
  right: 3px;
  background: rgba(6, 182, 212, 0.2);
  border: 1px solid rgba(6, 182, 212, 0.4);
  color: #38bdf8;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  padding: 0 3px;
}

.badges-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.badge-tag {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.debug-btn-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}

.btn-debug {
  background: rgba(6, 182, 212, 0.1);
  border: 1px solid rgba(6, 182, 212, 0.3);
  color: #38bdf8;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
}
`;

export const MobilePersistentHud: Component<MobilePersistentHudProps> = (props) => {
  let hostEl: HTMLDivElement | undefined;
  const [shadowRoot, setShadowRoot] = createSignal<ShadowRoot | null>(null);
  const [expanded, setExpanded] = createSignal(false);

  const [stats, setStats] = createSignal<Record<string, number>>({});
  const [inventory, setInventory] = createSignal<InventoryItem[]>([]);
  const [flags, setFlags] = createSignal<Record<string, string>>({});
  const [schemaPatches, setSchemaPatches] = createSignal<Record<string, any>>({});

  // 会话绑定的 UI 布局：未绑定时保持内置吸顶条（不是"静默降级"，是产品既定的默认视图）。
  const [layout] = createResource(
    () => props.conversationId,
    async (conversationId: number) => {
      try {
        return await presetUiLayoutForConversation(conversationId);
      } catch {
        return undefined;
      }
    },
  );

  const layoutError = () => {
    const err = layout.error;
    if (!err) return null;
    return err instanceof Error ? err.message : String(err);
  };

  const hudSnapshot = (): MobileHudSnapshot => ({
    stats: stats(),
    inventory: inventory(),
    flags: flags(),
    schemaPatches: schemaPatches(),
  });

  onMount(() => {
    if (hostEl && !hostEl.shadowRoot) {
      const root = hostEl.attachShadow({ mode: 'open' });
      setShadowRoot(root);
    }

    const unlistenPromise = listen<DataContainerPatch>('session:hud_state_patch', (event) => {
      const patch = event.payload;
      if (props.conversationId && patch.sessionId !== props.conversationId) {
        return;
      }
      if (patch.stats) {
        setStats((prev) => ({ ...prev, ...patch.stats }));
      }
      if (patch.inventory) {
        setInventory(patch.inventory);
      }
      if (patch.flags) {
        setFlags((prev) => ({ ...prev, ...patch.flags }));
      }
      if (patch.schemaPatches) {
        setSchemaPatches((prev) => ({ ...prev, ...patch.schemaPatches }));
      }
    });

    onCleanup(() => {
      unlistenPromise.then((unlisten) => unlisten());
    });
  });

  createEffect(() => {
    const cId = props.conversationId;
    if (cId) {
      sessionGameStateGet(cId)
        .then((state) => {
          if (state) {
            setStats(state.stats || {});
            setInventory(state.inventory || []);
            setFlags(state.flags || {});
          }
        })
        .catch((e) => {
          console.warn('[MobilePersistentHud] load state error:', e);
        });
    } else {
      setStats({});
      setInventory([]);
      setFlags({});
      setSchemaPatches({});
    }
  });

  const getDotClass = (key: string) => {
    const k = key.toLowerCase();
    if (k.includes('hp') || k.includes('health')) return 'dot-hp';
    if (k.includes('mp') || k.includes('mana')) return 'dot-mp';
    if (k.includes('gold')) return 'dot-gold';
    return 'dot-default';
  };

  const statEntries = () => Object.entries(stats());
  const flagEntries = () => Object.entries(flags());
  const patchEntries = () => Object.entries(schemaPatches());

  // 锚点分支（计划 §4 挂载锚点）：mobileBottomSticky 时外壳贴底（输入框上方微型条），
  // mobileDrawer 保持顶部吸顶抽屉。此前 BottomSticky 被画进顶部 = 锚点被无视。
  const isBottomSticky = () => layout()?.mountType === 'mobileBottomSticky';

  return (
    <div
      ref={hostEl}
      class={props.className || (isBottomSticky() ? 'fixed left-0 right-0 z-30' : 'w-full shrink-0 z-20')}
      style={isBottomSticky() ? { bottom: '64px' } : undefined}
    >
      <Show when={shadowRoot()}>
        {(root) => (
          <Portal mount={root()}>
            <style>{MOBILE_HUD_CSS}</style>
            {/* 布局自带 CSS 同样只在 Shadow DOM 内生效（C4） */}
            <Show when={layout()?.customCss}>
              <style>{layout()?.customCss}</style>
            </Show>
            <div class="mobile-hud">
              {/* 布局读取失败：显式报错，回退内置吸顶条 */}
              <Show when={layoutError()}>
                {(msg) => <div class="hud-error" role="alert">{msg()}</div>}
              </Show>
              {/* 绑定了 PC 锚点布局时不适用于移动端：提示，不硬塞 */}
              <Show when={layout() && !['mobileDrawer', 'mobileBottomSticky'].includes(layout()!.mountType)}>
                <div class="hud-error" role="alert">
                  该布局锚点为 {layout()?.mountType}（PC 端），移动端不渲染，改用内置吸顶条。
                </div>
              </Show>

              <Show when={layout() && layout()!.mountType === 'mobileDrawer'}>
                <div style={{ padding: '8px 12px' }}>
                  <MobileLayoutTree node={{ nodeType: 'container', ...(layout()!.rootContainer as any) }} snapshot={hudSnapshot()} conversationId={props.conversationId} />
                </div>
              </Show>
              <Show when={layout() && layout()!.mountType === 'mobileBottomSticky'}>
                <div style={{ padding: '4px 12px' }}>
                  <MobileLayoutTree node={{ nodeType: 'container', ...(layout()!.rootContainer as any) }} snapshot={hudSnapshot()} conversationId={props.conversationId} />
                </div>
              </Show>
              {/* 顶部常驻微型状态条（bottomSticky 布局时由布局树贴底承载，不双重渲染） */}
              <div class="hud-bar" style={isBottomSticky() ? { display: 'none' } : undefined}>
                <div class="stats-pill-group">
                  <For each={statEntries().slice(0, 4)}>
                    {([k, v]) => (
                      <div class="stat-pill">
                        <span class={`stat-dot ${getDotClass(k)}`} />
                        <span class="stat-pill-label">{k}</span>
                        <span class="stat-pill-val">{v}</span>
                      </div>
                    )}
                  </For>
                  <Show when={inventory().length > 0}>
                    <div class="stat-pill">
                      <span class="stat-pill-label">🎒</span>
                      <span class="stat-pill-val">{inventory().length}</span>
                    </div>
                  </Show>
                </div>
                <button class="btn-toggle" onClick={() => setExpanded(!expanded())}>
                  <span>HUD</span>
                  <span>{expanded() ? '▲' : '▼'}</span>
                </button>
              </div>

              {/* 下拉全量状态抽屉 */}
              <Show when={expanded()}>
                <div class="drawer-content">
                  {/* 背包物品 */}
                  <div>
                    <div class="section-title">
                      <span>背包物品 ({inventory().length})</span>
                      <Show when={stats().weight !== undefined}>
                        <span>负重: {stats().weight} / {stats().max_weight || 100}</span>
                      </Show>
                    </div>
                    <div class="inventory-grid" style={{ "margin-top": "6px" }}>
                      <For each={inventory()}>
                        {(item) => (
                          <div class="inventory-card">
                            <span class="card-count">x{item.count}</span>
                            <span class="card-icon">{item.icon || '📦'}</span>
                            <span class="card-name">{item.name}</span>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>

                  {/* Schema Patches */}
                  <Show when={patchEntries().length > 0}>
                    <div>
                      <div class="section-title">
                        <span>Schema 状态投影</span>
                      </div>
                      <div class="badges-row" style={{ "margin-top": "6px" }}>
                        <For each={patchEntries()}>
                          {([k, v]) => (
                            <span class="badge-tag">
                              {k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* 状态标记 */}
                  <Show when={flagEntries().length > 0}>
                    <div>
                      <div class="section-title">
                        <span>状态标记</span>
                      </div>
                      <div class="badges-row" style={{ "margin-top": "6px" }}>
                        <For each={flagEntries()}>
                          {([k, v]) => (
                            <span class="badge-tag">
                              {k} = {v}
                            </span>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* 调试入口 */}
                  <Show when={props.onOpenDebug}>
                    <div class="debug-btn-row">
                      <button class="btn-debug" onClick={() => props.onOpenDebug?.()}>
                        时序生命周期调试
                      </button>
                    </div>
                  </Show>
                </div>
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
};
