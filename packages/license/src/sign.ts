// ==========================================
// Lisans uretimi — YALNIZCA lisans sunucusunda calisir
// ==========================================
// DIKKAT: Bu dosya OZEL anahtari kullanir. Musteriye giden pakete
// ASLA dahil edilmemeli. Paketleme adiminda bu modul disarida
// birakilir; verify.ts ise dahil edilir.
//
// Ozel anahtar sizarsa lisans sisteminin tamami degersiz hale gelir —
// herkes kendine sinirsiz lisans uretebilir. Anahtar yalnizca sunucunun
// ortam degiskeninde durur, repoda bulunmaz.

import { generateKeyPairSync, sign as edSign, createPrivateKey, randomBytes } from 'crypto';
import { LICENSE_FORMAT_VERSION, LicensePayload, SignedLicense } from './types';

/** Yeni bir Ed25519 anahtar cifti uretir. Kurulumda BIR KEZ calistirilir. */
export function generateKeyPair(): { publicKeyPem: string; privateKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
}

/**
 * Musteriye verilecek okunabilir lisans anahtari uretir.
 * Bicim: RSTO-XXXX-XXXX-XXXX
 *
 * Karistirilmasi kolay karakterler (0/O, 1/I/L) alfabede YOK — anahtari
 * telefonda okuyup yazdirmak zorunda kalindiginda hata cikmasin diye.
 */
export function generateLicenseKey(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const group = () =>
    Array.from(randomBytes(4))
      .map((b) => alphabet[b % alphabet.length])
      .join('');
  return `RSTO-${group()}-${group()}-${group()}`;
}

export interface IssueLicenseInput {
  licenseKey: string;
  tenantId: string;
  restaurantName: string;
  hardwareId: string;
  expiresAt: Date;
  graceDays?: number;
  features?: string[];
}

/**
 * Lisansi imzalar.
 *
 * Onemli ayrinti: imza, JSON.stringify ciktisinin TAM METNI uzerinden
 * hesaplanir ve dogrulama tarafina o metin aynen gonderilir. Nesne
 * yeniden serilestirilirse (farkli anahtar sirasi, farkli bosluk) imza
 * tutmaz. Bu yuzden SignedLicense.payload bir string'dir, nesne degil.
 */
export function issueLicense(input: IssueLicenseInput, privateKeyPem: string): SignedLicense {
  const payload: LicensePayload = {
    v: LICENSE_FORMAT_VERSION,
    licenseKey: input.licenseKey,
    tenantId: input.tenantId,
    restaurantName: input.restaurantName,
    hardwareId: input.hardwareId,
    issuedAt: new Date().toISOString(),
    expiresAt: input.expiresAt.toISOString(),
    graceDays: input.graceDays ?? 7,
    features: input.features ?? [],
  };

  const serialized = JSON.stringify(payload);
  const signature = edSign(
    null,
    Buffer.from(serialized, 'utf8'),
    createPrivateKey(privateKeyPem),
  );

  return { payload: serialized, signature: signature.toString('base64url') };
}
