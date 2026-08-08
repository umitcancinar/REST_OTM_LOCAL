const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const test = require('node:test');
const { createGatewayServer, classifyGatewayRoute } = require('../dist/gateway.js');
const { loadGatewayConfig } = require('../dist/config.js');

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
  const config = loadGatewayConfig({
    NODE_ENV: 'production',
    GATEWAY_ALLOWED_HOSTS: 'restotm-ab12.local',
  });
  assert.equal(config.targets.api.hostname, '127.0.0.1');
  assert(config.allowedHosts.has('restotm-ab12.local'));
});

test('gateway HTTP isteklerini sabit loopback upstreamlere yollar ve spoofed forwarding headerlarini ezer', async (t) => {
  const seen = [];
  const upstreams = {};
  for (const name of ['api', 'admin', 'waiter']) {
    const server = http.createServer((req, res) => {
      seen.push({ name, url: req.url, forwardedFor: req.headers['x-forwarded-for'], injected: req.headers['x-forwarded-host'] });
      res.end(name);
    });
    upstreams[name] = { server, port: await listen(server) };
  }
  t.after(async () => Promise.all(Object.values(upstreams).map(({ server }) => close(server))));

  const config = loadGatewayConfig({
    GATEWAY_API_TARGET: `http://127.0.0.1:${upstreams.api.port}`,
    GATEWAY_ADMIN_TARGET: `http://127.0.0.1:${upstreams.admin.port}`,
    GATEWAY_WAITER_TARGET: `http://127.0.0.1:${upstreams.waiter.port}`,
  });
  const gateway = createGatewayServer(config);
  const gatewayPort = await listen(gateway);
  t.after(() => close(gateway));

  assert.equal((await request(gatewayPort, '/api/orders?x=1', { headers: { 'x-forwarded-for': 'evil' } })).body, 'api');
  assert.equal((await request(gatewayPort, '/garson/tables')).body, 'waiter');
  assert.equal((await request(gatewayPort, '/overview')).body, 'admin');
  assert.equal(seen[0].forwardedFor, '127.0.0.1');
  assert.equal(seen[0].injected, `127.0.0.1:${gatewayPort}`);
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
