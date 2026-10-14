/**
 * Night Voyage —— 浏览器端透明 IPC 桥接器（Browser Use / Web 端适配层）
 *
 * 作用：
 * 当在纯浏览器环境（如 Antigravity Browser Use、Chrome、Playwright）中访问
 * http://127.0.0.1:1420 时，透明拦截所有 Tauri IPC 调用（@tauri-apps/api/core），
 * 经由 Vite 开发服务器中间件直连真实 SQLite 数据库：
 * D:\data\Night Voyage\.cache\instances\instance-a\night-voyage.sqlite3
 *
 * 约束合规：
 * - C1：前端代码依然是纯渲染（Render-Only）。
 * - C2：未在白名单的动作调用、金币不足门禁拦截等严格显式抛错，不静默回退。
 * - 原生兼容：在 Tauri 桌面外壳内自动 bypass，不影响原生 IPC 性能。
 */

import { mockIPC } from '@tauri-apps/api/mocks';
import { emit } from '@tauri-apps/api/event';

export function isBrowserEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  // 仅在原生 Tauri 桌面外壳中，__TAURI_INTERNALS__ 会提前由宿主注入
  return !(window as any).__TAURI_INTERNALS__;
}

export function initBrowserBridge(): void {
  if (!isBrowserEnvironment()) {
    return;
  }

  console.info('[NightVoyage] 正在初始化 Antigravity Browser Use 原生桥接器（直连 instance-a 数据库）...');

  // 0. 注入并代理 __TAURI_INTERNALS__.metadata.currentWindow，确保 TitleBar.tsx 的 getCurrentWindow() 正常执行
  let _internals: any = (window as any).__TAURI_INTERNALS__ || {};
  if (!_internals.metadata) _internals.metadata = {};
  if (!_internals.metadata.currentWindow) _internals.metadata.currentWindow = { label: 'main' };

  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    get() {
      if (_internals) {
        if (!_internals.metadata) _internals.metadata = {};
        if (!_internals.metadata.currentWindow) _internals.metadata.currentWindow = { label: 'main' };
      }
      return _internals;
    },
    set(v) {
      if (v && typeof v === 'object') {
        if (!v.metadata) {
          v.metadata = _internals?.metadata || { currentWindow: { label: 'main' } };
        } else if (!v.metadata.currentWindow) {
          v.metadata.currentWindow = { label: 'main' };
        }
        _internals = Object.assign({}, _internals, v);
      } else {
        _internals = v;
      }
    },
    configurable: true,
    enumerable: true,
  });

  // 1. 注册 mockIPC 拦截器，将调用透明转发给 Vite 中间件（直读写 instance-a SQLite 库）
  mockIPC(
    async (cmd: string, args: Record<string, any> = {}) => {
      console.log(`[BrowserBridge IPC] -> ${cmd}`, args);

      // 特殊本地短路指令
      if (cmd === 'show_window') return null;
      if (cmd === 'mem0_init_status') return { ok: true, error: null };
      if (cmd === 'get_conversation_mode') return 'single_legacy';

      try {
        const res = await fetch('/__sqlite_ipc', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cmd, args }),
        });

        const json = await res.json();
        if (!json.ok) {
          throw new Error(json.error || `IPC error on ${cmd}`);
        }

        const data = json.data;

        // 如果是 buy_item 成功执行，即刻发射 HUD 增量广播，触发前台 HUD 原地刷新
        if (cmd === 'action_bridge_invoke' && args.command === 'buy_item') {
          try {
            const stateRes = await fetch('/__sqlite_ipc', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cmd: 'session_state_get', args: { sessionId: args.conversationId } }),
            });
            const stateJson = await stateRes.json();
            if (stateJson.ok && stateJson.data) {
              void emit('session:hud_state_patch', {
                sessionId: args.conversationId,
                state: stateJson.data,
              });
            }
          } catch (_) {}
        }

        return data;
      } catch (err: any) {
        console.error(`[BrowserBridge Error] on ${cmd}:`, err.message || err);
        throw err;
      }
    },
    { shouldMockEvents: true },
  );

  console.info('[NightVoyage] Antigravity Browser Use 原生桥接器已就绪，已直连 instance-a 真实数据库！');
}
