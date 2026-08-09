#!/usr/bin/env node

import { createHash, createPublicKey } from 'node:crypto';
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { auditArtifact } from './audit-artifact.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIRECTORY, '../..');

export const CANONICAL_ROLE_PATHS = Object.freeze({
  'runtime-service': 'bin/restotm-runtime-service.exe',
  'installer-bootstrap': 'bin/restotm-installer-bootstrap.exe',
  'postgres-server': 'postgres/bin/postgres.exe',
  'postgres-client': 'postgres/bin/pg_dump.exe',
  'local-api': 'api/restotm-api.exe',
  'admin-ui': 'admin/restotm-admin.exe',
  'waiter-ui': 'waiter/restotm-waiter.exe',
  'menu-ui': 'menu/restotm-menu.exe',
  'print-agent': 'print-agent/restotm-print-agent.exe',
  'lan-gateway': 'gateway/restotm-lan-gateway.exe',
  'license-public-key': 'config/license-public-key.pem',
  'update-public-key': 'config/update-public-key.pem',
});

const CANONICAL_CHILDREN = Object.freeze([
  ['postgres', 'postgres-server', 'postgres/bin/postgres.exe'],
  ['local-api', 'local-api', 'api/restotm-api.exe'],
  ['admin-ui', 'admin-ui', 'admin/restotm-admin.exe'],
  ['waiter-ui', 'waiter-ui', 'waiter/restotm-waiter.exe'],
  ['menu-ui', 'menu-ui', 'menu/restotm-menu.exe'],
  ['print-agent', 'print-agent', 'print-agent/restotm-print-agent.exe'],
  ['lan-gateway', 'lan-gateway', 'gateway/restotm-lan-gateway.exe'],
]);

const FORBIDDEN_COMPONENT = /^(?:\.git|\.env(?:\..*)?|__tests__|tests?|fixtures?|coverage)$/i;
const FORBIDDEN_EXTENSION = /\.(?:ts|tsx|map)$/i;
const PRIVATE_KEY = /-----BEGIN (?:EC |RSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;
const SOURCE_MAP_MARKER = /(?:\/\/[#@]|\/\*[#@])\s*sourceMappingURL\s*=/;

function usage() {
  return [
    'Kullanim: node scripts/release/assemble-windows-payload.mjs --version 1.2.3 --out <new-dir>',
    '  [--fixture] [--api-closure <dir>] [--admin-app <dir>] [--waiter-app <dir>] [--menu-app <dir>]',
    '  [--gateway-dist <dir>] [--print-agent-dist <dir>] [--receipt-dist <dir>]',
    '  [--receipt-package <file>] [--installer-contract <file>]',
    '  [--license-public-key <file>] [--update-public-key <file>]',
    '  [--runtime-service <file>] [--bootstrap <file>] [--postgres <file>] [--pg-dump <file>]',
    '  [--api-launcher <file>] [--admin-launcher <file>] [--waiter-launcher <file>] [--menu-launcher <file>]',
    '  [--print-launcher <file>] [--gateway-launcher <file>]',
  ].join('\n');
}

function defaultOptions() {
  const windowsInput = path.join(REPOSITORY_ROOT, 'build/windows-input');
  return {
    mode: 'production',
    apiClosure: path.join(REPOSITORY_ROOT, 'build/stage/local'),
    adminApp: path.join(REPOSITORY_ROOT, 'apps/admin'),
    waiterApp: path.join(REPOSITORY_ROOT, 'apps/waiter'),
    menuApp: path.join(REPOSITORY_ROOT, 'apps/menu'),
    gatewayDist: path.join(REPOSITORY_ROOT, 'apps/gateway/dist'),
    printAgentDist: path.join(REPOSITORY_ROOT, 'apps/print-agent/dist'),
    receiptDist: path.join(REPOSITORY_ROOT, 'packages/receipt-core/dist'),
    receiptPackage: path.join(REPOSITORY_ROOT, 'packages/receipt-core/package.json'),
    installerContract: path.join(windowsInput, 'installer-contract.json'),
    publicKey: path.join(windowsInput, 'config/license-public-key.pem'),
    updatePublicKey: path.join(windowsInput, 'config/update-public-key.pem'),
    runtimeService: path.join(windowsInput, 'bin/restotm-runtime-service.exe'),
    bootstrap: path.join(windowsInput, 'bin/restotm-installer-bootstrap.exe'),
    postgres: path.join(windowsInput, 'postgres/bin/postgres.exe'),
    pgDump: path.join(windowsInput, 'postgres/bin/pg_dump.exe'),
    apiLauncher: path.join(windowsInput, 'api/restotm-api.exe'),
    adminLauncher: path.join(windowsInput, 'admin/restotm-admin.exe'),
    waiterLauncher: path.join(windowsInput, 'waiter/restotm-waiter.exe'),
    menuLauncher: path.join(windowsInput, 'menu/restotm-menu.exe'),
    printLauncher: path.join(windowsInput, 'print-agent/restotm-print-agent.exe'),
    gatewayLauncher: path.join(windowsInput, 'gateway/restotm-lan-gateway.exe'),
  };
}

const VALUE_FLAGS = Object.freeze({
  '--version': 'version',
  '--out': 'out',
  '--api-closure': 'apiClosure',
  '--admin-app': 'adminApp',
  '--waiter-app': 'waiterApp',
  '--menu-app': 'menuApp',
  '--gateway-dist': 'gatewayDist',
  '--print-agent-dist': 'printAgentDist',
  '--receipt-dist': 'receiptDist',
  '--receipt-package': 'receiptPackage',
  '--installer-contract': 'installerContract',
  '--public-key': 'publicKey',
  '--license-public-key': 'publicKey',
  '--update-public-key': 'updatePublicKey',
  '--runtime-service': 'runtimeService',
  '--bootstrap': 'bootstrap',
  '--postgres': 'postgres',
  '--pg-dump': 'pgDump',
  '--api-launcher': 'apiLauncher',
  '--admin-launcher': 'adminLauncher',
  '--waiter-launcher': 'waiterLauncher',
  '--menu-launcher': 'menuLauncher',
  '--print-launcher': 'printLauncher',
  '--gateway-launcher': 'gatewayLauncher',
});

export function parseWindowsPayloadArguments(argv) {
  const options = defaultOptions();
  const seen = new Set();
  const seenProperties = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--fixture') {
      if (seen.has(flag)) throw new Error(`Duplicate arguman: ${flag}`);
      seen.add(flag);
      options.mode = 'fixture';
      continue;
    }
    const property = VALUE_FLAGS[flag];
    if (!property) throw new Error(`Bilinmeyen arguman: ${flag}\n${usage()}`);
    if (seen.has(flag)) throw new Error(`Duplicate arguman: ${flag}`);
    if (seenProperties.has(property)) throw new Error(`Ayni girdi birden fazla kez verilemez: ${flag}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} icin deger gerekli.`);
    seen.add(flag);
    seenProperties.add(property);
    options[property] = value;
    index += 1;
  }
  if (!options.version || !/^\d+\.\d+\.\d+$/.test(options.version)) {
    throw new Error('--version major.minor.patch biciminde zorunludur.');
  }
  if (!options.out) throw new Error('--out yeni ve bos olmayan bir hedef olarak zorunludur.');
  for (const property of Object.keys(options)) {
    if (!['mode', 'version'].includes(property)) options[property] = path.resolve(options[property]);
  }
  return options;
}

function normalizeRelative(value) {
  const normalized = value.split(path.sep).join('/').replace(/^\.\//, '');
  if (
    !normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((component) => component === '..' || component === '')
  ) {
    throw new Error(`Traversal/rooted artifact yolu reddedildi: ${value}`);
  }
  return normalized;
}

function assertSafeOutput(outputRoot) {
  const resolved = path.resolve(outputRoot);
  const filesystemRoot = path.parse(resolved).root;
  if (
    resolved === filesystemRoot
    || path.dirname(resolved) === filesystemRoot
    || resolved === REPOSITORY_ROOT
  ) {
    throw new Error(`Guvenli olmayan payload hedefi: ${resolved}`);
  }
  return resolved;
}

async function assertRegularSource(sourcePath, expectedKind) {
  const stats = await lstat(sourcePath).catch(() => null);
  if (!stats) throw new Error(`Zorunlu staging girdisi eksik: ${sourcePath}`);
  if (stats.isSymbolicLink()) throw new Error(`Symlink staging girdisi reddedildi: ${sourcePath}`);
  if (expectedKind === 'file' && !stats.isFile()) throw new Error(`Dosya bekleniyordu: ${sourcePath}`);
  if (expectedKind === 'directory' && !stats.isDirectory()) throw new Error(`Dizin bekleniyordu: ${sourcePath}`);
  return realpath(sourcePath);
}

function assertAllowedRelative(relativePath, { allowPublicKey = false } = {}) {
  const normalized = normalizeRelative(relativePath);
  const components = normalized.split('/');
  if (components.some((component) => FORBIDDEN_COMPONENT.test(component))) {
    throw new Error(`Test/env/cache yolu payload'a giremez: ${normalized}`);
  }
  if (FORBIDDEN_EXTENSION.test(normalized)) {
    throw new Error(`TypeScript/source-map payload'a giremez: ${normalized}`);
  }
  if (/\.(?:pem|key|p12|pfx|jks)$/i.test(normalized) && !allowPublicKey) {
    throw new Error(`Anahtar dosyasi allowlist disinda: ${normalized}`);
  }
  return normalized;
}

async function assertSafeContent(sourcePath, relativePath, { allowPublicKey = false } = {}) {
  const bytes = await readFile(sourcePath);
  const text = bytes.includes(0) ? '' : bytes.toString('utf8');
  if (PRIVATE_KEY.test(text)) throw new Error(`Private key payload'a giremez: ${relativePath}`);
  if (SOURCE_MAP_MARKER.test(text)) throw new Error(`Source-map marker payload'a giremez: ${relativePath}`);
  if (allowPublicKey) {
    let key;
    try {
      key = createPublicKey(text);
    } catch {
      throw new Error('Lisans public key gecerli PEM/SPKI degil.');
    }
    if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
      throw new Error('Lisans artifacti yalniz Ed25519 public key olabilir.');
    }
  }
  return bytes;
}

async function defaultAuthenticodeVerifier(filePath) {
  if (process.platform !== 'win32') {
    throw new Error('Production Authenticode dogrulamasi yalniz Windows build makinesinde yapilir.');
  }
  const command = [
    '& { param([string]$p)',
    "$s = Get-AuthenticodeSignature -LiteralPath $p -ErrorAction Stop;",
    "if ($s.Status -ne 'Valid') { [Console]::Error.WriteLine($s.Status); exit 1 }",
    '}',
  ].join(' ');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    command,
    filePath,
  ], { encoding: 'utf8', windowsHide: true });
  return result.status === 0;
}

async function assertPeAndSignature(sourcePath, mode, authenticodeVerifier) {
  const handle = await readFile(sourcePath);
  if (handle.length < 2 || handle[0] !== 0x4d || handle[1] !== 0x5a) {
    throw new Error(`Windows PE MZ basligi yok: ${sourcePath}`);
  }
  if (mode === 'production' && !await authenticodeVerifier(sourcePath)) {
    throw new Error(`Gecerli Authenticode imzasi yok: ${sourcePath}`);
  }
}

function validateInstallerContract(contract, mode) {
  if (
    contract.schema_version !== 1
    || contract.canonical_runtime_schema !== 'restotm-windows-host-v1'
    || contract.service_name !== 'RESTOTMRuntime'
    || contract.bootstrap_executable_relative_path !== CANONICAL_ROLE_PATHS['installer-bootstrap']
    || contract.license_public_key_relative_path !== CANONICAL_ROLE_PATHS['license-public-key']
    || contract.update_public_key_relative_path !== CANONICAL_ROLE_PATHS['update-public-key']
  ) {
    throw new Error('Installer contract canonical Windows host semasiyla uyusmuyor.');
  }
  if (mode === 'production' && contract.native_bootstrap?.production_ready !== true) {
    throw new Error('Production payload icin native_bootstrap.production_ready=true zorunludur.');
  }
  if (mode === 'fixture' && contract.native_bootstrap?.production_ready !== false) {
    throw new Error('Fixture modu yalniz production_ready=false contract ile calisir.');
  }
  const actualChildren = contract.children?.map((child) => [
    child.name,
    child.role,
    child.relative_executable,
  ]);
  if (JSON.stringify(actualChildren) !== JSON.stringify(CANONICAL_CHILDREN)) {
    throw new Error('Installer child role/path sirasi canonical contract ile uyusmuyor.');
  }
}

async function validateApiClosure(apiClosure, mode) {
  const audit = await auditArtifact({ profile: 'local', root: apiClosure });
  if (!audit.ok) {
    const details = audit.findings.slice(0, 10).map((finding) => `${finding.code}:${finding.path}`).join(', ');
    throw new Error(`Local API closure audit basarisiz: ${details}`);
  }
  const manifest = JSON.parse(await readFile(path.join(apiClosure, 'manifest.json'), 'utf8'));
  if (
    manifest.schemaVersion !== 1
    || manifest.profile !== 'local'
    || manifest.entryPoint !== 'api/local.js'
    || manifest.workspaceDependenciesPruned !== true
  ) {
    throw new Error('Local API closure manifesti audited local profile contractini karsilamiyor.');
  }
  if (mode === 'production' && manifest.npmDependenciesBundled !== true) {
    throw new Error('Local API npm/Prisma runtime closure tamamlanmadan production payload uretilmez.');
  }
  for (const required of [
    'api/node_modules/@rest-otm/license/dist/index.js',
    'api/node_modules/@rest-otm/license/dist/verify.js',
    'api/node_modules/@rest-otm/receipt-core/dist/index.js',
  ]) {
    await access(path.join(apiClosure, required)).catch(() => {
      throw new Error(`Audited API closure runtime dependency eksik: ${required}`);
    });
  }
  await access(path.join(apiClosure, 'api/node_modules/@rest-otm/license/dist/sign.js'))
    .then(() => { throw new Error('Local API closure license signing kodu iceremez.'); })
    .catch((error) => {
      if (error?.message === 'Local API closure license signing kodu iceremez.') throw error;
    });
}

async function validateLocalMenuBuild(menuApp) {
  const requiredFilesPath = path.join(menuApp, '.next/required-server-files.json');
  let metadata;
  try {
    metadata = JSON.parse(await readFile(requiredFilesPath, 'utf8'));
  } catch {
    throw new Error(`Menu Next build metadata eksik veya gecersiz: ${requiredFilesPath}`);
  }
  if (metadata?.config?.basePath !== '/menu') {
    throw new Error('Windows local menu artifact MENU_BASE_PATH=/menu ile build edilmemis.');
  }
}

export async function assembleWindowsPayload(options, dependencies = {}) {
  const mode = options.mode ?? 'production';
  if (!['production', 'fixture'].includes(mode)) throw new Error(`Gecersiz staging modu: ${mode}`);
  if (!/^\d+\.\d+\.\d+$/.test(options.version ?? '')) {
    throw new Error('productVersion major.minor.patch biciminde olmali.');
  }
  const outputRoot = assertSafeOutput(options.out);
  const outputState = await lstat(outputRoot).catch(() => null);
  if (outputState) throw new Error(`Payload hedefi zaten var; uzerine yazilmaz: ${outputRoot}`);

  const input = {};
  for (const [name, kind] of Object.entries({
    apiClosure: 'directory',
    adminApp: 'directory',
    waiterApp: 'directory',
    menuApp: 'directory',
    gatewayDist: 'directory',
    printAgentDist: 'directory',
    receiptDist: 'directory',
    receiptPackage: 'file',
    installerContract: 'file',
    publicKey: 'file',
    updatePublicKey: 'file',
    runtimeService: 'file',
    bootstrap: 'file',
    postgres: 'file',
    pgDump: 'file',
    apiLauncher: 'file',
    adminLauncher: 'file',
    waiterLauncher: 'file',
    menuLauncher: 'file',
    printLauncher: 'file',
    gatewayLauncher: 'file',
  })) {
    input[name] = await assertRegularSource(path.resolve(options[name]), kind);
  }

  const contract = JSON.parse(await readFile(input.installerContract, 'utf8'));
  validateInstallerContract(contract, mode);
  await validateApiClosure(input.apiClosure, mode);
  await validateLocalMenuBuild(input.menuApp);

  const signatureVerifier = dependencies.authenticodeVerifier ?? defaultAuthenticodeVerifier;
  const licensePublicKey = await assertSafeContent(
    input.publicKey,
    CANONICAL_ROLE_PATHS['license-public-key'],
    { allowPublicKey: true },
  );
  const updatePublicKey = await assertSafeContent(
    input.updatePublicKey,
    CANONICAL_ROLE_PATHS['update-public-key'],
    { allowPublicKey: true },
  );
  const licenseSpki = createPublicKey(licensePublicKey).export({ type: 'spki', format: 'der' });
  const updateSpki = createPublicKey(updatePublicKey).export({ type: 'spki', format: 'der' });
  if (Buffer.from(licenseSpki).equals(Buffer.from(updateSpki))) {
    throw new Error('Lisans ve update imzalari ayri Ed25519 public key kullanmali.');
  }

  const outputParent = path.dirname(outputRoot);
  await mkdir(outputParent, { recursive: true });
  const temporaryRoot = await mkdtemp(path.join(outputParent, `.${path.basename(outputRoot)}.tmp-`));
  const destinations = new Map();
  const records = [];

  async function copyOne(sourcePath, destinationPath, role, contentOptions = {}) {
    const normalized = assertAllowedRelative(destinationPath, contentOptions);
    const collisionKey = normalized.toLowerCase();
    if (destinations.has(collisionKey)) {
      throw new Error(`Case-insensitive duplicate payload yolu: ${normalized}`);
    }
    const source = await assertRegularSource(sourcePath, 'file');
    const bytes = await assertSafeContent(source, normalized, contentOptions);
    const destination = path.join(temporaryRoot, ...normalized.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
    const hasPeHeader = bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a;
    if (/\.(?:exe|dll)$/i.test(normalized) && !hasPeHeader) {
      throw new Error(`Windows PE MZ basligi yok: ${normalized}`);
    }
    if (hasPeHeader) {
      await assertPeAndSignature(destination, mode, signatureVerifier);
    }
    destinations.set(collisionKey, normalized);
    records.push({ relativePath: normalized, role, bytes, authenticodeRequired: hasPeHeader });
  }

  async function copyTree(sourceRoot, destinationRoot, role) {
    const canonicalSource = await assertRegularSource(sourceRoot, 'directory');
    async function visit(relativeDirectory = '') {
      const current = path.join(canonicalSource, relativeDirectory);
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))) {
        const relative = path.join(relativeDirectory, entry.name);
        const source = path.join(canonicalSource, relative);
        const state = await lstat(source);
        if (state.isSymbolicLink()) throw new Error(`Symlink payload closure icinde reddedildi: ${source}`);
        if (state.isDirectory()) {
          assertAllowedRelative(relative);
          await visit(relative);
        } else if (state.isFile()) {
          await copyOne(source, path.posix.join(destinationRoot, relative.split(path.sep).join('/')), role);
        } else {
          throw new Error(`Special file payload closure icinde reddedildi: ${source}`);
        }
      }
    }
    await visit();
  }

  try {
    await copyOne(input.runtimeService, CANONICAL_ROLE_PATHS['runtime-service'], 'runtime-service');
    await copyOne(input.bootstrap, CANONICAL_ROLE_PATHS['installer-bootstrap'], 'installer-bootstrap');
    await copyOne(input.postgres, CANONICAL_ROLE_PATHS['postgres-server'], 'postgres-server');
    await copyOne(input.pgDump, CANONICAL_ROLE_PATHS['postgres-client'], 'postgres-client');
    await copyOne(input.apiLauncher, CANONICAL_ROLE_PATHS['local-api'], 'local-api');
    await copyOne(input.adminLauncher, CANONICAL_ROLE_PATHS['admin-ui'], 'admin-ui');
    await copyOne(input.waiterLauncher, CANONICAL_ROLE_PATHS['waiter-ui'], 'waiter-ui');
    await copyOne(input.menuLauncher, CANONICAL_ROLE_PATHS['menu-ui'], 'menu-ui');
    await copyOne(input.printLauncher, CANONICAL_ROLE_PATHS['print-agent'], 'print-agent');
    await copyOne(input.gatewayLauncher, CANONICAL_ROLE_PATHS['lan-gateway'], 'lan-gateway');
    await copyOne(input.publicKey, CANONICAL_ROLE_PATHS['license-public-key'], 'license-public-key', { allowPublicKey: true });
    await copyOne(input.updatePublicKey, CANONICAL_ROLE_PATHS['update-public-key'], 'update-public-key', { allowPublicKey: true });
    await copyOne(input.installerContract, 'installer-contract.json', 'installer-contract');

    await copyTree(path.join(input.apiClosure, 'api'), 'api/runtime', 'local-api-runtime');
    await copyTree(path.join(input.apiClosure, 'metadata'), 'metadata/api-closure', 'release-metadata');
    await copyOne(path.join(input.apiClosure, 'manifest.json'), 'metadata/api-closure-manifest.json', 'release-metadata');

    for (const [appRoot, appName, destination, role] of [
      [input.adminApp, 'admin', 'admin/runtime', 'admin-ui-runtime'],
      [input.waiterApp, 'waiter', 'waiter/runtime', 'waiter-ui-runtime'],
      [input.menuApp, 'menu', 'menu/runtime', 'menu-ui-runtime'],
    ]) {
      await copyTree(path.join(appRoot, '.next/standalone'), destination, role);
      await copyTree(
        path.join(appRoot, '.next/static'),
        `${destination}/apps/${appName}/.next/static`,
        role,
      );
      await copyTree(path.join(appRoot, 'public'), `${destination}/apps/${appName}/public`, role);
      await access(path.join(temporaryRoot, destination, 'apps', appName, 'server.js'));
    }

    await copyTree(input.gatewayDist, 'gateway/dist', 'lan-gateway-runtime');
    await copyTree(input.printAgentDist, 'print-agent/dist', 'print-agent-runtime');
    await copyTree(
      input.receiptDist,
      'print-agent/node_modules/@rest-otm/receipt-core/dist',
      'receipt-runtime',
    );
    await copyOne(
      input.receiptPackage,
      'print-agent/node_modules/@rest-otm/receipt-core/package.json',
      'receipt-runtime',
    );

    for (const required of [
      'api/runtime/local.js',
      'api/runtime/node_modules/@rest-otm/license/dist/index.js',
      'api/runtime/node_modules/@rest-otm/license/dist/verify.js',
      'api/runtime/node_modules/@rest-otm/receipt-core/dist/index.js',
      'gateway/dist/app.js',
      'print-agent/dist/agent.js',
      'print-agent/node_modules/@rest-otm/receipt-core/dist/index.js',
    ]) {
      await access(path.join(temporaryRoot, ...required.split('/'))).catch(() => {
        throw new Error(`Canonical runtime dependency eksik: ${required}`);
      });
    }

    records.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
    const manifestFiles = records.map(({ relativePath, role, bytes, authenticodeRequired }) => ({
      relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      role,
      authenticodeRequired,
    }));
    const manifest = {
      schemaVersion: 1,
      productVersion: options.version,
      fixture: mode === 'fixture',
      files: manifestFiles,
    };
    await writeFile(
      path.join(temporaryRoot, 'artifact-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );
    await rename(temporaryRoot, outputRoot);
    return { root: outputRoot, manifest, mode };
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  try {
    const options = parseWindowsPayloadArguments(process.argv.slice(2));
    const result = await assembleWindowsPayload(options);
    console.log(`[windows-payload] ${result.mode}: ${result.manifest.files.length} dosya -> ${result.root}`);
  } catch (error) {
    console.error(`[windows-payload] HATA: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) await main();
