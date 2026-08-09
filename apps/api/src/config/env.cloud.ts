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
}

export const cloudEnv = {
  ...sharedEnv,
  LICENSE_PRIVATE_KEY,
  UPDATE_SIGNING_PRIVATE_KEY,
  UPDATE_SIGNING_PUBLIC_KEY,
  UPDATE_ARTIFACT_ALLOWED_ORIGINS,
  LICENSE_KEY_PEPPER_RING: licenseKeyPepperRing,
  MENU_PUBLIC_ID_SECRET: requireSecret(
    'MENU_PUBLIC_ID_SECRET',
    'dev-menu-public-id-secret-CHANGE-ME-32bytes',
  ),
  SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL || 'admin@restotm.com',
  SUPER_ADMIN_PASSWORD: requireSecret(
    'SUPER_ADMIN_PASSWORD',
    'dev-super-admin-CHANGE-ME',
  ),
} as const;

assertEnvironment();
