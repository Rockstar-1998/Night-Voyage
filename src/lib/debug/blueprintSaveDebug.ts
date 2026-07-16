/**
 * 隔离的蓝图保存/加载链路 debug 日志（临时文件）。
 *
 * 清理方式：删除此文件，并移除 BlueprintEditor.tsx 中所有调用点。
 * 所有日志前缀 `[bp-debug]`，便于在控制台过滤。
 *
 * 排查目标：确认用户编辑是否进入 graph store、保存的内容是否正确、
 * 加载时读到的内容是否与保存一致。
 */

export function logUpdate(nodeId: string, updates: unknown): void {
  console.log('[bp-debug] update nodeId=' + nodeId, updates);
}

export function logSaveStart(json: string): void {
  console.log(
    '[bp-debug] save-start json_len=' + json.length,
    json.slice(0, 300),
  );
}

export function logSaveDone(updatedGraph: string | null | undefined): void {
  const len = updatedGraph?.length ?? 0;
  console.log(
    '[bp-debug] save-done updated_graph_len=' + len,
    (updatedGraph ?? '').slice(0, 300),
  );
}

export function logLoad(rawGraph: string | null | undefined): void {
  const len = rawGraph?.length ?? 0;
  console.log(
    '[bp-debug] load raw_len=' + len,
    (rawGraph ?? '').slice(0, 300),
  );
}
