import { createHmac } from 'crypto';

const PEPPER_VERSION_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,31}$/;
const MIN_PEPPER_BYTES = 32;

export interface LicenseKeyPepper {
  version: string;
  secret: string;
}

export interface LicenseKeyPepperRing {
  activeVersion: string;
  peppers: readonly LicenseKeyPepper[];
}

export interface LicenseKeyMaterial {
  normalizedKey: string;
  keyHash: string;
  keyLast4: string;
  keyPepperVersion: string;
}

export function normalizeLicenseKey(rawKey: string): string {
  return rawKey.trim().toUpperCase();
}

export function parseLicenseKeyPepperRing(
  serialized: string,
  activeVersion: string,
): LicenseKeyPepperRing {
  if (!PEPPER_VERSION_PATTERN.test(activeVersion)) {
    throw new Error('LICENSE_KEY_ACTIVE_PEPPER_VERSION gecersiz.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('LICENSE_KEY_PEPPERS gecerli bir JSON object olmali.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('LICENSE_KEY_PEPPERS version:secret JSON object olmali.');
  }

  const peppers = Object.entries(parsed as Record<string, unknown>).map(([version, secret]) => {
    if (!PEPPER_VERSION_PATTERN.test(version)) {
      throw new Error(`Gecersiz lisans pepper surumu: ${version}`);
    }
    if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < MIN_PEPPER_BYTES) {
      throw new Error(`Lisans pepper ${version} en az ${MIN_PEPPER_BYTES} byte olmali.`);
    }
    return { version, secret };
  });

  if (peppers.length === 0) throw new Error('En az bir lisans pepper tanimlanmali.');
  if (!peppers.some((pepper) => pepper.version === activeVersion)) {
    throw new Error('Aktif lisans pepper surumu LICENSE_KEY_PEPPERS icinde bulunamadi.');
  }

  peppers.sort((left, right) => {
    if (left.version === activeVersion) return -1;
    if (right.version === activeVersion) return 1;
    return left.version.localeCompare(right.version);
  });
  return { activeVersion, peppers };
}

export function hashLicenseKey(normalizedKey: string, pepper: string): string {
  return createHmac('sha256', pepper).update(normalizedKey, 'utf8').digest('hex');
}

export function keyLast4(normalizedKey: string): string {
  return normalizedKey.replaceAll('-', '').slice(-4);
}

export function createLicenseKeyMaterial(
  rawKey: string,
  ring: LicenseKeyPepperRing,
  version = ring.activeVersion,
): LicenseKeyMaterial {
  const pepper = ring.peppers.find((candidate) => candidate.version === version);
  if (!pepper) throw new Error(`Lisans pepper surumu yuklu degil: ${version}`);
  const normalizedKey = normalizeLicenseKey(rawKey);
  return {
    normalizedKey,
    keyHash: hashLicenseKey(normalizedKey, pepper.secret),
    keyLast4: keyLast4(normalizedKey),
    keyPepperVersion: pepper.version,
  };
}

export function licenseKeyHashCandidates(
  rawKey: string,
  ring: LicenseKeyPepperRing,
): LicenseKeyMaterial[] {
  return ring.peppers.map((pepper) => createLicenseKeyMaterial(rawKey, ring, pepper.version));
}
