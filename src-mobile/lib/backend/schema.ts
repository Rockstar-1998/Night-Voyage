import { invoke } from '@tauri-apps/api/core';
import type { SchemaDefinition } from './types';

export async function presetSchemasList(presetId: number): Promise<SchemaDefinition[]> {
  return invoke<SchemaDefinition[]>('preset_schemas_list', { presetId });
}

export async function presetSchemaGet(schemaId: string): Promise<SchemaDefinition> {
  return invoke<SchemaDefinition>('preset_schema_get', { schemaId });
}
