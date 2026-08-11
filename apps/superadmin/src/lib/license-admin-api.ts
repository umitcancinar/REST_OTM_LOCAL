import { api } from './api';

export type LicenseStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

export interface LicenseRecord {
  id: string;
  tenantId: string;
  restaurantName: string;
  tenantSlug: string;
  status: LicenseStatus;
  expiresAt: string;
  graceDays: number;
  features: string[];
  keyMasked: string;
  hardwareIdShort: string | null;
  lastHeartbeatAt: string | null;
  notes: string | null;
}

export interface LicenseListResponse {
  items: LicenseRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateLicenseResponse {
  license: LicenseRecord;
  /** Düz anahtar güvenlik gereği yalnız bu yanıtta döner. */
  key: string;
}

function queryString(params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value));
  });
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export const licenseAdminApi = {
  list: (params: { page?: number; limit?: number; search?: string } = {}) =>
    api.get(`/license-admin${queryString(params)}`) as Promise<LicenseListResponse>,
  create: (body: {
    tenantId: string;
    durationDays: number;
    graceDays: number;
    features: string[];
    notes?: string;
  }) => api.post('/license-admin', body) as Promise<CreateLicenseResponse>,
  extend: (id: string, days: number) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/extend`, { days }) as Promise<LicenseRecord>,
  suspend: (id: string) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/suspend`, {}) as Promise<LicenseRecord>,
  resume: (id: string) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/resume`, {}) as Promise<LicenseRecord>,
  revoke: (id: string) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/revoke`, {}) as Promise<LicenseRecord>,
};
