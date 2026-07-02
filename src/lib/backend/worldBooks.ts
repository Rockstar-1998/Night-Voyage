import { invokeCommand, toInvokeArgs } from './internal';
import type {
  UpsertWorldBookEntryPayload,
  WorldBookEntryRecord,
  WorldBookSummary,
} from './types';

export async function worldBooksList() {
  return invokeCommand<WorldBookSummary[]>('world_books_list');
}

export async function worldBooksCreate(payload: { title: string; description?: string; imagePath?: string }) {
  return invokeCommand<WorldBookSummary>('world_books_create', toInvokeArgs(payload));
}

export async function worldBooksUpdate(payload: { id: number; title?: string; description?: string; imagePath?: string }) {
  return invokeCommand<WorldBookSummary>('world_books_update', toInvokeArgs(payload));
}

export async function worldBooksDelete(id: number) {
  return invokeCommand<void>('world_books_delete', { id });
}

export async function worldBookEntriesList(worldBookId: number) {
  return invokeCommand<WorldBookEntryRecord[]>('world_book_entries_list', { worldBookId });
}

export async function worldBookEntriesUpsert(payload: UpsertWorldBookEntryPayload) {
  return invokeCommand<WorldBookEntryRecord>('world_book_entries_upsert', toInvokeArgs(payload));
}

export async function worldBookEntriesDelete(entryId: number) {
  return invokeCommand<void>('world_book_entries_delete', { entryId });
}

export async function worldBooksExport(id: number) {
  return invokeCommand<string>('world_books_export', { id });
}
