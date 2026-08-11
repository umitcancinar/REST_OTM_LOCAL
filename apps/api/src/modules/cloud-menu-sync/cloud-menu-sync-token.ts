import {
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign as edSign,
  verify as edVerify,
} from 'crypto';

export const MENU_SYNC_TOKEN_VERSION = 1 as const;
export const MENU_SYNC_TOKEN_TTL_MS = 70 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const PURPOSE = 'menu-publication';

export interface MenuSyncTokenPayload {
  v: typeof MENU_SYNC_TOKEN_VERSION;
  purpose: typeof PURPOSE;
  licenseId: string;
  tenantId: string;
  hardwareId: string;
  issuedAt: string;
  expiresAt: string;
  jti: string;
}

function invalidToken(): Error & { statusCode: number } {
  return Object.assign(new Error('Sync token invalid'), { statusCode: 401 });
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 64;
}

function parsePayload(serialized: string): MenuSyncTokenPayload {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw invalidToken();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidToken();
  const candidate = value as Record<string, unknown>;
  const expectedKeys = ['expiresAt', 'hardwareId', 'issuedAt', 'jti', 'licenseId', 'purpose', 'tenantId', 'v'];
  if (JSON.stringify(Object.keys(candidate).sort()) !== JSON.stringify(expectedKeys)) throw invalidToken();
  if (
    candidate.v !== MENU_SYNC_TOKEN_VERSION
    || candidate.purpose !== PURPOSE
    || !isIdentifier(candidate.licenseId)
    || !isIdentifier(candidate.tenantId)
    || typeof candidate.hardwareId !== 'string'
    || !/^[a-f0-9]{64}$/i.test(candidate.hardwareId)
    || typeof candidate.issuedAt !== 'string'
    || typeof candidate.expiresAt !== 'string'
    || typeof candidate.jti !== 'string'
    || !/^[A-Za-z0-9_-]{32}$/.test(candidate.jti)
  ) throw invalidToken();
  return candidate as unknown as MenuSyncTokenPayload;
}

export function issueMenuSyncToken(
  input: Pick<MenuSyncTokenPayload, 'licenseId' | 'tenantId' | 'hardwareId'>,
  privateKeyPem: string,
  now = new Date(),
): string {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Menu sync signing key Ed25519 olmali.');
  const payload: MenuSyncTokenPayload = {
    v: MENU_SYNC_TOKEN_VERSION,
    purpose: PURPOSE,
    licenseId: input.licenseId,
    tenantId: input.tenantId,
    hardwareId: input.hardwareId.toLowerCase(),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MENU_SYNC_TOKEN_TTL_MS).toISOString(),
    jti: randomBytes(24).toString('base64url'),
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = edSign(null, Buffer.from(encoded, 'ascii'), key).toString('base64url');
  return `${encoded}.${signature}`;
}

export function verifyMenuSyncToken(
  token: string,
  publicKeyPem: string,
  now = new Date(),
): MenuSyncTokenPayload {
  if (typeof token !== 'string' || token.length < 100 || token.length > 2048) throw invalidToken();
  const parts = token.split('.');
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) throw invalidToken();
  const [encoded, signature] = parts;
  let key;
  try {
    key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw invalidToken();
    if (!edVerify(null, Buffer.from(encoded, 'ascii'), key, Buffer.from(signature, 'base64url'))) {
      throw invalidToken();
    }
  } catch {
    throw invalidToken();
  }
  const payload = parsePayload(Buffer.from(encoded, 'base64url').toString('utf8'));
  const issuedAt = new Date(payload.issuedAt);
  const expiresAt = new Date(payload.expiresAt);
  if (
    Number.isNaN(issuedAt.getTime())
    || Number.isNaN(expiresAt.getTime())
    || issuedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS
    || expiresAt.getTime() <= now.getTime()
    || expiresAt.getTime() - issuedAt.getTime() !== MENU_SYNC_TOKEN_TTL_MS
  ) throw invalidToken();
  return payload;
}

export function licensePublicKeyFromPrivate(privateKeyPem: string): string {
  return createPublicKey(createPrivateKey(privateKeyPem))
    .export({ type: 'spki', format: 'pem' })
    .toString();
}
