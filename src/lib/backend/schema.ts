import { invokeCommand } from './internal';
import type { SchemaDefinition } from './types';

export async function presetSchemasList(presetId: number): Promise<SchemaDefinition[]> {
  return invokeCommand<SchemaDefinition[]>('preset_schemas_list', { presetId });
}

export async function presetSchemaGet(schemaId: string): Promise<SchemaDefinition> {
  return invokeCommand<SchemaDefinition>('preset_schema_get', { schemaId });
}

export async function presetSchemaSave(schema: SchemaDefinition): Promise<SchemaDefinition> {
  return invokeCommand<SchemaDefinition>('preset_schema_save', { schema });
}

export async function presetSchemaDelete(schemaId: string): Promise<void> {
  return invokeCommand<void>('preset_schema_delete', { schemaId });
}

export async function presetSchemaReorderFields(schemaId: string, fieldNames: string[]): Promise<SchemaDefinition> {
  return invokeCommand<SchemaDefinition>('preset_schema_reorder_fields', { schemaId, fieldNames });
}
