#!/usr/bin/env node

import { generateKeyPairSync, randomBytes, createPublicKey } from 'node:crypto';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function ed25519Pair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function secret(bytes = 48) {
  return randomBytes(bytes).toString('base64url');
}

export function generateControlPlaneSecrets() {
  const license = ed25519Pair();
  const update = ed25519Pair();
  const derivedLicensePublic = createPublicKey(license.privateKey)
    .export({ type: 'spki', format: 'pem' })
    .toString();

  if (derivedLicensePublic !== license.publicKey) {
    throw new Error('license key self-check failed');
  }
  if (license.publicKey === update.publicKey) {
    throw new Error('license and update trust roots must differ');
  }

  const licensePepper = secret();
  return Object.freeze({
    LICENSE_PRIVATE_KEY: license.privateKey,
    LOCAL_LICENSE_PUBLIC_KEY: license.publicKey,
    LICENSE_KEY_ACTIVE_PEPPER_VERSION: 'v1',
    LICENSE_KEY_PEPPERS: JSON.stringify({ v1: licensePepper }),
    UPDATE_SIGNING_PRIVATE_KEY: update.privateKey,
    UPDATE_SIGNING_PUBLIC_KEY: update.publicKey,
    LOCAL_UPDATE_PUBLIC_KEY: update.publicKey,
  });
}

function envLine(key, value) {
  return `${key}=${JSON.stringify(value)}`;
}

export function renderEnvBundle(bundle) {
  return [
    '# REST_OTM control-plane signing bundle',
    '# PRIVATE: password manager + Render secret store only. Never commit.',
    envLine('LICENSE_PRIVATE_KEY', bundle.LICENSE_PRIVATE_KEY),
    envLine('LICENSE_KEY_ACTIVE_PEPPER_VERSION', bundle.LICENSE_KEY_ACTIVE_PEPPER_VERSION),
    envLine('LICENSE_KEY_PEPPERS', bundle.LICENSE_KEY_PEPPERS),
    envLine('UPDATE_SIGNING_PRIVATE_KEY', bundle.UPDATE_SIGNING_PRIVATE_KEY),
    envLine('UPDATE_SIGNING_PUBLIC_KEY', bundle.UPDATE_SIGNING_PUBLIC_KEY),
    '',
    '# PUBLIC: these two values are embedded in the future Windows package.',
    envLine('LOCAL_LICENSE_PUBLIC_KEY', bundle.LOCAL_LICENSE_PUBLIC_KEY),
    envLine('LOCAL_UPDATE_PUBLIC_KEY', bundle.LOCAL_UPDATE_PUBLIC_KEY),
    '',
  ].join('\n');
}

export async function writeSecretBundle(filePath, bundle = generateControlPlaneSecrets()) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('secret bundle output path is required');
  }

  const absolutePath = resolve(filePath);
  const handle = await open(absolutePath, 'wx', 0o600);
  try {
    await handle.writeFile(renderEnvBundle(bundle), { encoding: 'utf8' });
  } finally {
    await handle.close();
  }
  return absolutePath;
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const outIndex = process.argv.indexOf('--out');
  if (outIndex >= 0) {
    const outPath = process.argv[outIndex + 1];
    const writtenPath = await writeSecretBundle(outPath);
    process.stdout.write(`Secret bundle written with mode 0600: ${writtenPath}\n`);
  } else {
    process.stdout.write(renderEnvBundle(generateControlPlaneSecrets()));
  }
}
