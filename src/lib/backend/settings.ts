import { invokeCommand } from './internal';
import type { Setting } from './types';

export async function settingsGetAll() {
  return invokeCommand<Setting[]>('settings_get_all');
}

export async function settingsSet(key: string, value: string) {
  return invokeCommand<Setting>('settings_set', { key, value });
}

export async function getMessageFormatConfig(): Promise<string> {
  const all = await settingsGetAll();
  const entry = all.find(s => s.key === 'messageFormatConfig');
  return entry?.value ?? '';
}

export async function setMessageFormatConfig(value: string): Promise<void> {
  await settingsSet('messageFormatConfig', value);
}
