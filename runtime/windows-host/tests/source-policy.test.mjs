import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function read(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const values = await Promise.all(
    entries.map((entry) => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(absolute) : [absolute];
    }),
  );
  return values.flat();
}

test('Windows-only APIs stay behind target cfg/dependencies', async () => {
  const cargo = await read('Cargo.toml');
  const lib = await read('src/lib.rs');
  const platform = await read('src/platform.rs');
  assert.match(cargo, /\[target\.'cfg\(windows\)'\.dependencies\]/);
  assert.match(lib, /#\[cfg\(windows\)\]\s+pub mod windows_service/);
  assert.match(platform, /#\[cfg\(windows\)\]\s+fn spawn_windows/);
  assert.match(platform, /#\[cfg\(not\(windows\)\)\]/);
});

test('network contract is loopback-only except one fixed gateway', async () => {
  const config = await read('src/config.rs');
  assert.match(config, /address\.is_loopback\(\)/);
  assert.match(config, /self\.postgres\.port != 55432/);
  assert.match(config, /self\.api\.port != 4100/);
  assert.match(config, /self\.gateway\.host != "0\.0\.0\.0"/);
  assert.match(config, /self\.gateway\.port != 8787/);
  assert.match(config, /self\.gateway\.firewall_profile != "Private"/);
  assert.match(config, /self\.gateway\.remote_scope != "LocalSubnet"/);
});

test('supervisor has crash-loop, graceful stop and job-tree contracts', async () => {
  const supervisor = await read('src/supervisor.rs');
  const backoff = await read('src/backoff.rs');
  const platform = await read('src/platform.rs');
  assert.match(backoff, /crash_loop_quarantine_ms/);
  assert.match(supervisor, /HostError::CrashLoop/);
  assert.match(supervisor, /send_shutdown_http/);
  assert.match(supervisor, /terminate_tree/);
  assert.match(platform, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
});

test('bootstrap helper refuses false success until native backend exists', async () => {
  const bootstrap = await read('src/bootstrap.rs');
  const binary = await read('src/bin/installer_bootstrap.rs');
  assert.match(bootstrap, /UnavailableBootstrapBackend/);
  assert.match(bootstrap, /refusing success/);
  assert.match(binary, /ExitCode::from\(78\)/);
});

test('repository source contains no embedded private key or obvious secret assignment', async () => {
  const rustFiles = (await walk(path.join(root, 'src'))).filter((file) => file.endsWith('.rs'));
  const content = (await Promise.all(rustFiles.map((file) => readFile(file, 'utf8')))).join('\n');
  assert.doesNotMatch(content, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  assert.doesNotMatch(content, /LICENSE_PRIVATE_KEY\s*[=:]\s*['"][^'"]+/);
  assert.doesNotMatch(content, /DATABASE_URL\s*[=:]\s*['"]postgres(?:ql)?:\/\//);
});

test('sample configuration is valid JSON and carries no secret values', async () => {
  const sample = JSON.parse(await read('config.example.json'));
  assert.equal(sample.schema_version, 1);
  assert.equal(sample.network.gateway.port, 8787);
  assert.equal(sample.network.gateway.firewall_profile, 'Private');
  assert.equal(sample.children[1].secret_environment.DATABASE_URL, 'databaseUrl');
  assert.equal(JSON.stringify(sample).includes('BEGIN PRIVATE KEY'), false);
});
