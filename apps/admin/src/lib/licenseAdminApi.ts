import { api } from './api';

export type LicenseRecordStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'REVOKED';

export interface LicenseRecord {
  id: string;
  tenantId: string;
  restaurantName: string;
  status: LicenseRecordStatus;
  expiresAt: string;
  graceDays: number;
  features: string[];
  keyMasked: string;
  hardwareIdShort: string | null;
  activatedAt: string | null;
  lastHeartbeatAt: string | null;
  lastHeartbeatIp: string | null;
  appVersion: string | null;
  suspiciousCount: number;
  lastSuspiciousAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LicenseAuditLog {
  id: string;
  licenseId: string;
  operatorId: string | null;
  action: string;
  metadata: Record<string, unknown> | null;
  timestamp: string;
}

export interface LicenseDetail extends LicenseRecord {
  auditLogs: LicenseAuditLog[];
}

export interface LicenseListResponse {
  items: LicenseRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface CreateLicenseInput {
  tenantId: string;
  durationDays?: number;
  expiresAt?: string;
  graceDays: number;
  features: string[];
  notes?: string;
}

export interface CreateLicenseResponse {
  license: LicenseRecord;
  /** API bu değeri yalnız oluşturma yanıtında döndürür. */
  key: string;
}

export interface UpdateLicenseInput {
  graceDays?: number;
  features?: string[];
  notes?: string;
}

export interface RebindLicenseInput {
  hardwareId: string;
  hardwareIdShort?: string;
}

function queryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

export const licenseAdminApi = {
  list: (params: { page?: number; limit?: number; search?: string; status?: LicenseRecordStatus } = {}) =>
    api.get(`/license-admin${queryString(params)}`) as Promise<LicenseListResponse>,

  get: (id: string) =>
    api.get(`/license-admin/${encodeURIComponent(id)}`) as Promise<LicenseDetail>,

  create: (body: CreateLicenseInput) =>
    api.post('/license-admin', body) as Promise<CreateLicenseResponse>,

  update: (id: string, body: UpdateLicenseInput) =>
    api.patch(`/license-admin/${encodeURIComponent(id)}`, body) as Promise<LicenseRecord>,

  extend: (id: string, days: number) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/extend`, { days }) as Promise<LicenseRecord>,

  suspend: (id: string) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/suspend`, {}) as Promise<LicenseRecord>,

  resume: (id: string) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/resume`, {}) as Promise<LicenseRecord>,

  revoke: (id: string) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/revoke`, {}) as Promise<LicenseRecord>,

  resetActivation: (id: string) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/reset-activation`, {}) as Promise<LicenseRecord>,

  rebind: (id: string, body: RebindLicenseInput) =>
    api.post(`/license-admin/${encodeURIComponent(id)}/rebind`, body) as Promise<LicenseRecord>,
};
