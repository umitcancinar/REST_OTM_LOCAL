const test = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverLocalPrinters,
  localPrinterScanTargets,
} = require('../dist/modules/printing/printer-discovery.js');

function iface(address, netmask, extra = {}) {
  return {
    address,
    netmask,
    family: 'IPv4',
    mac: '00:00:00:00:00:00',
    internal: false,
    cidr: null,
    ...extra,
  };
}

test('yazici kesfi yalniz dogrudan bagli private IPv4 dilimini tarar', () => {
  const targets = localPrinterScanTargets({
    Ethernet: [iface('192.168.10.20', '255.255.255.0')],
    PublicVpn: [iface('203.0.113.5', '255.255.255.0')],
    Loopback: [iface('127.0.0.1', '255.0.0.0', { internal: true })],
  });
  assert.equal(targets.length, 253);
  assert.equal(targets.includes('192.168.10.20'), false);
  assert.equal(targets[0], '192.168.10.1');
  assert.equal(targets.at(-1), '192.168.10.254');
  assert.equal(targets.some((address) => address.startsWith('203.')), false);
});

test('genis kurumsal ag tumden taranmaz ve arayuzler tek hedef listesinde birlesir', () => {
  const targets = localPrinterScanTargets({
    Ethernet: [iface('10.50.7.9', '255.255.0.0')],
    Duplicate: [iface('10.50.7.10', '255.255.255.0')],
  });
  assert.equal(targets.every((address) => address.startsWith('10.50.7.')), true);
  assert.equal(new Set(targets).size, targets.length);
  assert.equal(targets.includes('10.50.7.9'), false);
  assert.equal(targets.includes('10.50.7.10'), false);
});

test('yalniz raw 9100 portuna cevap veren cihazlar yazici adayi olur', async () => {
  const calls = [];
  const result = await discoverLocalPrinters({
    interfaces: { Ethernet: [iface('192.168.44.5', '255.255.255.252')] },
    timeoutMs: 200,
    concurrency: 2,
    probe: async (ipAddress, port, timeoutMs) => {
      calls.push({ ipAddress, port, timeoutMs });
      return ipAddress === '192.168.44.6' ? 7 : null;
    },
  });
  assert.deepEqual(result.printers, [{ ipAddress: '192.168.44.6', port: 9100, latencyMs: 7 }]);
  assert.equal(result.scannedAddressCount, 1);
  assert.equal(result.networkCount, 1);
  assert.deepEqual(calls, [{ ipAddress: '192.168.44.6', port: 9100, timeoutMs: 200 }]);
});

test('istemciden keyfi timeout veya kontrolsuz paralellik almaz', async () => {
  const interfaces = { Ethernet: [iface('192.168.1.10', '255.255.255.252')] };
  await assert.rejects(
    () => discoverLocalPrinters({ interfaces, timeoutMs: 10, probe: async () => null }),
    /timeout contract/,
  );
  await assert.rejects(
    () => discoverLocalPrinters({ interfaces, concurrency: 1000, probe: async () => null }),
    /concurrency contract/,
  );
});
