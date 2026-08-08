// ==========================================
// Lisans Dogrulama Semalari (Zod)
// ==========================================

import { z } from 'zod';

/** SHA-256 ozeti: 64 karakter onaltilik. */
const hardwareId = z
  .string()
  .regex(/^[a-f0-9]{64}$/i, 'Geçersiz cihaz kimliği');

export const activateSchema = z.object({
  licenseKey: z.string().min(8).max(64),
  hardwareId,
  hardwareIdShort: z.string().max(32).optional(),
  appVersion: z.string().max(32).optional(),
});

export const heartbeatSchema = z.object({
  licenseKey: z.string().min(8).max(64),
  hardwareId,
  appVersion: z.string().max(32).optional(),
});

// ==========================================
// Govde tipleri semadan tureti1lir
// ==========================================
// apps/api/tsconfig.json artik "strict": true. Zod'un tip cikarimi
// strictNullChecks'e dayandigi icin z.infer dogru sonuc verir: zorunlu
// alanlar zorunlu, .optional() olanlar istege bagli kalir. Tipleri elle
// yazmaya gerek yok — sema tek dogruluk kaynagidir ve ikisi asla ayrisamaz.
export type ActivateBody = z.infer<typeof activateSchema>;

export type HeartbeatBody = z.infer<typeof heartbeatSchema>;
