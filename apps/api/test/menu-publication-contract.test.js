const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  isSafeNavigationHref,
  isSafePublicHostname,
  isSafePublicHttpsUrl,
  menuPublicationPayloadSchema,
  publicationChecksum,
} = require('../dist/modules/publication-contract/menu-publication.contract.js');
const {
  assertOutboundPublicationEndpoint,
  menuProjectionRetryDelay,
} = require('../dist/modules/menu-projection/menu-projection.runtime.js');
const {
  CLOUD_MENU_SYNC_AUTH_LIMITATION,
  deriveMenuPublicId,
} = require('../dist/modules/cloud-menu-sync/cloud-menu-sync.auth.js');
const {
  issueMenuSyncToken,
  licensePublicKeyFromPrivate,
  verifyMenuSyncToken,
} = require('../dist/modules/cloud-menu-sync/cloud-menu-sync-token.js');
const { generateKeyPairSync } = require('node:crypto');

function fixture() {
  return {
    schemaVersion: 1,
    tenant: {
      id: 'a'.repeat(32),
      name: 'Restoran',
      slug: 'restoran',
      customDomain: 'menu.example.com',
      logo: 'https://cdn.example.com/logo.png',
      settings: {
        theme: { primaryColor: '#112233' },
        workingHours: { monday: '09:00-23:00' },
        navLinks: [{ label: 'Menü', href: '/menu' }],
      },
      address: null,
      phone: null,
      email: null,
    },
    menu: {
      restaurantName: 'Restoran',
      categories: [{
        id: 'b'.repeat(32),
        name: 'Yemekler',
        description: null,
        image: null,
        sortOrder: 0,
        isActive: true,
        items: [{
          id: 'c'.repeat(32),
          name: 'Çorba',
          description: null,
          image: null,
          basePrice: 100,
          portionOptions: [],
          extras: [],
          calories: null,
          allergens: [],
          extraInfo: null,
          badge: null,
          sortOrder: 0,
          isActive: true,
        }],
      }],
    },
    cms: { settings: {}, gallery: [], stories: [], reviews: [], navLinks: [] },
  };
}

test('public contract is strict and excludes operational menu fields', () => {
  const payload = fixture();
  assert.equal(menuPublicationPayloadSchema.parse(payload).menu.categories[0].items[0].name, 'Çorba');
  payload.menu.categories[0].items[0].department = 'KITCHEN';
  assert.throws(() => menuPublicationPayloadSchema.parse(payload));
  delete payload.menu.categories[0].items[0].department;
  payload.menu.categories[0].items[0].taxRate = 20;
  assert.throws(() => menuPublicationPayloadSchema.parse(payload));
});

test('existing QR menu slug response shape remains UI-compatible', () => {
  const payload = menuPublicationPayloadSchema.parse(fixture());
  assert.deepEqual(Object.keys(payload.menu).sort(), ['categories', 'restaurantName']);
  assert.equal(payload.menu.restaurantName, 'Restoran');
  assert.equal(payload.menu.categories[0].id.length, 32);
  assert.equal(payload.menu.categories[0].items[0].basePrice, 100);
  assert.equal(payload.menu.categories[0].items[0].name, 'Çorba');
  const routes = fs.readFileSync(
    path.resolve(__dirname, '../src/modules/public/public.routes.ts'),
    'utf8',
  );
  assert.match(routes, /router\.get\('\/menu\/:slug', publicController\.getMenuBySlug\)/);
  const controller = fs.readFileSync(
    path.resolve(__dirname, '../src/modules/public/public-cloud.controller.ts'),
    'utf8',
  );
  assert.match(controller, /OR: \[\{ publicId: String\(publicId\) \}, \{ tenantId: String\(publicId\) \}\]/);
});

test('canonical checksum ignores object key insertion order', () => {
  const left = menuPublicationPayloadSchema.parse(fixture());
  const right = { ...left, tenant: { ...left.tenant } };
  assert.equal(publicationChecksum(left), publicationChecksum(right));
});

test('URLs, navigation and hostnames reject SSRF and protocol-relative bypasses', () => {
  assert.equal(isSafePublicHttpsUrl('https://cdn.example.com/a.png'), true);
  assert.equal(isSafePublicHttpsUrl('https://user:pass@cdn.example.com/a.png'), false);
  assert.equal(isSafePublicHttpsUrl('https://127.0.0.1/a.png'), false);
  assert.equal(isSafePublicHttpsUrl('https://192.168.1.2/a.png'), false);
  assert.equal(isSafePublicHttpsUrl('https://cdn.example.com/a.png#x'), false);
  assert.equal(isSafeNavigationHref('/menu'), true);
  assert.equal(isSafeNavigationHref('//evil.example/x'), false);
  assert.equal(isSafeNavigationHref('/\\evil.example/x'), false);
  assert.equal(isSafeNavigationHref('/%5cevil.example/x'), false);
  assert.equal(isSafePublicHostname('menu.example.com'), true);
  assert.equal(isSafePublicHostname('.example.com'), false);
  assert.equal(isSafePublicHostname('example..com'), false);
  assert.equal(isSafePublicHostname('-bad.example.com'), false);
});

test('local worker is outbound HTTPS-only with bounded jitter retry', () => {
  assert.equal(assertOutboundPublicationEndpoint('https://cloud.example.com/api/sync').protocol, 'https:');
  assert.throws(() => assertOutboundPublicationEndpoint('http://cloud.example.com/api/sync'));
  assert.throws(() => assertOutboundPublicationEndpoint('https://u:p@cloud.example.com/api/sync'));
  assert.equal(menuProjectionRetryDelay(1, () => 0), 5_000);
  assert.equal(menuProjectionRetryDelay(20, () => 0), 900_000);
});

test('cloud public identity is secret-derived and remaining TPM limitation is explicit', () => {
  const first = deriveMenuPublicId('tenant-1', 'x'.repeat(32));
  const second = deriveMenuPublicId('tenant-1', 'y'.repeat(32));
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.notEqual(first, second);
  assert.match(CLOUD_MENU_SYNC_AUTH_LIMITATION, /TPM_CNG_CHALLENGE/);
});

test('menu sync uses a short-lived Ed25519 grant bound to license, tenant and hardware', () => {
  const pair = generateKeyPairSync('ed25519');
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKey = licensePublicKeyFromPrivate(privateKey);
  const now = new Date('2026-08-11T12:00:00.000Z');
  const token = issueMenuSyncToken({
    licenseId: 'license-1',
    tenantId: 'tenant-1',
    hardwareId: 'a'.repeat(64),
  }, privateKey, now);
  const payload = verifyMenuSyncToken(token, publicKey, new Date(now.getTime() + 60_000));
  assert.equal(payload.licenseId, 'license-1');
  assert.equal(payload.tenantId, 'tenant-1');
  assert.equal(payload.hardwareId, 'a'.repeat(64));
  const [encoded, signature] = token.split('.');
  const corruptedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  assert.throws(() => verifyMenuSyncToken(`${encoded}.${corruptedSignature}`, publicKey, now), /invalid/);
  assert.throws(() => verifyMenuSyncToken(token, publicKey, new Date(now.getTime() + 71 * 60_000)), /invalid/);
});

test('menu publication transport never sends the long-lived license key or hardware header', () => {
  const runtime = fs.readFileSync(
    path.resolve(__dirname, '../src/modules/menu-projection/menu-projection.runtime.ts'),
    'utf8',
  );
  const route = fs.readFileSync(
    path.resolve(__dirname, '../src/modules/cloud-menu-sync/cloud-menu-sync.routes.ts'),
    'utf8',
  );
  assert.match(runtime, /authorization: `Bearer \$\{credentials\.syncToken\}`/);
  assert.doesNotMatch(runtime, /x-resto-license-key|x-resto-hardware-id/);
  assert.doesNotMatch(route, /x-resto-license-key|x-resto-hardware-id/);
});

test('schema and source enforce atomic outbox, monotonic cloud apply and projection-only reads', () => {
  const migration = fs.readFileSync(
    path.resolve(__dirname, '../prisma/migrations/20260809030000_add_cloud_menu_projection/migration.sql'),
    'utf8',
  );
  const service = fs.readFileSync(
    path.resolve(__dirname, '../src/modules/cloud-menu-sync/cloud-menu-sync.service.ts'),
    'utf8',
  );
  const controller = fs.readFileSync(
    path.resolve(__dirname, '../src/modules/public/public-cloud.controller.ts'),
    'utf8',
  );
  const menuService = fs.readFileSync(
    path.resolve(__dirname, '../src/modules/menu/menu.service.ts'),
    'utf8',
  );
  assert.match(migration, /UNIQUE INDEX "menu_projection_outbox_tenantId_version_key"/);
  assert.match(migration, /ON DELETE RESTRICT/);
  const outboxTable = migration.match(/CREATE TABLE "menu_projection_outbox" \([\s\S]*?\n\);/)?.[0];
  const publicationTable = migration.match(/CREATE TABLE "menu_publications" \([\s\S]*?\n\);/)?.[0];
  assert.ok(outboxTable);
  assert.ok(publicationTable);
  assert.doesNotMatch(outboxTable, /"sourceChecksum"/);
  assert.match(publicationTable, /"sourceChecksum" CHAR\(64\) NOT NULL/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /publication\.version < current\.version/);
  assert.match(service, /sourceChecksum/);
  assert.match(controller, /prisma\.menuPublication/);
  assert.doesNotMatch(controller, /prisma\.(?:tenant|menuCategory|menuItem|reservation|restaurantTable)/);
  assert.match(menuService, /\$transaction\(async \(tx\)/);
  assert.match(menuService, /enqueueMenuProjection\(tx, tenantId\)/);
});
