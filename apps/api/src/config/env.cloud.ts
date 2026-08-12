import { createPrivateKey, createPublicKey } from 'crypto';
import {
  addStartupError,
  assertEnvironment,
  requireSecret,
  sharedEnv,
} from './env.shared';
import { parseLicenseKeyPepperRing } from '../modules/license/license-key.policy';

const LICENSE_PRIVATE_KEY = (process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const UPDATE_SIGNING_PRIVATE_KEY = (process.env.UPDATE_SIGNING_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const UPDATE_SIGNING_PUBLIC_KEY = (process.env.UPDATE_SIGNING_PUBLIC_KEY || '').replace(/\\n/g, '\n');
const isProductionCloud = sharedEnv.isProd && sharedEnv.RUNTIME_MODE === 'cloud';
const B2_KEY_ID = process.env.B2_KEY_ID || '';
const B2_APPLICATION_KEY = process.env.B2_APPLICATION_KEY || '';
const B2_BUCKET_NAME = process.env.B2_BUCKET_NAME || '';
const B2_BUCKET_ID = process.env.B2_BUCKET_ID || '';
const B2_REGION = process.env.B2_REGION || '';
const B2_KEY_PREFIX = (process.env.B2_KEY_PREFIX || 'backups/').replace(/^\/+|\/+$/g, '') + '/';
const B2_S3_ENDPOINT = (() => {
  const raw = process.env.B2_S3_ENDPOINT || '';
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
      || !/^s3\.[a-z0-9-]+\.backblazeb2\.com$/i.test(url.hostname)
    ) throw new Error('unsafe-b2-endpoint');
    return url.origin;
  } catch {
    addStartupError('B2_S3_ENDPOINT canonical Backblaze HTTPS endpoint olmali.');
    return '';
  }
})();
const B2_CLOUD_BACKUP_ENABLED = process.env.B2_CLOUD_BACKUP_ENABLED === 'true' || Boolean(
  B2_KEY_ID || B2_APPLICATION_KEY || B2_BUCKET_NAME || B2_BUCKET_ID || B2_REGION || B2_S3_ENDPOINT,
);
const LICENSE_KEY_ACTIVE_PEPPER_VERSION =
  process.env.LICENSE_KEY_ACTIVE_PEPPER_VERSION || (isProductionCloud ? '' : 'dev-v1');
const LICENSE_KEY_PEPPERS = process.env.LICENSE_KEY_PEPPERS || (isProductionCloud
  ? ''
  : JSON.stringify({ 'dev-v1': 'development-only-license-key-pepper-change-me' }));

let licenseKeyPepperRing;
try {
  licenseKeyPepperRing = parseLicenseKeyPepperRing(
    LICENSE_KEY_PEPPERS,
    LICENSE_KEY_ACTIVE_PEPPER_VERSION,
  );
} catch (error) {
  addStartupError(error instanceof Error ? error.message : 'Lisans pepper yapilandirmasi gecersiz.');
  // Typed inert value; assertEnvironment below still stops the cloud process.
  licenseKeyPepperRing = parseLicenseKeyPepperRing(
    JSON.stringify({ invalid: 'invalid-fallback-license-key-pepper-000' }),
    'invalid',
  );
}

const UPDATE_ARTIFACT_ALLOWED_ORIGINS = (() => {
  const raw = process.env.UPDATE_ARTIFACT_ALLOWED_ORIGINS
    || (isProductionCloud ? '' : 'https://updates.example');
  const configured = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const result: string[] = [];
  for (const value of configured) {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:'
        || url.username
        || url.password
        || url.pathname !== '/'
        || url.search
        || url.hash
        || value.replace(/\/$/, '') !== url.origin
      ) throw new Error('not-canonical-origin');
      result.push(url.origin);
    } catch {
      addStartupError('UPDATE_ARTIFACT_ALLOWED_ORIGINS yalniz canonical HTTPS origin icermeli.');
    }
  }
  if (isProductionCloud && !process.env.UPDATE_ARTIFACT_ALLOWED_ORIGINS) {
    addStartupError('UPDATE_ARTIFACT_ALLOWED_ORIGINS tanimli degil.');
  } else if (isProductionCloud && result.length === 0) {
    addStartupError('UPDATE_ARTIFACT_ALLOWED_ORIGINS en az bir HTTPS origin icermeli.');
  }
  return [...new Set(result)];
})();

function validateUpdateSigningTrust(): void {
  if (!UPDATE_SIGNING_PRIVATE_KEY && !UPDATE_SIGNING_PUBLIC_KEY) {
    if (isProductionCloud) {
      addStartupError('UPDATE_SIGNING_PRIVATE_KEY tanimli degil.');
      addStartupError('UPDATE_SIGNING_PUBLIC_KEY tanimli degil.');
    }
    return;
  }
  if (!UPDATE_SIGNING_PRIVATE_KEY || !UPDATE_SIGNING_PUBLIC_KEY) {
    addStartupError('Update signing private/public key birlikte tanimlanmali.');
    return;
  }
  try {
    const privateKey = createPrivateKey(UPDATE_SIGNING_PRIVATE_KEY);
    const publicKey = createPublicKey(UPDATE_SIGNING_PUBLIC_KEY);
    if (privateKey.asymmetricKeyType !== 'ed25519' || publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('wrong-key-type');
    }
    const derivedPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
    const configuredPublic = publicKey.export({ type: 'spki', format: 'der' });
    if (!derivedPublic.equals(configuredPublic)) throw new Error('key-pair-mismatch');

    if (LICENSE_PRIVATE_KEY) {
      const licensePublic = createPublicKey(createPrivateKey(LICENSE_PRIVATE_KEY))
        .export({ type: 'spki', format: 'der' });
      if (licensePublic.equals(configuredPublic)) throw new Error('shared-license-trust-root');
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    if (reason === 'key-pair-mismatch') {
      addStartupError('UPDATE_SIGNING_PRIVATE_KEY ile UPDATE_SIGNING_PUBLIC_KEY eslesmiyor.');
    } else if (reason === 'shared-license-trust-root') {
      addStartupError('Update ve lisans imzalama anahtarlari farkli trust root olmali.');
    } else {
      addStartupError('Update signing anahtarlari gecerli Ed25519 PEM olmali.');
    }
  }
}

validateUpdateSigningTrust();

if (isProductionCloud) {
  if (sharedEnv.CORS_ORIGIN.length === 0) {
    addStartupError(
      'CORS_ORIGIN tanimli degil — cloud panel adresleri virgulle ayrilmis olmali.',
    );
  }
  if (!LICENSE_PRIVATE_KEY) addStartupError('LICENSE_PRIVATE_KEY tanimli degil.');
  else {
    try {
      const key = createPrivateKey(LICENSE_PRIVATE_KEY);
      if (key.asymmetricKeyType !== 'ed25519') {
        addStartupError('LICENSE_PRIVATE_KEY Ed25519 olmali.');
      }
    } catch {
      addStartupError('LICENSE_PRIVATE_KEY gecerli PEM biciminde degil.');
    }
  }
  if (B2_CLOUD_BACKUP_ENABLED) {
    for (const [name, value] of [
      ['B2_KEY_ID', B2_KEY_ID],
      ['B2_APPLICATION_KEY', B2_APPLICATION_KEY],
      ['B2_BUCKET_NAME', B2_BUCKET_NAME],
      ['B2_BUCKET_ID', B2_BUCKET_ID],
      ['B2_REGION', B2_REGION],
      ['B2_S3_ENDPOINT', B2_S3_ENDPOINT],
    ] as const) {
      if (!value) addStartupError(`${name} tanimli degil.`);
    }
  }
}

if (B2_BUCKET_NAME && !/^[a-z0-9][a-z0-9-]{4,48}[a-z0-9]$/.test(B2_BUCKET_NAME)) {
  addStartupError('B2_BUCKET_NAME gecersiz.');
}
if (B2_BUCKET_ID && !/^[a-f0-9]{24}$/i.test(B2_BUCKET_ID)) {
  addStartupError('B2_BUCKET_ID gecersiz.');
}
if (B2_REGION && !/^[a-z0-9-]{3,32}$/.test(B2_REGION)) {
  addStartupError('B2_REGION gecersiz.');
}
if (
  !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*\/$/.test(B2_KEY_PREFIX)
  || B2_KEY_PREFIX.split('/').includes('..')
) {
  addStartupError('B2_KEY_PREFIX guvenli bir object prefix olmali.');
}
if (B2_S3_ENDPOINT && B2_REGION) {
  const endpointRegion = new URL(B2_S3_ENDPOINT).hostname.split('.')[1];
  if (endpointRegion !== B2_REGION) addStartupError('B2_S3_ENDPOINT ile B2_REGION eslesmiyor.');
}

export const cloudEnv = {
  ...sharedEnv,
  LICENSE_PRIVATE_KEY,
  UPDATE_SIGNING_PRIVATE_KEY,
  UPDATE_SIGNING_PUBLIC_KEY,
  UPDATE_ARTIFACT_ALLOWED_ORIGINS,
  LICENSE_KEY_PEPPER_RING: licenseKeyPepperRing,
  B2_KEY_ID,
  B2_APPLICATION_KEY,
  B2_BUCKET_NAME,
  B2_BUCKET_ID,
  B2_REGION,
  B2_KEY_PREFIX,
  B2_S3_ENDPOINT,
  B2_CLOUD_BACKUP_ENABLED,
  MENU_PUBLIC_ID_SECRET: requireSecret(
    'MENU_PUBLIC_ID_SECRET',
    'dev-menu-public-id-secret-CHANGE-ME-32bytes',
  ),
  // Superadmin Next.js BFF ile API arasindaki makineden-makineye kimlik.
  // Kullanici tarayicisina veya NEXT_PUBLIC_ degiskenine asla acilmaz.
  SUPERADMIN_BFF_SERVICE_SECRET: requireSecret(
    'SUPERADMIN_BFF_SERVICE_SECRET',
    'dev-superadmin-bff-service-secret-change-me',
  ),
  // MFA kodlari DB'de plaintext degil bu pepper ile HMAC'lenmis tutulur.
  SUPERADMIN_MFA_PEPPER: requireSecret(
    'SUPERADMIN_MFA_PEPPER',
    'dev-superadmin-mfa-pepper-change-me-32bytes',
  ),
  SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL || 'admin@restotm.com',
  SUPER_ADMIN_PASSWORD: requireSecret(
    'SUPER_ADMIN_PASSWORD',
    'dev-super-admin-CHANGE-ME',
  ),
} as const;

assertEnvironment();
