// ==========================================
// Inventory & Recipe Types
// ==========================================

export enum StockUnit {
  GRAM = 'GRAM',
  KILOGRAM = 'KILOGRAM',
  LITER = 'LITER',
  MILLILITER = 'MILLILITER',
  PIECE = 'PIECE',
  PORTION = 'PORTION',
}

export interface InventoryItem {
  id: string;
  tenantId: string;
  name: string;
  unit: StockUnit;
  currentStock: number;
  minStockAlert: number;
  costPerUnit: number;
  supplier?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Recipe {
  id: string;
  tenantId: string;
  menuItemId: string;
  ingredients: RecipeIngredient[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RecipeIngredient {
  id: string;
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: StockUnit;
}

export interface WasteLog {
  id: string;
  tenantId: string;
  inventoryItemId: string;
  quantity: number;
  reason: string;
  loggedBy: string;
  createdAt: Date;
}

export interface StockAlert {
  inventoryItemId: string;
  itemName: string;
  currentStock: number;
  minStockAlert: number;
  unit: StockUnit;
  severity: 'warning' | 'critical';
}

export interface CreateInventoryItemDTO {
  name: string;
  unit: StockUnit;
  currentStock: number;
  minStockAlert: number;
  costPerUnit: number;
  supplier?: string;
}

export interface CreateRecipeDTO {
  menuItemId: string;
  ingredients: Omit<RecipeIngredient, 'id' | 'inventoryItemName'>[];
}
