import { invoke } from '@tauri-apps/api/core';
import type { DataContainer, DiceRollResult } from './types';

export async function sessionGameStateGet(sessionId: number): Promise<DataContainer> {
  return invoke<DataContainer>('session_game_state_get', { sessionId });
}

export async function sessionGameStateSave(sessionId: number, state: DataContainer): Promise<void> {
  return invoke<void>('session_game_state_save', { sessionId, state });
}

export async function sessionGameStateReset(sessionId: number): Promise<DataContainer> {
  return invoke<DataContainer>('session_game_state_reset', { sessionId });
}

export async function sessionToolCallExecute(
  sessionId: number,
  toolName: string,
  argumentsJson: string,
): Promise<string> {
  return invoke<string>('session_tool_call_execute', { sessionId, toolName, argumentsJson });
}

export async function agentDiceRoll(skill: string, dc: number, modifier: number): Promise<DiceRollResult> {
  return invoke<DiceRollResult>('agent_dice_roll', { skill, dc, modifier });
}

export async function agentValidateBannedWords(text: string, customWords?: string[]): Promise<void> {
  return invoke<void>('agent_validate_banned_words', { text, customWords: customWords || [] });
}
