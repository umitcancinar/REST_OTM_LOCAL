import { createPrivateKey } from 'crypto';
import {
  addStartupError,
  assertEnvironment,
  requireSecret,
  sharedEnv,
} from './env.shared';

const LICENSE_PRIVATE_KEY = (process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (sharedEnv.isProd && sharedEnv.RUNTIME_MODE === 'cloud') {
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
  SUPER_ADMIN_EMAIL: process.env.SUPER_ADMIN_EMAIL || 'admin@restotm.com',
  SUPER_ADMIN_PASSWORD: requireSecret(
    'SUPER_ADMIN_PASSWORD',
    'dev-super-admin-CHANGE-ME',
  ),
} as const;

assertEnvironment();
