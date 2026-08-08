// ==========================================
// Menu Types
// ==========================================

export interface MenuCategory {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  image?: string;
  sortOrder: number;
  isActive: boolean;
  items?: MenuItem[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MenuItem {
  id: string;
  tenantId: string;
  categoryId: string;
  name: string;
  description?: string;
  image?: string;
  basePrice: number;
  portionOptions: PortionOption[];
  extras: MenuExtra[];
  department: Department;
  preparationTime?: number; // in minutes
  isActive: boolean;
  sortOrder: number;
  allergens?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface PortionOption {
  id: string;
  name: string; // e.g. "Normal", "1.5 Porsiyon", "Duble"
  multiplier: number; // e.g. 1.0, 1.5, 2.0
  priceOverride?: number; // Optional fixed price override
}

export interface MenuExtra {
  id: string;
  name: string; // e.g. "Ekstra Peynir", "Kaşar"
  price: number;
}

export enum Department {
  KITCHEN = 'KITCHEN',
  BAR = 'BAR',
  GRILL = 'GRILL',
  PASTRY = 'PASTRY',
  COLD = 'COLD',
}

export interface CreateCategoryDTO {
  name: string;
  description?: string;
  sortOrder?: number;
}

export interface CreateMenuItemDTO {
  categoryId: string;
  name: string;
  description?: string;
  basePrice: number;
  portionOptions?: Omit<PortionOption, 'id'>[];
  extras?: Omit<MenuExtra, 'id'>[];
  department: Department;
  preparationTime?: number;
  allergens?: string[];
}
