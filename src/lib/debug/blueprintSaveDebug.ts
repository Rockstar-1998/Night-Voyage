/**
 * 隔离的蓝图保存/加载链路 debug 日志（临时文件）。
 *
 * 清理方式：删除此文件，并移除 BlueprintEditor.tsx 和 BlueprintCanvas.tsx
 * 中所有调用点。同时删除后端 commands/debug.rs 和 lib.rs 中的注册。
 *
 * 所有日志前缀 `[bp-debug]`，通过 invoke 转发到后端 stderr 输出，
 * 这样在 Tauri release 构建中也能在后端日志看到前端 debug 信息。
 *
 * 排查目标：确认用户编辑是否进入 graph store、保存的内容是否正确、
 * 加载时读到的内容是否与保存一致、画布渲染时 visibleNodes 是否包含节点。
 */

import { invoke } from '@tauri-apps/api/core';

function sendToBackend(message: string): void {
  // 通过 invoke 调用后端 debug_log_frontend command，输出到 stderr
  // 使用 invoke 而非 console.log，确保 release 构建中也能在后端日志看到
  invoke('debug_log_frontend', { message }).catch(() => {
    // invoke 失败时不影响业务逻辑（C2：不吞异常，但 debug 日志失败可忽略）
  });
  // 同时输出到 console，方便开发模式下 F12 查看
  console.log(message);
}

export function logUpdate(nodeId: string, updates: unknown): void {
  const msg = '[bp-debug] update nodeId=' + nodeId;
  sendToBackend(msg);
  console.log(msg, updates);
}

export function logSaveStart(json: string): void {
  const msg =
    '[bp-debug] save-start json_len=' + json.length + ' prefix=' + json.slice(0, 300);
  sendToBackend(msg);
}

export function logSaveDone(updatedGraph: string | null | undefined): void {
  const len = updatedGraph?.length ?? 0;
  const prefix = (updatedGraph ?? '').slice(0, 300);
  const msg =
    '[bp-debug] save-done updated_graph_len=' + len + ' prefix=' + prefix;
  sendToBackend(msg);
}

export function logLoad(rawGraph: string | null | undefined): void {
  const len = rawGraph?.length ?? 0;
  const prefix = (rawGraph ?? '').slice(0, 300);
  const msg =
    '[bp-debug] load raw_len=' + len + ' prefix=' + prefix;
  sendToBackend(msg);
}

/**
 * JSON.parse 成功后调用：打印解析后的节点数和边数。
 */
export function logParsed(nodeCount: number, edgeCount: number): void {
  const msg =
    '[bp-debug] parsed nodes=' + nodeCount + ' edges=' + edgeCount;
  sendToBackend(msg);
}

/**
 * setGraph 后调用：打印 graph store 中的节点数。
 */
export function logGraphStore(count: number): void {
  const msg = '[bp-debug] graph-store nodes=' + count;
  sendToBackend(msg);
}

/**
 * JSON.parse 失败时调用：打印错误。
 */
export function logParseError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const full = '[bp-debug] parse-error: ' + msg;
  sendToBackend(full);
  console.error(full);
}

/**
 * 画布渲染时调用：打印 visibleNodes 长度和 hiddenNodeIds 大小。
 */
export function logRender(
  totalNodes: number,
  visibleCount: number,
  hiddenCount: number,
): void {
  const msg =
    '[bp-debug] render total=' + totalNodes +
    ' visible=' + visibleCount +
    ' hidden=' + hiddenCount;
  sendToBackend(msg);
}

/**
 * computeNodeLayout 抛错时调用：打印节点信息和错误。
 */
export function logLayoutError(
  nodeId: string,
  nodeType: string,
  err: unknown,
): void {
  const msg = err instanceof Error ? err.message : String(err);
  const full =
    '[bp-debug] layout-error nodeId=' + nodeId + ' type=' + nodeType + ' err=' + msg;
  sendToBackend(full);
  console.error(full);
}
