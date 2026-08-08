import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';

export type RuntimeMode = 'all' | 'cloud' | 'local';

const RUNTIME_MODE: RuntimeMode = (() => {
  const value = process.env.RUNTIME_MODE || 'all';
  if (value === 'all' || value === 'cloud' || value === 'local') return value;
  throw new Error(`Gecersiz RUNTIME_MODE: ${value}. all, cloud veya local olmali.`);
})();

const startupErrors: string[] = [];
const MIN_SECRET_LENGTH = 32;

if (IS_PROD && RUNTIME_MODE === 'all') {
  startupErrors.push(
    'RUNTIME_MODE=all yalnizca gelistirme icindir; uretimde cloud veya local secilmelidir.',
  );
}

export function requireSecret(name: string, devFallback: string): string {
  const value = process.env[name];
  if (!IS_PROD) return value || devFallback;
  if (!value) {
    startupErrors.push(`${name} tanimli degil.`);
    return '';
  }
  if (value.includes('CHANGE-ME')) {
    startupErrors.push(`${name} ornek/varsayilan degeri iceriyor.`);
    return '';
  }
  if (value.length < MIN_SECRET_LENGTH) {
    startupErrors.push(`${name} cok kisa — en az ${MIN_SECRET_LENGTH} karakter olmali.`);
    return '';
  }
  return value;
}

export function requireValue(name: string, devFallback: string): string {
  const value = process.env[name];
  if (!IS_PROD) return value || devFallback;
  if (!value) {
    startupErrors.push(`${name} tanimli degil.`);
    return '';
  }
  return value;
}

export function positiveInteger(name: string, fallback: number, minimum: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum) {
    startupErrors.push(`${name} en az ${minimum} olan bir tam sayi olmali.`);
    return fallback;
  }
  return value;
}

export function requireAbsoluteLocalPath(name: string, devFallback: string): string {
  const configured = process.env[name];
  const value = configured || devFallback;
  if (IS_PROD && RUNTIME_MODE === 'local') {
    if (!configured) startupErrors.push(`${name} tanimli degil.`);
    else if (!path.isAbsolute(value)) startupErrors.push(`${name} mutlak bir yol olmali.`);
  }
  return value;
}

export function addStartupError(message: string): void {
  startupErrors.push(message);
}

export function assertEnvironment(): void {
  if (startupErrors.length === 0) return;
  const lines = [...new Set(startupErrors)].map((error) => `  - ${error}`).join('\n');
  throw new Error(
    '\n\n=========================================================\n' +
      ' BASLATMA DURDURULDU — uretim yapilandirmasi eksik\n' +
      '=========================================================\n' +
      `${lines}\n\n` +
      ' Guclu bir sir uretmek icin:\n' +
      '   openssl rand -base64 48\n\n' +
      ' NOT: JWT sirlarini degistirmek tum aktif oturumlari sonlandirir;\n' +
      ' kullanicilar yeniden giris yapar. Beklenen davranis budur.\n' +
      '=========================================================\n',
  );
}

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
];

const CORS_ORIGIN = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const sharedEnv = {
  NODE_ENV,
  RUNTIME_MODE,
  PORT: parseInt(process.env.PORT || '4000', 10),
  BIND_HOST: process.env.BIND_HOST || (IS_PROD ? '127.0.0.1' : '0.0.0.0'),
  DATABASE_URL: requireValue('DATABASE_URL', ''),
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  JWT_ACCESS_SECRET: requireSecret(
    'JWT_ACCESS_SECRET',
    'dev-access-secret-CHANGE-ME-NOT-FOR-PROD',
  ),
  JWT_REFRESH_SECRET: requireSecret(
    'JWT_REFRESH_SECRET',
    'dev-refresh-secret-CHANGE-ME-NOT-FOR-PROD',
  ),
  JWT_ACCESS_EXPIRY: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  JWT_REFRESH_EXPIRY: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  BCRYPT_SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10),
  CORS_ORIGIN: CORS_ORIGIN.length > 0 || IS_PROD ? CORS_ORIGIN : DEV_ORIGINS,
  APP_VERSION: process.env.APP_VERSION || '1.0.0',
  isDev: NODE_ENV === 'development',
  isProd: IS_PROD,
} as const;
