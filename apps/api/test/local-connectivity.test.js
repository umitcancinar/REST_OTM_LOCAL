const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LOCAL_GATEWAY_PORT,
  LocalConnectivityError,
  LocalConnectivityRuntime,
  validateLocalLanHostname,
} = require('../dist/modules/local-connectivity/local-connectivity.runtime.js');
const {
  createLocalConnectivityRouter,
  LOCAL_CONNECTIVITY_RECOVERY_RULES,
} = require('../dist/modules/local-connectivity/local-connectivity.routes.js');

function address(address, family, overrides = {}) {
  return {
    address,
    family,
    internal: false,
    mac: 'aa:bb:cc:dd:ee:ff',
    netmask: family === 'IPv4' ? '255.255.255.0' : 'ffff:ffff:ffff:ffff::',
    cidr: null,
    scopeid: 0,
    ...overrides,
  };
}

function provider(interfaces) {
  return { getNetworkInterfaces: () => interfaces };
}

test('yalniz guvenli LAN adresleri deterministik listelenir ve interface/MAC sizmaz', async () => {
  const runtime = new LocalConnectivityRuntime('RestOtm-Kasa.local', provider({
    z_wifi: [
      address('192.168.1.20', 'IPv4'),
      address('8.8.8.8', 'IPv4'),
      address('fe80::1234', 'IPv6'),
    ],
    a_ethernet: [
      address('10.0.0.5', 'IPv4'),
      address('172.31.4.9', 'IPv4'),
      address('169.254.10.2', 'IPv4'),
      address('fd12:3456::7', 'IPv6'),
      address('2001:4860:4860::8888', 'IPv6'),
      address('127.0.0.1', 'IPv4', { internal: true }),
      address('192.168.1.20', 'IPv4'),
    ],
  }), { async toSvg() { return '<svg />'; } });

  const status = await runtime.getStatus();
  assert.equal(status.online, true);
  assert.equal(status.hostname, 'restotm-kasa.local');
  assert.equal(status.gatewayPort, LOCAL_GATEWAY_PORT);
  assert.deepEqual(status.addresses.map((entry) => entry.address), [
    '10.0.0.5',
    '169.254.10.2',
    '172.31.4.9',
    '192.168.1.20',
    'fd12:3456::7',
    'fe80::1234',
  ]);
  assert.equal(status.urls.admin, 'http://restotm-kasa.local:8787/');
  assert.equal(status.urls.waiter, 'http://restotm-kasa.local:8787/garson');
  assert.equal(status.urls.health, 'http://restotm-kasa.local:8787/api/health');
  assert.equal(status.addresses[3].urls.waiter, 'http://192.168.1.20:8787/garson');
  assert.equal(status.addresses[4].urls.waiter, 'http://[fd12:3456::7]:8787/garson');
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes('aa:bb:cc:dd:ee:ff'), false);
  assert.equal(serialized.includes('z_wifi'), false);
  assert.equal(serialized.includes('a_ethernet'), false);
  assert.equal(serialized.includes('netmask'), false);
});

test('ag yoksa public fallback yapmadan guvenli offline status doner', async () => {
  const runtime = new LocalConnectivityRuntime('restotm-kasa', provider({
    lo: [address('127.0.0.1', 'IPv4', { internal: true })],
    public: [address('203.0.113.5', 'IPv4')],
  }), { async toSvg() { return '<svg />'; } });
  const status = await runtime.getStatus();
  assert.equal(status.online, false);
  assert.deepEqual(status.addresses, []);
  assert.equal(status.warning.code, 'LAN_ADDRESS_UNAVAILABLE');
});

test('QR yalniz uretilen hostname veya kesfedilmis IP URLsiyle sabit guvenli ayarlari kullanir', async () => {
  const calls = [];
  const runtime = new LocalConnectivityRuntime(
    'restotm-kasa',
    provider({ lan: [address('192.168.50.10', 'IPv4')] }),
    {
      async toSvg(value, options) {
        calls.push({ value, options });
        return `<svg data-value="${value}" />`;
      },
    },
  );

  const waiterQr = await runtime.createQrSvg();
  assert.equal(waiterQr.url, 'http://restotm-kasa:8787/garson');
  const healthQr = await runtime.createQrSvg('health', '192.168.50.10');
  assert.equal(healthQr.url, 'http://192.168.50.10:8787/api/health');
  const tableQr = await runtime.createQrSvg('table-menu', '192.168.50.10', {
    slug: 'lezzet-restoran',
    tableId: 'table_12345678',
    tableToken: 'v1.example',
  });
  assert.equal(
    tableQr.url,
    'http://192.168.50.10:8787/menu/lezzet-restoran?tableId=table_12345678&tableToken=v1.example',
  );
  assert.deepEqual(calls[0].options, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 4,
    width: 320,
    color: { dark: '#111827', light: '#FFFFFF' },
  });
  await assert.rejects(
    () => runtime.createQrSvg('waiter', 'evil.example.com'),
    (error) => error instanceof LocalConnectivityError && error.code === 'LAN_QR_HOST_NOT_AVAILABLE',
  );
  await assert.rejects(
    () => runtime.createQrSvg('unknown'),
    (error) => error instanceof LocalConnectivityError && error.code === 'INVALID_LAN_QR_TARGET',
  );
  await assert.rejects(
    () => runtime.createQrSvg('table-menu'),
    (error) => error instanceof LocalConnectivityError && error.code === 'TABLE_MENU_QR_IDENTITY_REQUIRED',
  );
});

test('installer hostname sozlesmesi localhost, IP ve gecersiz label reddeder', () => {
  assert.equal(validateLocalLanHostname('KASA-01.local.'), 'kasa-01.local');
  for (const invalid of ['localhost', '192.168.1.2', '-kasa.local', 'kasa_.local', '']) {
    assert.throws(
      () => validateLocalLanHostname(invalid),
      (error) => error instanceof LocalConnectivityError && error.code === 'INVALID_LAN_HOSTNAME',
    );
  }
});

test('connectivity recovery yuzeyi kesin GET/HEAD yollaridir ve router guardsiz kurulamaz', () => {
  assert.deepEqual(
    LOCAL_CONNECTIVITY_RECOVERY_RULES.map((rule) => `${rule.methods.join(',')}:${rule.path}`),
    [
      'GET,HEAD:/api/local-connectivity/status',
      'GET,HEAD:/api/local-connectivity/qr.svg',
    ],
  );
  const runtime = new LocalConnectivityRuntime(
    'restotm-kasa',
    provider({}),
    { async toSvg() { return '<svg />'; } },
  );
  assert.throws(
    () => createLocalConnectivityRouter(runtime, []),
    (error) => error instanceof LocalConnectivityError && error.code === 'LAN_CONNECTIVITY_AUTH_REQUIRED',
  );
});
