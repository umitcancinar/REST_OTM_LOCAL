import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import {
  createHash,
  createPublicKey,
  randomUUID,
  type KeyObject,
} from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import {
  LOCAL_UPDATE_SUPERVISOR_CONTRACT_VERSION,
  compareVersions,
  parseAndVerifySignedManifest,
  type UpdateManifest,
  validateArtifactUrl,
  validateUpdateEndpoint,
} from './local-update.contract';

const UPDATE_STATE_VERSION = 1 as const;
const UPDATE_HANDOFF_FILE = 'pending-handoff.json';
const UPDATE_STATE_FILE = 'update-high-water.json';
const UPDATE_LOCK_FILE = '.update.lock';
const MAX_MANIFEST_BYTES = 256 * 1024;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const MAX_CLOCK_ROLLBACK_MS = 12 * 60 * 60 * 1000;
const MAX_MANIFEST_FUTURE_MS = 5 * 60 * 1000;
const MAX_MANIFEST_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_TOTAL_ARTIFACT_BYTES = 8 * 1024 * 1024 * 1024;

const persistedVersionSchema = z.string().min(1).max(128).refine((value) => {
  try {
    compareVersions(value, value);
    return true;
  } catch {
    return false;
  }
}, 'persisted version gecersiz');

const updateStateSchema = z.object({
  stateVersion: z.literal(UPDATE_STATE_VERSION),
  highestAcceptedVersion: persistedVersionSchema,
  highestAcceptedManifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  highestManifestIssuedAt: z.string().datetime({ offset: true }),
  highestObservedAt: z.string().datetime({ offset: true }),
  stagedAt: z.string().datetime({ offset: true }),
  handoffCommandId: z.string().uuid(),
}).strict();

const updateHandoffSchema = z.object({
  contractVersion: z.literal(LOCAL_UPDATE_SUPERVISOR_CONTRACT_VERSION),
  commandId: z.string().uuid(),
  action: z.literal('INSTALL_STAGED_UPDATE'),
  state: z.literal('STAGED_AWAITING_SUPERVISOR'),
  createdAt: z.string().datetime({ offset: true }),
  currentVersion: persistedVersionSchema,
  targetVersion: persistedVersionSchema,
  channel: z.string().min(1).max(32),
  manifestSha256: z.string().regex(/^[0-9a-f]{64}$/),
  manifestEnvelopePath: z.string().min(1),
  stageDirectory: z.string().min(1),
  artifacts: z.array(z.object({
    role: z.string().min(1),
    fileName: z.string().min(1),
    absolutePath: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    sizeBytes: z.number().int().positive(),
  }).strict()).min(1),
  migration: z.record(z.unknown()),
  verification: z.object({
    signatureAlgorithm: z.literal('Ed25519'),
    canonicalManifestRequired: z.literal(true),
    supervisorMustReverifyManifestAndArtifacts: z.literal(true),
    publicKeyEnvironmentName: z.literal('LOCAL_UPDATE_PUBLIC_KEY'),
  }).strict(),
  requirements: z.object({
    supervisorProtocolVersion: z.literal(LOCAL_UPDATE_SUPERVISOR_CONTRACT_VERSION),
    preMigrationBackupRequiredWhenDeclared: z.literal(true),
    atomicReplaceRequired: z.literal(true),
    healthCheckAndRollbackRequired: z.literal(true),
  }).strict(),
  localApiApplySupported: z.literal(false),
  operationalDataIncluded: z.literal(false),
}).strict();

type UpdateState = z.infer<typeof updateStateSchema>;
type UpdateHandoff = z.infer<typeof updateHandoffSchema>;

export const LOCAL_UPDATE_LICENSE_GATE_POLICY = 'RECOVERY_MAINTENANCE_ALWAYS' as const;

export interface LocalUpdateRuntimeConfig {
  runtimeMode: 'local';
  dataDir: string;
  manifestUrl: string;
  publicKeyPem: string;
  currentVersion: string;
  channel: string;
  currentDatabaseSchemaVersion: number;
  allowedArtifactOrigins?: readonly string[];
  requestTimeoutMs?: number;
  maxTotalArtifactBytes?: number;
  clock?: () => Date;
}

export interface LocalUpdateFetch {
  (input: string | URL, init?: RequestInit): Promise<Response>;
}

export interface LocalUpdateStatus {
  coordinatorState: 'IDLE' | 'STAGED_AWAITING_SUPERVISOR';
  currentVersion: string;
  channel: string;
  currentDatabaseSchemaVersion: number;
  highestAcceptedVersion: string | null;
  pending: null | {
    commandId: string;
    targetVersion: string;
    stagedAt: string;
    manifestSha256: string;
  };
  applySupportedByLocalApi: false;
  supervisorHandoffContractVersion: 1;
  licenseGatePolicy: typeof LOCAL_UPDATE_LICENSE_GATE_POLICY;
}

export interface StagedUpdateResult {
  code: 'UPDATE_STAGED_NOT_APPLIED';
  state: 'STAGED_AWAITING_SUPERVISOR';
  commandId: string;
  targetVersion: string;
  manifestSha256: string;
  stageDirectory: string;
  applySupportedByLocalApi: false;
}

export interface NoUpdateAvailableResult {
  code: 'NO_UPDATE_AVAILABLE';
  state: 'IDLE';
  currentVersion: string;
  channel: string;
  applySupportedByLocalApi: false;
}

export type LocalUpdateCheckResult = StagedUpdateResult | NoUpdateAvailableResult;

export class LocalUpdateError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = 'LocalUpdateError';
  }
}

function safeChild(root: string, name: string): string {
  const candidate = path.resolve(root, name);
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new LocalUpdateError('UPDATE_PATH_ESCAPE', 'Update dosya yolu guvenli sinirin disina cikiyor.');
  }
  return candidate;
}

function positiveInteger(value: number | undefined, fallback: number, field: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1_000) {
    throw new LocalUpdateError('INVALID_UPDATE_CONFIG', `${field} en az 1000 olmali.`);
  }
  return resolved;
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  try {
    const handle = await open(directory, 'r');
    await handle.sync();
    await handle.close();
  } catch {
    // Windows dizin handle'inda fsync desteklemeyebilir. Dosyanin kendisi
    // her durumda fsync edilir; bu adim POSIX dayanikliligini tamamlar.
  }
}

async function atomicWriteJson(target: string, value: unknown): Promise<void> {
  const directory = path.dirname(target);
  const temporary = safeChild(directory, `.${path.basename(target)}.${randomUUID()}.partial`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, target);
    await chmod(target, 0o600).catch(() => undefined);
    await syncDirectoryBestEffort(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function parseBoundedJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok || response.status !== 200) {
    throw new LocalUpdateError('UPDATE_MANIFEST_HTTP_ERROR', 'Update manifesti alinamadi.', 502);
  }
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('application/json')) {
    throw new LocalUpdateError('UPDATE_MANIFEST_CONTENT_TYPE', 'Update manifesti JSON degil.', 502);
  }
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_MANIFEST_BYTES)) {
    throw new LocalUpdateError('UPDATE_MANIFEST_TOO_LARGE', 'Update manifesti boyut sinirini asiyor.', 502);
  }
  if (!response.body) throw new LocalUpdateError('UPDATE_MANIFEST_EMPTY', 'Update manifesti bos.', 502);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_MANIFEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new LocalUpdateError('UPDATE_MANIFEST_TOO_LARGE', 'Update manifesti boyut sinirini asiyor.', 502);
    }
    chunks.push(Buffer.from(value));
  }
  try {
    return JSON.parse(Buffer.concat(chunks, total).toString('utf8')) as unknown;
  } catch {
    throw new LocalUpdateError('UPDATE_MANIFEST_INVALID_JSON', 'Update manifesti gecerli JSON degil.', 502);
  }
}

async function writeChunk(handle: Awaited<ReturnType<typeof open>>, value: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < value.byteLength) {
    const result = await handle.write(value, offset, value.byteLength - offset, null);
    if (result.bytesWritten < 1) throw new Error('Artifact dosyasina yazilamadi.');
    offset += result.bytesWritten;
  }
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}

export class LocalUpdateRuntime {
  private readonly endpoint: URL;
  private readonly publicKey: KeyObject;
  private readonly allowedOrigins: ReadonlySet<string>;
  private readonly requestTimeoutMs: number;
  private readonly maxTotalArtifactBytes: number;
  private readonly clock: () => Date;
  private dataRoot?: string;
  private initialized = false;
  private operation?: Promise<LocalUpdateCheckResult>;

  constructor(
    private readonly config: LocalUpdateRuntimeConfig,
    private readonly fetchImpl: LocalUpdateFetch = fetch,
  ) {
    if (config.runtimeMode !== 'local') {
      throw new LocalUpdateError('INVALID_UPDATE_CONFIG', 'LocalUpdateRuntime yalniz local profilde calisir.');
    }
    if (!path.isAbsolute(config.dataDir) || path.parse(config.dataDir).root === path.resolve(config.dataDir)) {
      throw new LocalUpdateError('INVALID_UPDATE_CONFIG', 'Update dataDir mutlak ve kok olmayan bir yol olmali.');
    }
    this.endpoint = validateUpdateEndpoint(config.manifestUrl);
    try {
      this.publicKey = createPublicKey(config.publicKeyPem);
      if (this.publicKey.asymmetricKeyType !== 'ed25519') throw new Error('wrong-key-type');
    } catch {
      throw new LocalUpdateError('INVALID_UPDATE_CONFIG', 'Update public key gecerli Ed25519 PEM olmali.');
    }
    compareVersions(config.currentVersion, config.currentVersion);
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(config.channel)) {
      throw new LocalUpdateError('INVALID_UPDATE_CONFIG', 'Update channel gecersiz.');
    }
    if (!Number.isSafeInteger(config.currentDatabaseSchemaVersion)
      || config.currentDatabaseSchemaVersion < 0) {
      throw new LocalUpdateError('INVALID_UPDATE_CONFIG', 'Mevcut veritabani sema surumu gecersiz.');
    }
    const origins = config.allowedArtifactOrigins ?? [this.endpoint.origin];
    if (origins.length < 1 || origins.length > 16) {
      throw new LocalUpdateError('INVALID_UPDATE_CONFIG', 'Artifact origin allowlist gecersiz.');
    }
    this.allowedOrigins = new Set(origins.map((origin) => {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'https:' || parsed.origin !== origin || parsed.pathname !== '/') {
        throw new LocalUpdateError('INVALID_UPDATE_CONFIG', 'Artifact origin canonical HTTPS origin olmali.');
      }
      return parsed.origin;
    }));
    this.requestTimeoutMs = positiveInteger(
      config.requestTimeoutMs,
      DEFAULT_REQUEST_TIMEOUT_MS,
      'requestTimeoutMs',
    );
    this.maxTotalArtifactBytes = positiveInteger(
      config.maxTotalArtifactBytes,
      DEFAULT_MAX_TOTAL_ARTIFACT_BYTES,
      'maxTotalArtifactBytes',
    );
    this.clock = config.clock ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    const configuredRoot = path.resolve(this.config.dataDir);
    await mkdir(configuredRoot, { recursive: true, mode: 0o700 });
    const configuredEntry = await lstat(configuredRoot);
    if (configuredEntry.isSymbolicLink()) {
      throw new LocalUpdateError('UPDATE_DATA_DIR_UNSAFE', 'Update data dizini symlink olamaz.');
    }
    const root = await realpath(configuredRoot);
    const rootEntry = await lstat(root);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink()) {
      throw new LocalUpdateError('UPDATE_DATA_DIR_UNSAFE', 'Update data dizini gercek bir klasor olmali.');
    }
    this.dataRoot = root;
    await chmod(root, 0o700).catch(() => undefined);
    const stages = safeChild(root, 'stages');
    await mkdir(stages, { recursive: true, mode: 0o700 });
    const stagesEntry = await lstat(stages);
    if (!stagesEntry.isDirectory() || stagesEntry.isSymbolicLink()) {
      throw new LocalUpdateError('UPDATE_DATA_DIR_UNSAFE', 'Update stage dizini gercek bir klasor olmali.');
    }
    const canonicalStages = await realpath(stages);
    const normalize = (value: string) => process.platform === 'win32'
      ? path.resolve(value).toLowerCase()
      : path.resolve(value);
    if (normalize(canonicalStages) !== normalize(stages)) {
      throw new LocalUpdateError('UPDATE_DATA_DIR_UNSAFE', 'Update stage dizini reparse/symlink olamaz.');
    }
    await chmod(stages, 0o700).catch(() => undefined);
    this.initialized = true;
  }

  async getStatus(): Promise<LocalUpdateStatus> {
    this.requireInitialized();
    const state = await this.readState();
    const handoff = await this.readHandoff();
    this.assertCoordinatorConsistency(state, handoff);
    return {
      coordinatorState: handoff ? 'STAGED_AWAITING_SUPERVISOR' : 'IDLE',
      currentVersion: this.config.currentVersion,
      channel: this.config.channel,
      currentDatabaseSchemaVersion: this.config.currentDatabaseSchemaVersion,
      highestAcceptedVersion: state?.highestAcceptedVersion ?? null,
      pending: handoff ? {
        commandId: handoff.commandId,
        targetVersion: handoff.targetVersion,
        stagedAt: handoff.createdAt,
        manifestSha256: handoff.manifestSha256,
      } : null,
      applySupportedByLocalApi: false,
      supervisorHandoffContractVersion: LOCAL_UPDATE_SUPERVISOR_CONTRACT_VERSION,
      licenseGatePolicy: LOCAL_UPDATE_LICENSE_GATE_POLICY,
    };
  }

  checkAndStage(): Promise<LocalUpdateCheckResult> {
    this.requireInitialized();
    if (this.operation) {
      throw new LocalUpdateError('UPDATE_ALREADY_RUNNING', 'Bir update kontrolu zaten calisiyor.', 409);
    }
    const operation = this.performCheckAndStage();
    this.operation = operation;
    void operation.finally(() => {
      if (this.operation === operation) this.operation = undefined;
    }).catch(() => undefined);
    return operation;
  }

  private async performCheckAndStage(): Promise<LocalUpdateCheckResult> {
    const releaseLock = await this.acquireLock();
    let temporaryStage: string | undefined;
    try {
      const previousState = await this.readState();
      const existingHandoff = await this.readHandoff();
      this.assertCoordinatorConsistency(previousState, existingHandoff);
      const response = await this.fetchWithTimeout(this.endpoint, {
        method: 'GET',
        redirect: 'error',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'identity',
          'X-Rest-Otm-Current-Version': this.config.currentVersion,
          'X-Rest-Otm-Update-Channel': this.config.channel,
        },
      });
      if (response.url) {
        const finalUrl = validateUpdateEndpoint(response.url);
        if (finalUrl.href !== this.endpoint.href) {
          throw new LocalUpdateError('UPDATE_MANIFEST_REDIRECTED', 'Update manifest redirect yaniti reddedildi.', 502);
        }
      }
      if (response.status === 204) {
        if (existingHandoff) {
          throw new LocalUpdateError(
            'UPDATE_PENDING_BUT_FEED_EMPTY',
            'Stage edilmis update varken cloud feed bos dondu; supervisor incelemesi gerekli.',
            409,
          );
        }
        return {
          code: 'NO_UPDATE_AVAILABLE',
          state: 'IDLE',
          currentVersion: this.config.currentVersion,
          channel: this.config.channel,
          applySupportedByLocalApi: false,
        };
      }
      const rawEnvelope = await parseBoundedJsonResponse(response);
      let verified: ReturnType<typeof parseAndVerifySignedManifest>;
      try {
        verified = parseAndVerifySignedManifest(rawEnvelope, this.publicKey);
      } catch {
        throw new LocalUpdateError('UPDATE_MANIFEST_UNTRUSTED', 'Update manifest imzasi veya semasi gecersiz.', 409);
      }
      this.assertManifestPolicy(verified.manifest);
      this.assertAntiRollback(verified.manifest, verified.digest, previousState);

      if (
        previousState?.highestAcceptedVersion === verified.manifest.version
        && previousState.highestAcceptedManifestSha256 === verified.digest
      ) {
        if (
          !existingHandoff
          || existingHandoff.manifestSha256 !== verified.digest
          || existingHandoff.targetVersion !== verified.manifest.version
        ) {
          throw new LocalUpdateError(
            'UPDATE_HANDOFF_MISSING_OR_CORRUPT',
            'Kabul edilmis update icin supervisor handoff kaydi bulunamadi.',
            409,
          );
        }
        await this.verifyStagedHandoff(existingHandoff);
        return this.presentHandoff(existingHandoff);
      }

      const stagesRoot = safeChild(this.requireDataRoot(), 'stages');
      temporaryStage = await mkdtemp(path.join(stagesRoot, '.partial-'));
      await chmod(temporaryStage, 0o700).catch(() => undefined);
      const stagedArtifacts = [];
      for (const artifact of verified.manifest.artifacts) {
        const artifactUrl = validateArtifactUrl(artifact.url, this.allowedOrigins);
        const destination = safeChild(temporaryStage, artifact.fileName);
        await this.downloadAndVerify(artifactUrl, destination, artifact.sizeBytes, artifact.sha256);
        stagedArtifacts.push({
          role: artifact.role,
          fileName: artifact.fileName,
          absolutePath: destination,
          sha256: artifact.sha256,
          sizeBytes: artifact.sizeBytes,
        });
      }

      const envelopePath = safeChild(temporaryStage, 'signed-manifest.json');
      await atomicWriteJson(envelopePath, verified.envelope);
      const finalStage = safeChild(
        stagesRoot,
        `${verified.manifest.version}-${verified.digest.slice(0, 16)}`,
      );
      await rename(temporaryStage, finalStage).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'EEXIST' || error.code === 'ENOTEMPTY') {
          throw new LocalUpdateError('UPDATE_STAGE_COLLISION', 'Update stage hedefi zaten mevcut.', 409);
        }
        throw error;
      });
      temporaryStage = undefined;
      await syncDirectoryBestEffort(stagesRoot);

      const commandId = randomUUID();
      const now = this.clock().toISOString();
      const handoff: UpdateHandoff = {
        contractVersion: LOCAL_UPDATE_SUPERVISOR_CONTRACT_VERSION,
        commandId,
        action: 'INSTALL_STAGED_UPDATE',
        state: 'STAGED_AWAITING_SUPERVISOR',
        createdAt: now,
        currentVersion: this.config.currentVersion,
        targetVersion: verified.manifest.version,
        channel: verified.manifest.channel,
        manifestSha256: verified.digest,
        manifestEnvelopePath: path.join(finalStage, path.basename(envelopePath)),
        stageDirectory: finalStage,
        artifacts: stagedArtifacts.map((artifact) => ({
          ...artifact,
          absolutePath: path.join(finalStage, artifact.fileName),
        })),
        migration: verified.manifest.migration,
        verification: {
          signatureAlgorithm: 'Ed25519',
          canonicalManifestRequired: true,
          supervisorMustReverifyManifestAndArtifacts: true,
          publicKeyEnvironmentName: 'LOCAL_UPDATE_PUBLIC_KEY',
        },
        requirements: {
          supervisorProtocolVersion: LOCAL_UPDATE_SUPERVISOR_CONTRACT_VERSION,
          preMigrationBackupRequiredWhenDeclared: true,
          atomicReplaceRequired: true,
          healthCheckAndRollbackRequired: true,
        },
        localApiApplySupported: false,
        operationalDataIncluded: false,
      };
      updateHandoffSchema.parse(handoff);

      const state: UpdateState = {
        stateVersion: UPDATE_STATE_VERSION,
        highestAcceptedVersion: verified.manifest.version,
        highestAcceptedManifestSha256: verified.digest,
        highestManifestIssuedAt: verified.manifest.issuedAt,
        highestObservedAt: now,
        stagedAt: now,
        handoffCommandId: commandId,
      };
      // High-water once stage is durable, then fixed handoff. A handoff write
      // failure is not reported as success; the same signed manifest can be
      // retried only after an operator reconciles the missing handoff.
      await atomicWriteJson(this.statePath(), state);
      await atomicWriteJson(this.handoffPath(), handoff);
      return this.presentHandoff(handoff);
    } finally {
      if (temporaryStage) await rm(temporaryStage, { recursive: true, force: true }).catch(() => undefined);
      await releaseLock();
    }
  }

  private assertManifestPolicy(manifest: UpdateManifest): void {
    const now = this.clock();
    const issuedAt = new Date(manifest.issuedAt);
    const expiresAt = new Date(manifest.expiresAt);
    if (manifest.channel !== this.config.channel) {
      throw new LocalUpdateError('UPDATE_CHANNEL_MISMATCH', 'Manifest farkli update channel icin imzalanmis.', 409);
    }
    if (issuedAt.getTime() > now.getTime() + MAX_MANIFEST_FUTURE_MS) {
      throw new LocalUpdateError('UPDATE_MANIFEST_FROM_FUTURE', 'Manifest gelecekte imzalanmis.', 409);
    }
    if (expiresAt <= now || expiresAt <= issuedAt) {
      throw new LocalUpdateError('UPDATE_MANIFEST_EXPIRED', 'Update manifest suresi dolmus.', 409);
    }
    if (expiresAt.getTime() - issuedAt.getTime() > MAX_MANIFEST_LIFETIME_MS) {
      throw new LocalUpdateError('UPDATE_MANIFEST_LIFETIME_INVALID', 'Manifest gecerlilik suresi cok uzun.', 409);
    }
    if (compareVersions(manifest.version, this.config.currentVersion) <= 0) {
      throw new LocalUpdateError('UPDATE_NOT_NEWER', 'Manifest mevcut surumden yeni degil.', 409);
    }
    if (
      compareVersions(this.config.currentVersion, manifest.minCurrentVersion) < 0
      || compareVersions(this.config.currentVersion, manifest.maxCurrentVersion) > 0
    ) {
      throw new LocalUpdateError('UPDATE_CURRENT_VERSION_INCOMPATIBLE', 'Mevcut surum bu update zinciriyle uyumlu degil.', 409);
    }
    const migration = manifest.migration;
    const currentSchema = this.config.currentDatabaseSchemaVersion;
    if (
      currentSchema < migration.minCurrentSchemaVersion
      || currentSchema > migration.maxCurrentSchemaVersion
    ) {
      throw new LocalUpdateError('UPDATE_DATABASE_SCHEMA_INCOMPATIBLE', 'Veritabani semasi bu update ile uyumlu degil.', 409);
    }
    if (migration.mode === 'none' && migration.targetSchemaVersion !== currentSchema) {
      throw new LocalUpdateError('UPDATE_MIGRATION_CONTRACT_INVALID', 'mode=none sema degisikligi bildiremez.', 409);
    }
    if (migration.targetSchemaVersion !== currentSchema && !migration.requiresBackup) {
      throw new LocalUpdateError('UPDATE_BACKUP_REQUIRED', 'Sema degisikligi backup zorunlulugu bildirmeli.', 409);
    }
    const totalBytes = manifest.artifacts.reduce((total, artifact) => total + artifact.sizeBytes, 0);
    if (!Number.isSafeInteger(totalBytes) || totalBytes > this.maxTotalArtifactBytes) {
      throw new LocalUpdateError('UPDATE_ARTIFACT_TOTAL_TOO_LARGE', 'Update artifact toplam boyutu siniri asiyor.', 409);
    }
    for (const artifact of manifest.artifacts) validateArtifactUrl(artifact.url, this.allowedOrigins);
  }

  private assertAntiRollback(
    manifest: UpdateManifest,
    digest: string,
    state: UpdateState | null,
  ): void {
    if (!state) return;
    const versionOrder = compareVersions(manifest.version, state.highestAcceptedVersion);
    if (versionOrder < 0) {
      throw new LocalUpdateError('UPDATE_ROLLBACK_REJECTED', 'Daha once kabul edilen surumun altina inilemez.', 409);
    }
    if (versionOrder === 0 && digest !== state.highestAcceptedManifestSha256) {
      throw new LocalUpdateError('UPDATE_EQUIVOCATION_REJECTED', 'Ayni surum icin farkli manifest reddedildi.', 409);
    }
    if (new Date(manifest.issuedAt) < new Date(state.highestManifestIssuedAt)) {
      throw new LocalUpdateError('UPDATE_ISSUED_AT_ROLLBACK', 'Manifest imza zamani geriye gidemez.', 409);
    }
    if (this.clock().getTime() < new Date(state.highestObservedAt).getTime() - MAX_CLOCK_ROLLBACK_MS) {
      throw new LocalUpdateError('UPDATE_CLOCK_ROLLBACK', 'Sistem saati update high-water kaydinin gerisinde.', 409);
    }
  }

  private async downloadAndVerify(
    url: URL,
    destination: string,
    expectedSize: number,
    expectedSha256: string,
  ): Promise<void> {
    const response = await this.fetchWithTimeout(url, {
      method: 'GET',
      redirect: 'error',
      headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' },
    });
    if (!response.ok || response.status !== 200 || !response.body) {
      throw new LocalUpdateError('UPDATE_ARTIFACT_HTTP_ERROR', 'Update artifact indirilemedi.', 502);
    }
    if (response.url) {
      const finalUrl = validateArtifactUrl(response.url, this.allowedOrigins);
      if (finalUrl.href !== url.href) {
        throw new LocalUpdateError('UPDATE_ARTIFACT_REDIRECTED', 'Artifact redirect yaniti reddedildi.', 502);
      }
    }
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) !== expectedSize)) {
      throw new LocalUpdateError('UPDATE_ARTIFACT_SIZE_MISMATCH', 'Artifact beklenen boyutta degil.', 409);
    }

    const partial = `${destination}.${randomUUID()}.partial`;
    let handle;
    const hash = createHash('sha256');
    let size = 0;
    try {
      handle = await open(partial, 'wx', 0o600);
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > expectedSize) {
          await reader.cancel().catch(() => undefined);
          throw new LocalUpdateError('UPDATE_ARTIFACT_SIZE_MISMATCH', 'Artifact boyut sinirini asti.', 409);
        }
        hash.update(value);
        await writeChunk(handle, value);
      }
      const digest = hash.digest('hex');
      if (size !== expectedSize || digest !== expectedSha256) {
        throw new LocalUpdateError('UPDATE_ARTIFACT_INTEGRITY_FAILED', 'Artifact boyut/hash dogrulamasi basarisiz.', 409);
      }
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(partial, destination);
      await chmod(destination, 0o600).catch(() => undefined);
      await syncDirectoryBestEffort(path.dirname(destination));
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await unlink(partial).catch(() => undefined);
      throw error;
    }
  }

  private async fetchWithTimeout(url: URL, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref?.();
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch {
      throw new LocalUpdateError('UPDATE_NETWORK_ERROR', 'Update servisine guvenli baglanti kurulamadi.', 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    const lockPath = safeChild(this.requireDataRoot(), UPDATE_LOCK_FILE);
    let handle;
    try {
      handle = await open(lockPath, 'wx', 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: this.clock().toISOString() })}\n`);
      await handle.sync();
      await handle.close();
      handle = undefined;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'EEXIST') {
        throw new LocalUpdateError('UPDATE_LOCKED', 'Update lock kaydi mevcut; guvenli operator incelemesi gerekli.', 409);
      }
      throw error;
    }
    return async () => {
      await unlink(lockPath).catch(() => undefined);
      await syncDirectoryBestEffort(path.dirname(lockPath));
    };
  }

  private async readState(): Promise<UpdateState | null> {
    try {
      const entry = await lstat(this.statePath());
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 64 * 1024) throw new Error('unsafe-state');
      return updateStateSchema.parse(JSON.parse(await readFile(this.statePath(), 'utf8')));
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'ENOENT') return null;
      throw new LocalUpdateError('UPDATE_STATE_CORRUPT', 'Update high-water kaydi dogrulanamadi.', 409);
    }
  }

  private async readHandoff(): Promise<UpdateHandoff | null> {
    try {
      const entry = await lstat(this.handoffPath());
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 256 * 1024) throw new Error('unsafe-handoff');
      const handoff = updateHandoffSchema.parse(JSON.parse(await readFile(this.handoffPath(), 'utf8')));
      this.assertHandoffPaths(handoff);
      return handoff;
    } catch (error) {
      const fsError = error as NodeJS.ErrnoException;
      if (fsError.code === 'ENOENT') return null;
      throw new LocalUpdateError('UPDATE_HANDOFF_CORRUPT', 'Supervisor update handoff kaydi dogrulanamadi.', 409);
    }
  }

  private presentHandoff(handoff: UpdateHandoff): StagedUpdateResult {
    return {
      code: 'UPDATE_STAGED_NOT_APPLIED',
      state: 'STAGED_AWAITING_SUPERVISOR',
      commandId: handoff.commandId,
      targetVersion: handoff.targetVersion,
      manifestSha256: handoff.manifestSha256,
      stageDirectory: handoff.stageDirectory,
      applySupportedByLocalApi: false,
    };
  }

  private assertCoordinatorConsistency(state: UpdateState | null, handoff: UpdateHandoff | null): void {
    if (!state && !handoff) return;
    if (!state && handoff) {
      throw new LocalUpdateError('UPDATE_STATE_MISSING', 'Handoff var fakat update high-water kaydi yok.', 409);
    }
    if (state && !handoff) {
      if (compareVersions(state.highestAcceptedVersion, this.config.currentVersion) <= 0) return;
      throw new LocalUpdateError(
        'UPDATE_HANDOFF_MISSING_OR_CORRUPT',
        'Stage edilmis yeni surum icin supervisor handoff kaydi yok.',
        409,
      );
    }
    if (
      state
      && handoff
      && (
        state.handoffCommandId !== handoff.commandId
        || state.highestAcceptedVersion !== handoff.targetVersion
        || state.highestAcceptedManifestSha256 !== handoff.manifestSha256
      )
    ) {
      throw new LocalUpdateError('UPDATE_COORDINATOR_STATE_MISMATCH', 'Update state ve handoff eslesmiyor.', 409);
    }
  }

  private assertHandoffPaths(handoff: UpdateHandoff): void {
    const stagesRoot = safeChild(this.requireDataRoot(), 'stages');
    const stageRelative = path.relative(stagesRoot, handoff.stageDirectory);
    if (
      !stageRelative
      || stageRelative.startsWith('..')
      || path.isAbsolute(stageRelative)
      || path.dirname(stageRelative) !== '.'
    ) {
      throw new LocalUpdateError('UPDATE_HANDOFF_PATH_UNSAFE', 'Handoff stage yolu izinli sinirin disinda.', 409);
    }
    if (handoff.manifestEnvelopePath !== path.join(handoff.stageDirectory, 'signed-manifest.json')) {
      throw new LocalUpdateError('UPDATE_HANDOFF_PATH_UNSAFE', 'Handoff manifest yolu gecersiz.', 409);
    }
    const names = new Set<string>();
    for (const artifact of handoff.artifacts) {
      const lower = artifact.fileName.toLowerCase();
      if (
        names.has(lower)
        || artifact.absolutePath !== path.join(handoff.stageDirectory, artifact.fileName)
      ) {
        throw new LocalUpdateError('UPDATE_HANDOFF_PATH_UNSAFE', 'Handoff artifact yolu gecersiz.', 409);
      }
      names.add(lower);
    }
  }

  private async verifyStagedHandoff(handoff: UpdateHandoff): Promise<void> {
    const stageEntry = await lstat(handoff.stageDirectory).catch(() => undefined);
    if (!stageEntry?.isDirectory() || stageEntry.isSymbolicLink()) {
      throw new LocalUpdateError('UPDATE_STAGE_MISSING_OR_UNSAFE', 'Stage dizini bulunamadi veya guvensiz.', 409);
    }
    const manifestEntry = await lstat(handoff.manifestEnvelopePath).catch(() => undefined);
    if (!manifestEntry?.isFile() || manifestEntry.isSymbolicLink() || manifestEntry.size > MAX_MANIFEST_BYTES) {
      throw new LocalUpdateError('UPDATE_STAGE_MISSING_OR_UNSAFE', 'Stage manifesti bulunamadi veya guvensiz.', 409);
    }
    try {
      const envelope = JSON.parse(await readFile(handoff.manifestEnvelopePath, 'utf8')) as unknown;
      const verified = parseAndVerifySignedManifest(envelope, this.publicKey);
      if (
        verified.digest !== handoff.manifestSha256
        || verified.manifest.version !== handoff.targetVersion
        || verified.manifest.channel !== handoff.channel
      ) {
        throw new Error('manifest-handoff-mismatch');
      }
    } catch {
      throw new LocalUpdateError('UPDATE_STAGE_INTEGRITY_FAILED', 'Stage manifest imzasi veya handoff bagi gecersiz.', 409);
    }
    for (const artifact of handoff.artifacts) {
      const entry = await lstat(artifact.absolutePath).catch(() => undefined);
      if (!entry?.isFile() || entry.isSymbolicLink() || entry.size !== artifact.sizeBytes) {
        throw new LocalUpdateError('UPDATE_STAGE_MISSING_OR_UNSAFE', 'Stage artifact bulunamadi veya guvensiz.', 409);
      }
      if (await sha256File(artifact.absolutePath) !== artifact.sha256) {
        throw new LocalUpdateError('UPDATE_STAGE_INTEGRITY_FAILED', 'Stage artifact SHA-256 dogrulamasi basarisiz.', 409);
      }
    }
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new LocalUpdateError('UPDATE_NOT_INITIALIZED', 'Update koordinatörü baslatilmadi.', 503);
    }
  }

  private statePath(): string {
    return safeChild(this.requireDataRoot(), UPDATE_STATE_FILE);
  }

  private handoffPath(): string {
    return safeChild(this.requireDataRoot(), UPDATE_HANDOFF_FILE);
  }

  private requireDataRoot(): string {
    if (!this.dataRoot) {
      throw new LocalUpdateError('UPDATE_NOT_INITIALIZED', 'Update koordinatörü baslatilmadi.', 503);
    }
    return this.dataRoot;
  }
}

export const LOCAL_UPDATE_INTERNAL_CONTRACT = Object.freeze({
  stateFile: UPDATE_STATE_FILE,
  handoffFile: UPDATE_HANDOFF_FILE,
  manifestCanonicalization: 'sorted-json-v1',
  signatureAlgorithm: 'Ed25519',
  applySupportedByLocalApi: false,
  operationalDataIncluded: false,
});
