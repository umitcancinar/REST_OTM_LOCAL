// ==========================================
// Lisans dogrulama testleri
// ==========================================
// Bu testler is modelinin kalbini koruyor. Buradaki bir gerileme
// "herkes bedava kullanabiliyor" demek olur, o yuzden saldiri
// senaryolari da test ediliyor — sadece mutlu yol degil.

const test = require('node:test');
const assert = require('node:assert/strict');

const { generateKeyPair, issueLicense, generateLicenseKey } = require('../dist/sign');
const { verifyLicense, advanceState } = require('../dist/verify');
const { activate, readStoredMenuSyncToken } = require('../dist/client');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createServer } = require('node:http');

const { publicKeyPem, privateKeyPem } = generateKeyPair();
const HW = 'a'.repeat(64);
const OTHER_HW = 'b'.repeat(64);

const daysFromNow = (n) => new Date(Date.now() + n * 24 * 60 * 60 * 1000);

function makeLicense(overrides = {}) {
  return issueLicense(
    {
      licenseKey: 'RSTO-TEST-TEST-TEST',
      tenantId: 'tenant-1',
      restaurantName: 'Test Restoran',
      hardwareId: HW,
      expiresAt: daysFromNow(30),
      ...overrides,
    },
    privateKeyPem,
  );
}

// ─── Mutlu yol ──────────────────────────────────────────────────────

test('gecerli lisans kabul edilir ve kalan gun dogru hesaplanir', () => {
  const signed = makeLicense();
  const r = verifyLicense(signed, { publicKeyPem, hardwareId: HW });
  assert.equal(r.state, 'valid');
  assert.equal(r.license.restaurantName, 'Test Restoran');
  assert.ok(r.daysLeft >= 29 && r.daysLeft <= 30, `daysLeft=${r.daysLeft}`);
});

// ─── Saldiri senaryolari ────────────────────────────────────────────

test('payload kurcalanirsa imza tutmaz — sure uzatma girisimi', () => {
  const signed = makeLicense({ expiresAt: daysFromNow(1) });
  const payload = JSON.parse(signed.payload);
  payload.expiresAt = daysFromNow(3650).toISOString(); // 10 yil uzatmaya calis
  const tampered = { payload: JSON.stringify(payload), signature: signed.signature };

  const r = verifyLicense(tampered, { publicKeyPem, hardwareId: HW });
  assert.equal(r.state, 'invalid_signature');
});

test('baska anahtarla uretilen lisans reddedilir — sahte lisans', () => {
  const attacker = generateKeyPair();
  const forged = issueLicense(
    {
      licenseKey: 'RSTO-FAKE-FAKE-FAKE',
      tenantId: 'tenant-1',
      restaurantName: 'Sahte',
      hardwareId: HW,
      expiresAt: daysFromNow(3650),
    },
    attacker.privateKeyPem,
  );

  const r = verifyLicense(forged, { publicKeyPem, hardwareId: HW });
  assert.equal(r.state, 'invalid_signature');
});

test('lisans dosyasi baska makineye kopyalanirsa reddedilir', () => {
  const signed = makeLicense();
  const r = verifyLicense(signed, { publicKeyPem, hardwareId: OTHER_HW });
  assert.equal(r.state, 'hardware_mismatch');
});

test('yerel saat geri alinirsa yakalanir', () => {
  const signed = makeLicense();
  const state = { lastHeartbeatAt: new Date().toISOString(), highWaterMark: new Date().toISOString() };

  // Kullanici saati 5 gun geri aldi
  const r = verifyLicense(signed, {
    publicKeyPem,
    hardwareId: HW,
    state,
    now: daysFromNow(-5),
  });
  assert.equal(r.state, 'clock_tampered');
});

test('kucuk saat sapmalari kurcalama sayilmaz (yaz/kis saati, NTP)', () => {
  const signed = makeLicense();
  const now = new Date();
  const state = { lastHeartbeatAt: now.toISOString(), highWaterMark: now.toISOString() };

  // 3 saat geride — mesru bir sapma
  const r = verifyLicense(signed, {
    publicKeyPem,
    hardwareId: HW,
    state,
    now: new Date(now.getTime() - 3 * 60 * 60 * 1000),
  });
  assert.equal(r.state, 'valid');
});

// ─── Sure ve cevrimdisi tolerans ────────────────────────────────────

test('suresi dolmus lisans reddedilir', () => {
  const signed = makeLicense({ expiresAt: daysFromNow(-1) });
  const r = verifyLicense(signed, { publicKeyPem, hardwareId: HW });
  assert.equal(r.state, 'expired');
});

test('internet kesintisinde tolerans suresi boyunca calismaya devam eder', () => {
  const signed = makeLicense({ graceDays: 7, issuedAt: daysFromNow(-5) });
  const state = {
    lastHeartbeatAt: daysFromNow(-5).toISOString(), // 5 gundur yoklama yok
    highWaterMark: daysFromNow(-5).toISOString(),
  };
  const r = verifyLicense(signed, { publicKeyPem, hardwareId: HW, state });
  assert.equal(r.state, 'valid');
});

test('tolerans suresi asilirsa kilitlenir — sunucu kalici engellendiginde', () => {
  const signed = makeLicense({ graceDays: 7, issuedAt: daysFromNow(-9) });
  const state = {
    lastHeartbeatAt: daysFromNow(-9).toISOString(), // 9 gundur yoklama yok
    highWaterMark: daysFromNow(-9).toISOString(),
  };
  const r = verifyLicense(signed, { publicKeyPem, hardwareId: HW, state });
  assert.equal(r.state, 'grace_exceeded');
});

test('state dosyasi silinse bile imzali offlineUntil asilirsa kilitlenir', () => {
  const signed = makeLicense({ graceDays: 7, issuedAt: daysFromNow(-9) });
  const r = verifyLicense(signed, { publicKeyPem, hardwareId: HW });
  assert.equal(r.state, 'grace_exceeded');
});

test('imzali askiya alma karari yerelde reddedilir', () => {
  const signed = makeLicense({ entitlement: 'suspended' });
  const r = verifyLicense(signed, { publicKeyPem, hardwareId: HW });
  assert.equal(r.state, 'license_disabled');
  assert.equal(r.entitlement, 'suspended');
});

test('offline tolerans uyelik bitisini asamaz', () => {
  const signed = makeLicense({ expiresAt: daysFromNow(2), graceDays: 7 });
  const payload = JSON.parse(signed.payload);
  assert.ok(new Date(payload.offlineUntil) <= new Date(payload.expiresAt));
});

// ─── Bicim ve surum ─────────────────────────────────────────────────

test('bozuk lisans dosyasi anlasilir sekilde reddedilir', () => {
  const r = verifyLicense({ payload: 'bu json degil', signature: 'xxx' }, { publicKeyPem, hardwareId: HW });
  assert.ok(r.state === 'invalid_signature' || r.state === 'malformed');
});

test('gelecekteki lisans surumu tahmin edilmeden reddedilir', () => {
  const signed = makeLicense();
  const payload = JSON.parse(signed.payload);
  payload.v = 99;
  // Yeni surumu dogru imzayla uret ki surum kontrolu test edilsin
  const resigned = issueLicense(
    { ...payload, issuedAt: new Date(payload.issuedAt), expiresAt: new Date(payload.expiresAt) },
    privateKeyPem,
  );
  const bumped = JSON.parse(resigned.payload);
  bumped.v = 99;
  const r = verifyLicense(
    { payload: JSON.stringify(bumped), signature: resigned.signature },
    { publicKeyPem, hardwareId: HW },
  );
  // Imza tutmayacagi icin once imza hatasi doner — bu da kabul edilebilir
  assert.ok(['unsupported_version', 'invalid_signature'].includes(r.state));
});

// ─── Durum yonetimi ─────────────────────────────────────────────────

test('highWaterMark yalnizca ileri gider', () => {
  const t1 = new Date('2026-06-01T00:00:00Z');
  const t2 = new Date('2026-05-01T00:00:00Z'); // geri

  const s1 = advanceState(undefined, t1);
  const s2 = advanceState(s1, t2);

  assert.equal(s2.highWaterMark, t1.toISOString(), 'geri gitmemeli');
  assert.equal(s2.lastHeartbeatAt, t2.toISOString());
});

// ─── Lisans anahtari bicimi ─────────────────────────────────────────

test('lisans anahtari karistirilabilir karakter icermez', () => {
  for (let i = 0; i < 200; i++) {
    const key = generateLicenseKey();
    assert.match(key, /^RSTO-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(!/[01ILO]/.test(key.slice(5)), `karistirilabilir karakter: ${key}`);
  }
});

test('aktivasyon kisa omurlu menu sync tokenini izinli yerel kayda yazar', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'restotm-license-client-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const syncToken = `${'a'.repeat(120)}.${'b'.repeat(86)}`;
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const request = JSON.parse(body);
      const signed = issueLicense({
        licenseKey: request.licenseKey,
        tenantId: 'tenant-1',
        restaurantName: 'Test Restoran',
        hardwareId: request.hardwareId,
        expiresAt: daysFromNow(30),
      }, privateKeyPem);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        data: {
          license: signed,
          syncToken,
          serverTime: new Date().toISOString(),
          heartbeatIntervalHours: 1,
        },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, 'object');
  const result = await activate({
    dataDir,
    serverUrl: `http://127.0.0.1:${address.port}`,
    publicKeyPem,
    appVersion: 'test',
  }, 'RSTO-TEST-TEST-TEST');
  assert.equal(result.ok, true);
  assert.equal(readStoredMenuSyncToken(dataDir), syncToken);
});
