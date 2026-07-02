import { convertFileSrc } from '@tauri-apps/api/core';
import { invokeCommand } from './internal';
import type { ImportedAsset } from './types';

export async function assetsImportImage(sourcePath: string) {
  return invokeCommand<ImportedAsset>('assets_import_image', { sourcePath });
}

export async function assetsImportImageBytes(fileName: string, bytes: number[]) {
  return invokeCommand<ImportedAsset>('assets_import_image_bytes', { fileName, bytes });
}

export async function importManagedImageFile(file: File) {
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return assetsImportImageBytes(file.name, bytes);
}

export function toAssetUrl(path?: string | null) {
  if (!path) return undefined;
  return convertFileSrc(path);
}

export function resolveImageSrc(path: string | undefined | null, fallback: string) {
  if (!path) return fallback;
  if (/^(https?:|data:|blob:|asset:)/i.test(path)) return path;
  return toAssetUrl(path) ?? fallback;
}
