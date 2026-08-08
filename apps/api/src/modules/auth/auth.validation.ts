// ==========================================
// Auth Validation Schemas (Zod)
// ==========================================

import { z } from 'zod';
import { validators } from '../../utils/validators';

export const loginSchema = z.object({
  email: validators.email,
  password: z.string().min(1, 'Password is required'),
  slug: z.string().optional(), // Added for multi-tenant disambiguation
});

export const pinLoginSchema = z.object({
  tenantSlug: validators.slug,
  pin: validators.pin,
});

// GUVENLIK: tenantId BILEREK burada yok. Once istekten (body'den) aliniyordu;
// bu, herhangi bir OWNER'in baska bir restoranin tenantId'sini vererek o
// restorana kullanici eklemesine izin veriyordu (tam izolasyon kirilmasi).
// Artik sunucu tarafinda getTenantId(req) ile belirleniyor — bkz.
// auth.controller.ts register().
export const registerSchema = z.object({
  email: validators.email,
  password: validators.password,
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(['OWNER', 'CHEF', 'CASHIER', 'WAITER']),
  pin: validators.pin.optional(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: validators.password,
});

export const adminResetPasswordSchema = z.object({
  targetRole: z.enum(['OWNER', 'CHEF', 'CASHIER', 'WAITER']),
  newPassword: validators.password,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type PinLoginInput = z.infer<typeof pinLoginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AdminResetPasswordInput = z.infer<typeof adminResetPasswordSchema>;
