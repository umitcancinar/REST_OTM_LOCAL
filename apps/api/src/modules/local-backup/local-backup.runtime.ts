import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createSecretKey,
  randomBytes,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

const MANIFEST_VERSION = 2;
const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SCHEDULER_POLL_MS = 15 * 60 * 1000;
const DEFAULT_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_RESTORE_VERIFICATION_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RESTORE_VERIFICATION_RETRY_MS = 6 * 60 * 60 * 1000;
const DEFAULT_EXTERNAL_RETENTION: BackupRetentionPolicy = { daily: 30, weekly: 12, monthly: 24 };
const REPLICATION_STATE_VERSION = 1;
const REPLICATION_STATE_FILE = '.restotm-replication-state.json';
const BACKUP_V1_FILE_PATTERN = /^restotm-\d{8}T\d{9}Z-[0-9a-f-]{36}\.dump$/i;
const BACKUP_V2_FILE_PATTERN = /^restotm-\d{8}T\d{9}Z-[0-9a-f-]{36}\.dump\.enc$/i;
const BACKUP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BACKUP_KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BYTES = 16;

export type BackupReason = 'manual' | 'scheduled';

export interface PostgresConnectionOptions {
  host: string;
  port: number;
  user: string;
  password?: string;
  database: string;
  sslMode?: 'disable' | 'allow' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
}

export interface BackupRetentionPolicy {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface LocalBackupConfig {
  /** PostgreSQL veri dizini veya onu barindiran uygulama veri dizini. */
  dataDir: string;
  /** Veri dizininin disinda, sadece REST_OTM'nin yonettigi yedek dizini. */
  backupDir: string;
  /** Opsiyonel harici disk/NAS mount hedefi; production local profilde zorunludur. */
  externalBackupDir?: string;
  externalVolumePolicy?: 'require-separate' | 'warn' | 'allow';
  /** B2 kimlik bilgisi tasimayan, Control API'den kisa omurlu izin alan adaptor. */
  cloudReplica?: BackupCloudReplicaAdapter;
  connection: PostgresConnectionOptions;
  /** Supervisor tarafindan DPAPI ile acilip yalniz bu prosese verilen 32 byte anahtar. */
  encryptionKey: Uint8Array;
  /** Anahtar rotasyonunda hangi DPAPI kaydinin kullanilacagini belirleyen, sir olmayan kimlik. */
  encryptionKeyId: string;
  pgDumpPath?: string;
  pgRestorePath?: string;
  retention?: Partial<BackupRetentionPolicy>;
  externalRetention?: Partial<BackupRetentionPolicy>;
  processTimeoutMs?: number;
  backupIntervalMs?: number;
  schedulerPollMs?: number;
  lockStaleMs?: number;
  restoreVerificationIntervalMs?: number;
  restoreVerificationRetryMs?: number;
  clock?: () => Date;
}

export interface BackupProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}

export interface BackupProcessAdapter {
  run(executable: string, args: readonly string[], options: BackupProcessOptions): Promise<void>;
}

export interface BackupManifestV1 {
  manifestVersion: 1;
  id: string;
  format: 'pg_dump-custom';
  reason: BackupReason;
  createdAt: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface BackupManifestV2 {
  manifestVersion: 2;
  id: string;
  format: 'pg_dump-custom';
  reason: BackupReason;
  createdAt: string;
  fileName: string;
  /** Sifreli dosyanin boyutu. */
  sizeBytes: number;
  plainSizeBytes: number;
  cipherSha256: string;
  encryption: {
    algorithm: 'aes-256-gcm';
    keyId: string;
    ivBase64: string;
    authTagBase64: string;
  };
}

export type BackupManifest = BackupManifestV1 | BackupManifestV2;

export interface BackupDownload {
  manifest: BackupManifest;
  absolutePath: string;
}

export interface BackupCloudReplicaAdapter {
  upload(download: BackupDownload): Promise<void>;
}

export interface BackupRestoreVerification {
  manifest: BackupManifest;
  plainSizeBytes: number;
  verifiedAt: string;
}

export interface RestoreVerificationRecord {
  status: 'SUCCESS' | 'FAILED';
  backupId: string | null;
  verifiedAt: string;
  local: 'VERIFIED' | 'FAILED' | 'NOT_AVAILABLE';
  external: 'VERIFIED' | 'FAILED' | 'NOT_AVAILABLE' | 'NOT_CONFIGURED';
  code: string | null;
}

export interface LocalBackupStatus {
  running: boolean;
  schedulerRunning: boolean;
  backupCount: number;
  invalidEntryCount: number;
  lastSuccess: BackupManifest | null;
  lastError: { code: string; occurredAt: string } | null;
  retention: BackupRetentionPolicy;
  externalReplication: {
    configured: boolean;
    running: boolean;
    healthy: boolean;
    alarm: 'NONE' | 'WARNING' | 'ERROR';
    pendingCount: number;
    lastSuccess: { id: string; occurredAt: string } | null;
    lastError: { code: string; occurredAt: string } | null;
    volume: {
      policy: 'require-separate' | 'warn' | 'allow';
      separate: boolean | null;
      warningCode: string | null;
      acceptanceRequired: boolean;
    };
    retention: BackupRetentionPolicy | null;
  };
  cloudReplication: {
    configured: boolean;
    running: boolean;
    healthy: boolean;
    alarm: 'NONE' | 'ERROR';
    pendingCount: number;
    lastSuccess: { id: string; occurredAt: string } | null;
    lastError: { code: string; occurredAt: string } | null;
    encryption: 'AES-256-GCM_BEFORE_UPLOAD';
    credentialPolicy: 'SHORT_LIVED_PRESIGNED_URL';
  };
  restoreVerification: {
    running: boolean;
    lastRestoreVerification: RestoreVerificationRecord | null;
    nextDueAt: string;
    alarm: 'NONE' | 'WARNING' | 'ERROR';
    intervalMs: number;
    retryMs: number;
    licenseGatePolicy: 'RECOVERY_MAINTENANCE_ALWAYS';
  };
}

export class LocalBackupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = 'LocalBackupError';
  }
}

export class BackupAlreadyRunningError extends LocalBackupError {
  constructor() {
    super('BACKUP_ALREADY_RUNNING', 'Bir yedekleme islemi zaten calisiyor.', 409);
    this.name = 'BackupAlreadyRunningError';
  }
}

export class ExecFileBackupProcessAdapter implements BackupProcessAdapter {
  async run(
    executable: string,
    args: readonly string[],
    options: BackupProcessOptions,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile(
        executable,
        [...args],
        {
          cwd: options.cwd,
          env: options.env,
          timeout: options.timeoutMs,
          windowsHide: true,
          maxBuffer: 1024 * 1024,
        },
        (error) => {
          if (!error) {
            resolve();
            return;
          }

          const processError = error as NodeJS.ErrnoException & { code?: string | number; killed?: boolean };
          const failureCode = processError.killed
            ? 'PG_DUMP_TIMEOUT'
            : processError.code === 'ENOENT'
              ? 'PG_DUMP_NOT_FOUND'
              : 'PG_DUMP_FAILED';
          reject(new LocalBackupError(failureCode, 'PostgreSQL yedegi olusturulamadi.', 502));
        },
      );
    });
  }
}

export class ExecFileRestoreProcessAdapter implements BackupProcessAdapter {
  async run(
    executable: string,
    args: readonly string[],
    options: BackupProcessOptions,
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile(
        executable,
        [...args],
        {
          cwd: options.cwd,
          env: options.env,
          timeout: options.timeoutMs,
          windowsHide: true,
          maxBuffer: 4 * 1024 * 1024,
        },
        (error) => {
          if (!error) {
            resolve();
            return;
          }
          const processError = error as NodeJS.ErrnoException & { killed?: boolean };
          const failureCode = processError.killed
            ? 'PG_RESTORE_TIMEOUT'
            : processError.code === 'ENOENT'
              ? 'PG_RESTORE_NOT_FOUND'
              : 'BACKUP_ARCHIVE_INVALID';
          reject(new LocalBackupError(failureCode, 'Yedek arsivi geri yukleme dogrulamasindan gecemedi.', 409));
        },
      );
    });
  }
}

interface BackupScanResult {
  backups: BackupManifest[];
  invalidEntryCount: number;
}

interface HeldBackupLock {
  token: string;
  release(): Promise<void>;
}

interface ReplicationState {
  stateVersion: 1;
  pendingIds: string[];
  lastSuccess: { id: string; occurredAt: string } | null;
  lastError: { code: string; occurredAt: string } | null;
  lastRestoreVerification: RestoreVerificationRecord | null;
  nextRestoreVerificationDueAt: string | null;
  cloudPendingIds: string[];
  cloudCompletedIds: string[];
  cloudLastSuccess: { id: string; occurredAt: string } | null;
  cloudLastError: { code: string; occurredAt: string } | null;
}

function positiveDuration(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1_000) {
    throw new LocalBackupError('INVALID_BACKUP_CONFIG', `${field} en az 1000 ms olmalidir.`);
  }
  return resolved;
}

function retentionCount(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > 3660) {
    throw new LocalBackupError('INVALID_BACKUP_CONFIG', `${field} gecersiz.`);
  }
  return resolved;
}

function isReplicationState(value: unknown): value is ReplicationState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<ReplicationState>;
  const validEvent = (event: ReplicationState['lastSuccess'] | undefined): boolean => (
    event === null
    || Boolean(
      event
      && typeof event.id === 'string'
      && BACKUP_ID_PATTERN.test(event.id)
      && typeof event.occurredAt === 'string'
      && Number.isFinite(Date.parse(event.occurredAt)),
    )
  );
  const validError = state.lastError === null || Boolean(
    state.lastError
    && typeof state.lastError.code === 'string'
    && /^[A-Z0-9_]{3,64}$/.test(state.lastError.code)
    && typeof state.lastError.occurredAt === 'string'
    && Number.isFinite(Date.parse(state.lastError.occurredAt)),
  );
  const restore = state.lastRestoreVerification;
  const validRestore = restore === undefined || restore === null || Boolean(
    restore
    && (restore.status === 'SUCCESS' || restore.status === 'FAILED')
    && (restore.backupId === null || BACKUP_ID_PATTERN.test(restore.backupId))
    && typeof restore.verifiedAt === 'string'
    && Number.isFinite(Date.parse(restore.verifiedAt))
    && ['VERIFIED', 'FAILED', 'NOT_AVAILABLE'].includes(restore.local)
    && ['VERIFIED', 'FAILED', 'NOT_AVAILABLE', 'NOT_CONFIGURED'].includes(restore.external)
    && (restore.code === null || /^[A-Z0-9_]{3,64}$/.test(restore.code)),
  );
  const validNextDue = state.nextRestoreVerificationDueAt === undefined
    || state.nextRestoreVerificationDueAt === null
    || (typeof state.nextRestoreVerificationDueAt === 'string'
      && Number.isFinite(Date.parse(state.nextRestoreVerificationDueAt)));
  const validIdList = (items: unknown): boolean => items === undefined || (
    Array.isArray(items)
    && items.length <= 10_000
    && items.every((id) => typeof id === 'string' && BACKUP_ID_PATTERN.test(id))
    && new Set(items).size === items.length
  );
  const validCloudError = state.cloudLastError === undefined || state.cloudLastError === null || Boolean(
    state.cloudLastError
    && typeof state.cloudLastError.code === 'string'
    && /^[A-Z0-9_]{3,64}$/.test(state.cloudLastError.code)
    && typeof state.cloudLastError.occurredAt === 'string'
    && Number.isFinite(Date.parse(state.cloudLastError.occurredAt)),
  );
  return state.stateVersion === REPLICATION_STATE_VERSION
    && Array.isArray(state.pendingIds)
    && state.pendingIds.length <= 10_000
    && state.pendingIds.every((id) => typeof id === 'string' && BACKUP_ID_PATTERN.test(id))
    && new Set(state.pendingIds).size === state.pendingIds.length
    && validEvent(state.lastSuccess)
    && validError
    && validRestore
    && validNextDue
    && validIdList(state.cloudPendingIds)
    && validIdList(state.cloudCompletedIds)
    && (state.cloudLastSuccess === undefined || validEvent(state.cloudLastSuccess))
    && validCloudError;
}

function safeDecode(value: string, field: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new LocalBackupError('INVALID_DATABASE_URL', `${field} URL kodlamasi gecersiz.`);
  }
}

/** DATABASE_URL'yi parola veya tum URL'yi loglamadan pg_dump alanlarina ayirir. */
export function postgresConnectionFromUrl(databaseUrl: string): PostgresConnectionOptions {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new LocalBackupError('INVALID_DATABASE_URL', 'PostgreSQL baglanti adresi gecersiz.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new LocalBackupError('INVALID_DATABASE_URL', 'Yalniz PostgreSQL baglanti adresi desteklenir.');
  }

  const database = safeDecode(parsed.pathname.replace(/^\//, ''), 'Veritabani adi');
  const user = safeDecode(parsed.username, 'Kullanici adi');
  const password = parsed.password ? safeDecode(parsed.password, 'Parola') : undefined;
  const rawPort = parsed.port || '5432';
  const port = Number(rawPort);
  const sslModeValue = parsed.searchParams.get('sslmode') ?? undefined;
  const allowedSslModes = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']);

  if (!parsed.hostname || !database || !user || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new LocalBackupError('INVALID_DATABASE_URL', 'PostgreSQL baglanti alanlari eksik veya gecersiz.');
  }
  if (sslModeValue && !allowedSslModes.has(sslModeValue)) {
    throw new LocalBackupError('INVALID_DATABASE_URL', 'PostgreSQL sslmode degeri desteklenmiyor.');
  }

  return {
    host: parsed.hostname.replace(/^\[|\]$/g, ''),
    port,
    user,
    ...(password ? { password } : {}),
    database,
    ...(sslModeValue ? { sslMode: sslModeValue as PostgresConnectionOptions['sslMode'] } : {}),
  };
}

function validateConnection(connection: PostgresConnectionOptions): void {
  for (const [field, value] of [
    ['host', connection.host],
    ['user', connection.user],
    ['database', connection.database],
  ] as const) {
    if (!value.trim() || value.includes('\0') || value.includes('\n') || value.includes('\r')) {
      throw new LocalBackupError('INVALID_BACKUP_CONFIG', `${field} gecersiz.`);
    }
  }
  if (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535) {
    throw new LocalBackupError('INVALID_BACKUP_CONFIG', 'PostgreSQL portu gecersiz.');
  }
  if (connection.password?.includes('\0')) {
    throw new LocalBackupError('INVALID_BACKUP_CONFIG', 'PostgreSQL parola alani gecersiz.');
  }
}

function validatePgToolPath(executable: string, expectedName: 'pg_dump' | 'pg_restore'): void {
  if (!executable || executable.includes('\0')) {
    throw new LocalBackupError('INVALID_BACKUP_CONFIG', `${expectedName} yolu gecersiz.`);
  }
  const executableName = path.basename(executable).toLowerCase();
  if (executableName !== expectedName && executableName !== `${expectedName}.exe`) {
    throw new LocalBackupError('INVALID_BACKUP_CONFIG', `Yedek araci ${expectedName} olmalidir.`);
  }
}

function pgDumpEnvironment(connection: PostgresConnectionOptions): NodeJS.ProcessEnv {
  // Uygulamanin JWT, lisans ve diger servis secret'larini pg_dump'a miras
  // birakmayiz. Yalniz executable/DLL/locale cozumlemesi icin gereken sistem
  // alanlari ve kontrollu libpq alanlari aktarilir.
  const inheritedKeys = [
    'PATH',
    'Path',
    'PATHEXT',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LD_LIBRARY_PATH',
    'DYLD_LIBRARY_PATH',
  ] as const;
  const result: NodeJS.ProcessEnv = {};
  for (const key of inheritedKeys) {
    if (process.env[key] !== undefined) result[key] = process.env[key];
  }
  result.PGAPPNAME = 'restotm-local-backup';
  result.PGCONNECT_TIMEOUT = '10';
  result.PGCLIENTENCODING = 'UTF8';
  if (connection.password !== undefined) result.PGPASSWORD = connection.password;
  if (connection.sslMode) result.PGSSLMODE = connection.sslMode;
  return result;
}

function pgRestoreEnvironment(): NodeJS.ProcessEnv {
  const result = pgDumpEnvironment({
    host: 'unused',
    port: 5432,
    user: 'unused',
    database: 'unused',
  });
  result.PGAPPNAME = 'restotm-local-backup-verify';
  return result;
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

async function ensureManagedDirectory(inputPath: string, create: boolean): Promise<string> {
  const absolutePath = path.resolve(inputPath);
  if (absolutePath.includes('\0')) {
    throw new LocalBackupError('INVALID_BACKUP_PATH', 'Yedek dizini yolu gecersiz.');
  }
  if (create) await mkdir(absolutePath, { recursive: true, mode: 0o700 });

  let entry;
  try {
    entry = await lstat(absolutePath);
  } catch {
    throw new LocalBackupError('INVALID_BACKUP_PATH', 'Yedek veya veri dizini bulunamadi.');
  }
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new LocalBackupError('INVALID_BACKUP_PATH', 'Yedek ve veri kokleri gercek dizin olmalidir.');
  }

  const canonicalPath = await realpath(absolutePath);
  if (create) await chmod(canonicalPath, 0o700);
  return canonicalPath;
}

async function storageVolumeIdentity(directory: string): Promise<string | null> {
  if (process.platform === 'win32') {
    const volumeRoot = path.parse(directory).root.replace(/[\\/]+$/, '').toUpperCase();
    return volumeRoot ? `windows-volume:${volumeRoot}` : null;
  }
  const entry = await stat(directory);
  return Number.isSafeInteger(entry.dev) ? `posix-dev:${entry.dev}` : null;
}

function safeChildPath(root: string, fileName: string): string {
  if (path.basename(fileName) !== fileName || fileName.includes('\0')) {
    throw new LocalBackupError('UNSAFE_BACKUP_PATH', 'Guvenli olmayan yedek dosyasi adi.', 400);
  }
  const candidate = path.resolve(root, fileName);
  if (!isPathInside(root, candidate)) {
    throw new LocalBackupError('UNSAFE_BACKUP_PATH', 'Yedek yolu izin verilen dizinin disinda.', 400);
  }
  return candidate;
}

function isBackupManifestFileName(fileName: string): boolean {
  if (!fileName.endsWith('.manifest.json')) return false;
  const backupFileName = fileName.slice(0, -'.manifest.json'.length);
  return BACKUP_V1_FILE_PATTERN.test(backupFileName) || BACKUP_V2_FILE_PATTERN.test(backupFileName);
}

function isCanonicalBase64(value: unknown, expectedBytes: number): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === expectedBytes && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

function hasCommonManifestFields(item: Partial<BackupManifest>): boolean {
  return typeof item.id === 'string'
    && BACKUP_ID_PATTERN.test(item.id)
    && item.format === 'pg_dump-custom'
    && (item.reason === 'manual' || item.reason === 'scheduled')
    && typeof item.createdAt === 'string'
    && Number.isFinite(Date.parse(item.createdAt))
    && typeof item.fileName === 'string'
    && typeof item.sizeBytes === 'number'
    && Number.isSafeInteger(item.sizeBytes)
    && item.sizeBytes > 0;
}

function isBackupManifest(value: unknown): value is BackupManifest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BackupManifest>;
  if (!hasCommonManifestFields(item)) return false;
  if (item.manifestVersion === 1) {
    const legacy = item as Partial<BackupManifestV1>;
    return BACKUP_V1_FILE_PATTERN.test(legacy.fileName ?? '')
      && typeof legacy.sha256 === 'string'
      && /^[0-9a-f]{64}$/i.test(legacy.sha256);
  }
  if (item.manifestVersion !== MANIFEST_VERSION) return false;
  const current = item as Partial<BackupManifestV2>;
  return BACKUP_V2_FILE_PATTERN.test(current.fileName ?? '')
    && typeof current.plainSizeBytes === 'number'
    && Number.isSafeInteger(current.plainSizeBytes)
    && current.plainSizeBytes > 0
    && typeof current.cipherSha256 === 'string'
    && /^[0-9a-f]{64}$/i.test(current.cipherSha256)
    && current.encryption?.algorithm === 'aes-256-gcm'
    && typeof current.encryption.keyId === 'string'
    && BACKUP_KEY_ID_PATTERN.test(current.encryption.keyId)
    && isCanonicalBase64(current.encryption.ivBase64, AES_GCM_IV_BYTES)
    && isCanonicalBase64(current.encryption.authTagBase64, AES_GCM_TAG_BYTES);
}

export function backupStoredSha256(manifest: BackupManifest): string {
  return manifest.manifestVersion === 1 ? manifest.sha256 : manifest.cipherSha256;
}

function backupAuthenticatedData(manifest: Pick<BackupManifestV2,
  'manifestVersion' | 'id' | 'format' | 'reason' | 'createdAt' | 'fileName'
> & { encryption: Pick<BackupManifestV2['encryption'], 'algorithm' | 'keyId'> }): Buffer {
  return Buffer.from(JSON.stringify({
    manifestVersion: manifest.manifestVersion,
    id: manifest.id,
    format: manifest.format,
    reason: manifest.reason,
    createdAt: manifest.createdAt,
    fileName: manifest.fileName,
    encryption: {
      algorithm: manifest.encryption.algorithm,
      keyId: manifest.encryption.keyId,
    },
  }), 'utf8');
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

async function createSecureTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  await chmod(directory, 0o700);
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw new LocalBackupError('UNSAFE_BACKUP_PATH', 'Guvenli gecici yedek dizini olusturulamadi.');
  }
  return realpath(directory);
}

function timestampForFile(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '').replace('Z', 'Z');
}

function utcDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcWeekKey(date: Date): string {
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const weekday = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - weekday + 1);
  return utcDayKey(monday);
}

function utcMonthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function selectRetentionSet(
  backups: readonly BackupManifest[],
  policy: BackupRetentionPolicy,
): Set<string> {
  const sorted = [...backups].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const keep = new Set<string>();

  const selectBuckets = (limit: number, key: (date: Date) => string): void => {
    const buckets = new Set<string>();
    for (const backup of sorted) {
      const bucket = key(new Date(backup.createdAt));
      if (buckets.has(bucket)) continue;
      if (buckets.size >= limit) break;
      buckets.add(bucket);
      keep.add(backup.id);
    }
  };

  selectBuckets(policy.daily, utcDayKey);
  selectBuckets(policy.weekly, utcWeekKey);
  selectBuckets(policy.monthly, utcMonthKey);
  return keep;
}

export class LocalBackupRuntime {
  private readonly retention: BackupRetentionPolicy;
  private readonly externalRetention: BackupRetentionPolicy | null;
  private readonly externalVolumePolicy: 'require-separate' | 'warn' | 'allow';
  private readonly processTimeoutMs: number;
  private readonly backupIntervalMs: number;
  private readonly schedulerPollMs: number;
  private readonly lockStaleMs: number;
  private readonly restoreVerificationIntervalMs: number;
  private readonly restoreVerificationRetryMs: number;
  private readonly clock: () => Date;
  private readonly pgDumpPath: string;
  private readonly pgRestorePath: string;
  private readonly encryptionKey: KeyObject;
  private readonly encryptionKeyId: string;
  private readonly config: Omit<LocalBackupConfig, 'encryptionKey'>;
  private dataRoot?: string;
  private backupRoot?: string;
  private externalRoot?: string;
  private externalVolumeSeparate: boolean | null = null;
  private externalVolumeWarning: string | null = null;
  private initializing?: Promise<void>;
  private running = false;
  private replicationRunning = false;
  private cloudReplicationRunning = false;
  private restoreVerificationRunning = false;
  private replicationState: ReplicationState = {
    stateVersion: REPLICATION_STATE_VERSION,
    pendingIds: [],
    lastSuccess: null,
    lastError: null,
    lastRestoreVerification: null,
    nextRestoreVerificationDueAt: null,
    cloudPendingIds: [],
    cloudCompletedIds: [],
    cloudLastSuccess: null,
    cloudLastError: null,
  };
  private scheduler?: NodeJS.Timeout;
  private schedulerTick?: Promise<void>;
  private schedulerStopping = false;
  private lastSuccess: BackupManifest | null = null;
  private lastError: { code: string; occurredAt: string } | null = null;

  constructor(
    config: LocalBackupConfig,
    private readonly processAdapter: BackupProcessAdapter = new ExecFileBackupProcessAdapter(),
    private readonly restoreProcessAdapter: BackupProcessAdapter = new ExecFileRestoreProcessAdapter(),
  ) {
    validateConnection(config.connection);
    this.pgDumpPath = config.pgDumpPath ?? 'pg_dump';
    this.pgRestorePath = config.pgRestorePath ?? 'pg_restore';
    validatePgToolPath(this.pgDumpPath, 'pg_dump');
    validatePgToolPath(this.pgRestorePath, 'pg_restore');
    if (config.encryptionKey.byteLength !== 32) {
      throw new LocalBackupError('INVALID_BACKUP_KEY', 'Yedek sifreleme anahtari tam 32 byte olmalidir.');
    }
    if (!BACKUP_KEY_ID_PATTERN.test(config.encryptionKeyId)) {
      throw new LocalBackupError('INVALID_BACKUP_KEY', 'Yedek sifreleme anahtari kimligi gecersiz.');
    }
    const keyMaterial = Buffer.from(config.encryptionKey);
    this.encryptionKey = createSecretKey(keyMaterial);
    keyMaterial.fill(0);
    this.encryptionKeyId = config.encryptionKeyId;
    const { encryptionKey: consumedKeyReference, ...nonSecretConfig } = config;
    consumedKeyReference.fill(0);
    this.config = nonSecretConfig;
    this.retention = {
      daily: retentionCount(config.retention?.daily, 7, 'retention.daily'),
      weekly: retentionCount(config.retention?.weekly, 4, 'retention.weekly'),
      monthly: retentionCount(config.retention?.monthly, 12, 'retention.monthly'),
    };
    if (this.retention.daily + this.retention.weekly + this.retention.monthly === 0) {
      throw new LocalBackupError('INVALID_BACKUP_CONFIG', 'En az bir retention sinifi etkin olmalidir.');
    }
    this.externalVolumePolicy = config.externalVolumePolicy ?? 'warn';
    if (!['require-separate', 'warn', 'allow'].includes(this.externalVolumePolicy)) {
      throw new LocalBackupError('INVALID_BACKUP_CONFIG', 'Harici yedek volume politikasi gecersiz.');
    }
    this.externalRetention = config.externalBackupDir
      ? {
          daily: retentionCount(
            config.externalRetention?.daily,
            DEFAULT_EXTERNAL_RETENTION.daily,
            'externalRetention.daily',
          ),
          weekly: retentionCount(
            config.externalRetention?.weekly,
            DEFAULT_EXTERNAL_RETENTION.weekly,
            'externalRetention.weekly',
          ),
          monthly: retentionCount(
            config.externalRetention?.monthly,
            DEFAULT_EXTERNAL_RETENTION.monthly,
            'externalRetention.monthly',
          ),
        }
      : null;
    if (this.externalRetention) {
      const notShorter = this.externalRetention.daily >= this.retention.daily
        && this.externalRetention.weekly >= this.retention.weekly
        && this.externalRetention.monthly >= this.retention.monthly;
      const strictlyLonger = this.externalRetention.daily + this.externalRetention.weekly
        + this.externalRetention.monthly
        > this.retention.daily + this.retention.weekly + this.retention.monthly;
      if (!notShorter || !strictlyLonger) {
        throw new LocalBackupError(
          'INVALID_BACKUP_CONFIG',
          'Harici retention her sinifta lokalden kisa olamaz ve toplamda daha uzun olmalidir.',
        );
      }
    }
    this.processTimeoutMs = positiveDuration(config.processTimeoutMs, DEFAULT_PROCESS_TIMEOUT_MS, 'processTimeoutMs');
    this.backupIntervalMs = positiveDuration(config.backupIntervalMs, DEFAULT_BACKUP_INTERVAL_MS, 'backupIntervalMs');
    this.schedulerPollMs = positiveDuration(config.schedulerPollMs, DEFAULT_SCHEDULER_POLL_MS, 'schedulerPollMs');
    this.lockStaleMs = positiveDuration(config.lockStaleMs, DEFAULT_LOCK_STALE_MS, 'lockStaleMs');
    this.restoreVerificationIntervalMs = positiveDuration(
      config.restoreVerificationIntervalMs,
      DEFAULT_RESTORE_VERIFICATION_INTERVAL_MS,
      'restoreVerificationIntervalMs',
    );
    this.restoreVerificationRetryMs = positiveDuration(
      config.restoreVerificationRetryMs,
      DEFAULT_RESTORE_VERIFICATION_RETRY_MS,
      'restoreVerificationRetryMs',
    );
    if (this.restoreVerificationRetryMs > this.restoreVerificationIntervalMs) {
      throw new LocalBackupError(
        'INVALID_BACKUP_CONFIG',
        'Restore dogrulama retry araligi ana araliktan uzun olamaz.',
      );
    }
    if (this.lockStaleMs <= this.processTimeoutMs) {
      throw new LocalBackupError('INVALID_BACKUP_CONFIG', 'lockStaleMs, processTimeoutMs degerinden buyuk olmalidir.');
    }
    this.clock = config.clock ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    if (
      this.dataRoot
      && this.backupRoot
      && (!this.config.externalBackupDir || this.externalRoot)
    ) return;
    if (!this.initializing) {
      this.initializing = (async () => {
        const dataRoot = await ensureManagedDirectory(this.config.dataDir, false);
        const backupRoot = await ensureManagedDirectory(this.config.backupDir, true);
        if (
          dataRoot === backupRoot
          || isPathInside(dataRoot, backupRoot)
          || isPathInside(backupRoot, dataRoot)
        ) {
          throw new LocalBackupError(
            'BACKUP_PATH_NOT_SEPARATE',
            'Yedek dizini veri dizininden ayri ve onun disinda olmalidir.',
          );
        }
        this.dataRoot = dataRoot;
        this.backupRoot = backupRoot;
        if (this.config.externalBackupDir) {
          const externalRoot = await ensureManagedDirectory(this.config.externalBackupDir, true);
          if (
            externalRoot === dataRoot
            || externalRoot === backupRoot
            || isPathInside(dataRoot, externalRoot)
            || isPathInside(externalRoot, dataRoot)
            || isPathInside(backupRoot, externalRoot)
            || isPathInside(externalRoot, backupRoot)
          ) {
            throw new LocalBackupError(
              'BACKUP_EXTERNAL_PATH_NOT_SEPARATE',
              'Harici yedek dizini veri ve lokal yedek dizinlerinden ayri olmalidir.',
            );
          }

          this.externalRoot = externalRoot;
          await this.refreshExternalVolumeAssessment();
        }
        await this.loadAndReconcileReplicationState();
      })().catch((error) => {
        this.dataRoot = undefined;
        this.backupRoot = undefined;
        this.externalRoot = undefined;
        this.externalVolumeSeparate = null;
        this.externalVolumeWarning = null;
        throw error;
      }).finally(() => {
        this.initializing = undefined;
      });
    }
    await this.initializing;
  }

  async createBackup(reason: BackupReason = 'manual'): Promise<BackupManifest> {
    await this.initialize();
    if (this.running || this.restoreVerificationRunning) throw new BackupAlreadyRunningError();
    this.running = true;

    let heldLock: HeldBackupLock | undefined;
    let cipherPartialPath: string | undefined;
    let manifestPartialPath: string | undefined;
    let unpublishedFinalPath: string | undefined;
    let workDirectory: string | undefined;
    try {
      heldLock = await this.acquireLock();
      const root = this.requireBackupRoot();
      const createdAt = this.clock();
      const id = randomUUID();
      const fileName = `restotm-${timestampForFile(createdAt)}-${id}.dump.enc`;
      const finalPath = safeChildPath(root, fileName);
      cipherPartialPath = safeChildPath(root, `${fileName}.partial`);
      const manifestName = `${fileName}.manifest.json`;
      const manifestPath = safeChildPath(root, manifestName);
      manifestPartialPath = safeChildPath(root, `${manifestName}.partial`);

      // Plaintext hicbir zaman yonetilen backup kokunde yayinlanmaz. pg_dump
      // yalniz OS temp altindaki 0700 calisma dizisinde 0600 bir dosyaya
      // yazar; bu dosya ayni islemde stream edilerek sifrelenir ve silinir.
      workDirectory = await createSecureTemporaryDirectory('restotm-backup-work-');
      const plainPath = safeChildPath(workDirectory, 'source.dump');
      const plainReservation = await open(plainPath, 'wx', 0o600);
      await plainReservation.close();

      const connection = this.config.connection;
      const args = [
        '--format=custom',
        '--compress=6',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        '--file', plainPath,
        '--host', connection.host,
        '--port', String(connection.port),
        '--username', connection.user,
        '--dbname', connection.database,
      ];
      const processEnv = pgDumpEnvironment(connection);

      await this.processAdapter.run(this.pgDumpPath, args, {
        cwd: workDirectory,
        env: processEnv,
        timeoutMs: this.processTimeoutMs,
      });

      const dumpEntry = await lstat(plainPath);
      if (!dumpEntry.isFile() || dumpEntry.isSymbolicLink() || dumpEntry.size < 1) {
        throw new LocalBackupError('INVALID_BACKUP_OUTPUT', 'pg_dump gecerli bir yedek dosyasi uretmedi.');
      }
      await chmod(plainPath, 0o600);
      const dumpHandle = await open(plainPath, 'r');
      await dumpHandle.sync();
      await dumpHandle.close();

      const iv = randomBytes(AES_GCM_IV_BYTES);
      const manifestBase = {
        manifestVersion: 2 as const,
        id,
        format: 'pg_dump-custom' as const,
        reason,
        createdAt: createdAt.toISOString(),
        fileName,
        encryption: {
          algorithm: 'aes-256-gcm' as const,
          keyId: this.encryptionKeyId,
        },
      };
      const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
      cipher.setAAD(backupAuthenticatedData(manifestBase));
      const cipherHash = createHash('sha256');
      cipher.on('data', (chunk: Buffer) => cipherHash.update(chunk));
      const cipherHandle = await open(cipherPartialPath, 'wx', 0o600);
      try {
        await pipeline(
          createReadStream(plainPath),
          cipher,
          cipherHandle.createWriteStream(),
        );
      } finally {
        await cipherHandle.close().catch(() => undefined);
      }

      const cipherEntry = await lstat(cipherPartialPath);
      if (!cipherEntry.isFile() || cipherEntry.isSymbolicLink() || cipherEntry.size < 1) {
        throw new LocalBackupError('INVALID_BACKUP_OUTPUT', 'Sifreli yedek dosyasi olusturulamadi.');
      }
      const cipherSyncHandle = await open(cipherPartialPath, 'r');
      await cipherSyncHandle.sync();
      await cipherSyncHandle.close();
      const manifest: BackupManifestV2 = {
        ...manifestBase,
        sizeBytes: dumpEntry.size,
        plainSizeBytes: dumpEntry.size,
        cipherSha256: cipherHash.digest('hex'),
        encryption: {
          ...manifestBase.encryption,
          ivBase64: iv.toString('base64'),
          authTagBase64: cipher.getAuthTag().toString('base64'),
        },
      };
      // GCM ciphertext uzunlugu plaintext ile aynidir; yine de gercek dosya
      // boyutunu kaydederek algoritma ayrintisina bagimli varsayim yapmayiz.
      manifest.sizeBytes = cipherEntry.size;

      await writeFile(manifestPartialPath, `${JSON.stringify(manifest, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      const manifestHandle = await open(manifestPartialPath, 'r');
      await manifestHandle.sync();
      await manifestHandle.close();

      // Ayni dosya sistemindeki rename atomiktir. Manifest en son yayina
      // girer; listeleyiciler yarim veya manifestsiz yedegi gormez.
      await rename(cipherPartialPath, finalPath);
      cipherPartialPath = undefined;
      unpublishedFinalPath = finalPath;
      await rename(manifestPartialPath, manifestPath);
      manifestPartialPath = undefined;
      unpublishedFinalPath = undefined;
      await this.syncBackupDirectoryBestEffort();

      this.lastSuccess = manifest;
      this.lastError = null;
      if (this.externalRoot) {
        await this.enqueueAndReplicate(manifest);
      }
      if (this.config.cloudReplica) {
        await this.enqueueAndUploadCloud(manifest);
      }
      try {
        await this.applyRetention();
      } catch {
        // Yedek ve manifest artik atomik olarak yayinlanmistir. Retention
        // temizligi basarisiz olsa da kullanilabilir yedegi "basarisiz" diye
        // raporlamayiz; durum endpoint'i bakim hatasini ayrica gosterir.
        this.lastError = { code: 'BACKUP_RETENTION_FAILED', occurredAt: this.clock().toISOString() };
      }
      return manifest;
    } catch (error) {
      const localError = error instanceof LocalBackupError
        ? error
        : new LocalBackupError('BACKUP_FAILED', 'Yerel yedek olusturulamadi.');
      this.lastError = { code: localError.code, occurredAt: this.clock().toISOString() };
      if (cipherPartialPath) await unlink(cipherPartialPath).catch(() => undefined);
      if (manifestPartialPath) await unlink(manifestPartialPath).catch(() => undefined);
      if (unpublishedFinalPath) await unlink(unpublishedFinalPath).catch(() => undefined);
      throw localError;
    } finally {
      if (workDirectory) await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
      await heldLock?.release().catch(() => undefined);
      this.running = false;
    }
  }

  async listBackups(): Promise<BackupManifest[]> {
    await this.initialize();
    return (await this.scanBackups()).backups;
  }

  async getStatus(): Promise<LocalBackupStatus> {
    await this.initialize();
    const scan = await this.scanBackups();
    const nextDueAt = this.replicationState.nextRestoreVerificationDueAt
      ?? this.clock().toISOString();
    const restoreRecord = this.replicationState.lastRestoreVerification;
    const restoreAlarm: 'NONE' | 'WARNING' | 'ERROR' = restoreRecord?.status === 'FAILED'
      ? 'ERROR'
      : restoreRecord?.external === 'FAILED'
        ? 'ERROR'
        : restoreRecord?.external === 'NOT_AVAILABLE'
          ? 'WARNING'
          : this.clock().getTime() >= Date.parse(nextDueAt) && !this.restoreVerificationRunning
            ? 'WARNING'
            : 'NONE';
    return {
      running: this.running,
      schedulerRunning: Boolean(this.scheduler),
      backupCount: scan.backups.length,
      invalidEntryCount: scan.invalidEntryCount,
      lastSuccess: this.lastSuccess ?? scan.backups[0] ?? null,
      lastError: this.lastError,
      retention: { ...this.retention },
      externalReplication: {
        configured: Boolean(this.externalRoot),
        running: this.replicationRunning,
        healthy: !this.externalRoot || Boolean(
          this.replicationState.pendingIds.length === 0
          && !this.replicationState.lastError
          && !this.externalVolumeWarning,
        ),
        alarm: !this.externalRoot
          ? 'NONE'
          : this.replicationState.lastError || this.replicationState.pendingIds.length > 0
            ? 'ERROR'
            : this.externalVolumeWarning
              ? 'WARNING'
              : 'NONE',
        pendingCount: this.replicationState.pendingIds.length,
        lastSuccess: this.replicationState.lastSuccess,
        lastError: this.replicationState.lastError,
        volume: {
          policy: this.externalVolumePolicy,
          separate: this.externalVolumeSeparate,
          warningCode: this.externalVolumeWarning,
          acceptanceRequired: Boolean(this.externalVolumeWarning),
        },
        retention: this.externalRetention ? { ...this.externalRetention } : null,
      },
      cloudReplication: {
        configured: Boolean(this.config.cloudReplica),
        running: this.cloudReplicationRunning,
        healthy: !this.config.cloudReplica || Boolean(
          this.replicationState.cloudPendingIds.length === 0
          && !this.replicationState.cloudLastError
        ),
        alarm: this.config.cloudReplica && (
          this.replicationState.cloudPendingIds.length > 0
          || this.replicationState.cloudLastError
        ) ? 'ERROR' : 'NONE',
        pendingCount: this.replicationState.cloudPendingIds.length,
        lastSuccess: this.replicationState.cloudLastSuccess,
        lastError: this.replicationState.cloudLastError,
        encryption: 'AES-256-GCM_BEFORE_UPLOAD',
        credentialPolicy: 'SHORT_LIVED_PRESIGNED_URL',
      },
      restoreVerification: {
        running: this.restoreVerificationRunning,
        lastRestoreVerification: restoreRecord,
        nextDueAt,
        alarm: restoreAlarm,
        intervalMs: this.restoreVerificationIntervalMs,
        retryMs: this.restoreVerificationRetryMs,
        licenseGatePolicy: 'RECOVERY_MAINTENANCE_ALWAYS',
      },
    };
  }

  async getVerifiedDownload(id: string): Promise<BackupDownload> {
    if (!BACKUP_ID_PATTERN.test(id)) {
      throw new LocalBackupError('BACKUP_NOT_FOUND', 'Yedek bulunamadi.', 404);
    }
    await this.initialize();
    const backup = await this.findManifestById(id);
    if (!backup) throw new LocalBackupError('BACKUP_NOT_FOUND', 'Yedek bulunamadi.', 404);

    const filePath = safeChildPath(this.requireBackupRoot(), backup.fileName);
    const entry = await lstat(filePath).catch(() => undefined);
    if (!entry?.isFile() || entry.isSymbolicLink() || entry.size !== backup.sizeBytes) {
      throw new LocalBackupError('BACKUP_INTEGRITY_FAILED', 'Yedek dosyasi butunluk kontrolunden gecemedi.', 409);
    }
    const digest = await sha256File(filePath);
    if (digest !== backupStoredSha256(backup)) {
      throw new LocalBackupError('BACKUP_INTEGRITY_FAILED', 'Yedek dosyasi butunluk kontrolunden gecemedi.', 409);
    }
    return { manifest: backup, absolutePath: filePath };
  }

  /**
   * Yedegi gecici 0600 plaintext dosyasina acar ve pg_restore --list ile
   * arsiv yapisini dogrular. Veritabanina baglanmaz, destructive restore
   * yapmaz ve gecici dosyayi sonuc ne olursa olsun siler.
   */
  async verifyRestoreCandidate(id: string): Promise<BackupRestoreVerification> {
    await this.initialize();
    if (this.running || this.restoreVerificationRunning) throw new BackupAlreadyRunningError();
    this.restoreVerificationRunning = true;
    let heldLock: HeldBackupLock | undefined;
    try {
      heldLock = await this.acquireLock();
      return await this.verifyRestoreDownload(await this.getVerifiedDownload(id));
    } finally {
      await heldLock?.release().catch(() => undefined);
      this.restoreVerificationRunning = false;
    }
  }

  async runRestoreVerificationIfDue(force = false): Promise<RestoreVerificationRecord | null> {
    await this.initialize();
    const dueAt = Date.parse(
      this.replicationState.nextRestoreVerificationDueAt ?? this.clock().toISOString(),
    );
    if (!force && this.clock().getTime() < dueAt) return null;
    if (this.running || this.restoreVerificationRunning) return null;

    this.restoreVerificationRunning = true;
    let heldLock: HeldBackupLock | undefined;
    try {
      heldLock = await this.acquireLock();
      const newest = (await this.scanBackups()).backups.find((backup) => (
        backup.manifestVersion === MANIFEST_VERSION
      )) as BackupManifestV2 | undefined;
      if (!newest) {
        return await this.recordRestoreVerificationFailure(
          null,
          'BACKUP_RESTORE_DRILL_NO_V2_BACKUP',
          'NOT_AVAILABLE',
          this.externalRoot ? 'NOT_AVAILABLE' : 'NOT_CONFIGURED',
        );
      }

      try {
        await this.verifyRestoreDownload(await this.getVerifiedDownload(newest.id));
      } catch (error) {
        const code = error instanceof LocalBackupError ? error.code : 'BACKUP_RESTORE_DRILL_FAILED';
        return await this.recordRestoreVerificationFailure(
          newest.id,
          code,
          'FAILED',
          this.externalRoot ? 'NOT_AVAILABLE' : 'NOT_CONFIGURED',
        );
      }

      let external: RestoreVerificationRecord['external'] = this.externalRoot
        ? 'NOT_AVAILABLE'
        : 'NOT_CONFIGURED';
      if (this.externalRoot) {
        try {
          const externalManifest = (await this.scanBackupsAt(this.externalRoot)).backups
            .find((backup) => backup.id === newest.id);
          if (externalManifest?.manifestVersion === MANIFEST_VERSION) {
            const externalDownload = await this.getVerifiedDownloadAt(
              this.externalRoot,
              externalManifest,
            );
            await this.verifyRestoreDownload(externalDownload);
            external = 'VERIFIED';
          } else {
            const expectedCipher = await lstat(
              safeChildPath(this.externalRoot, newest.fileName),
            ).catch(() => undefined);
            const expectedManifest = await lstat(
              safeChildPath(this.externalRoot, `${newest.fileName}.manifest.json`),
            ).catch(() => undefined);
            if (expectedCipher || expectedManifest) {
              throw new LocalBackupError(
                'BACKUP_EXTERNAL_RESTORE_DRILL_INVALID',
                'Harici restore drill adayi eksik veya gecersiz.',
              );
            }
          }
        } catch (error) {
          if (error instanceof LocalBackupError) {
            return await this.recordRestoreVerificationFailure(
              newest.id,
              error.code.startsWith('BACKUP_EXTERNAL_')
                ? error.code
                : 'BACKUP_EXTERNAL_RESTORE_DRILL_FAILED',
              'VERIFIED',
              'FAILED',
            );
          }
          external = 'NOT_AVAILABLE';
        }
      }
      return await this.recordRestoreVerificationSuccess(newest.id, external);
    } finally {
      await heldLock?.release().catch(() => undefined);
      this.restoreVerificationRunning = false;
    }
  }

  private async verifyRestoreDownload(verified: BackupDownload): Promise<BackupRestoreVerification> {
    let workDirectory: string | undefined;
    try {
      workDirectory = await createSecureTemporaryDirectory('restotm-restore-verify-');
      const plainPath = safeChildPath(workDirectory, 'candidate.dump');
      const plainHandle = await open(plainPath, 'wx', 0o600);
      try {
        if (verified.manifest.manifestVersion === 1) {
          await pipeline(
            createReadStream(verified.absolutePath),
            plainHandle.createWriteStream(),
          );
        } else {
          if (verified.manifest.encryption.keyId !== this.encryptionKeyId) {
            throw new LocalBackupError(
              'BACKUP_KEY_UNAVAILABLE',
              'Yedek icin gereken sifreleme anahtari bu kurulumda acik degil.',
              409,
            );
          }
          const decipher = createDecipheriv(
            'aes-256-gcm',
            this.encryptionKey,
            Buffer.from(verified.manifest.encryption.ivBase64, 'base64'),
          );
          decipher.setAAD(backupAuthenticatedData(verified.manifest));
          decipher.setAuthTag(Buffer.from(verified.manifest.encryption.authTagBase64, 'base64'));
          try {
            await pipeline(
              createReadStream(verified.absolutePath),
              decipher,
              plainHandle.createWriteStream(),
            );
          } catch {
            throw new LocalBackupError(
              'BACKUP_DECRYPTION_FAILED',
              'Yedek sifre cozumleme ve kimlik dogrulamasindan gecemedi.',
              409,
            );
          }
        }
      } finally {
        await plainHandle.close().catch(() => undefined);
      }

      const plainEntry = await lstat(plainPath);
      if (!plainEntry.isFile() || plainEntry.isSymbolicLink() || plainEntry.size < 1) {
        throw new LocalBackupError('BACKUP_ARCHIVE_INVALID', 'Yedek arsivi gecersiz.', 409);
      }
      if (
        verified.manifest.manifestVersion === 2
        && plainEntry.size !== verified.manifest.plainSizeBytes
      ) {
        throw new LocalBackupError('BACKUP_INTEGRITY_FAILED', 'Yedek boyutu dogrulanamadi.', 409);
      }

      await this.restoreProcessAdapter.run(this.pgRestorePath, ['--list', plainPath], {
        cwd: workDirectory,
        env: pgRestoreEnvironment(),
        timeoutMs: this.processTimeoutMs,
      });
      return {
        manifest: verified.manifest,
        plainSizeBytes: plainEntry.size,
        verifiedAt: this.clock().toISOString(),
      };
    } catch (error) {
      if (error instanceof LocalBackupError) throw error;
      throw new LocalBackupError('BACKUP_VERIFY_FAILED', 'Yedek geri yukleme icin dogrulanamadi.', 409);
    } finally {
      if (workDirectory) await rm(workDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async getVerifiedDownloadAt(
    root: string,
    manifest: BackupManifest,
  ): Promise<BackupDownload> {
    const filePath = safeChildPath(root, manifest.fileName);
    const entry = await lstat(filePath).catch(() => undefined);
    if (!entry?.isFile() || entry.isSymbolicLink() || entry.size !== manifest.sizeBytes) {
      throw new LocalBackupError(
        'BACKUP_EXTERNAL_INTEGRITY_FAILED',
        'Harici restore drill yedegi butunluk kontrolunden gecemedi.',
        409,
      );
    }
    if (await sha256File(filePath) !== backupStoredSha256(manifest)) {
      throw new LocalBackupError(
        'BACKUP_EXTERNAL_INTEGRITY_FAILED',
        'Harici restore drill yedegi butunluk kontrolunden gecemedi.',
        409,
      );
    }
    return { manifest, absolutePath: filePath };
  }

  private async recordRestoreVerificationSuccess(
    backupId: string,
    external: RestoreVerificationRecord['external'],
  ): Promise<RestoreVerificationRecord> {
    const now = this.clock();
    const record: RestoreVerificationRecord = {
      status: 'SUCCESS',
      backupId,
      verifiedAt: now.toISOString(),
      local: 'VERIFIED',
      external,
      code: null,
    };
    this.replicationState.lastRestoreVerification = record;
    this.replicationState.nextRestoreVerificationDueAt = new Date(
      now.getTime() + this.restoreVerificationIntervalMs,
    ).toISOString();
    if (
      this.lastError?.code.startsWith('BACKUP_RESTORE_DRILL_')
      || this.lastError?.code.startsWith('BACKUP_EXTERNAL_RESTORE_DRILL_')
    ) this.lastError = null;
    await this.persistReplicationStateBestEffort();
    return record;
  }

  private async recordRestoreVerificationFailure(
    backupId: string | null,
    code: string,
    local: RestoreVerificationRecord['local'],
    external: RestoreVerificationRecord['external'],
  ): Promise<RestoreVerificationRecord> {
    const now = this.clock();
    const record: RestoreVerificationRecord = {
      status: 'FAILED',
      backupId,
      verifiedAt: now.toISOString(),
      local,
      external,
      code,
    };
    this.replicationState.lastRestoreVerification = record;
    this.replicationState.nextRestoreVerificationDueAt = new Date(
      now.getTime() + this.restoreVerificationRetryMs,
    ).toISOString();
    this.lastError = { code, occurredAt: now.toISOString() };
    await this.persistReplicationStateBestEffort();
    return record;
  }

  async applyRetention(): Promise<void> {
    await this.initialize();
    const backups = (await this.scanBackups()).backups;
    // v1 yalniz geriye donuk salt-okumadir. Yeni retention politikasi eski
    // plaintext arsivleri otomatik olarak degistirmez veya silmez.
    const currentBackups = backups.filter((backup): backup is BackupManifestV2 => (
      backup.manifestVersion === MANIFEST_VERSION
    ));
    const keep = selectRetentionSet(currentBackups, this.retention);
    const root = this.requireBackupRoot();

    for (const backup of backups) {
      if (backup.manifestVersion === 1) continue;
      if (
        this.replicationState.pendingIds.includes(backup.id)
        || this.replicationState.cloudPendingIds.includes(backup.id)
      ) continue;
      if (keep.has(backup.id)) continue;
      const manifestPath = safeChildPath(root, `${backup.fileName}.manifest.json`);
      const dumpPath = safeChildPath(root, backup.fileName);
      // Manifest once silinerek yedek API'den aninda gizlenir. Her iki hedef
      // de sadece dogrulanmis, yonetilen kok altindaki normal adlardir.
      await unlink(manifestPath).catch(() => undefined);
      await unlink(dumpPath).catch(() => undefined);
    }
    await this.syncBackupDirectoryBestEffort();
  }

  startScheduler(): void {
    if (this.scheduler) return;
    this.schedulerStopping = false;
    const tick = (): void => {
      if (this.schedulerStopping || this.schedulerTick) return;
      const maintenance = this.runMaintenanceTick()
        .catch(() => undefined)
        .finally(() => {
          if (this.schedulerTick === maintenance) this.schedulerTick = undefined;
        });
      this.schedulerTick = maintenance;
    };
    tick();
    this.scheduler = setInterval(tick, this.schedulerPollMs);
    this.scheduler.unref?.();
  }

  async retryExternalReplication(): Promise<void> {
    await this.initialize();
    if (!this.externalRoot || this.replicationRunning || this.running) return;
    this.replicationRunning = true;
    try {
      for (const id of [...this.replicationState.pendingIds]) {
        const manifest = await this.findManifestById(id);
        if (!manifest || manifest.manifestVersion !== MANIFEST_VERSION) {
          await this.recordReplicationFailure('BACKUP_REPLICATION_SOURCE_MISSING');
          continue;
        }
        try {
          await this.replicateManifest(manifest);
          await this.recordReplicationSuccess(manifest.id);
        } catch (error) {
          const code = error instanceof LocalBackupError
            ? error.code
            : 'BACKUP_REPLICATION_FAILED';
          await this.recordReplicationFailure(code);
        }
      }
      await this.applyExternalRetention().catch(async () => {
        await this.recordReplicationFailure('BACKUP_EXTERNAL_RETENTION_FAILED');
      });
    } finally {
      this.replicationRunning = false;
    }
  }

  async retryCloudReplication(): Promise<void> {
    await this.initialize();
    if (!this.config.cloudReplica || this.cloudReplicationRunning || this.running) return;
    this.cloudReplicationRunning = true;
    try {
      for (const id of [...this.replicationState.cloudPendingIds]) {
        try {
          const download = await this.getVerifiedDownload(id);
          if (download.manifest.manifestVersion !== MANIFEST_VERSION) {
            throw new LocalBackupError('BACKUP_CLOUD_SOURCE_INVALID', 'Bulut yedek kaynagi gecersiz.');
          }
          await this.config.cloudReplica.upload(download);
          await this.recordCloudReplicationSuccess(id);
        } catch {
          await this.recordCloudReplicationFailure('BACKUP_CLOUD_UPLOAD_FAILED');
        }
      }
    } finally {
      this.cloudReplicationRunning = false;
    }
  }

  async stopScheduler(): Promise<void> {
    this.schedulerStopping = true;
    if (this.scheduler) {
      clearInterval(this.scheduler);
      this.scheduler = undefined;
    }
    await this.schedulerTick;
  }

  private async runScheduledIfDue(): Promise<void> {
    if (this.running || this.restoreVerificationRunning) return;
    const backups = await this.listBackups();
    const newest = backups[0];
    if (newest && this.clock().getTime() - Date.parse(newest.createdAt) < this.backupIntervalMs) return;
    await this.createBackup('scheduled');
  }

  private async runMaintenanceTick(): Promise<void> {
    await this.runScheduledIfDue().catch(() => undefined);
    await this.retryExternalReplication().catch(() => undefined);
    await this.retryCloudReplication().catch(() => undefined);
    await this.runRestoreVerificationIfDue().catch(() => undefined);
  }

  private async loadAndReconcileReplicationState(): Promise<void> {
    const root = this.requireBackupRoot();
    const statePath = safeChildPath(root, REPLICATION_STATE_FILE);
    try {
      const entry = await lstat(statePath);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 64 * 1024) {
        throw new LocalBackupError('BACKUP_REPLICATION_STATE_INVALID', 'Replikasyon durumu gecersiz.');
      }
      const parsed: unknown = JSON.parse(await readFile(statePath, 'utf8'));
      if (!isReplicationState(parsed)) {
        throw new LocalBackupError('BACKUP_REPLICATION_STATE_INVALID', 'Replikasyon durumu gecersiz.');
      }
      this.replicationState = {
        ...parsed,
        lastRestoreVerification: parsed.lastRestoreVerification ?? null,
        nextRestoreVerificationDueAt: parsed.nextRestoreVerificationDueAt ?? null,
        cloudPendingIds: parsed.cloudPendingIds ?? [],
        cloudCompletedIds: parsed.cloudCompletedIds ?? [],
        cloudLastSuccess: parsed.cloudLastSuccess ?? null,
        cloudLastError: parsed.cloudLastError ?? null,
      };
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code !== 'ENOENT') {
        this.replicationState.lastError = {
          code: error instanceof LocalBackupError ? error.code : 'BACKUP_REPLICATION_STATE_INVALID',
          occurredAt: this.clock().toISOString(),
        };
      }
    }

    const localBackups = (await this.scanBackupsAt(root)).backups
      .filter((backup): backup is BackupManifestV2 => backup.manifestVersion === MANIFEST_VERSION);
    const localIds = new Set(localBackups.map((backup) => backup.id));
    const externalIds = this.externalRoot
      ? new Set(
          (await this.scanBackupsAt(this.externalRoot)).backups
            .filter((backup): backup is BackupManifestV2 => backup.manifestVersion === MANIFEST_VERSION)
            .map((backup) => backup.id),
        )
      : new Set<string>();
    const pending = new Set(
      this.externalRoot
        ? this.replicationState.pendingIds.filter((id) => localIds.has(id))
        : [],
    );
    if (this.externalRoot) {
      for (const backup of localBackups) {
        if (!externalIds.has(backup.id)) pending.add(backup.id);
      }
    }
    this.replicationState.pendingIds = [...pending];
    const completedCloud = new Set(
      this.replicationState.cloudCompletedIds.filter((id) => localIds.has(id)),
    );
    const pendingCloud = new Set(
      this.config.cloudReplica
        ? this.replicationState.cloudPendingIds.filter((id) => localIds.has(id))
        : [],
    );
    if (this.config.cloudReplica) {
      for (const backup of localBackups) {
        if (!completedCloud.has(backup.id)) pendingCloud.add(backup.id);
      }
    }
    this.replicationState.cloudCompletedIds = [...completedCloud];
    this.replicationState.cloudPendingIds = [...pendingCloud];
    if (!this.replicationState.nextRestoreVerificationDueAt) {
      this.replicationState.nextRestoreVerificationDueAt = this.clock().toISOString();
    }
    await this.persistReplicationStateBestEffort();
  }

  private async refreshExternalVolumeAssessment(): Promise<void> {
    const externalRoot = this.requireExternalRoot();
    let canonicalExternalRoot: string;
    try {
      canonicalExternalRoot = await ensureManagedDirectory(externalRoot, false);
    } catch {
      throw new LocalBackupError('BACKUP_EXTERNAL_UNAVAILABLE', 'Harici yedek hedefi kullanilamiyor.');
    }
    if (canonicalExternalRoot !== externalRoot || !this.dataRoot || !this.backupRoot) {
      throw new LocalBackupError('BACKUP_EXTERNAL_PATH_CHANGED', 'Harici yedek hedefinin guvenli yolu degisti.');
    }
    const [dataVolume, backupVolume, externalVolume] = await Promise.all([
      storageVolumeIdentity(this.dataRoot),
      storageVolumeIdentity(this.backupRoot),
      storageVolumeIdentity(externalRoot),
    ]);
    this.externalVolumeSeparate = dataVolume && backupVolume && externalVolume
      ? externalVolume !== backupVolume && externalVolume !== dataVolume
      : null;
    this.externalVolumeWarning = null;
    if (this.externalVolumeSeparate === true) return;

    const code = this.externalVolumeSeparate === false
      ? 'BACKUP_EXTERNAL_SAME_VOLUME'
      : 'BACKUP_EXTERNAL_VOLUME_UNKNOWN';
    if (this.externalVolumePolicy === 'require-separate') {
      throw new LocalBackupError(
        code,
        'Harici yedek hedefinin ayri fiziksel volume oldugu dogrulanamadi.',
      );
    }
    if (this.externalVolumePolicy === 'warn') this.externalVolumeWarning = code;
  }

  private async enqueueAndReplicate(manifest: BackupManifestV2): Promise<void> {
    if (!this.replicationState.pendingIds.includes(manifest.id)) {
      this.replicationState.pendingIds.push(manifest.id);
    }
    await this.persistReplicationStateBestEffort();
    this.replicationRunning = true;
    try {
      await this.replicateManifest(manifest);
      await this.recordReplicationSuccess(manifest.id);
      await this.applyExternalRetention().catch(async () => {
        await this.recordReplicationFailure('BACKUP_EXTERNAL_RETENTION_FAILED');
      });
    } catch (error) {
      const code = error instanceof LocalBackupError ? error.code : 'BACKUP_REPLICATION_FAILED';
      await this.recordReplicationFailure(code);
    } finally {
      this.replicationRunning = false;
    }
  }

  private async enqueueAndUploadCloud(manifest: BackupManifestV2): Promise<void> {
    if (!this.config.cloudReplica) return;
    if (!this.replicationState.cloudPendingIds.includes(manifest.id)) {
      this.replicationState.cloudPendingIds.push(manifest.id);
    }
    await this.persistReplicationStateBestEffort();
    this.cloudReplicationRunning = true;
    try {
      await this.config.cloudReplica.upload(await this.getVerifiedDownload(manifest.id));
      await this.recordCloudReplicationSuccess(manifest.id);
    } catch {
      await this.recordCloudReplicationFailure('BACKUP_CLOUD_UPLOAD_FAILED');
    } finally {
      this.cloudReplicationRunning = false;
    }
  }

  private async recordCloudReplicationSuccess(id: string): Promise<void> {
    this.replicationState.cloudPendingIds = this.replicationState.cloudPendingIds
      .filter((pendingId) => pendingId !== id);
    if (!this.replicationState.cloudCompletedIds.includes(id)) {
      this.replicationState.cloudCompletedIds.push(id);
    }
    this.replicationState.cloudLastSuccess = { id, occurredAt: this.clock().toISOString() };
    if (this.replicationState.cloudPendingIds.length === 0) {
      this.replicationState.cloudLastError = null;
      if (this.lastError?.code.startsWith('BACKUP_CLOUD_')) this.lastError = null;
    }
    await this.persistReplicationStateBestEffort();
  }

  private async recordCloudReplicationFailure(code: string): Promise<void> {
    const occurredAt = this.clock().toISOString();
    this.replicationState.cloudLastError = { code, occurredAt };
    this.lastError = { code, occurredAt };
    await this.persistReplicationStateBestEffort();
  }

  private async recordReplicationSuccess(id: string): Promise<void> {
    this.replicationState.pendingIds = this.replicationState.pendingIds.filter((pendingId) => pendingId !== id);
    this.replicationState.lastSuccess = { id, occurredAt: this.clock().toISOString() };
    if (this.replicationState.pendingIds.length === 0) {
      this.replicationState.lastError = null;
      if (
        this.lastError?.code.startsWith('BACKUP_REPLICATION_')
        || this.lastError?.code.startsWith('BACKUP_EXTERNAL_')
      ) this.lastError = null;
    }
    await this.persistReplicationStateBestEffort();
  }

  private async recordReplicationFailure(code: string): Promise<void> {
    const occurredAt = this.clock().toISOString();
    this.replicationState.lastError = { code, occurredAt };
    this.lastError = { code, occurredAt };
    await this.persistReplicationStateBestEffort();
  }

  private async persistReplicationStateBestEffort(): Promise<void> {
    try {
      const root = this.requireBackupRoot();
      const finalPath = safeChildPath(root, REPLICATION_STATE_FILE);
      const partialName = `${REPLICATION_STATE_FILE}.${randomUUID()}.partial`;
      const partialPath = safeChildPath(root, partialName);
      await writeFile(partialPath, `${JSON.stringify(this.replicationState, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      const handle = await open(partialPath, 'r');
      await handle.sync();
      await handle.close();
      await rename(partialPath, finalPath);
      await this.syncDirectoryBestEffort(root);
    } catch {
      this.replicationState.lastError = {
        code: 'BACKUP_REPLICATION_STATE_WRITE_FAILED',
        occurredAt: this.clock().toISOString(),
      };
    }
  }

  private async replicateManifest(manifest: BackupManifestV2): Promise<void> {
    await this.refreshExternalVolumeAssessment();
    const source = await this.getVerifiedDownload(manifest.id);
    if (source.manifest.manifestVersion !== MANIFEST_VERSION) {
      throw new LocalBackupError('BACKUP_REPLICATION_SOURCE_INVALID', 'Yalniz sifreli v2 yedekler replike edilir.');
    }
    if (JSON.stringify(source.manifest) !== JSON.stringify(manifest)) {
      throw new LocalBackupError('BACKUP_REPLICATION_SOURCE_INVALID', 'Lokal manifest replikasyon adayi ile eslesmiyor.');
    }
    const root = this.requireExternalRoot();
    const finalPath = safeChildPath(root, manifest.fileName);
    const manifestPath = safeChildPath(root, `${manifest.fileName}.manifest.json`);
    const cipherPartialPath = safeChildPath(root, `${manifest.fileName}.partial`);
    const manifestPartialPath = safeChildPath(root, `${manifest.fileName}.manifest.json.partial`);
    try {
      await unlink(cipherPartialPath).catch(() => undefined);
      await unlink(manifestPartialPath).catch(() => undefined);

      const existingCipher = await lstat(finalPath).catch(() => undefined);
      if (existingCipher) {
        if (!existingCipher.isFile() || existingCipher.isSymbolicLink() || existingCipher.size !== manifest.sizeBytes) {
          throw new LocalBackupError('BACKUP_EXTERNAL_CONFLICT', 'Harici yedek hedefinde cakisan dosya var.');
        }
        if (await sha256File(finalPath) !== manifest.cipherSha256) {
          throw new LocalBackupError('BACKUP_EXTERNAL_INTEGRITY_FAILED', 'Harici yedek butunlugu gecersiz.');
        }
      } else {
        const sourceStream = createReadStream(source.absolutePath);
        const output = await open(cipherPartialPath, 'wx', 0o600);
        try {
          await pipeline(sourceStream, output.createWriteStream());
        } finally {
          await output.close().catch(() => undefined);
        }
        const copied = await lstat(cipherPartialPath);
        if (
          !copied.isFile()
          || copied.isSymbolicLink()
          || copied.size !== manifest.sizeBytes
          || await sha256File(cipherPartialPath) !== manifest.cipherSha256
        ) {
          throw new LocalBackupError('BACKUP_EXTERNAL_INTEGRITY_FAILED', 'Harici yedek kopyasi dogrulanamadi.');
        }
        const syncHandle = await open(cipherPartialPath, 'r');
        await syncHandle.sync();
        await syncHandle.close();
        await rename(cipherPartialPath, finalPath);
      }

      const existingManifest = await lstat(manifestPath).catch(() => undefined);
      if (existingManifest) {
        if (!existingManifest.isFile() || existingManifest.isSymbolicLink() || existingManifest.size > 64 * 1024) {
          throw new LocalBackupError('BACKUP_EXTERNAL_CONFLICT', 'Harici manifest hedefinde cakisan dosya var.');
        }
        const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (
          !isBackupManifest(parsed)
          || parsed.manifestVersion !== MANIFEST_VERSION
          || parsed.id !== manifest.id
          || backupStoredSha256(parsed) !== manifest.cipherSha256
          || JSON.stringify(parsed) !== JSON.stringify(manifest)
        ) {
          throw new LocalBackupError('BACKUP_EXTERNAL_CONFLICT', 'Harici manifest mevcut yedekle eslesmiyor.');
        }
      } else {
        await writeFile(manifestPartialPath, `${JSON.stringify(manifest, null, 2)}\n`, {
          encoding: 'utf8',
          flag: 'wx',
          mode: 0o600,
        });
        const manifestHandle = await open(manifestPartialPath, 'r');
        await manifestHandle.sync();
        await manifestHandle.close();
        await rename(manifestPartialPath, manifestPath);
      }
      await this.syncDirectoryBestEffort(root);
    } finally {
      await unlink(cipherPartialPath).catch(() => undefined);
      await unlink(manifestPartialPath).catch(() => undefined);
    }
  }

  private async applyExternalRetention(): Promise<void> {
    if (!this.externalRetention || !this.externalRoot) return;
    await this.refreshExternalVolumeAssessment();
    const backups = (await this.scanBackupsAt(this.externalRoot)).backups;
    const current = backups.filter((backup): backup is BackupManifestV2 => (
      backup.manifestVersion === MANIFEST_VERSION
    ));
    const keep = selectRetentionSet(current, this.externalRetention);
    for (const backup of current) {
      if (keep.has(backup.id)) continue;
      await unlink(safeChildPath(this.externalRoot, `${backup.fileName}.manifest.json`)).catch(() => undefined);
      await unlink(safeChildPath(this.externalRoot, backup.fileName)).catch(() => undefined);
    }
    await this.syncDirectoryBestEffort(this.externalRoot);
  }

  private async scanBackups(): Promise<BackupScanResult> {
    return this.scanBackupsAt(this.requireBackupRoot());
  }

  private async scanBackupsAt(root: string): Promise<BackupScanResult> {
    const entries = await readdir(root, { withFileTypes: true });
    const backups: BackupManifest[] = [];
    let invalidEntryCount = 0;

    for (const entry of entries) {
      if (!isBackupManifestFileName(entry.name)) continue;
      if (!entry.isFile() || entry.isSymbolicLink()) {
        invalidEntryCount += 1;
        continue;
      }
      try {
        const manifestPath = safeChildPath(root, entry.name);
        const manifestEntry = await lstat(manifestPath);
        if (!manifestEntry.isFile() || manifestEntry.isSymbolicLink() || manifestEntry.size > 64 * 1024) {
          invalidEntryCount += 1;
          continue;
        }
        const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (!isBackupManifest(parsed) || entry.name !== `${parsed.fileName}.manifest.json`) {
          invalidEntryCount += 1;
          continue;
        }
        const dumpPath = safeChildPath(root, parsed.fileName);
        const dumpEntry = await lstat(dumpPath);
        if (!dumpEntry.isFile() || dumpEntry.isSymbolicLink() || dumpEntry.size !== parsed.sizeBytes) {
          invalidEntryCount += 1;
          continue;
        }
        backups.push(parsed);
      } catch {
        invalidEntryCount += 1;
      }
    }

    backups.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return { backups, invalidEntryCount };
  }

  private async findManifestById(id: string): Promise<BackupManifest | undefined> {
    const root = this.requireBackupRoot();
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!isBackupManifestFileName(entry.name) || !entry.isFile() || entry.isSymbolicLink()) continue;
      try {
        const manifestPath = safeChildPath(root, entry.name);
        const manifestEntry = await lstat(manifestPath);
        if (!manifestEntry.isFile() || manifestEntry.isSymbolicLink() || manifestEntry.size > 64 * 1024) continue;
        const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
        if (
          isBackupManifest(parsed)
          && parsed.id === id
          && entry.name === `${parsed.fileName}.manifest.json`
        ) {
          return parsed;
        }
      } catch {
        // Bozuk veya yarim manifest indirme adayi degildir.
      }
    }
    return undefined;
  }

  private async acquireLock(): Promise<HeldBackupLock> {
    const root = this.requireBackupRoot();
    const lockPath = safeChildPath(root, '.restotm-backup.lock');
    const token = randomUUID();

    const tryAcquire = async (): Promise<HeldBackupLock> => {
      try {
        const handle = await open(lockPath, 'wx', 0o600);
        await handle.writeFile(`${JSON.stringify({ token, pid: process.pid, createdAt: this.clock().toISOString() })}\n`);
        await handle.sync();
        await handle.close();
        return {
          token,
          release: async () => {
            const current = await readFile(lockPath, 'utf8').catch(() => '');
            if (!current.includes(`\"token\":\"${token}\"`)) return;
            await unlink(lockPath).catch(() => undefined);
          },
        };
      } catch (error) {
        const fsError = error as NodeJS.ErrnoException;
        if (fsError.code !== 'EEXIST') throw error;
        const lockEntry = await stat(lockPath).catch(() => undefined);
        if (!lockEntry || this.clock().getTime() - lockEntry.mtimeMs <= this.lockStaleMs) {
          throw new BackupAlreadyRunningError();
        }
        await unlink(lockPath);
        return tryAcquire();
      }
    };

    return tryAcquire();
  }

  private requireBackupRoot(): string {
    if (!this.backupRoot) throw new LocalBackupError('BACKUP_NOT_INITIALIZED', 'Yedek servisi baslatilmadi.');
    return this.backupRoot;
  }

  private requireExternalRoot(): string {
    if (!this.externalRoot) {
      throw new LocalBackupError('BACKUP_EXTERNAL_NOT_CONFIGURED', 'Harici yedek hedefi tanimli degil.');
    }
    return this.externalRoot;
  }

  private async syncBackupDirectoryBestEffort(): Promise<void> {
    await this.syncDirectoryBestEffort(this.requireBackupRoot());
  }

  private async syncDirectoryBestEffort(directory: string): Promise<void> {
    try {
      const handle = await open(directory, 'r');
      await handle.sync();
      await handle.close();
    } catch {
      // Windows'ta dizin fsync desteklenmeyebilir. Dosyalar ayri ayri fsync
      // edilmistir; bu son dayanıklilik adimi platforma bagli best-effort'tur.
    }
  }
}
