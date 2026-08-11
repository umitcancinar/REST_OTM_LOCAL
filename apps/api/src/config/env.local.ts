import path from 'path';
import { createPublicKey, createSecretKey } from 'crypto';
import {
  addStartupError,
  assertEnvironment,
  positiveInteger,
  requireAbsoluteLocalPath,
  requireSecret,
  sharedEnv,
} from './env.shared';
import { validateLocalLanHostname } from '../modules/local-connectivity/local-connectivity.runtime';
import { validateUpdateEndpoint } from '../modules/local-update/local-update.contract';

const LOCAL_LICENSE_SERVER_URL = (process.env.LOCAL_LICENSE_SERVER_URL || '').replace(/\/+$/, '');
const LOCAL_LICENSE_PUBLIC_KEY = (process.env.LOCAL_LICENSE_PUBLIC_KEY || '').replace(/\\n/g, '\n');
const LOCAL_UPDATE_MANIFEST_URL = process.env.LOCAL_UPDATE_MANIFEST_URL
  || (LOCAL_LICENSE_SERVER_URL
    ? `${LOCAL_LICENSE_SERVER_URL}/api/updates/v1/manifest`
    : 'https://updates.invalid/api/updates/v1/manifest');
const LOCAL_UPDATE_PUBLIC_KEY = (process.env.LOCAL_UPDATE_PUBLIC_KEY || '').replace(/\\n/g, '\n');
const LOCAL_UPDATE_ALLOWED_ORIGINS = (() => {
  const configured = (process.env.LOCAL_UPDATE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  let manifestOrigin = 'https://updates.invalid';
  try {
    manifestOrigin = validateUpdateEndpoint(LOCAL_UPDATE_MANIFEST_URL).origin;
  } catch {
    addStartupError(
      'LOCAL_UPDATE_MANIFEST_URL credentials/query/hash icermeyen gecerli bir HTTPS adresi olmali.',
    );
  }
  const values = configured.length > 0 ? configured : [manifestOrigin];
  const result: string[] = [];
  for (const value of values) {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.origin !== value || url.pathname !== '/') throw new Error();
      result.push(url.origin);
    } catch {
      addStartupError('LOCAL_UPDATE_ALLOWED_ORIGINS yalniz canonical HTTPS origin icermeli.');
    }
  }
  return [...new Set(result)];
})();
const LOCAL_LAN_HOSTNAME = (() => {
  const configured = process.env.LOCAL_LAN_HOSTNAME || '';
  if (sharedEnv.isProd && sharedEnv.RUNTIME_MODE === 'local' && !configured) {
    addStartupError('LOCAL_LAN_HOSTNAME installer tarafindan tanimlanmali.');
  }
  const resolved = configured || 'restotm-local';
  try {
    return validateLocalLanHostname(resolved);
  } catch {
    addStartupError('LOCAL_LAN_HOSTNAME gecerli bir DNS hostname olmali.');
    return 'restotm-local';
  }
})();
const LOCAL_BACKUP_KEY_ID = process.env.LOCAL_BACKUP_KEY_ID
  || (sharedEnv.isProd ? '' : 'development-only');
const LOCAL_BACKUP_EXTERNAL_DIR = (() => {
  const configured = process.env.LOCAL_BACKUP_EXTERNAL_DIR || '';
  if (sharedEnv.isProd && sharedEnv.RUNTIME_MODE === 'local') {
    if (!configured) addStartupError('LOCAL_BACKUP_EXTERNAL_DIR saha kurulumunda zorunludur.');
    else if (!path.isAbsolute(configured)) addStartupError('LOCAL_BACKUP_EXTERNAL_DIR mutlak bir yol olmali.');
  }
  return configured ? path.resolve(configured) : '';
})();
const LOCAL_BACKUP_EXTERNAL_VOLUME_POLICY = (() => {
  const configured = process.env.LOCAL_BACKUP_EXTERNAL_VOLUME_POLICY || '';
  const resolved = configured || 'warn';
  if (!['require-separate', 'warn', 'allow'].includes(resolved)) {
    addStartupError('LOCAL_BACKUP_EXTERNAL_VOLUME_POLICY require-separate, warn veya allow olmali.');
    return 'warn' as const;
  }
  if (
    sharedEnv.isProd
    && sharedEnv.RUNTIME_MODE === 'local'
    && resolved === 'allow'
  ) {
    addStartupError('Uretim local profilde volume uyarisi kapatilamaz; warn veya require-separate secilmeli.');
  }
  return resolved as 'require-separate' | 'warn' | 'allow';
})();

const LOCAL_BACKUP_KEY = (() => {
  const configured = process.env.LOCAL_BACKUP_KEY_BASE64 || '';
  const fallback = Buffer.alloc(32, 0xa5).toString('base64');
  const encoded = configured || (sharedEnv.isProd ? '' : fallback);
  if (sharedEnv.isProd && sharedEnv.RUNTIME_MODE === 'local' && !configured) {
    addStartupError(
      'LOCAL_BACKUP_KEY_BASE64 tanimli degil; supervisor DPAPI ile actigi 32-byte anahtari aktarmali.',
    );
  }
  if (!encoded) return createSecretKey(Buffer.alloc(0));
  const decoded = Buffer.from(encoded, 'base64');
  if (configured) delete process.env.LOCAL_BACKUP_KEY_BASE64;
  if (decoded.length !== 32 || decoded.toString('base64') !== encoded) {
    addStartupError('LOCAL_BACKUP_KEY_BASE64 canonical Base64 biciminde tam 32 byte olmali.');
    decoded.fill(0);
    return createSecretKey(Buffer.alloc(0));
  }
  const key = createSecretKey(decoded);
  decoded.fill(0);
  return key;
})();

const TABLE_QR_SIGNING_KEY = (() => {
  const configured = process.env.TABLE_QR_SIGNING_SECRET;
  const value = requireSecret(
    'TABLE_QR_SIGNING_SECRET',
    'development-table-qr-signing-secret-CHANGE-ME',
  );
  if (configured) delete process.env.TABLE_QR_SIGNING_SECRET;
  const bytes = Buffer.from(value, 'utf8');
  const key = createSecretKey(bytes);
  bytes.fill(0);
  return key;
})();

if (sharedEnv.isProd && sharedEnv.RUNTIME_MODE === 'local' && !LOCAL_BACKUP_KEY_ID) {
  addStartupError('LOCAL_BACKUP_KEY_ID tanimli degil.');
}
if (LOCAL_BACKUP_KEY_ID && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(LOCAL_BACKUP_KEY_ID)) {
  addStartupError('LOCAL_BACKUP_KEY_ID gecersiz.');
}

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

  if (!LOCAL_UPDATE_PUBLIC_KEY) addStartupError('LOCAL_UPDATE_PUBLIC_KEY tanimli degil.');
  else {
    try {
      const key = createPublicKey(LOCAL_UPDATE_PUBLIC_KEY);
      if (key.asymmetricKeyType !== 'ed25519') {
        addStartupError('LOCAL_UPDATE_PUBLIC_KEY Ed25519 olmali.');
      }
    } catch {
      addStartupError('LOCAL_UPDATE_PUBLIC_KEY gecerli PEM biciminde degil.');
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

const LOCAL_UPDATE_DATA_DIR = requireAbsoluteLocalPath(
  'LOCAL_UPDATE_DATA_DIR',
  path.resolve(process.cwd(), 'data/update'),
);

export const localEnv = {
  ...sharedEnv,
  PRINT_AGENT_SECRET: requireSecret(
    'PRINT_AGENT_SECRET',
    'dev-print-agent-secret-CHANGE-ME',
  ),
  INTERNAL_RUNTIME_TOKEN: requireSecret(
    'INTERNAL_RUNTIME_TOKEN',
    'dev-internal-runtime-token-CHANGE-ME',
  ),
  LOCAL_LICENSE_SERVER_URL,
  LOCAL_LICENSE_PUBLIC_KEY,
  LOCAL_LICENSE_DATA_DIR,
  LOCAL_LAN_HOSTNAME,
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
  LOCAL_UPDATE_MANIFEST_URL,
  LOCAL_UPDATE_PUBLIC_KEY,
  LOCAL_UPDATE_ALLOWED_ORIGINS,
  LOCAL_UPDATE_DATA_DIR,
  LOCAL_UPDATE_CHANNEL: process.env.LOCAL_UPDATE_CHANNEL || 'stable',
  LOCAL_UPDATE_DATABASE_SCHEMA_VERSION: positiveInteger(
    'LOCAL_UPDATE_DATABASE_SCHEMA_VERSION',
    1,
    0,
  ),
  LOCAL_POSTGRES_DATA_DIR: requireAbsoluteLocalPath(
    'LOCAL_POSTGRES_DATA_DIR',
    path.resolve(process.cwd(), 'data/postgres'),
  ),
  LOCAL_BACKUP_DIR: requireAbsoluteLocalPath(
    'LOCAL_BACKUP_DIR',
    path.resolve(process.cwd(), 'backups'),
  ),
  LOCAL_BACKUP_EXTERNAL_DIR,
  LOCAL_BACKUP_EXTERNAL_VOLUME_POLICY,
  // Her runtime kendi tek kullanimlik kopyasini alir. Kalici kopya Buffer
  // yerine KeyObject'te tutulur; constructor kendisine verilen kopyayi siler.
  LOCAL_BACKUP_KEY: () => Buffer.from(LOCAL_BACKUP_KEY.export()),
  LOCAL_BACKUP_KEY_ID,
  TABLE_QR_SIGNING_KEY: () => Buffer.from(TABLE_QR_SIGNING_KEY.export()),
  PG_DUMP_PATH: requireAbsoluteLocalPath('PG_DUMP_PATH', sharedEnv.isProd ? '' : 'pg_dump'),
  PG_RESTORE_PATH: requireAbsoluteLocalPath('PG_RESTORE_PATH', sharedEnv.isProd ? '' : 'pg_restore'),
  BACKUP_RETENTION_DAILY: positiveInteger('BACKUP_RETENTION_DAILY', 7, 0),
  BACKUP_RETENTION_WEEKLY: positiveInteger('BACKUP_RETENTION_WEEKLY', 4, 0),
  BACKUP_RETENTION_MONTHLY: positiveInteger('BACKUP_RETENTION_MONTHLY', 12, 0),
  BACKUP_EXTERNAL_RETENTION_DAILY: positiveInteger('BACKUP_EXTERNAL_RETENTION_DAILY', 30, 0),
  BACKUP_EXTERNAL_RETENTION_WEEKLY: positiveInteger('BACKUP_EXTERNAL_RETENTION_WEEKLY', 12, 0),
  BACKUP_EXTERNAL_RETENTION_MONTHLY: positiveInteger('BACKUP_EXTERNAL_RETENTION_MONTHLY', 24, 0),
  BACKUP_RESTORE_VERIFICATION_INTERVAL_MS: positiveInteger(
    'BACKUP_RESTORE_VERIFICATION_INTERVAL_MS',
    7 * 24 * 60 * 60 * 1000,
    60 * 60 * 1000,
  ),
  BACKUP_RESTORE_VERIFICATION_RETRY_MS: positiveInteger(
    'BACKUP_RESTORE_VERIFICATION_RETRY_MS',
    6 * 60 * 60 * 1000,
    60 * 1000,
  ),
} as const;

assertEnvironment();
