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
  assert.match(config, /self\.menu\.port != 3300/);
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
  assert.match(supervisor, /external_stop/);
  assert.match(supervisor, /monitor_stop/);
  assert.match(supervisor, /ACTIVE_PROBE_FAILURE_THRESHOLD/);
  assert.match(supervisor, /tcp_endpoint_ready/);
  assert.match(supervisor, /pg_ctl/);
  assert.match(supervisor, /\.arg\("fast"\)/);
});

test('Windows SCM startup remains alive during strict child readiness recovery', async () => {
  const service = await read('src/windows_service.rs');
  assert.match(service, /ServiceState::StartPending/);
  assert.match(service, /startup_reporting/);
  assert.match(service, /checkpoint = checkpoint\.saturating_add\(1\)/);
  assert.match(service, /thread::park_timeout\(Duration::from_secs\(5\)\)/);
  assert.match(service, /Duration::from_secs\(30\)/);
});

test('health file replacement and production log limits are durable', async () => {
  const health = await read('src/health.rs');
  const platform = await read('src/platform.rs');
  const logging = await read('src/logging.rs');
  assert.match(health, /atomic_replace/);
  assert.match(platform, /MOVEFILE_REPLACE_EXISTING \| MOVEFILE_WRITE_THROUGH/);
  assert.match(logging, /MAX_LOG_FILES/);
  assert.match(logging, /MAX_TOTAL_LOG_BYTES/);
  assert.doesNotMatch(logging, /try_from_env/);
});

test('native updater independently reverifies Ed25519 envelope, canonical manifest and artifacts', async () => {
  const update = await read('src/update.rs');
  const lib = await read('src/lib.rs');
  assert.match(lib, /pub mod update/);
  assert.match(update, /VerifyingKey::from_bytes/);
  assert.match(update, /verifying_key\.verify/);
  assert.match(update, /canonical_json\(&value\)/);
  assert.match(update, /sha256_file\(&staged\.absolute_path\)/);
  assert.match(update, /license and update trust roots reuse the same Ed25519 key/);
  assert.match(update, /update_der == license_der/);
  assert.match(update, /manifest time window is expired, future-dated or too long/);
});

test('update apply uses immutable release, write-through pointer, health gate and rollback journal', async () => {
  const runtime = await read('src/runtime.rs');
  const update = await read('src/update.rs');
  assert.match(update, /install_root\.join\("releases"\)/);
  assert.match(update, /TransactionPhase::Prepared/);
  assert.match(update, /TransactionPhase::Activated/);
  assert.match(update, /TransactionPhase::HealthChecking/);
  assert.match(update, /TransactionPhase::Committed/);
  assert.match(update, /MOVEFILE_REPLACE_EXISTING \| MOVEFILE_WRITE_THROUGH/);
  assert.match(update, /wait_for_candidate_health/);
  assert.match(update, /HEALTH_STABILITY/);
  assert.match(update, /restore_postgres_snapshot/);
  assert.match(runtime, /candidate_supervisor\.request_stop\(\);[\s\S]*candidate_supervisor\.wait\(\)\?;[\s\S]*update\.rollback/);
  assert.match(runtime, /wait_for_candidate_health[\s\S]*update\.commit\(\)/);
});

test('update payload cannot carry data or trust roots and schema changes fail closed without runner', async () => {
  const update = await read('src/update.rs');
  assert.match(update, /\["api", "admin", "waiter", "menu", "gateway", "print-agent", "postgres"\]/);
  assert.match(update, /ZIP symlink entry rejected/);
  assert.match(update, /Windows case-insensitive rules/);
  assert.match(update, /schema-changing update rejected: no hash-bound fixed-command migration runner/);
  assert.match(update, /PostgreSQL is not proven offline; raw update safety snapshot refused/);
  assert.match(update, /source\.join\("postmaster\.pid"\)\.exists\(\)/);
  assert.match(update, /remove_directory_if_exists\(&self\.journal\.safety_backup_directory\)/);
});

test('bootstrap binds installed APP_VERSION to MSI product version', async () => {
  const bootstrap = await read('src/bootstrap.rs');
  const native = await read('src/native_provisioning.rs');
  const wix = await readFile(path.join(root, '../../packaging/windows/wix/Product.wxs'), 'utf8');
  assert.match(bootstrap, /product_version: String/);
  assert.match(bootstrap, /--product-version/);
  assert.match(native, /\("APP_VERSION"\.into\(\), request\.product_version\.clone\(\)\)/);
  assert.match(wix, /--product-version &quot;\$\(var\.ProductVersion\)&quot;/);
});

test('bootstrap helper uses native backend only in Windows builds and stays fail-closed elsewhere', async () => {
  const bootstrap = await read('src/bootstrap.rs');
  const binary = await read('src/bin/installer_bootstrap.rs');
  assert.match(bootstrap, /UnavailableBootstrapBackend/);
  assert.match(bootstrap, /refusing success/);
  assert.match(binary, /cfg\(windows\)[\s\S]*NativeWindowsBootstrapBackend/);
  assert.match(binary, /cfg\(not\(windows\)\)[\s\S]*UnavailableBootstrapBackend/);
  assert.match(binary, /ExitCode::from\(78\)/);
});

test('native provisioning is DPAPI LocalMachine, restrictive-DACL and reparse fail-closed', async () => {
  const native = await read('src/native_provisioning.rs');
  const platform = await read('src/platform.rs');
  const wix = await readFile(path.join(root, '../../packaging/windows/wix/Product.wxs'), 'utf8');

  assert.match(platform, /CryptProtectData/);
  assert.match(platform, /CRYPTPROTECT_LOCAL_MACHINE/);
  assert.match(native, /ProgramW6432/);
  assert.match(native, /ProgramData/);
  assert.match(native, /FILE_ATTRIBUTE_REPARSE_POINT/);
  assert.match(native, /SetFileSecurityW/);
  assert.match(native, /LookupAccountNameW/);
  assert.match(native, /NT SERVICE\\\\\{SERVICE_NAME\}/);
  assert.match(native, /configure_service_contract/);
  assert.match(native, /restart\/15000\/restart\/30000\/restart\/60000/);
  assert.match(native, /"preshutdown", SERVICE_NAME, "120000"/);
  assert.match(native, /MOVEFILE_WRITE_THROUGH/);
  assert.match(native, /sync_all/);
  assert.match(native, /struct Rollback/);
  assert.match(native, /load_verified_bootstrap/);
  assert.match(wix, /ServiceSid="restricted"/);
  assert.match(wix, /After="InstallServices"/);
  assert.match(wix, /--menu-port 3300/);
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
