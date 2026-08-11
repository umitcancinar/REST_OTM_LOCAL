const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');

const repositoryRoot = path.resolve(__dirname, '../../..');

async function source(relativePath) {
  return readFile(path.join(repositoryRoot, ...relativePath.split('/')), 'utf8');
}

test('native shutdown kanali loopback ve kurulum-bazli bearer token disinda gizlenir', async () => {
  const runtime = await source('apps/api/src/runtime/local.runtime.ts');
  const env = await source('apps/api/src/config/env.local.ts');
  const nativeProvisioning = await source('runtime/windows-host/src/native_provisioning.rs');

  assert.match(runtime, /remote === '127\.0\.0\.1'/);
  assert.match(runtime, /remote === '::1'/);
  assert.match(runtime, /timingSafeEqual/);
  assert.match(runtime, /res\.status\(404\)\.end\(\)/);
  assert.match(env, /INTERNAL_RUNTIME_TOKEN:\s*requireSecret/);
  assert.match(nativeProvisioning, /"INTERNAL_RUNTIME_TOKEN"\.into\(\),\s*"internalApiToken"\.into\(\)/);
  assert.match(nativeProvisioning, /protect_secret\(&random_secret\(48\)\?\)/);
});

test('Windows API child shell kullanmadan migration tamamlaninca baslar', async () => {
  const launcher = await source('runtime/windows-host/src/bin/child_launcher.rs');
  assert.match(launcher, /migrate_before_start:\s*true/);
  assert.match(launcher, /node_modules\/prisma\/build\/index\.js/);
  assert.match(launcher, /\.args\(\["migrate", "deploy", "--schema"\]\)/);
  assert.match(launcher, /if !status\.success\(\)/);
  assert.doesNotMatch(launcher, /Command::new\(\s*"(?:cmd|powershell)(?:\.exe)?"/i);
});

test('ilk aktivasyon yalniz lisans anahtariyla loopbackte tek-kullanimlik Personel oturumu acar', async () => {
  const routes = await source('apps/api/src/modules/local-license/local-license.routes.ts');
  const installation = await source('apps/api/src/modules/local-license/local-installation.service.ts');
  const auth = await source('apps/api/src/middlewares/auth.middleware.ts');
  const staff = await source('apps/api/src/modules/staff/staff.service.ts');
  const staffController = await source('apps/api/src/modules/staff/staff.controller.ts');

  assert.match(routes, /activationSchema = z\.object\(\{\s*licenseKey:/);
  assert.doesNotMatch(routes, /ownerName|ownerEmail|ownerPassword/);
  assert.match(routes, /if \(!isLoopback\(req\.ip \?\? ''\)\)/);
  assert.match(installation, /__first_setup__@local\.invalid/);
  assert.match(installation, /issueAccessToken\([\s\S]*'15m'/);
  assert.match(auth, /sessionType === 'local_setup'/);
  assert.match(auth, /path === '\/api\/staff'/);
  assert.match(staff, /email: BOOTSTRAP_EMAIL[\s\S]*isActive: false/);
  assert.match(staff, /Son aktif yönetici pasif veya yetkisiz bırakılamaz/);
  assert.match(staffController, /z\.enum\(\['WAITER', 'CASHIER', 'CHEF', 'ADMIN', 'OWNER'\]\)/);
  assert.match(staffController, /z\.string\(\)\.min\(12\)\.max\(128\)/);
});
