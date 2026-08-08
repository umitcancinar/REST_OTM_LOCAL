import { randomBytes } from 'crypto';

const LICENSE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * 80 bit rastgelelik, okunması kolay Crockford-benzeri alfabe.
 * 0/O ve 1/I gibi telefonda karışan karakterler bilerek kullanılmaz.
 */
export function generateLicenseKey(): string {
  const bytes = randomBytes(16);
  const token = Array.from(bytes, (byte) => LICENSE_ALPHABET[byte & 31]).join('');
  return `RSTO-${token.match(/.{1,4}/g)!.join('-')}`;
}

/** Tam anahtar yalnız oluşturma yanıtında görünür. */
export function maskLicenseKey(key: string): string {
  const suffix = key.replace(/-/g, '').slice(-4);
  return maskLicenseKeyLast4(suffix);
}

export function maskLicenseKeyLast4(last4: string | null): string {
  return `RSTO-****-****-****-${last4 || '????'}`;
}

export function initialExpiry(
  durationDays: number | undefined,
  explicitExpiry: string | undefined,
  now = new Date(),
): Date {
  if (explicitExpiry) return new Date(explicitExpiry);
  return new Date(now.getTime() + (durationDays ?? 365) * 24 * 60 * 60 * 1000);
}

/** Süresi geçmiş lisans bugünden, devam eden lisans mevcut bitişinden uzar. */
export function extendExpiry(current: Date, days: number, now = new Date()): Date {
  const base = current > now ? current : now;
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

export function lifecycleError(message: string, statusCode = 409): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

export function assertNotRevoked(status: string): void {
  if (status === 'REVOKED') {
    throw lifecycleError('İptal edilmiş lisans değiştirilemez.');
  }
}
