import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  assembleWindowsPayload,
  CANONICAL_ROLE_PATHS,
  parseWindowsPayloadArguments,
} from './assemble-windows-payload.mjs';

async function put(root, relativePath, content = '') {
  const target = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'restotm-windows-payload-'));
  const source = path.join(root, 'source');
  const apiClosure = path.join(source, 'api-closure');
  const adminApp = path.join(source, 'admin');
  const waiterApp = path.join(source, 'waiter');
  const gatewayDist = path.join(source, 'gateway-dist');
  const printAgentDist = path.join(source, 'print-dist');
  const receiptDist = path.join(source, 'receipt-dist');
  const peRoot = path.join(source, 'pe');
  const fakePe = Buffer.from('MZfixture-not-signed');

  await put(apiClosure, 'api/local.js', 'require("./node_modules/@rest-otm/license");\n');
  await put(apiClosure, 'api/node_modules/@rest-otm/license/dist/index.js', 'module.exports = require("./verify");\n');
  await put(apiClosure, 'api/node_modules/@rest-otm/license/dist/verify.js', 'module.exports = {};\n');
  await put(apiClosure, 'api/node_modules/@rest-otm/license/package.json', '{"main":"dist/index.js"}\n');
  await put(apiClosure, 'api/node_modules/@rest-otm/receipt-core/dist/index.js', 'module.exports = {};\n');
  await put(apiClosure, 'api/node_modules/@rest-otm/receipt-core/package.json', '{"main":"dist/index.js"}\n');
  await put(apiClosure, 'api/native/addon.node', fakePe);
  await put(apiClosure, 'metadata/dependencies.json', '{"npmExternals":[]}\n');
  await put(apiClosure, 'metadata/dependency-graph.json', '{}\n');
  await put(apiClosure, 'manifest.json', `${JSON.stringify({
    schemaVersion: 1,
    profile: 'local',
    entryPoint: 'api/local.js',
    files: 6,
    npmDependenciesBundled: false,
    workspaceDependenciesPruned: true,
  }, null, 2)}\n`);

  for (const [app, name] of [[adminApp, 'admin'], [waiterApp, 'waiter']]) {
    await put(app, `.next/standalone/apps/${name}/server.js`, 'console.log("standalone");\n');
    await put(app, `.next/static/chunks/${name}.js`, 'self.webpackChunk = [];\n');
    await put(app, 'public/manifest.json', '{}\n');
  }
  await put(gatewayDist, 'app.js', 'console.log("gateway");\n');
  await put(gatewayDist, 'config.js', 'module.exports = {};\n');
  await put(printAgentDist, 'agent.js', 'require("@rest-otm/receipt-core");\n');
  await put(receiptDist, 'index.js', 'module.exports = {};\n');
  const receiptPackage = await put(source, 'receipt-package.json', '{"main":"dist/index.js"}\n');

  const contractTemplate = JSON.parse(
    await readFile(new URL('../../packaging/windows/installer-contract.example.json', import.meta.url), 'utf8'),
  );
  const installerContract = await put(source, 'installer-contract.json', `${JSON.stringify(contractTemplate, null, 2)}\n`);
  const { publicKey } = generateKeyPairSync('ed25519');
  const licensePublicKey = await put(
    source,
    'license-public-key.pem',
    publicKey.export({ type: 'spki', format: 'pem' }),
  );

  const executableSources = {};
  for (const [property, relativePath] of Object.entries({
    runtimeService: CANONICAL_ROLE_PATHS['runtime-service'],
    bootstrap: CANONICAL_ROLE_PATHS['installer-bootstrap'],
    postgres: CANONICAL_ROLE_PATHS['postgres-server'],
    pgDump: CANONICAL_ROLE_PATHS['postgres-client'],
    apiLauncher: CANONICAL_ROLE_PATHS['local-api'],
    adminLauncher: CANONICAL_ROLE_PATHS['admin-ui'],
    waiterLauncher: CANONICAL_ROLE_PATHS['waiter-ui'],
    printLauncher: CANONICAL_ROLE_PATHS['print-agent'],
    gatewayLauncher: CANONICAL_ROLE_PATHS['lan-gateway'],
  })) {
    executableSources[property] = await put(peRoot, relativePath, fakePe);
  }

  return {
    root,
    options: {
      mode: 'fixture',
      version: '1.2.3',
      out: path.join(root, 'payload'),
      apiClosure,
      adminApp,
      waiterApp,
      gatewayDist,
      printAgentDist,
      receiptDist,
      receiptPackage,
      installerContract,
      publicKey: licensePublicKey,
      ...executableSources,
    },
  };
}

test('fixture stager canonical payload ve deterministic SHA-256 manifest uretir', async (t) => {
  const first = await createFixture();
  const second = await createFixture();
  await writeFile(second.options.publicKey, await readFile(first.options.publicKey));
  t.after(() => Promise.all([
    rm(first.root, { recursive: true, force: true }),
    rm(second.root, { recursive: true, force: true }),
  ]));

  const firstResult = await assembleWindowsPayload(first.options);
  second.options.out = path.join(second.root, 'payload-two');
  const secondResult = await assembleWindowsPayload(second.options);
  assert.equal(firstResult.manifest.fixture, true);
  assert.deepEqual(firstResult.manifest, secondResult.manifest);
  assert.deepEqual(
    firstResult.manifest.files.map((file) => file.relativePath),
    [...firstResult.manifest.files.map((file) => file.relativePath)].sort((a, b) => a.localeCompare(b, 'en')),
  );
  const roleMap = new Map(firstResult.manifest.files.map((file) => [file.role, file.relativePath]));
  for (const [role, relativePath] of Object.entries(CANONICAL_ROLE_PATHS)) {
    assert.equal(roleMap.get(role), relativePath);
  }
  assert.equal(firstResult.manifest.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)), true);
  assert.equal(
    firstResult.manifest.files.find((file) => file.relativePath === 'api/runtime/native/addon.node')?.authenticodeRequired,
    true,
  );
  await access(path.join(firstResult.root, 'api/runtime/local.js'));
  await access(path.join(firstResult.root, 'admin/runtime/apps/admin/server.js'));
  await access(path.join(firstResult.root, 'waiter/runtime/apps/waiter/server.js'));
  await access(path.join(firstResult.root, 'print-agent/node_modules/@rest-otm/receipt-core/dist/index.js'));
});

test('production eksik veya imzasiz PE ile payload uretmez', async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const contract = JSON.parse(await readFile(fixture.options.installerContract, 'utf8'));
  contract.native_bootstrap.production_ready = true;
  await writeFile(fixture.options.installerContract, `${JSON.stringify(contract, null, 2)}\n`);
  const apiManifestPath = path.join(fixture.options.apiClosure, 'manifest.json');
  const apiManifest = JSON.parse(await readFile(apiManifestPath, 'utf8'));
  apiManifest.npmDependenciesBundled = true;
  await writeFile(apiManifestPath, `${JSON.stringify(apiManifest, null, 2)}\n`);
  fixture.options.mode = 'production';

  await assert.rejects(
    assembleWindowsPayload(fixture.options, { authenticodeVerifier: async () => false }),
    /Authenticode/,
  );
  await assert.rejects(access(fixture.options.out));

  await rm(fixture.options.runtimeService);
  await assert.rejects(
    assembleWindowsPayload(fixture.options, { authenticodeVerifier: async () => true }),
    /girdisi eksik/,
  );
});

test('source, source-map, private key ve symlink closure fail-closed reddedilir', async (t) => {
  const mapFixture = await createFixture();
  const keyFixture = await createFixture();
  const linkFixture = await createFixture();
  t.after(() => Promise.all([mapFixture, keyFixture, linkFixture].map(({ root }) =>
    rm(root, { recursive: true, force: true }))));

  await put(mapFixture.options.gatewayDist, 'app.js.map', '{}');
  await assert.rejects(assembleWindowsPayload(mapFixture.options), /source-map/);

  await put(keyFixture.options.printAgentDist, 'embedded.js', '-----BEGIN PRIVATE KEY-----\nsecret\n');
  await assert.rejects(assembleWindowsPayload(keyFixture.options), /Private key/);

  const linkTarget = await put(linkFixture.root, 'outside.js', 'outside');
  await symlink(linkTarget, path.join(linkFixture.options.gatewayDist, 'linked.js'));
  await assert.rejects(assembleWindowsPayload(linkFixture.options), /Symlink/);
});

test('wrong canonical child role/path contract ve guvensiz CLI reddedilir', async (t) => {
  const fixture = await createFixture();
  t.after(() => rm(fixture.root, { recursive: true, force: true }));
  const contract = JSON.parse(await readFile(fixture.options.installerContract, 'utf8'));
  contract.children[1].relative_executable = 'api/wrong.exe';
  await writeFile(fixture.options.installerContract, `${JSON.stringify(contract, null, 2)}\n`);
  await assert.rejects(assembleWindowsPayload(fixture.options), /child role\/path/);

  assert.throws(
    () => parseWindowsPayloadArguments(['--fixture', '--fixture', '--version', '1.0.0', '--out', 'x']),
    /Duplicate/,
  );
  const parsed = parseWindowsPayloadArguments(['--version', '1.0.0', '--out', '/']);
  await assert.rejects(assembleWindowsPayload(parsed), /Guvenli olmayan payload hedefi/);
});
