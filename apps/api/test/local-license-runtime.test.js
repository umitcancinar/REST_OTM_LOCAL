const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LocalLicenseRuntime,
  OperationalLicenseError,
} = require('../dist/modules/local-license/local-license.runtime.js');
const {
  createLocalLicenseGate,
  isRecoveryRequest,
} = require('../dist/modules/local-license/local-license.middleware.js');

const CONFIG = {
  runtimeMode: 'local',
  dataDir: '/unused-in-unit-test',
  serverUrl: 'https://license.example.test',
  publicKeyPem: 'test-public-key',
  appVersion: '1.0.0-test',
};

function payload(overrides = {}) {
  return {
    v: 2,
    licenseKey: 'RSTO-TEST-0001',
    tenantId: 'tenant-1',
    restaurantName: 'Test Restoran',
    hardwareId: 'hardware-1',
    issuedAt: '2026-08-08T00:00:00.000Z',
    expiresAt: '2027-08-08T00:00:00.000Z',
    entitlement: 'active',
    offlineUntil: '2026-08-15T00:00:00.000Z',
    graceDays: 7,
    features: ['pos'],
    ...overrides,
  };
}

function validStatus(overrides = {}) {
  return { state: 'valid', license: payload(overrides), daysLeft: 365 };
}

function fakeClient(initialStatus) {
  let current = initialStatus;
  let checkCount = 0;
  return {
    adapter: {
      checkLocalLicense() {
        checkCount += 1;
        return current;
      },
      async activate() {
        return { ok: true, message: 'ok', status: current };
      },
      async heartbeat() {
        return current;
      },
      statusMessage(status) {
        return `state:${status.state}`;
      },
    },
    setStatus(status) {
      current = status;
    },
    checks() {
      return checkCount;
    },
  };
}

test('operasyon guardi bellekteki eski duruma guvenmeden her cagrida diski kontrol eder', () => {
  const fake = fakeClient(validStatus());
  const runtime = new LocalLicenseRuntime(CONFIG, fake.adapter);
  const afterConstruction = fake.checks();

  runtime.assertOperationalLicense('request');
  runtime.assertOperationalLicense('job');
  assert.equal(fake.checks(), afterConstruction + 2);

  fake.setStatus({ state: 'expired', license: payload(), expiredSince: new Date() });
  assert.throws(
    () => runtime.assertOperationalLicense('websocket'),
    (error) => error instanceof OperationalLicenseError && error.statusCode === 423,
  );
});

test('durum ozeti hassas lisans anahtari ve donanim parmak izi sizdirmaz', () => {
  const fake = fakeClient(validStatus());
  const runtime = new LocalLicenseRuntime(CONFIG, fake.adapter);
  const view = runtime.getStatusView();
  const serialized = JSON.stringify(view);

  assert.equal(view.operational, true);
  assert.equal(view.restaurantName, 'Test Restoran');
  assert.equal(serialized.includes('RSTO-TEST-0001'), false);
  assert.equal(serialized.includes('hardware-1'), false);
});

test('aktivasyon agda basarili gorunse bile diske dogrulanabilir lisans yazilmadiysa acilmaz', async () => {
  const fake = fakeClient({ state: 'malformed', reason: 'Lisans bulunamadi' });
  const runtime = new LocalLicenseRuntime(CONFIG, fake.adapter);
  const activation = await runtime.activate('rsto-test-0001');

  assert.equal(activation.result.ok, false);
  assert.equal(activation.status.operational, false);
});

test('durum olayi yalnizca anlamli lisans gecisinde yayinlanir', () => {
  const fake = fakeClient(validStatus());
  const runtime = new LocalLicenseRuntime(CONFIG, fake.adapter);
  const events = [];
  runtime.subscribe((event) => events.push(event));

  runtime.checkNow('request');
  assert.equal(events.length, 0);

  fake.setStatus({ state: 'expired', license: payload(), expiredSince: new Date() });
  runtime.checkNow('request');
  assert.equal(events.length, 1);
  assert.equal(events[0].current.state, 'expired');
  assert.equal(events[0].view.operational, false);
});

test('kurtarma allowlisti prefix sinirini ve HTTP metodunu dogru uygular', () => {
  assert.equal(isRecoveryRequest('GET', '/api/local-license/status?fresh=1'), true);
  assert.equal(isRecoveryRequest('POST', '/api/local-license/status'), false);
  assert.equal(isRecoveryRequest('GET', '/api/support/ticket/123'), true);
  assert.equal(isRecoveryRequest('GET', '/api/support-evil'), false);
  assert.equal(isRecoveryRequest('POST', '/api/backup/restore'), false);
  assert.equal(isRecoveryRequest('POST', '/api/backup/export'), true);
});

test('REST gate kilitli istegi 423 ile durdurur, export yolunu acik birakir', () => {
  const fake = fakeClient({ state: 'invalid_signature' });
  const runtime = new LocalLicenseRuntime(CONFIG, fake.adapter);
  const gate = createLocalLicenseGate(runtime);

  let nextCalled = false;
  let responseStatus;
  let responseBody;
  const response = {
    setHeader() {},
    status(code) {
      responseStatus = code;
      return this;
    },
    json(body) {
      responseBody = body;
      return this;
    },
  };

  gate(
    { method: 'POST', path: '/api/orders', originalUrl: '/api/orders' },
    response,
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, false);
  assert.equal(responseStatus, 423);
  assert.equal(responseBody.code, 'LOCAL_LICENSE_LOCKED');

  nextCalled = false;
  gate(
    { method: 'POST', path: '/api/backup/export', originalUrl: '/api/backup/export' },
    response,
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, true);
});
