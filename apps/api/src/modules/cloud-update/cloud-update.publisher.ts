import {
  createPrivateKey,
  createPublicKey,
  sign,
  type KeyObject,
} from 'node:crypto';
import {
  canonicalJson,
  compareVersions,
  manifestDigest,
  parseAndVerifySignedManifest,
  updateManifestSchema,
  validateArtifactUrl,
  type SignedUpdateManifest,
  type UpdateManifest,
} from '../local-update/local-update.contract';

const MAX_MANIFEST_FUTURE_MS = 5 * 60 * 1000;
const MAX_MANIFEST_LIFETIME_MS = 31 * 24 * 60 * 60 * 1000;

export class CloudUpdatePublisherError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 409,
  ) {
    super(message);
    this.name = 'CloudUpdatePublisherError';
  }
}

export interface StoredPublishedEnvelope {
  id: string;
  version: string;
  channel: string;
  minCurrentVersion: string;
  maxCurrentVersion: string;
  issuedAt: Date;
  expiresAt: Date;
  manifestPayload: string | null;
  signature: string | null;
  manifestSha256: string | null;
}

function parseEd25519PrivateKey(privateKeyPem: string): KeyObject {
  try {
    const key = createPrivateKey(privateKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong-key-type');
    return key;
  } catch {
    throw new CloudUpdatePublisherError(
      'UPDATE_SIGNER_UNAVAILABLE',
      'Cloud update imzalayicisi yapilandirilmamis.',
      503,
    );
  }
}

function parseEd25519PublicKey(publicKeyPem: string): KeyObject {
  try {
    const key = createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('wrong-key-type');
    return key;
  } catch {
    throw new CloudUpdatePublisherError(
      'UPDATE_FEED_UNAVAILABLE',
      'Cloud update dogrulama anahtari yapilandirilmamis.',
      503,
    );
  }
}

export function assertPublishableManifest(
  input: UpdateManifest,
  allowedOrigins: ReadonlySet<string>,
  now = new Date(),
): UpdateManifest {
  const manifest = updateManifestSchema.parse(input);
  const issuedAt = new Date(manifest.issuedAt).getTime();
  const expiresAt = new Date(manifest.expiresAt).getTime();
  if (issuedAt > now.getTime() + MAX_MANIFEST_FUTURE_MS) {
    throw new CloudUpdatePublisherError('UPDATE_ISSUED_AT_IN_FUTURE', 'Manifest gelecekte yayinlanamaz.');
  }
  if (expiresAt <= now.getTime()) {
    throw new CloudUpdatePublisherError('UPDATE_ALREADY_EXPIRED', 'Suresi dolmus manifest yayinlanamaz.');
  }
  if (expiresAt - issuedAt > MAX_MANIFEST_LIFETIME_MS) {
    throw new CloudUpdatePublisherError(
      'UPDATE_LIFETIME_TOO_LONG',
      'Manifest gecerlilik suresi 31 gunu asamaz.',
    );
  }
  if (compareVersions(manifest.version, manifest.maxCurrentVersion) <= 0) {
    throw new CloudUpdatePublisherError(
      'UPDATE_TARGET_NOT_NEWER',
      'Hedef surum uygun mevcut surum araliginin tamamindan yeni olmali.',
    );
  }
  for (const artifact of manifest.artifacts) validateArtifactUrl(artifact.url, allowedOrigins);
  return manifest;
}

export function signUpdateManifest(
  input: UpdateManifest,
  privateKeyPem: string,
  allowedOrigins: ReadonlySet<string>,
  now = new Date(),
): { envelope: SignedUpdateManifest; digest: string; manifest: UpdateManifest } {
  const manifest = assertPublishableManifest(input, allowedOrigins, now);
  const payload = canonicalJson(manifest);
  const signature = sign(null, Buffer.from(payload, 'utf8'), parseEd25519PrivateKey(privateKeyPem))
    .toString('base64url');
  return {
    envelope: { payload, signature },
    digest: manifestDigest(payload),
    manifest,
  };
}

export function selectEligiblePublishedRelease(
  releases: readonly StoredPublishedEnvelope[],
  currentVersion: string,
  channel: string,
  now = new Date(),
): StoredPublishedEnvelope | null {
  compareVersions(currentVersion, currentVersion);
  const eligible = releases.filter((release) => (
    release.channel === channel
    && release.issuedAt.getTime() <= now.getTime()
    && release.expiresAt.getTime() > now.getTime()
    && compareVersions(release.version, currentVersion) > 0
    && compareVersions(currentVersion, release.minCurrentVersion) >= 0
    && compareVersions(currentVersion, release.maxCurrentVersion) <= 0
  ));
  return eligible.reduce<StoredPublishedEnvelope | null>((best, candidate) => (
    !best || compareVersions(candidate.version, best.version) > 0 ? candidate : best
  ), null);
}

export function verifyStoredEnvelope(
  release: StoredPublishedEnvelope,
  publicKeyPem: string,
): SignedUpdateManifest {
  if (!release.manifestPayload || !release.signature || !release.manifestSha256) {
    throw new CloudUpdatePublisherError('UPDATE_FEED_CORRUPT', 'Yayinlanmis manifest eksik.', 503);
  }
  try {
    const verified = parseAndVerifySignedManifest(
      { payload: release.manifestPayload, signature: release.signature },
      parseEd25519PublicKey(publicKeyPem),
    );
    if (
      verified.digest !== release.manifestSha256
      || verified.manifest.version !== release.version
      || verified.manifest.channel !== release.channel
      || verified.manifest.minCurrentVersion !== release.minCurrentVersion
      || verified.manifest.maxCurrentVersion !== release.maxCurrentVersion
      || verified.manifest.issuedAt !== release.issuedAt.toISOString()
      || verified.manifest.expiresAt !== release.expiresAt.toISOString()
    ) throw new Error('database-envelope-mismatch');
    return verified.envelope;
  } catch (error) {
    if (error instanceof CloudUpdatePublisherError) throw error;
    throw new CloudUpdatePublisherError(
      'UPDATE_FEED_CORRUPT',
      'Yayinlanmis manifest butunluk kontrolunden gecemedi.',
      503,
    );
  }
}
