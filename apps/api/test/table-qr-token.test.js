const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  TableQrTokenService,
  normalizeTableQrIdentity,
} = require('../dist/modules/public/table-qr-token.service.js');

test('masa QR tokeni tenant slug ve tableId bagini HMAC ile dogrular', () => {
  const sourceSecret = Buffer.alloc(32, 0x5a);
  const service = new TableQrTokenService(sourceSecret);
  assert.equal(sourceSecret.every((byte) => byte === 0), true);

  const token = service.sign('Lezzet-Restoran', 'table_12345678');
  assert.match(token, /^v1\.[A-Za-z0-9_-]{43}$/);
  assert.equal(service.verify(token, 'lezzet-restoran', 'table_12345678'), true);
  assert.equal(service.verify(token, 'baska-restoran', 'table_12345678'), false);
  assert.equal(service.verify(token, 'lezzet-restoran', 'table_87654321'), false);
  assert.equal(service.verify(`${token.slice(0, -1)}A`, 'lezzet-restoran', 'table_12345678'), false);
  const rotatedService = new TableQrTokenService(Buffer.alloc(32, 0x6b));
  assert.equal(rotatedService.verify(token, 'lezzet-restoran', 'table_12345678'), false);
});

test('masa QR kimligi dar ve canonical tutulur', () => {
  assert.deepEqual(normalizeTableQrIdentity(' Restoran-01 ', 'table_12345678'), {
    slug: 'restoran-01',
    tableId: 'table_12345678',
  });
  for (const [slug, tableId] of [
    ['../tenant', 'table_12345678'],
    ['restoran', 'x'],
    ['restoran', 'table id with spaces'],
  ]) {
    assert.throws(() => normalizeTableQrIdentity(slug, tableId));
  }
});

test('local garson cagrisi token, tenant+table DB dogrulamasi ve dar rate limit uygular', () => {
  const controller = fs.readFileSync(
    path.join(__dirname, '..', 'src/modules/public/local-waiter-call.controller.ts'),
    'utf8',
  );
  const routes = fs.readFileSync(
    path.join(__dirname, '..', 'src/modules/public/local-public.routes.ts'),
    'utf8',
  );
  const baseRuntime = fs.readFileSync(
    path.join(__dirname, '..', 'src/runtime/base.runtime.ts'),
    'utf8',
  );
  const gateway = fs.readFileSync(
    path.join(__dirname, '../..', 'gateway/src/gateway.ts'),
    'utf8',
  );
  assert.match(controller, /tokenService\.verify\(tableToken, slug, tableId\)/);
  assert.match(controller, /where:\s*\{ id: tableId, tenantId: tenant\.id \}/);
  assert.match(routes, /windowMs:\s*60 \* 1000/);
  assert.match(routes, /max:\s*6/);
  assert.match(baseRuntime, /runtimeMode === 'cloud'[\s\S]*ip === '127\.0\.0\.1'/);
  assert.match(gateway, /headers\['x-forwarded-for'\] = remoteAddress/);
});
