import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const blueprint = await readFile(resolve(repositoryRoot, 'render.control.yaml'), 'utf8');

test('control blueprint owns only the two new isolated service names', () => {
  const serviceNames = [...blueprint.matchAll(/^\s{4}name:\s*(\S+)\s*$/gm)]
    .map((match) => match[1]);

  assert.deepEqual(serviceNames, [
    'rest-otm-control-api',
    'rest-otm-superadmin',
  ]);
  assert.doesNotMatch(blueprint, /^\s*name:\s*rest-otm-api\s*$/m);
  assert.doesNotMatch(blueprint, /umitcancinar\/RETS_OTM/);
});

test('control API secret inputs remain provider-managed and fail-closed', () => {
  for (const key of [
    'DATABASE_URL',
    'LICENSE_PRIVATE_KEY',
    'LICENSE_KEY_PEPPERS',
    'UPDATE_SIGNING_PRIVATE_KEY',
    'UPDATE_SIGNING_PUBLIC_KEY',
    'SUPER_ADMIN_EMAIL',
    'SUPER_ADMIN_PASSWORD',
  ]) {
    assert.match(
      blueprint,
      new RegExp(`- key: ${key}\\n\\s+sync: false`),
      `${key} must be entered through Render's secret prompt`,
    );
  }
});

test('BFF trust is generated once and copied server-to-server', () => {
  assert.match(
    blueprint,
    /- key: SUPERADMIN_BFF_SERVICE_SECRET\n\s+generateValue: true/,
  );
  assert.match(
    blueprint,
    /- key: SUPERADMIN_BFF_SERVICE_SECRET\n\s+fromService:\n\s+type: web\n\s+name: rest-otm-control-api\n\s+envVarKey: SUPERADMIN_BFF_SERVICE_SECRET/,
  );
  assert.doesNotMatch(blueprint, /NEXT_PUBLIC_SUPERADMIN_BFF_SERVICE_SECRET/);
});

test('initial browser and API origins are pinned to the new Render services', () => {
  assert.match(
    blueprint,
    /value: https:\/\/rest-otm-control-api\.onrender\.com\/api/,
  );
  assert.match(
    blueprint,
    /value: https:\/\/rest-otm-superadmin\.onrender\.com/,
  );
  assert.doesNotMatch(blueprint, /https:\/\/rets-otm\.onrender\.com/);
});

