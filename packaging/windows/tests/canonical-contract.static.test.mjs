import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const packagingRoot = path.resolve(testRoot, '..');
const repositoryRoot = path.resolve(packagingRoot, '..', '..');

async function packagingSource(relativePath) {
  return readFile(path.join(packagingRoot, relativePath), 'utf8');
}

const expectedSecrets = [
  'databaseUrl',
  'internalApiToken',
  'printAgentSecret',
  'jwtAccessSecret',
  'jwtRefreshSecret',
  'backupEncryptionKey',
  'gatewayControlSecret',
];

const expectedChildren = [
  ['postgres', []],
  ['local-api', ['postgres']],
  ['admin-ui', ['local-api']],
  ['waiter-ui', ['local-api']],
  ['print-agent', ['local-api']],
  ['lan-gateway', ['local-api', 'admin-ui', 'waiter-ui']],
];

test('installer example and Rust host example share one canonical topology', async () => {
  const installer = JSON.parse(await packagingSource('installer-contract.example.json'));
  const host = JSON.parse(
    await readFile(path.join(repositoryRoot, 'runtime/windows-host/config.example.json'), 'utf8'),
  );

  assert.equal(installer.canonical_runtime_schema, 'restotm-windows-host-v1');
  assert.equal(installer.schema_version, host.schema_version);
  assert.deepEqual(installer.network, host.network);
  assert.deepEqual(
    installer.children.map(({ name, depends_on }) => [name, depends_on]),
    expectedChildren,
  );
  assert.deepEqual(
    host.children.map(({ name, depends_on }) => [name, depends_on]),
    expectedChildren,
  );
  assert.deepEqual(installer.secrets.required_values, expectedSecrets);
});

test('PowerShell has an executable cross-contract drift check', async () => {
  const contractTest = await packagingSource('scripts/Test-RestOtmCanonicalContract.ps1');
  assert.match(contractTest, /Assert-RestOtmInstallerContract/);
  assert.match(contractTest, /host\.network \| ConvertTo-Json/);
  assert.match(contractTest, /hostTopology/);
  assert.match(contractTest, /production_ready -ne \$false/);
});

test('PowerShell provisioner emits strict secret store and hash-bound receipt names', async () => {
  const provisioner = await packagingSource('scripts/New-RestOtmRuntimeConfiguration.ps1');
  for (const field of [
    'schema_version',
    'installation_id',
    'install_root',
    'program_data_root',
    'secret_store',
    'bootstrap_receipt',
    'health_file',
    'log_directory',
    'network',
    'restart_policy',
    'children',
  ]) {
    assert.match(provisioner, new RegExp(`\\b${field}\\s*=`));
  }
  for (const secret of expectedSecrets) {
    assert.match(provisioner, new RegExp(`\\b${secret}\\s*=`));
  }
  for (const receiptField of [
    'config_sha256',
    'secret_store_sha256',
    'acl_policy_version',
    'completed_at_unix_ms',
  ]) {
    assert.match(provisioner, new RegExp(`\\b${receiptField}\\s*=`));
  }
  assert.match(provisioner, /restotm-windows-acl-v1/);
  assert.match(provisioner, /Secret rotasyonu[\s\S]*throw/);
});

test('installer and preflight cannot pass while native bootstrap backend is unavailable', async () => {
  const installer = JSON.parse(await packagingSource('installer-contract.example.json'));
  const build = await packagingSource('scripts/Build-RestOtmInstaller.ps1');
  const preflight = await packagingSource('scripts/Test-RestOtmPreflight.ps1');
  const common = await packagingSource('scripts/RestOtm.Windows.Common.psm1');
  const bootstrap = await readFile(
    path.join(repositoryRoot, 'runtime/windows-host/src/bootstrap.rs'),
    'utf8',
  );

  assert.equal(installer.native_bootstrap.production_ready, false);
  for (const source of [build, preflight]) {
    assert.match(source, /RequireProductionReady/);
    assert.match(source, /Assert-RestOtmArtifactContractAlignment/);
    assert.match(source, /verification_command/);
    assert.match(source, /LASTEXITCODE -ne 0/);
  }
  assert.match(common, /production_ready=true degil/);
  assert.match(bootstrap, /UnavailableBootstrapBackend/);
  assert.match(bootstrap, /refusing success/);
});

test('manifest roles cover service, bootstrap and every canonical child artifact', async () => {
  const installer = JSON.parse(await packagingSource('installer-contract.example.json'));
  const manifest = JSON.parse(await packagingSource('artifact-manifest.example.json'));
  const roles = new Map(manifest.files.map((file) => [file.role, file.relativePath]));

  assert.equal(roles.get('runtime-service'), 'bin/restotm-runtime-service.exe');
  assert.equal(roles.get('installer-bootstrap'), installer.bootstrap_executable_relative_path);
  assert.equal(roles.get('license-public-key'), installer.license_public_key_relative_path);
  assert.equal(roles.get('postgres-client'), 'postgres/bin/pg_dump.exe');
  for (const child of installer.children) {
    assert.equal(roles.get(child.role), child.relative_executable);
  }
});
