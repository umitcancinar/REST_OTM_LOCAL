import { z } from 'zod';

const featureName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/, 'Özellik adı küçük harf, rakam, _ veya - içerebilir');

const features = z
  .array(featureName)
  .max(100)
  .transform((items) => [...new Set(items)].sort());

const notes = z.string().trim().max(2000).nullable();

export const listLicensesSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED']).optional(),
  tenantId: z.string().min(1).max(64).optional(),
  search: z.string().trim().max(100).optional(),
});

export const licenseIdSchema = z.object({
  id: z.string().min(1).max(64),
});

export const createLicenseSchema = z
  .object({
    tenantId: z.string().min(1).max(64),
    durationDays: z.number().int().min(1).max(3650).optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
    graceDays: z.number().int().min(0).max(30).default(7),
    features: features.default([]),
    notes: notes.optional(),
  })
  .refine((value) => !(value.durationDays && value.expiresAt), {
    message: 'durationDays ve expiresAt birlikte gönderilemez',
    path: ['expiresAt'],
  });

export const updateLicenseSchema = z
  .object({
    graceDays: z.number().int().min(0).max(30).optional(),
    features: features.optional(),
    notes: notes.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'En az bir alan gönderilmelidir');

export const extendLicenseSchema = z.object({
  days: z.number().int().min(1).max(3650),
  reason: z.string().trim().max(500).optional(),
});

export const actionReasonSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const rebindLicenseSchema = z.object({
  hardwareId: z.string().regex(/^[a-f0-9]{64}$/i, 'Geçersiz cihaz kimliği'),
  hardwareIdShort: z.string().trim().min(1).max(32).optional(),
  reason: z.string().trim().max(500).optional(),
});

export type ListLicensesInput = z.infer<typeof listLicensesSchema>;
export type CreateLicenseInput = z.infer<typeof createLicenseSchema>;
export type UpdateLicenseInput = z.infer<typeof updateLicenseSchema>;
export type ExtendLicenseInput = z.infer<typeof extendLicenseSchema>;
export type RebindLicenseInput = z.infer<typeof rebindLicenseSchema>;
