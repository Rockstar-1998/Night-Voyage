import { invokeCommand, toInvokeArgs } from './internal';
import type {
  CharacterCard,
  CharacterCardType,
  CreateCharacterCardPayload,
} from './types';

export async function characterCardsList(cardType?: CharacterCardType) {
  return invokeCommand<CharacterCard[]>('character_cards_list', { cardType });
}

export async function characterCardsCreate(payload: CreateCharacterCardPayload) {
  return invokeCommand<CharacterCard>('character_cards_create', toInvokeArgs(payload));
}

export async function characterCardsUpdate(payload: CreateCharacterCardPayload & { id: number }) {
  return invokeCommand<CharacterCard>('character_cards_update', toInvokeArgs(payload));
}

export async function characterCardsDelete(id: number) {
  return invokeCommand<void>('character_cards_delete', { id });
}

export async function characterCardsExport(id: number) {
  return invokeCommand<string>('character_cards_export', { id });
}
