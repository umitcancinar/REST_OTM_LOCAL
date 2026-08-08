import path from 'path';
import { createPublicKey } from 'crypto';
import {
  addStartupError,
  assertEnvironment,
  positiveInteger,
  requireAbsoluteLocalPath,
  requireSecret,
  sharedEnv,
} from './env.shared';

const LOCAL_LICENSE_SERVER_URL = (process.env.LOCAL_LICENSE_SERVER_URL || '').replace(/\/+$/, '');
const LOCAL_LICENSE_PUBLIC_KEY = (process.env.LOCAL_LICENSE_PUBLIC_KEY || '').replace(/\\n/g, '\n');

if (sharedEnv.isProd && sharedEnv.RUNTIME_MODE === 'local') {
  try {
    const url = new URL(LOCAL_LICENSE_SERVER_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('unsafe-url');
    }
  } catch {
    addStartupError(
      'LOCAL_LICENSE_SERVER_URL credentials/query/hash icermeyen gecerli bir HTTPS adresi olmali.',
    );
  }

  if (!LOCAL_LICENSE_PUBLIC_KEY) addStartupError('LOCAL_LICENSE_PUBLIC_KEY tanimli degil.');
  else {
    try {
      const key = createPublicKey(LOCAL_LICENSE_PUBLIC_KEY);
      if (key.asymmetricKeyType !== 'ed25519') {
        addStartupError('LOCAL_LICENSE_PUBLIC_KEY Ed25519 olmali.');
      }
    } catch {
      addStartupError('LOCAL_LICENSE_PUBLIC_KEY gecerli PEM biciminde degil.');
    }
  }
}

const LOCAL_LICENSE_DATA_DIR = (() => {
  const value = process.env.LOCAL_LICENSE_DATA_DIR || '';
  if (sharedEnv.isProd && sharedEnv.RUNTIME_MODE === 'local') {
    if (!value) addStartupError(
      'LOCAL_LICENSE_DATA_DIR mutlak ve servis hesabinin yazabildigi bir klasor olmali.',
    );
    else if (!path.isAbsolute(value)) addStartupError('LOCAL_LICENSE_DATA_DIR mutlak bir yol olmali.');
  }
  return value || path.resolve(process.cwd(), 'data/license');
})();

export const localEnv = {
  ...sharedEnv,
  PRINT_AGENT_SECRET: requireSecret(
    'PRINT_AGENT_SECRET',
    'dev-print-agent-secret-CHANGE-ME',
  ),
  LOCAL_LICENSE_SERVER_URL,
  LOCAL_LICENSE_PUBLIC_KEY,
  LOCAL_LICENSE_DATA_DIR,
  LOCAL_LICENSE_HEARTBEAT_MS: positiveInteger(
    'LOCAL_LICENSE_HEARTBEAT_MS',
    60 * 60 * 1000,
    60 * 1000,
  ),
  LOCAL_LICENSE_RETRY_MS: positiveInteger(
    'LOCAL_LICENSE_RETRY_MS',
    5 * 60 * 1000,
    30 * 1000,
  ),
  LOCAL_POSTGRES_DATA_DIR: requireAbsoluteLocalPath(
    'LOCAL_POSTGRES_DATA_DIR',
    path.resolve(process.cwd(), 'data/postgres'),
  ),
  LOCAL_BACKUP_DIR: requireAbsoluteLocalPath(
    'LOCAL_BACKUP_DIR',
    path.resolve(process.cwd(), 'backups'),
  ),
  PG_DUMP_PATH: requireAbsoluteLocalPath('PG_DUMP_PATH', sharedEnv.isProd ? '' : 'pg_dump'),
  BACKUP_RETENTION_DAILY: positiveInteger('BACKUP_RETENTION_DAILY', 7, 0),
  BACKUP_RETENTION_WEEKLY: positiveInteger('BACKUP_RETENTION_WEEKLY', 4, 0),
  BACKUP_RETENTION_MONTHLY: positiveInteger('BACKUP_RETENTION_MONTHLY', 12, 0),
} as const;

assertEnvironment();
