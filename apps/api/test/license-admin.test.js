const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assertNotRevoked,
  extendExpiry,
  generateLicenseKey,
  initialExpiry,
  maskLicenseKey,
} = require('../dist/modules/license-admin/license-admin.policy.js');
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
