const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertNotRevoked,
  extendExpiry,
  generateLicenseKey,
  initialExpiry,
  maskLicenseKey,
  maskLicenseKeyLast4,
} = require('../dist/modules/license-admin/license-admin.policy.js');
const {
  createLicenseKeyMaterial,
  licenseKeyHashCandidates,
  parseLicenseKeyPepperRing,
} = require('../dist/modules/license/license-key.policy.js');
const {
  assertSignableStatus,
  isActivationEligible,
  isHeartbeatEligible,
} = require('../dist/modules/license/license-lifecycle.policy.js');

test('secure license key has the documented non-ambiguous format', () => {
  const keys = new Set(Array.from({ length: 1000 }, generateLicenseKey));
  assert.equal(keys.size, 1000);
  for (const key of keys) {
    assert.match(key, /^RSTO-[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
  }
});

test('masked responses never expose the full license key', () => {
  const key = 'RSTO-ABCD-EFGH-JKLM-NPQR';
  const masked = maskLicenseKey(key);
  assert.equal(masked, 'RSTO-****-****-****-NPQR');
  assert.equal(masked.includes('ABCD'), false);
  assert.equal(maskLicenseKeyLast4('NPQR'), masked);
  assert.equal(maskLicenseKeyLast4(null), 'RSTO-****-****-****-????');
});

test('license keys use deterministic peppered HMAC material without plaintext', () => {
  const ring = parseLicenseKeyPepperRing(
    JSON.stringify({
      v1: 'a'.repeat(32),
      v2: 'b'.repeat(48),
    }),
    'v2',
  );
  const material = createLicenseKeyMaterial(' rsto-abcd-efgh-jklm-npqr ', ring);

  assert.equal(material.normalizedKey, 'RSTO-ABCD-EFGH-JKLM-NPQR');
  assert.equal(material.keyPepperVersion, 'v2');
  assert.equal(material.keyLast4, 'NPQR');
  assert.match(material.keyHash, /^[a-f0-9]{64}$/);
  assert.equal(material.keyHash.includes('ABCD'), false);
  assert.equal(createLicenseKeyMaterial(material.normalizedKey, ring).keyHash, material.keyHash);
});

test('pepper rotation reads every configured version but writes the active one first', () => {
  const ring = parseLicenseKeyPepperRing(
    JSON.stringify({ old: 'o'.repeat(32), current: 'c'.repeat(32) }),
    'current',
  );
  const candidates = licenseKeyHashCandidates('RSTO-ABCD-EFGH-JKLM-NPQR', ring);

  assert.deepEqual(candidates.map((candidate) => candidate.keyPepperVersion), ['current', 'old']);
  assert.notEqual(candidates[0].keyHash, candidates[1].keyHash);
  assert.throws(() => parseLicenseKeyPepperRing('{bad-json', 'v1'));
  assert.throws(() => parseLicenseKeyPepperRing(JSON.stringify({ v1: 'short' }), 'v1'));
  assert.throws(() => parseLicenseKeyPepperRing(JSON.stringify({ v1: 'x'.repeat(32) }), 'v2'));
});

test('migration enforces one non-revoked seat and keeps a plaintext preflight', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const migration = fs.readFileSync(
    path.join(__dirname, '../prisma/migrations/20260809010000_harden_license_keys/migration.sql'),
    'utf8',
  );
  assert.match(migration, /WHERE "status" <> 'REVOKED'/);
  assert.match(migration, /licenses_one_non_revoked_per_tenant_key/);
  assert.match(migration, /ALTER COLUMN "key" DROP NOT NULL/);
  assert.doesNotMatch(migration, /DROP COLUMN "key"/);
});

test('new license defaults to 365 days when no explicit expiry is given', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const result = initialExpiry(undefined, undefined, now);
  assert.equal(result.toISOString(), '2027-08-08T12:00:00.000Z');
});

test('extension starts at current expiry while license is still valid', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const current = new Date('2026-09-01T00:00:00.000Z');
  assert.equal(
    extendExpiry(current, 30, now).toISOString(),
    '2026-10-01T00:00:00.000Z',
  );
});

test('extension starts today when license has expired', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const expired = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(
    extendExpiry(expired, 1, now).toISOString(),
    '2026-08-09T12:00:00.000Z',
  );
});

test('revoked is a terminal lifecycle state', () => {
  assert.throws(
    () => assertNotRevoked('REVOKED'),
    (error) => error.statusCode === 409 && /değiştirilemez/.test(error.message),
  );
  assert.doesNotThrow(() => assertNotRevoked('SUSPENDED'));
});

test('activation policy never reopens suspended or revoked licenses', () => {
  const now = new Date('2026-08-08T12:00:00.000Z');
  const expiresAt = new Date('2026-09-08T12:00:00.000Z');
  const hardwareId = 'a'.repeat(64);
  assert.equal(isActivationEligible({ status: 'PENDING', hardwareId: null, expiresAt }, hardwareId, now), true);
  assert.equal(isActivationEligible({ status: 'ACTIVE', hardwareId, expiresAt }, hardwareId, now), true);
  assert.equal(isActivationEligible({ status: 'SUSPENDED', hardwareId, expiresAt }, hardwareId, now), false);
  assert.equal(isActivationEligible({ status: 'REVOKED', hardwareId, expiresAt }, hardwareId, now), false);
  assert.equal(isActivationEligible({ status: 'ACTIVE', hardwareId: 'b'.repeat(64), expiresAt }, hardwareId, now), false);
});

test('heartbeat policy requires a current device binding but permits terminal status delivery', () => {
  const hardwareId = 'a'.repeat(64);
  assert.equal(isHeartbeatEligible({ status: 'PENDING', hardwareId: null }, hardwareId), false);
  assert.equal(isHeartbeatEligible({ status: 'ACTIVE', hardwareId }, hardwareId), true);
  assert.equal(isHeartbeatEligible({ status: 'SUSPENDED', hardwareId }, hardwareId), true);
  assert.equal(isHeartbeatEligible({ status: 'REVOKED', hardwareId }, hardwareId), true);
  assert.equal(isHeartbeatEligible({ status: 'ACTIVE', hardwareId: 'b'.repeat(64) }, hardwareId), false);
});

test('PENDING can never be signed as an active entitlement', () => {
  assert.throws(
    () => assertSignableStatus('PENDING'),
    (error) => error.statusCode === 409 && /aktivasyonu gerekli/.test(error.message),
  );
  assert.doesNotThrow(() => assertSignableStatus('ACTIVE'));
  assert.doesNotThrow(() => assertSignableStatus('SUSPENDED'));
  assert.doesNotThrow(() => assertSignableStatus('REVOKED'));
});
