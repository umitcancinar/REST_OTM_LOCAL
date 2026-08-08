const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRoutesSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'public', 'public.routes.ts'),
  'utf8',
);
const publicCloudControllerSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'public', 'public-cloud.controller.ts'),
  'utf8',
);
const localPublicRoutesSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'modules', 'public', 'local-public.routes.ts'),
  'utf8',
);

test('public router never exposes destructive table maintenance', () => {
  assert.doesNotMatch(publicRoutesSource, /router\.(?:get|post|put|patch|delete)\(['"]\/fix-tables['"]/);
});

test('cloud public projection has no local waiter/socket or write operation', () => {
  assert.match(publicRoutesSource, /public-cloud\.controller/);
  assert.doesNotMatch(publicRoutesSource, /waiter\/call/);
  assert.doesNotMatch(publicCloudControllerSource, /websocket|waiter:called/);
  assert.doesNotMatch(
    publicCloudControllerSource,
    /prisma\.[A-Za-z]+\.(?:create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(/,
  );
});

test('waiter call exists only in the local LAN projection', () => {
  assert.match(localPublicRoutesSource, /waiter\/call\/\:slug/);
});
