import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

const MANIFEST_VERSION = 1;
const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SCHEDULER_POLL_MS = 15 * 60 * 1000;
const DEFAULT_PROCESS_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const BACKUP_FILE_PATTERN = /^restotm-\d{8}T\d{9}Z-[0-9a-f-]{36}\.dump$/i;
const BACKUP_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  connection: PostgresConnectionOptions;
  pgDumpPath?: string;
  retention?: Partial<BackupRetentionPolicy>;
  processTimeoutMs?: number;
  backupIntervalMs?: number;
  schedulerPollMs?: number;
  lockStaleMs?: number;
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

export interface BackupManifest {
  manifestVersion: 1;
  id: string;
  format: 'pg_dump-custom';
  reason: BackupReason;
  createdAt: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
}

export interface BackupDownload {
  manifest: BackupManifest;
  absolutePath: string;
}

export interface LocalBackupStatus {
  running: boolean;
  schedulerRunning: boolean;
  backupCount: number;
  invalidEntryCount: number;
  lastSuccess: BackupManifest | null;
  lastError: { code: string; occurredAt: string } | null;
  retention: BackupRetentionPolicy;
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

interface BackupScanResult {
  backups: BackupManifest[];
  invalidEntryCount: number;
}

interface HeldBackupLock {
  token: string;
  release(): Promise<void>;
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

function validatePgDumpPath(executable: string): void {
  if (!executable || executable.includes('\0')) {
    throw new LocalBackupError('INVALID_BACKUP_CONFIG', 'pg_dump yolu gecersiz.');
  }
  const executableName = path.basename(executable).toLowerCase();
  if (executableName !== 'pg_dump' && executableName !== 'pg_dump.exe') {
    throw new LocalBackupError('INVALID_BACKUP_CONFIG', 'Yedek araci pg_dump olmalidir.');
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

function isBackupManifest(value: unknown): value is BackupManifest {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BackupManifest>;
  return item.manifestVersion === MANIFEST_VERSION
    && typeof item.id === 'string'
    && BACKUP_ID_PATTERN.test(item.id)
    && item.format === 'pg_dump-custom'
    && (item.reason === 'manual' || item.reason === 'scheduled')
    && typeof item.createdAt === 'string'
    && Number.isFinite(Date.parse(item.createdAt))
    && typeof item.fileName === 'string'
    && BACKUP_FILE_PATTERN.test(item.fileName)
    && typeof item.sizeBytes === 'number'
    && Number.isSafeInteger(item.sizeBytes)
    && item.sizeBytes > 0
    && typeof item.sha256 === 'string'
    && /^[0-9a-f]{64}$/i.test(item.sha256);
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
  private readonly processTimeoutMs: number;
  private readonly backupIntervalMs: number;
  private readonly schedulerPollMs: number;
  private readonly lockStaleMs: number;
  private readonly clock: () => Date;
  private readonly pgDumpPath: string;
  private dataRoot?: string;
  private backupRoot?: string;
  private initializing?: Promise<void>;
  private running = false;
  private scheduler?: NodeJS.Timeout;
  private lastSuccess: BackupManifest | null = null;
  private lastError: { code: string; occurredAt: string } | null = null;

  constructor(
    private readonly config: LocalBackupConfig,
    private readonly processAdapter: BackupProcessAdapter = new ExecFileBackupProcessAdapter(),
  ) {
    validateConnection(config.connection);
    this.pgDumpPath = config.pgDumpPath ?? 'pg_dump';
    validatePgDumpPath(this.pgDumpPath);
    this.retention = {
      daily: retentionCount(config.retention?.daily, 7, 'retention.daily'),
      weekly: retentionCount(config.retention?.weekly, 4, 'retention.weekly'),
      monthly: retentionCount(config.retention?.monthly, 12, 'retention.monthly'),
    };
    if (this.retention.daily + this.retention.weekly + this.retention.monthly === 0) {
      throw new LocalBackupError('INVALID_BACKUP_CONFIG', 'En az bir retention sinifi etkin olmalidir.');
    }
    this.processTimeoutMs = positiveDuration(config.processTimeoutMs, DEFAULT_PROCESS_TIMEOUT_MS, 'processTimeoutMs');
    this.backupIntervalMs = positiveDuration(config.backupIntervalMs, DEFAULT_BACKUP_INTERVAL_MS, 'backupIntervalMs');
    this.schedulerPollMs = positiveDuration(config.schedulerPollMs, DEFAULT_SCHEDULER_POLL_MS, 'schedulerPollMs');
    this.lockStaleMs = positiveDuration(config.lockStaleMs, DEFAULT_LOCK_STALE_MS, 'lockStaleMs');
    if (this.lockStaleMs <= this.processTimeoutMs) {
      throw new LocalBackupError('INVALID_BACKUP_CONFIG', 'lockStaleMs, processTimeoutMs degerinden buyuk olmalidir.');
    }
    this.clock = config.clock ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    if (this.dataRoot && this.backupRoot) return;
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
      })().finally(() => {
        this.initializing = undefined;
      });
    }
    await this.initializing;
  }

  async createBackup(reason: BackupReason = 'manual'): Promise<BackupManifest> {
    await this.initialize();
    if (this.running) throw new BackupAlreadyRunningError();
    this.running = true;

    let heldLock: HeldBackupLock | undefined;
    let partialPath: string | undefined;
    let manifestPartialPath: string | undefined;
    let unpublishedFinalPath: string | undefined;
    try {
      heldLock = await this.acquireLock();
      const root = this.requireBackupRoot();
      const createdAt = this.clock();
      const id = randomUUID();
      const fileName = `restotm-${timestampForFile(createdAt)}-${id}.dump`;
      const finalPath = safeChildPath(root, fileName);
      partialPath = safeChildPath(root, `${fileName}.partial`);
      const manifestName = `${fileName}.manifest.json`;
      const manifestPath = safeChildPath(root, manifestName);
      manifestPartialPath = safeChildPath(root, `${manifestName}.partial`);

      // wx ile isim rezerve edilir. Dizin 0700, dosya 0600'dur; pg_dump
      // yalniz bu normal dosyayi acar ve olasi symlink yarisi daraltilir.
      const reservation = await open(partialPath, 'wx', 0o600);
      await reservation.close();

      const connection = this.config.connection;
      const args = [
        '--format=custom',
        '--compress=6',
        '--no-owner',
        '--no-privileges',
        '--no-password',
        '--file', partialPath,
        '--host', connection.host,
        '--port', String(connection.port),
        '--username', connection.user,
        '--dbname', connection.database,
      ];
      const processEnv = pgDumpEnvironment(connection);

      await this.processAdapter.run(this.pgDumpPath, args, {
        cwd: root,
        env: processEnv,
        timeoutMs: this.processTimeoutMs,
      });

      const dumpEntry = await lstat(partialPath);
      if (!dumpEntry.isFile() || dumpEntry.isSymbolicLink() || dumpEntry.size < 1) {
        throw new LocalBackupError('INVALID_BACKUP_OUTPUT', 'pg_dump gecerli bir yedek dosyasi uretmedi.');
      }
      await chmod(partialPath, 0o600);
      const dumpHandle = await open(partialPath, 'r');
      await dumpHandle.sync();
      await dumpHandle.close();

      const manifest: BackupManifest = {
        manifestVersion: MANIFEST_VERSION,
        id,
        format: 'pg_dump-custom',
        reason,
        createdAt: createdAt.toISOString(),
        fileName,
        sizeBytes: dumpEntry.size,
        sha256: await sha256File(partialPath),
      };

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
      await rename(partialPath, finalPath);
      partialPath = undefined;
      unpublishedFinalPath = finalPath;
      await rename(manifestPartialPath, manifestPath);
      manifestPartialPath = undefined;
      unpublishedFinalPath = undefined;
      await this.syncBackupDirectoryBestEffort();

      this.lastSuccess = manifest;
      this.lastError = null;
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
      if (partialPath) await unlink(partialPath).catch(() => undefined);
      if (manifestPartialPath) await unlink(manifestPartialPath).catch(() => undefined);
      if (unpublishedFinalPath) await unlink(unpublishedFinalPath).catch(() => undefined);
      throw localError;
    } finally {
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
    return {
      running: this.running,
      schedulerRunning: Boolean(this.scheduler),
      backupCount: scan.backups.length,
      invalidEntryCount: scan.invalidEntryCount,
      lastSuccess: this.lastSuccess ?? scan.backups[0] ?? null,
      lastError: this.lastError,
      retention: { ...this.retention },
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
    if (digest !== backup.sha256) {
      throw new LocalBackupError('BACKUP_INTEGRITY_FAILED', 'Yedek dosyasi butunluk kontrolunden gecemedi.', 409);
    }
    return { manifest: backup, absolutePath: filePath };
  }

  async applyRetention(): Promise<void> {
    await this.initialize();
    const backups = (await this.scanBackups()).backups;
    const keep = selectRetentionSet(backups, this.retention);
    const root = this.requireBackupRoot();

    for (const backup of backups) {
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
    const tick = (): void => {
      void this.runScheduledIfDue().catch(() => undefined);
    };
    tick();
    this.scheduler = setInterval(tick, this.schedulerPollMs);
    this.scheduler.unref?.();
  }

  stopScheduler(): void {
    if (!this.scheduler) return;
    clearInterval(this.scheduler);
    this.scheduler = undefined;
  }

  private async runScheduledIfDue(): Promise<void> {
    if (this.running) return;
    const backups = await this.listBackups();
    const newest = backups[0];
    if (newest && this.clock().getTime() - Date.parse(newest.createdAt) < this.backupIntervalMs) return;
    await this.createBackup('scheduled');
  }

  private async scanBackups(): Promise<BackupScanResult> {
    const root = this.requireBackupRoot();
    const entries = await readdir(root, { withFileTypes: true });
    const backups: BackupManifest[] = [];
    let invalidEntryCount = 0;

    for (const entry of entries) {
      if (!entry.name.endsWith('.dump.manifest.json')) continue;
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
      if (!entry.name.endsWith('.dump.manifest.json') || !entry.isFile() || entry.isSymbolicLink()) continue;
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

  private async syncBackupDirectoryBestEffort(): Promise<void> {
    try {
      const handle = await open(this.requireBackupRoot(), 'r');
      await handle.sync();
      await handle.close();
    } catch {
      // Windows'ta dizin fsync desteklenmeyebilir. Dosyalar ayri ayri fsync
      // edilmistir; bu son dayanıklilik adimi platforma bagli best-effort'tur.
    }
  }
}
