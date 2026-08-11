const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createGatewayServer, classifyGatewayRoute } = require('../dist/gateway.js');
const { loadGatewayConfig, normalizeMdnsHostname, isLocalPrivateIpHost } = require('../dist/config.js');
const {
  buildMdnsAnnouncement,
  buildMdnsProbe,
  discoverMdnsLanAddresses,
  MdnsDiscovery,
} = require('../dist/mdns.js');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function request(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path,
      method: options.method || 'GET',
      headers: { host: `127.0.0.1:${port}`, ...(options.headers || {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.once('error', reject);
    if (options.body) req.end(options.body);
    else req.end();
  });
}

test('route siniri API/socket, garson ve admin upstreamlerini ayirir', () => {
  assert.equal(classifyGatewayRoute('/api/orders'), 'api');
  assert.equal(classifyGatewayRoute('/socket.io/'), 'api');
  assert.equal(classifyGatewayRoute('/garson/_next/a.js'), 'waiter');
  assert.equal(classifyGatewayRoute('/menu/lezzet-restoran'), 'menu');
  assert.equal(classifyGatewayRoute('/settings'), 'admin');
  assert.equal(classifyGatewayRoute('/apix'), 'admin');
});

test('production config yalniz loopback upstream ve acik host allowlist kabul eder', () => {
  assert.throws(() => loadGatewayConfig({ NODE_ENV: 'production' }), /GATEWAY_ALLOWED_HOSTS/);
  assert.throws(() => loadGatewayConfig({
    NODE_ENV: 'production',
    GATEWAY_ALLOWED_HOSTS: 'restotm-ab12.local',
    GATEWAY_API_TARGET: 'http://192.168.1.4:4100',
  }), /loopback/);
  assert.throws(() => loadGatewayConfig({
    NODE_ENV: 'production',
    GATEWAY_ALLOWED_HOSTS: 'restotm-ab12.local',
    GATEWAY_MENU_TARGET: 'https://menu.example.com',
  }), /loopback/);
  const config = loadGatewayConfig({
    NODE_ENV: 'production',
    GATEWAY_ALLOWED_HOSTS: 'restotm-ab12.local',
  });
  assert.equal(config.targets.api.hostname, '127.0.0.1');
  assert(config.allowedHosts.has('restotm-ab12.local'));
  assert.equal(config.mdns.enabled, true);
  assert.equal(config.mdns.hostname, 'restotm-ab12.local');
  assert.equal(config.mdns.serviceType, '_rest-otm._tcp.local');
  assert.equal(config.mdns.port, 8787);
  assert.throws(() => loadGatewayConfig({
    NODE_ENV: 'production',
    GATEWAY_ALLOWED_HOSTS: '192.168.1.20',
  }), /mDNS/);
  assert.throws(() => loadGatewayConfig({
    NODE_ENV: 'production',
    GATEWAY_ALLOWED_HOSTS: 'restotm-ab12.local',
    GATEWAY_MDNS_HOSTNAME: 'restotm-other.local',
  }), /GATEWAY_ALLOWED_HOSTS/);
  assert.throws(() => normalizeMdnsHostname('tenant-name.example.com'), /\.local/);
});

test('IP fallback sadece gateway makinesinin kendi private adresini kabul eder', () => {
  const interfaces = {
    ethernet: [
      { address: '192.168.50.10', family: 'IPv4', internal: false },
      { address: 'fd12:3456::10', family: 'IPv6', internal: false },
    ],
  };
  assert.equal(isLocalPrivateIpHost('192.168.50.10', interfaces), true);
  assert.equal(isLocalPrivateIpHost('fd12:3456::10', interfaces), true);
  assert.equal(isLocalPrivateIpHost('192.168.50.11', interfaces), false);
  assert.equal(isLocalPrivateIpHost('10.20.30.40', interfaces), false);
  assert.equal(isLocalPrivateIpHost('8.8.8.8', interfaces), false);
});

test('gateway HTTP isteklerini sabit loopback upstreamlere yollar ve spoofed forwarding headerlarini ezer', async (t) => {
  const seen = [];
  const upstreams = {};
  for (const name of ['api', 'admin', 'waiter', 'menu']) {
    const server = http.createServer((req, res) => {
      seen.push({ name, url: req.url, forwardedFor: req.headers['x-forwarded-for'], injected: req.headers['x-forwarded-host'], origin: req.headers.origin });
      res.end(name);
    });
    upstreams[name] = { server, port: await listen(server) };
  }
  t.after(async () => Promise.all(Object.values(upstreams).map(({ server }) => close(server))));

  const config = loadGatewayConfig({
    GATEWAY_API_TARGET: `http://127.0.0.1:${upstreams.api.port}`,
    GATEWAY_ADMIN_TARGET: `http://127.0.0.1:${upstreams.admin.port}`,
    GATEWAY_WAITER_TARGET: `http://127.0.0.1:${upstreams.waiter.port}`,
    GATEWAY_MENU_TARGET: `http://127.0.0.1:${upstreams.menu.port}`,
  });
  const gateway = createGatewayServer(config);
  const gatewayPort = await listen(gateway);
  t.after(() => close(gateway));

  assert.equal((await request(gatewayPort, '/api/orders?x=1', {
    headers: { 'x-forwarded-for': 'evil', origin: `http://127.0.0.1:${gatewayPort}` },
  })).body, 'api');
  assert.equal((await request(gatewayPort, '/garson/tables')).body, 'waiter');
  assert.equal((await request(gatewayPort, '/menu/lezzet-restoran?tableId=t1')).body, 'menu');
  assert.equal((await request(gatewayPort, '/overview')).body, 'admin');
  assert.equal(seen[0].forwardedFor, '127.0.0.1');
  assert.equal(seen[0].injected, `127.0.0.1:${gatewayPort}`);
  assert.equal(seen[0].origin, undefined);
});

test('gateway bilinmeyen Host, cross-origin mutation ve buyuk istegi reddeder', async (t) => {
  const config = loadGatewayConfig({ GATEWAY_MAX_CONTENT_LENGTH_BYTES: '1024' });
  const gateway = createGatewayServer(config);
  const port = await listen(gateway);
  t.after(() => close(gateway));

  assert.equal((await request(port, '/', { headers: { host: 'attacker.example' } })).status, 400);
  assert.equal((await request(port, '/api/orders', {
    method: 'POST',
    headers: { origin: 'https://attacker.example' },
  })).status, 403);
  assert.equal((await request(port, '/api/orders', {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:65534' },
  })).status, 403);
  assert.equal((await request(port, '/api/orders', {
    method: 'POST',
    headers: { 'content-length': '2048' },
  })).status, 413);
});

test('yalniz Socket.IO yolu WebSocket upgrade alir ve upstream 101 cevabi tasinir', async (t) => {
  const upstream = http.createServer();
  upstream.on('upgrade', (_request, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.end();
  });
  const upstreamPort = await listen(upstream);
  t.after(() => close(upstream));

  const config = loadGatewayConfig({ GATEWAY_API_TARGET: `http://127.0.0.1:${upstreamPort}` });
  const gateway = createGatewayServer(config);
  const gatewayPort = await listen(gateway);
  t.after(() => close(gateway));

  const response = await new Promise((resolve, reject) => {
    const socket = net.connect(gatewayPort, '127.0.0.1');
    let data = '';
    socket.once('error', reject);
    socket.on('data', (chunk) => { data += chunk.toString('latin1'); });
    socket.on('end', () => resolve(data));
    socket.write(
      `GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\n`
      + `Host: 127.0.0.1:${gatewayPort}\r\n`
      + 'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
    );
  });
  assert.match(response, /^HTTP\/1\.1 101/);

  const rejected = await new Promise((resolve, reject) => {
    const socket = net.connect(gatewayPort, '127.0.0.1');
    let data = '';
    socket.once('error', reject);
    socket.on('data', (chunk) => { data += chunk.toString('latin1'); });
    socket.on('end', () => resolve(data));
    socket.write(`GET /garson HTTP/1.1\r\nHost: 127.0.0.1:${gatewayPort}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
  });
  assert.match(rejected, /^HTTP\/1\.1 403/);
});

function lanEntry(address, family, overrides = {}) {
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

class FakeMdnsSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
    this.memberships = [];
    this.closed = false;
  }
  bind(_port, _address, callback) { callback(); }
  addMembership(group, address) { this.memberships.push({ group, address }); }
  setMulticastTTL(ttl) { this.ttl = ttl; }
  setMulticastLoopback(value) { this.loopback = value; }
  send(message, port, address, callback) {
    this.sent.push({ message: Buffer.from(message), port, address });
    callback?.(null);
  }
  close() { this.closed = true; }
}

function mdnsConfig() {
  return loadGatewayConfig({
    NODE_ENV: 'production',
    GATEWAY_ALLOWED_HOSTS: 'restotm-ab12.local',
  }).mdns;
}

function mdnsProvider(entries) {
  return { getNetworkInterfaces: () => entries };
}

test('mDNS adres kesfi yalniz guvenli LAN IPlerini kullanir ve interface/MAC ilan etmez', () => {
  const addresses = discoverMdnsLanAddresses(mdnsProvider({
    wifi: [
      lanEntry('192.168.1.20', 'IPv4'),
      lanEntry('8.8.8.8', 'IPv4'),
      lanEntry('fd12:3456::7', 'IPv6'),
      lanEntry('2001:4860:4860::8888', 'IPv6'),
    ],
  }));
  assert.deepEqual(addresses.map(({ address, family }) => ({ address, family })), [
    { address: '192.168.1.20', family: 'IPv4' },
    { address: 'fd12:3456::7', family: 'IPv6' },
  ]);
  const packet = buildMdnsAnnouncement(mdnsConfig(), addresses);
  const printable = packet.toString('latin1');
  assert.match(printable, /_rest-otm/);
  assert.match(printable, /\/garson/);
  assert.match(printable, /\/menu/);
  assert.doesNotMatch(printable, /aa:bb|wifi|tenant|license|hardware|device/i);
  assert.equal(buildMdnsProbe('restotm-ab12.local').readUInt16BE(4), 1);
});

test('mDNS uc probe sonrasi ilan eder; shutdown TTL=0 goodbye yollar ve socket temizler', async () => {
  const socket = new FakeMdnsSocket();
  const logs = [];
  let clock = 5_000;
  const discovery = new MdnsDiscovery(mdnsConfig(), {
    networkProvider: mdnsProvider({ wifi: [lanEntry('192.168.1.20', 'IPv4')] }),
    createSocket: () => socket,
    probeIntervalMs: 1,
    now: () => clock,
    log: (entry) => logs.push(entry),
  });
  discovery.start();
  await new Promise((resolve) => setTimeout(resolve, 12));
  assert.equal(discovery.status().state, 'announced');
  assert.equal(socket.ttl, 255);
  assert.equal(socket.loopback, false);
  assert.deepEqual(socket.memberships, [{ group: '224.0.0.251', address: '192.168.1.20' }]);
  assert(socket.sent.length >= 4);
  assert(logs.some((entry) => entry.event === 'gateway.mdns_announced'));

  const query = buildMdnsProbe('_rest-otm._tcp.local');
  const beforeQueries = socket.sent.length;
  socket.emit('message', query, { address: '192.168.1.30', family: 'IPv4', port: 5353, size: query.length });
  socket.emit('message', query, { address: '192.168.1.30', family: 'IPv4', port: 5353, size: query.length });
  assert.equal(socket.sent.length, beforeQueries + 1);
  clock += 1_000;
  socket.emit('message', query, { address: '192.168.1.30', family: 'IPv4', port: 5353, size: query.length });
  assert.equal(socket.sent.length, beforeQueries + 2);

  const sentBeforeStop = socket.sent.length;
  discovery.stop();
  assert.equal(discovery.status().state, 'stopped');
  assert.equal(socket.closed, true);
  assert.equal(socket.sent.length, sentBeforeStop + 1);
  assert.deepEqual(
    socket.sent.at(-1).message,
    buildMdnsAnnouncement(mdnsConfig(), [{ address: '192.168.1.20', family: 'IPv4', interfaceName: 'wifi' }], 0),
  );
});

test('hostname collision ve UDP failure discoveryyi kapatir; HTTP/IP fallback sureci ayakta kalir', () => {
  const collisionSocket = new FakeMdnsSocket();
  const collisionLogs = [];
  const discovery = new MdnsDiscovery(mdnsConfig(), {
    networkProvider: mdnsProvider({ wifi: [lanEntry('192.168.1.20', 'IPv4')] }),
    createSocket: () => collisionSocket,
    probeIntervalMs: 60_000,
    log: (entry) => collisionLogs.push(entry),
  });
  discovery.start();
  const foreignPacket = buildMdnsAnnouncement(mdnsConfig(), [
    { address: '192.168.1.99', family: 'IPv4', interfaceName: 'other' },
  ]);
  collisionSocket.emit('message', foreignPacket, { address: '192.168.1.99', family: 'IPv4', port: 5353, size: foreignPacket.length });
  assert.equal(discovery.status().state, 'collision');
  assert.equal(discovery.status().reason, 'HOSTNAME_COLLISION');
  assert.equal(collisionSocket.closed, true);
  assert(collisionLogs.some((entry) => entry.fallback === 'DIRECT_LAN_IP'));

  const failedSocket = new FakeMdnsSocket();
  const failed = new MdnsDiscovery(mdnsConfig(), {
    networkProvider: mdnsProvider({ wifi: [lanEntry('192.168.1.20', 'IPv4')] }),
    createSocket: () => failedSocket,
    probeIntervalMs: 60_000,
    log: () => undefined,
  });
  failed.start();
  failedSocket.emit('error', new Error('EADDRINUSE sensitive details'));
  assert.equal(failed.status().state, 'failed');
  assert.equal(failed.status().reason, 'SOCKET_ERROR');
  // mDNS runtime gateway serverini kapatacak bir callback/process exit tasimaz.
  assert.equal(failedSocket.closed, true);
});

test('LAN adresi yoksa mDNS fail-safe kapanir; license kilidindan bagimsiz discovery contracti kalir', () => {
  const logs = [];
  const discovery = new MdnsDiscovery(mdnsConfig(), {
    networkProvider: mdnsProvider({ lo: [lanEntry('127.0.0.1', 'IPv4', { internal: true })] }),
    createSocket: () => { throw new Error('socket acilmamali'); },
    log: (entry) => logs.push(entry),
  });
  discovery.start();
  assert.equal(discovery.status().reason, 'NO_LAN_ADDRESS');
  assert(logs.some((entry) => entry.fallback === 'DIRECT_LAN_IP'));
  // Discovery lisans durumunu veya operational API verisini TXT'ye koymaz;
  // kilitliyken gateway ve activation/recovery adresi bulunabilir kalir.
  const packet = buildMdnsAnnouncement(mdnsConfig(), [
    { address: '192.168.1.20', family: 'IPv4', interfaceName: 'wifi' },
  ]).toString('latin1');
  assert.doesNotMatch(packet, /locked|license|tenant|key/i);
});
