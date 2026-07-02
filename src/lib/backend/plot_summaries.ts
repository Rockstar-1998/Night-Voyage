import { invokeCommand, toInvokeArgs } from './internal';
import type { PlotSummaryRecord } from './types';

export async function plotSummariesList(conversationId: number) {
  return invokeCommand<PlotSummaryRecord[]>('plot_summaries_list', { conversationId });
}

export async function plotSummariesGetPending(conversationId: number) {
  return invokeCommand<PlotSummaryRecord[]>('plot_summaries_get_pending', { conversationId });
}

export async function plotSummariesUpsertManual(payload: {
  conversationId: number;
  batchIndex: number;
  summaryText: string;
}) {
  return invokeCommand<PlotSummaryRecord>('plot_summaries_upsert_manual', toInvokeArgs(payload));
}

export async function plotSummariesUpdateMode(payload: {
  conversationId: number;
  plotSummaryMode: 'ai' | 'manual' | string;
}) {
  return invokeCommand<string>('plot_summaries_update_mode', toInvokeArgs(payload));
}
