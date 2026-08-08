import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const packagingRoot = path.resolve(testRoot, '..');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(absolute) : [absolute];
    }),
  );
  return nested.flat();
}

async function source(relativePath) {
  return readFile(path.join(packagingRoot, relativePath), 'utf8');
}

test('PowerShell entry points use strict, terminating error behavior', async () => {
  const files = (await walk(path.join(packagingRoot, 'scripts'))).filter((file) =>
    ['.ps1', '.psm1'].includes(path.extname(file)),
  );
  assert.ok(files.length >= 6);

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    assert.match(content, /Set-StrictMode -Version Latest/);
    assert.match(content, /\$ErrorActionPreference = 'Stop'/);
  }
});

test('PowerShell scaffold avoids remote-code and policy-bypass primitives', async () => {
  const files = (await walk(path.join(packagingRoot, 'scripts'))).filter((file) =>
    ['.ps1', '.psm1'].includes(path.extname(file)),
  );
  const combined = (await Promise.all(files.map((file) => readFile(file, 'utf8')))).join('\n');

  for (const forbidden of [
    /Invoke-Expression/i,
    /\biex\b/i,
    /ExecutionPolicy\s+Bypass/i,
    /DownloadString/i,
    /FromBase64String\([^)]*(?:exe|dll)/i,
    /Invoke-WebRequest[^\n]*-OutFile/i,
  ]) {
    assert.doesNotMatch(combined, forbidden);
  }
});

test('runtime topology exposes only one scoped LAN gateway', async () => {
  const config = await source('scripts/New-RestOtmRuntimeConfiguration.ps1');
  assert.match(config, /postgres = \[ordered\]@\{ host = '127\.0\.0\.1'; port = 55432 \}/);
  assert.match(config, /api = \[ordered\]@\{ host = '127\.0\.0\.1'; port = 4100 \}/);
  assert.match(config, /admin = \[ordered\]@\{ host = '127\.0\.0\.1'; port = 3100 \}/);
  assert.match(config, /waiter = \[ordered\]@\{ host = '127\.0\.0\.1'; port = 3200 \}/);
  assert.match(config, /printAgent = \[ordered\]@\{ host = '127\.0\.0\.1'; port = 4300 \}/);
  assert.match(
    config,
    /gateway = \[ordered\]@\{ host = '0\.0\.0\.0'; port = 8787; allowedScope = 'LocalSubnet'; firewallProfile = 'Private' \}/,
  );
  assert.doesNotMatch(config, /firewallProfile = 'Public'/);
});

test('secrets are generated per machine and DPAPI protected', async () => {
  const common = await source('scripts/RestOtm.Windows.Common.psm1');
  const config = await source('scripts/New-RestOtmRuntimeConfiguration.ps1');
  assert.match(common, /RandomNumberGenerator/);
  assert.match(common, /DataProtectionScope\]::LocalMachine/);
  assert.match(config, /dpapi-local-machine-v1/);
  assert.match(config, /if \(\$RotateSecrets -or -not/);
  assert.doesNotMatch(config, /password\s*=\s*['"][^'"]+['"]/i);
});

test('WiX service is delayed-auto, recoverable and data survives uninstall', async () => {
  const product = await source('wix/Product.wxs');
  assert.match(product, /Start="auto"/);
  assert.match(product, /DelayedAutoStart="yes"/);
  assert.equal((product.match(/FailureActionType="restart"/g) ?? []).length, 3);
  assert.match(product, /Permanent="yes"/);
  assert.match(product, /NeverOverwrite="yes"/);
  assert.doesNotMatch(product, /RemoveFolder/);
  assert.doesNotMatch(product, /RemoveFile/);
});

test('WiX firewall permits only TCP 8787 on Private LocalSubnet', async () => {
  const product = await source('wix/Product.wxs');
  assert.equal((product.match(/<firewall:FirewallException/g) ?? []).length, 1);
  assert.match(product, /Profile="private"/);
  assert.match(product, /Scope="localSubnet"/);
  assert.match(product, /Protocol="tcp"/);
  assert.match(product, /Port="8787"/);
  assert.doesNotMatch(product, /Port="55432"/);
  assert.doesNotMatch(product, /Profile="public"/i);
});

test('installer build is fail-fast on artifacts and signing material', async () => {
  const build = await source('scripts/Build-RestOtmInstaller.ps1');
  const common = await source('scripts/RestOtm.Windows.Common.psm1');
  assert.match(build, /Assert-RestOtmArtifactManifest/);
  assert.match(build, /installer-contract\.json/);
  assert.match(build, /signtool\.exe/);
  assert.match(build, /Code Signing EKU/);
  assert.match(build, /Get-AuthenticodeSignature/);
  assert.match(common, /Zorunlu artifact rolu eksik/);
  assert.match(common, /installer-bootstrap/);
});

test('example contracts are explicit non-release placeholders', async () => {
  const manifest = JSON.parse(await source('artifact-manifest.example.json'));
  const contract = JSON.parse(await source('installer-contract.example.json'));
  assert.equal(manifest.schemaVersion, 1);
  assert.match(manifest.files[0].sha256, /^REPLACE_/);
  assert.equal(contract.firstRunProvisioning, true);
  assert.equal(contract.uninstallPreservesCustomerData, true);
  assert.equal(contract.network.gatewayRemoteScope, 'LocalSubnet');
});
