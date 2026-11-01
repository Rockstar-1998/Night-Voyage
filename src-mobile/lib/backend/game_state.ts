import { invoke } from '@tauri-apps/api/core';
import type { DataContainer } from './types';

export async function sessionGameStateGet(sessionId: number): Promise<DataContainer> {
  return invoke<DataContainer>('session_game_state_get', { sessionId });
}
