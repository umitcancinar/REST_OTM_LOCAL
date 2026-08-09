const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const {
  parseAndVerifySignedManifest,
} = require('../dist/modules/local-update/local-update.contract.js');
const {
  CloudUpdatePublisherError,
  selectEligiblePublishedRelease,
  signUpdateManifest,
  verifyStoredEnvelope,
} = require('../dist/modules/cloud-update/cloud-update.publisher.js');

const NOW = new Date('2026-08-09T12:00:00.000Z');

function keys() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privatePem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    publicKey: pair.publicKey,
  };
}

function manifest(overrides = {}) {
  return {
    schemaVersion: 1,
    version: '1.2.0',
    channel: 'stable',
    minCurrentVersion: '1.0.0',
    maxCurrentVersion: '1.1.9',
    issuedAt: '2026-08-09T11:55:00.000Z',
    expiresAt: '2026-08-16T11:55:00.000Z',
    migration: {
      contractVersion: 1,
      minCurrentSchemaVersion: 1,
      maxCurrentSchemaVersion: 1,
      targetSchemaVersion: 1,
      mode: 'none',
      requiresBackup: false,
      rollbackSupported: true,
    },
    artifacts: [{
      role: 'windows-payload',
      fileName: 'restotm-1.2.0.zip',
      platform: 'win32-x64',
      sha256: 'a'.repeat(64),
      sizeBytes: 1024,
      url: 'https://cdn.example/releases/restotm-1.2.0.zip?signature=presigned',
    }],
    ...overrides,
  };
}

test('cloud publisher local updater ile ayni exact canonical Ed25519 envelope uretir', () => {
  const pair = keys();
  const signed = signUpdateManifest(
    manifest(),
    pair.privatePem,
    new Set(['https://cdn.example']),
    NOW,
  );
  const localVerified = parseAndVerifySignedManifest(signed.envelope, pair.publicKey);
  assert.equal(localVerified.manifest.version, '1.2.0');
  assert.equal(localVerified.digest, signed.digest);
  assert.deepEqual(JSON.parse(signed.envelope.payload), manifest());
});

test('publisher HTTPS origin, zaman penceresi ve tum client araligindan yeni target ister', () => {
  const pair = keys();
  const signManifest = (value) => signUpdateManifest(
    value,
    pair.privatePem,
    new Set(['https://cdn.example']),
    NOW,
  );
  assert.throws(
    () => signManifest(manifest({ artifacts: [{ ...manifest().artifacts[0], url: 'https://evil.example/a.zip' }] })),
    /izinli HTTPS origin/,
  );
  assert.throws(
    () => signManifest(manifest({ version: '1.1.9' })),
    (error) => error instanceof CloudUpdatePublisherError && error.code === 'UPDATE_TARGET_NOT_NEWER',
  );
  assert.throws(
    () => signManifest(manifest({ expiresAt: '2026-10-01T00:00:00.000Z' })),
    (error) => error instanceof CloudUpdatePublisherError && error.code === 'UPDATE_LIFETIME_TOO_LONG',
  );
});

test('channel/current-version rollout uygun en yuksek SemVer release secimini yapar', () => {
  const base = {
    id: 'a',
    version: '1.2.0',
    channel: 'stable',
    minCurrentVersion: '1.0.0',
    maxCurrentVersion: '1.1.9',
    issuedAt: new Date('2026-08-09T11:00:00.000Z'),
    expiresAt: new Date('2026-08-10T11:00:00.000Z'),
    manifestPayload: '{}',
    signature: 'x',
    manifestSha256: 'a'.repeat(64),
  };
  const selected = selectEligiblePublishedRelease([
    base,
    { ...base, id: 'b', version: '1.3.0' },
    { ...base, id: 'c', version: '2.0.0', channel: 'beta' },
    { ...base, id: 'd', version: '1.4.0', issuedAt: new Date('2026-08-10T12:00:00.000Z') },
  ], '1.1.0', 'stable', NOW);
  assert.equal(selected.id, 'b');
  assert.equal(selectEligiblePublishedRelease([base], '1.2.0', 'stable', NOW), null);
});

test('stored envelope DB identity/digest ile birebir bagli; corruption fail-closed', () => {
  const pair = keys();
  const signed = signUpdateManifest(manifest(), pair.privatePem, new Set(['https://cdn.example']), NOW);
  const stored = {
    id: 'release-1',
    version: '1.2.0',
    channel: 'stable',
    minCurrentVersion: '1.0.0',
    maxCurrentVersion: '1.1.9',
    issuedAt: new Date('2026-08-09T11:55:00.000Z'),
    expiresAt: new Date('2026-08-16T11:55:00.000Z'),
    manifestPayload: signed.envelope.payload,
    signature: signed.envelope.signature,
    manifestSha256: signed.digest,
  };
  assert.deepEqual(verifyStoredEnvelope(stored, pair.publicPem), signed.envelope);
  assert.throws(
    () => verifyStoredEnvelope({ ...stored, version: '1.2.1' }, pair.publicPem),
    (error) => error instanceof CloudUpdatePublisherError && error.code === 'UPDATE_FEED_CORRUPT',
  );
});

test('DB migration artifact, signed envelope ve audit logunu append-only korur', () => {
  const migration = readFileSync(
    path.join(__dirname, '../prisma/migrations/20260809040000_add_cloud_update_releases/migration.sql'),
    'utf8',
  );
  assert.match(migration, /update releases are append-only/);
  assert.match(migration, /update artifact metadata is immutable/);
  assert.match(migration, /update release audit log is append-only/);
  assert.match(migration, /signed envelope/);
  assert.doesNotMatch(migration, /tenantId|orders|customers|menu_items/);
});

test('routes exact public protocolu ve current SUPER_ADMIN defense-in-depth guardlarini tasir', () => {
  const routes = readFileSync(
    path.join(__dirname, '../src/modules/cloud-update/cloud-update.routes.ts'),
    'utf8',
  );
  const profile = readFileSync(path.join(__dirname, '../src/runtime/cloud.profile.ts'), 'utf8');
  assert.match(profile, /app\.use\('\/api\/updates\/v1', cloudUpdateManifestRouter\)/);
  assert.match(routes, /get\('\/manifest'/);
  assert.match(routes, /authMiddleware/);
  assert.match(routes, /rbac\('SUPER_ADMIN'\)/);
  assert.match(routes, /requireCurrentSuperAdmin/);
  const controller = readFileSync(
    path.join(__dirname, '../src/modules/cloud-update/cloud-update.controller.ts'),
    'utf8',
  );
  assert.match(controller, /res\.status\(204\)\.end\(\)/);
});
