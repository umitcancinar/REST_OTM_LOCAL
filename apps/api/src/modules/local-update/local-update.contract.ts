import { createHash, type KeyObject, verify as verifySignature } from 'node:crypto';
import { z } from 'zod';

export const LOCAL_UPDATE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const LOCAL_UPDATE_SUPERVISOR_CONTRACT_VERSION = 1 as const;

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]{86}$/;
const CHANNEL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED_ARTIFACT_NAMES = new Set([
  'signed-manifest.json',
  'pending-handoff.json',
  'update-high-water.json',
  '.update.lock',
]);
const WINDOWS_DEVICE_NAME_PATTERN = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

function canonicalIsoDate(value: string): boolean {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

const versionSchema = z.string().regex(SEMVER_PATTERN).refine((value) => {
  try {
    compareVersions(value, value);
    return true;
  } catch {
    return false;
  }
}, 'surum guvenli SemVer 2.0 araliginda olmali');

export const updateArtifactSchema = z.object({
  role: z.enum([
    'windows-payload',
    'api',
    'admin',
    'waiter',
    'menu',
    'gateway',
    'print-agent',
    'windows-host',
    'postgresql',
  ]),
  fileName: z.string().regex(ARTIFACT_NAME_PATTERN).refine((value) => (
    !value.endsWith('.')
    && !RESERVED_ARTIFACT_NAMES.has(value.toLowerCase())
    && !WINDOWS_DEVICE_NAME_PATTERN.test(value)
  ), 'artifact fileName Windows/reserved isim olamaz'),
  platform: z.literal('win32-x64'),
  sha256: z.string().regex(SHA256_PATTERN),
  sizeBytes: z.number().int().positive().max(4 * 1024 * 1024 * 1024),
  url: z.string().url().max(2048),
}).strict();

export const updateMigrationSchema = z.object({
  contractVersion: z.literal(1),
  minCurrentSchemaVersion: z.number().int().nonnegative().max(1_000_000),
  maxCurrentSchemaVersion: z.number().int().nonnegative().max(1_000_000),
  targetSchemaVersion: z.number().int().nonnegative().max(1_000_000),
  mode: z.enum(['none', 'backward-compatible', 'offline-required']),
  requiresBackup: z.boolean(),
  rollbackSupported: z.boolean(),
}).strict().superRefine((migration, context) => {
  if (migration.minCurrentSchemaVersion > migration.maxCurrentSchemaVersion) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxCurrentSchemaVersion'],
      message: 'migration schema araligi ters olamaz',
    });
  }
  if (migration.mode === 'none' && (
    migration.targetSchemaVersion < migration.minCurrentSchemaVersion
    || migration.targetSchemaVersion > migration.maxCurrentSchemaVersion
  )) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetSchemaVersion'],
      message: 'migration mode=none hedef semayi degistiremez',
    });
  }
  if (migration.mode !== 'none' && !migration.requiresBackup) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['requiresBackup'],
      message: 'sema degisikligi oncesi yedek zorunludur',
    });
  }
});

export const updateManifestSchema = z.object({
  schemaVersion: z.literal(LOCAL_UPDATE_MANIFEST_SCHEMA_VERSION),
  version: versionSchema,
  channel: z.string().regex(CHANNEL_PATTERN),
  minCurrentVersion: versionSchema,
  maxCurrentVersion: versionSchema,
  issuedAt: z.string().refine(canonicalIsoDate, 'issuedAt canonical ISO-8601 olmali'),
  expiresAt: z.string().refine(canonicalIsoDate, 'expiresAt canonical ISO-8601 olmali'),
  migration: updateMigrationSchema,
  artifacts: z.array(updateArtifactSchema).min(1).max(64),
}).strict().superRefine((manifest, context) => {
  if (compareVersions(manifest.minCurrentVersion, manifest.maxCurrentVersion) > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['maxCurrentVersion'],
      message: 'uygulama surum araligi ters olamaz',
    });
  }
  const fileNames = new Set<string>();
  for (const [index, artifact] of manifest.artifacts.entries()) {
    const fileName = artifact.fileName.toLowerCase();
    if (fileNames.has(fileName)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['artifacts', index, 'fileName'],
        message: 'artifact fileName Windows case-insensitive olarak global benzersiz olmali',
      });
    }
    fileNames.add(fileName);
  }
});

export const signedUpdateManifestSchema = z.object({
  payload: z.string().min(2).max(256 * 1024),
  signature: z.string().regex(BASE64URL_PATTERN),
}).strict();

export type UpdateArtifact = z.infer<typeof updateArtifactSchema>;
export type UpdateMigration = z.infer<typeof updateMigrationSchema>;
export type UpdateManifest = z.infer<typeof updateManifestSchema>;
export type SignedUpdateManifest = z.infer<typeof signedUpdateManifestSchema>;

interface ParsedVersion {
  core: [number, number, number];
  prerelease: string[];
}

function parseVersion(value: string): ParsedVersion {
  const match = SEMVER_PATTERN.exec(value);
  if (!match) throw new Error(`Gecersiz surum: ${value}`);
  const prerelease = match[4]?.split('.') ?? [];
  if (prerelease.some((item) => /^\d+$/.test(item) && item.length > 1 && item.startsWith('0'))) {
    throw new Error(`Gecersiz sayisal prerelease: ${value}`);
  }
  const core = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  if (core.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`Surum sayisal araligi cok buyuk: ${value}`);
  }
  return {
    core,
    prerelease,
  };
}

/** Build metadata bilerek kabul edilmez; ayni binary icin tek siralama vardir. */
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < a.core.length; index += 1) {
    const delta = a.core[index] - b.core[index];
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  if (a.prerelease.length === 0 || b.prerelease.length === 0) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length === 0 ? 1 : -1;
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const aPart = a.prerelease[index];
    const bPart = b.prerelease[index];
    if (aPart === undefined || bPart === undefined) return aPart === undefined ? -1 : 1;
    if (aPart === bPart) continue;
    const aNumeric = /^\d+$/.test(aPart);
    const bNumeric = /^\d+$/.test(bPart);
    if (aNumeric && bNumeric) {
      if (aPart.length !== bPart.length) return aPart.length < bPart.length ? -1 : 1;
      return aPart < bPart ? -1 : 1;
    }
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
    return aPart < bPart ? -1 : 1;
  }
  return 0;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Canonical JSON sonlu sayi gerektirir.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Canonical JSON yalniz sade JSON degerlerini kabul eder.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.some((key) => record[key] === undefined)) {
    throw new Error('Canonical JSON undefined deger kabul etmez.');
  }
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export function manifestDigest(payload: string): string {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

export function parseAndVerifySignedManifest(
  input: unknown,
  publicKey: KeyObject,
): { envelope: SignedUpdateManifest; manifest: UpdateManifest; digest: string } {
  const envelope = signedUpdateManifestSchema.parse(input);
  const signature = Buffer.from(envelope.signature, 'base64url');
  if (signature.length !== 64 || signature.toString('base64url') !== envelope.signature) {
    throw new Error('Manifest imzasi canonical base64url degil.');
  }
  const valid = verifySignature(
    null,
    Buffer.from(envelope.payload, 'utf8'),
    publicKey,
    signature,
  );
  if (!valid) throw new Error('Manifest Ed25519 imzasi gecersiz.');

  const parsed: unknown = JSON.parse(envelope.payload);
  const manifest = updateManifestSchema.parse(parsed);
  if (canonicalJson(manifest) !== envelope.payload) {
    throw new Error('Imzali manifest canonical JSON biciminde degil.');
  }
  return { envelope, manifest, digest: manifestDigest(envelope.payload) };
}

export function validateUpdateEndpoint(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Update endpoint gecerli bir URL olmali.');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname === '/'
  ) {
    throw new Error('Update endpoint credentials/query/hash icermeyen HTTPS URL olmali.');
  }
  return url;
}

export function validateArtifactUrl(value: string, allowedOrigins: ReadonlySet<string>): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Artifact URL gecersiz.');
  }
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || url.hash
    || !allowedOrigins.has(url.origin)
  ) {
    throw new Error('Artifact URL izinli HTTPS origin disinda veya credentials/hash iceriyor.');
  }
  return url;
}
