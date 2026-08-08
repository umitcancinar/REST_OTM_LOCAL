// ==========================================
// Tenant Types
// ==========================================

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  logo?: string;
  address?: string;
  phone?: string;
  email?: string;
  settings: TenantSettings;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSettings {
  currency: string;
  timezone: string;
  taxRate: number;
  serviceChargeRate: number;
  enableKDS: boolean;
  enablePrinter: boolean;
  defaultLanguage: string;
  theme: 'light' | 'dark' | 'auto';
}

export interface CreateTenantDTO {
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  email?: string;
  settings?: Partial<TenantSettings>;
}

export interface UpdateTenantDTO extends Partial<CreateTenantDTO> {}
