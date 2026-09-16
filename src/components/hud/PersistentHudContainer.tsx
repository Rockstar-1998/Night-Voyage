import { Component, For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import { listen } from '@tauri-apps/api/event';
import type { DataContainerPatch, InventoryItem } from '../../lib/backend/types';
import { sessionGameStateGet } from '../../lib/backend/game_state';

interface PersistentHudContainerProps {
  sessionId?: number;
  layoutId?: string;
  customCss?: string;
  className?: string;
  onOpenDebug?: () => void;
}

const XUANQING_HUD_CSS = `
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

.hud-panel {
  background: rgba(11, 15, 25, 0.85);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.37);
  overflow: hidden;
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.hud-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  user-select: none;
}

.hud-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hud-badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #06b6d4;
  box-shadow: 0 0 8px #06b6d4;
}

.hud-title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #94a3b8;
}

.hud-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hud-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #94a3b8;
  font-size: 11px;
  padding: 4px 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.hud-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #f8fafc;
  border-color: rgba(6, 182, 212, 0.4);
}

.hud-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* 状态条 */
.stat-bars-container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
}

.stat-item {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 6px 10px;
}

.stat-item-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.stat-name {
  font-size: 11px;
  font-weight: 600;
  color: #94a3b8;
}

.stat-val {
  font-size: 11px;
  font-family: monospace;
  font-weight: 700;
  color: #f1f5f9;
}

.stat-progress-bg {
  width: 100%;
  height: 5px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  overflow: hidden;
}

.stat-progress-fill {
  height: 100%;
  border-radius: 999px;
  transition: width 0.3s ease;
}

.stat-fill-hp { background: linear-gradient(90deg, #f43f5e, #fb7185); }
.stat-fill-mp { background: linear-gradient(90deg, #0284c7, #38bdf8); }
.stat-fill-san { background: linear-gradient(90deg, #7c3aed, #a855f7); }
.stat-fill-gold { background: linear-gradient(90deg, #d97706, #fbbf24); }
.stat-fill-weight { background: linear-gradient(90deg, #059669, #34d399); }
.stat-fill-default { background: linear-gradient(90deg, #0d9488, #2dd4bf); }

/* 背包槽位 */
.inventory-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #64748b;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.inventory-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(68px, 1fr));
  gap: 6px;
}

.inventory-slot {
  aspect-ratio: 1;
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 6px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  align-items: center;
  position: relative;
  transition: all 0.15s ease;
  cursor: pointer;
}

.inventory-slot:hover {
  border-color: rgba(6, 182, 212, 0.5);
  background: rgba(6, 182, 212, 0.08);
}

.slot-icon {
  font-size: 20px;
  margin-top: 2px;
}

.slot-name {
  font-size: 10px;
  color: #cbd5e1;
  text-align: center;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.slot-count {
  position: absolute;
  top: 3px;
  right: 4px;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 4px;
  font-size: 9px;
  font-family: monospace;
  font-weight: 700;
  color: #38bdf8;
  padding: 0 3px;
}

.slot-empty {
  aspect-ratio: 1;
  border: 1px dashed rgba(255, 255, 255, 0.05);
  border-radius: 8px;
}

/* 状态标签 / Flags */
.flags-container {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.flag-badge {
  font-size: 10px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(6, 182, 212, 0.1);
  border: 1px solid rgba(6, 182, 212, 0.25);
  color: #67e8f9;
}

/* Schema Patches 独立卡片 */
.schema-patches-container {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.schema-field-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  padding: 4px 8px;
  display: flex;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}

.schema-field-key {
  color: #64748b;
  font-weight: 600;
}

.schema-field-val {
  color: #f8fafc;
  font-family: monospace;
}
`;

export const PersistentHudContainer: Component<PersistentHudContainerProps> = (props) => {
  let hostEl: HTMLDivElement | undefined;
  const [shadowRoot, setShadowRoot] = createSignal<ShadowRoot | null>(null);
  const [collapsed, setCollapsed] = createSignal(false);

  const [stats, setStats] = createSignal<Record<string, number>>({});
  const [inventory, setInventory] = createSignal<InventoryItem[]>([]);
  const [flags, setFlags] = createSignal<Record<string, string>>({});
  const [schemaPatches, setSchemaPatches] = createSignal<Record<string, any>>({});

  onMount(() => {
    if (hostEl && !hostEl.shadowRoot) {
      const root = hostEl.attachShadow({ mode: 'open' });
      setShadowRoot(root);
    }

    // 监听 session:hud_state_patch 事件
    const unlistenPromise = listen<DataContainerPatch>('session:hud_state_patch', (event) => {
      const patch = event.payload;
      if (props.sessionId && patch.sessionId !== props.sessionId) {
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

  // 切换会话时加载最新状态快照
  createEffect(() => {
    const sId = props.sessionId;
    if (sId) {
      sessionGameStateGet(sId)
        .then((state) => {
          if (state) {
            setStats(state.stats || {});
            setInventory(state.inventory || []);
            setFlags(state.flags || {});
          }
        })
        .catch((err) => {
          console.warn('[PersistentHUD] load initial state failed:', err);
        });
    } else {
      setStats({});
      setInventory([]);
      setFlags({});
      setSchemaPatches({});
    }
  });

  const getStatClass = (key: string) => {
    const k = key.toLowerCase();
    if (k.includes('hp') || k.includes('health') || k.includes('生命')) return 'stat-fill-hp';
    if (k.includes('mp') || k.includes('mana') || k.includes('法力')) return 'stat-fill-mp';
    if (k.includes('san') || k.includes('理智')) return 'stat-fill-san';
    if (k.includes('gold') || k.includes('coin') || k.includes('金币')) return 'stat-fill-gold';
    if (k.includes('weight') || k.includes('负重')) return 'stat-fill-weight';
    return 'stat-fill-default';
  };

  const statEntries = () => Object.entries(stats());
  const flagEntries = () => Object.entries(flags());
  const patchEntries = () => Object.entries(schemaPatches());

  // 背包槽位固定补足至少 8 格
  const inventorySlots = () => {
    const items = inventory();
    const minSlots = 8;
    const empties = Math.max(0, minSlots - items.length);
    return { items, empties: new Array(empties).fill(0) };
  };

  return (
    <div ref={hostEl} class={props.className || 'w-full max-w-4xl mx-auto px-4 mb-2'}>
      <Show when={shadowRoot()}>
        {(root) => (
          <Portal mount={root()}>
            <style>{XUANQING_HUD_CSS}</style>
            <Show when={props.customCss}>
              <style>{props.customCss}</style>
            </Show>

            <div class="hud-panel">
              {/* 顶栏 */}
              <div class="hud-header">
                <div class="hud-title-group">
                  <div class="hud-badge-dot" />
                  <span class="hud-title">常驻状态面板 (Persistent HUD)</span>
                  <Show when={patchEntries().length > 0}>
                    <span style={{ "font-size": "10px", color: "#38bdf8", "background": "rgba(56, 189, 248, 0.1)", "padding": "1px 6px", "border-radius": "4px" }}>
                      Schema 已联动
                    </span>
                  </Show>
                </div>
                <div class="hud-actions">
                  <Show when={props.onOpenDebug}>
                    <button class="hud-btn" onClick={() => props.onOpenDebug?.()} title="调试与时序泳道">
                      时序调试
                    </button>
                  </Show>
                  <button class="hud-btn" onClick={() => setCollapsed(!collapsed())}>
                    {collapsed() ? '展开面板 ▼' : '收起 ▲'}
                  </button>
                </div>
              </div>

              {/* 折叠区 */}
              <Show when={!collapsed()}>
                <div class="hud-body">
                  {/* 数值属性条 */}
                  <Show when={statEntries().length > 0}>
                    <div class="stat-bars-container">
                      <For each={statEntries()}>
                        {([key, val]) => {
                          const maxVal = stats()[`max_${key}`] || stats()[`${key}_max`] || 100;
                          const pct = Math.min(100, Math.max(0, (val / maxVal) * 100));
                          return (
                            <div class="stat-item">
                              <div class="stat-item-header">
                                <span class="stat-name">{key}</span>
                                <span class="stat-val">{val}</span>
                              </div>
                              <div class="stat-progress-bg">
                                <div
                                  class={`stat-progress-fill ${getStatClass(key)}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </Show>

                  {/* 背包槽位 */}
                  <div class="inventory-section">
                    <div class="section-label">
                      <span>背包物品 ({inventory().length})</span>
                      <Show when={stats().weight !== undefined}>
                        <span>负重: {stats().weight} / {stats().max_weight || 100}</span>
                      </Show>
                    </div>
                    <div class="inventory-grid">
                      <For each={inventorySlots().items}>
                        {(item) => (
                          <div class="inventory-slot" title={`${item.name} (${item.count}件)\n单重: ${item.unitWeight} | 单价: ${item.unitPrice}`}>
                            <span class="slot-count">{item.count}</span>
                            <span class="slot-icon">{item.icon || '🎒'}</span>
                            <span class="slot-name">{item.name}</span>
                          </div>
                        )}
                      </For>
                      <For each={inventorySlots().empties}>
                        {() => <div class="slot-empty" />}
                      </For>
                    </div>
                  </div>

                  {/* Schema Patches 实时投影字段 */}
                  <Show when={patchEntries().length > 0}>
                    <div class="inventory-section">
                      <div class="section-label">
                        <span>Schema 投影变量</span>
                      </div>
                      <div class="schema-patches-container">
                        <For each={patchEntries()}>
                          {([k, v]) => (
                            <div class="schema-field-card">
                              <span class="schema-field-key">{k}:</span>
                              <span class="schema-field-val">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                  </Show>

                  {/* 状态标记 Tags */}
                  <Show when={flagEntries().length > 0}>
                    <div class="flags-container">
                      <For each={flagEntries()}>
                        {([k, v]) => (
                          <span class="flag-badge">
                            {k}: {v}
                          </span>
                        )}
                      </For>
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
