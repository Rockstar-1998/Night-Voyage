import { importManagedImageFile } from './backend';

export async function handleImportFile(
  event: Event,
  onImport: (file: File) => Promise<void> | void,
): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  await onImport(file);
}

export async function importImage(
  file: File | undefined,
  setUploadingImage: (uploading: boolean) => void,
  onImagePath: (storedPath: string) => void,
): Promise<void> {
  if (!file) return;
  setUploadingImage(true);
  try {
    const imported = await importManagedImageFile(file);
    onImagePath(imported.storedPath);
  } finally {
    setUploadingImage(false);
  }
}
