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
// Govde tipleri BILEREK elle yazildi (z.infer degil)
// ==========================================
// apps/api/tsconfig.json icinde "strict": false. Zod'un tip cikarimi
// strictNullChecks'e dayanir; kapali oldugunda kosullu tipleri cokuyor ve
// z.infer TUM alanlari istege bagli gosteriyor. Bu da servis girdileriyle
// uyumsuzluk uretiyor.
//
// Kalici cozum apps/api icin strict modu acmaktir; ancak bu, mevcut kodda
// genis capli duzeltme gerektirdiginden ayri ele alinmali. O gune kadar
// tipleri burada acikca tanimlayip semayla es tutuyoruz.
export interface ActivateBody {
  licenseKey: string;
  hardwareId: string;
  hardwareIdShort?: string;
  appVersion?: string;
}

export interface HeartbeatBody {
  licenseKey: string;
  hardwareId: string;
  appVersion?: string;
}
