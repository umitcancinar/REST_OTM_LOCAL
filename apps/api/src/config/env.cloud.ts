import { createPrivateKey } from 'crypto';
import {
  addStartupError,
  assertEnvironment,
  requireSecret,
  sharedEnv,
} from './env.shared';
import { parseLicenseKeyPepperRing } from '../modules/license/license-key.policy';

const LICENSE_PRIVATE_KEY = (process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
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
