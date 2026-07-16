/**
 * 隔离的蓝图保存/加载链路 debug 日志（临时文件）。
 *
 * 清理方式：删除此文件，并移除 BlueprintEditor.tsx 和 BlueprintCanvas.tsx
 * 中所有调用点。
 * 所有日志前缀 `[bp-debug]`，便于在控制台过滤。
 *
 * 排查目标：确认用户编辑是否进入 graph store、保存的内容是否正确、
 * 加载时读到的内容是否与保存一致、画布渲染时 visibleNodes 是否包含节点。
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

/**
 * JSON.parse 成功后调用：打印解析后的节点数和边数。
 */
export function logParsed(nodeCount: number, edgeCount: number): void {
  console.log(
    '[bp-debug] parsed nodes=' + nodeCount + ' edges=' + edgeCount,
  );
}

/**
 * setGraph 后调用：打印 graph store 中的节点数。
 */
export function logGraphStore(count: number): void {
  console.log('[bp-debug] graph-store nodes=' + count);
}

/**
 * JSON.parse 失败时调用：打印错误。
 */
export function logParseError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[bp-debug] parse-error: ' + msg);
}

/**
 * 画布渲染时调用：打印 visibleNodes 长度和 hiddenNodeIds 大小。
 */
export function logRender(
  totalNodes: number,
  visibleCount: number,
  hiddenCount: number,
): void {
  console.log(
    '[bp-debug] render total=' + totalNodes +
    ' visible=' + visibleCount +
    ' hidden=' + hiddenCount,
  );
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
  console.error(
    '[bp-debug] layout-error nodeId=' + nodeId + ' type=' + nodeType + ' err=' + msg,
  );
}
