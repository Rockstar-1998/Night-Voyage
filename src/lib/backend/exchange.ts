import { invokeCommand } from './internal';
import type { ExchangeImportReport } from './types';

export async function exchangeImport(payloadJson: string) {
  return invokeCommand<ExchangeImportReport>('exchange_import', { payloadJson });
}

/** 触发浏览器下载一份 JSON 文本。沿用 preset 导出那套 Blob + anchor 方案。 */
export function downloadJsonFile(fileName: string, json: string) {
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** 把任意字符串净化成安全的文件名片段。 */
export function sanitizeFileName(input: string, fallback: string) {
  const cleaned = input
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .trim();
  return cleaned || fallback;
}
