import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import test from 'node:test';

import {
  generateControlPlaneSecrets,
  renderEnvBundle,
} from './generate-control-plane-secrets.mjs';

test('control-plane bundle uses distinct valid Ed25519 trust roots', () => {
  const bundle = generateControlPlaneSecrets();
  const licensePrivate = createPrivateKey(bundle.LICENSE_PRIVATE_KEY);
  const licensePublic = createPublicKey(bundle.LOCAL_LICENSE_PUBLIC_KEY);
  const updatePrivate = createPrivateKey(bundle.UPDATE_SIGNING_PRIVATE_KEY);
  const updatePublic = createPublicKey(bundle.UPDATE_SIGNING_PUBLIC_KEY);

  assert.equal(licensePrivate.asymmetricKeyType, 'ed25519');
  assert.equal(licensePublic.asymmetricKeyType, 'ed25519');
  assert.equal(updatePrivate.asymmetricKeyType, 'ed25519');
  assert.equal(updatePublic.asymmetricKeyType, 'ed25519');
  assert.notDeepEqual(
    licensePublic.export({ type: 'spki', format: 'der' }),
    updatePublic.export({ type: 'spki', format: 'der' }),
  );
});

test('control-plane bundle has a rotation-ready strong license pepper', () => {
  const bundle = generateControlPlaneSecrets();
  const peppers = JSON.parse(bundle.LICENSE_KEY_PEPPERS);
  assert.equal(bundle.LICENSE_KEY_ACTIVE_PEPPER_VERSION, 'v1');
  assert.equal(typeof peppers.v1, 'string');
  assert.ok(peppers.v1.length >= 43);
});

test('render output labels private and public material without shell syntax', () => {
  const output = renderEnvBundle(generateControlPlaneSecrets());
  assert.match(output, /PRIVATE: password manager \+ Render secret store only/);
  assert.match(output, /LICENSE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----/);
  assert.match(output, /LOCAL_LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----/);
  assert.doesNotMatch(output, /export\s+[A-Z_]+=/);
});

