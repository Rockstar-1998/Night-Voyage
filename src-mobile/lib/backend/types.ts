/**
 * Mobile Backend Type Definitions
 *
 * Independent mobile-side type definitions per C5 (Mobile Frontend Independence).
 * Mirrors Rust backend serde contracts for UI layouts, schemas, and game states.
 */

export type LayoutMountType =
  | 'rightDock'
  | 'topSticky'
  | 'floatingHUD'
  | 'mobileDrawer'
  | 'mobileBottomSticky';

export type ContainerKind = 'rootCanvas' | 'panel' | 'tabs' | 'grid';
export type WidgetType = 'statBar' | 'inventorySlotGrid' | 'dataLabel' | 'badge' | 'avatarFrame' | 'actionButton';

export interface WidgetDefinition {
  id: string;
  widgetType: WidgetType;
  label: string;
  dataBinding: string;
  x: number;
  y: number;
  width: number;
  height: number;
  config?: Record<string, unknown>;
  style?: Record<string, string>;
}

export interface LayoutContainer {
  id: string;
  kind: ContainerKind;
  layoutMode?: 'absolute' | 'flex' | 'grid' | string;
  x: number;
  y: number;
  width: number;
  height: number;
  style?: Record<string, string>;
  children?: LayoutNode[];
}

export type LayoutNode =
  | ({ nodeType: 'container' } & LayoutContainer)
  | ({ nodeType: 'widget' } & WidgetDefinition);

export interface StatRequirement {
  type: string;
  min?: number;
  max?: number;
}

export interface RequiredDataInterface {
  requiredStats: Record<string, StatRequirement>;
  requiredFlags: string[];
  requiredInventory: boolean;
}

export interface UILayoutDefinition {
  id: string;
  presetId: number;
  name: string;
  mountType: LayoutMountType;
  rootContainer: LayoutContainer;
  customCss?: string;
  requiredDataInterface: RequiredDataInterface;
  createdAt?: number;
  updatedAt?: number;
}

export interface SchemaFieldDefinition {
  name: string;
  fieldType: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  displayTarget: 'PersistentHUD' | 'InlineMessage';
  dbMapping?: string | null;
  description: string;
}

export interface SchemaDefinition {
  id: string;
  presetId: number;
  name: string;
  description: string;
  retentionDepth?: number | null;
  fields: SchemaFieldDefinition[];
  card?: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  count: number;
  unitWeight: number;
  unitPrice: number;
  icon?: string | null;
  properties?: Record<string, string>;
}

export interface DataContainer {
  stats: Record<string, number>;
  inventory: InventoryItem[];
  flags: Record<string, string>;
  scratchpad: Record<string, string>;
}
