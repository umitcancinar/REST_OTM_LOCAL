import assert from 'node:assert/strict';
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditArtifact, parseArguments } from './audit-artifact.mjs';

async function fixture(files) {
  const root = await mkdtemp(path.join(tmpdir(), 'rest-otm-artifact-'));
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);
  }
  return root;
}

test('local allowlist icindeki derlenmis artifact gecer', async () => {
  const root = await fixture({
    'api/local.js': 'console.log("local runtime");',
    'admin/server.js': 'console.log("admin");',
    'waiter/server.js': 'console.log("waiter");',
    'print-agent/agent.js': 'console.log("print");',
    'migrations/001.sql': 'SELECT 1;',
    'version.json': '{"version":"1.0.0"}',
  });

  const result = await auditArtifact({ profile: 'local', root });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

test('cloud allowlist icindeki derlenmis artifact gecer', async () => {
  const root = await fixture({
    'api/cloud.js': 'console.log("cloud control plane");',
    'superadmin/server.js': 'console.log("superadmin");',
    'menu/server.js': 'console.log("public menu");',
    'manifest.json': '{"profile":"cloud"}',
  });

  const result = await auditArtifact({ profile: 'cloud', root });
  assert.equal(result.ok, true, JSON.stringify(result.findings));
});

test('local artifact cloud imzalama ve license-admin kodunda fail eder', async () => {
  const root = await fixture({
    'api/local.js': 'require("@rest-otm/license/sign").issueLicense(input, LICENSE_PRIVATE_KEY);',
    'api/modules/license-admin/routes.js': 'module.exports = {};',
    'config/private.pem': '-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----',
  });

  const result = await auditArtifact({ profile: 'local', root });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(({ code }) => code === 'forbidden-local-path'));
  assert.ok(result.findings.some(({ code }) => code === 'forbidden-local-content'));
});

test('buyuk bundle sonundaki yasak import da taranir', async () => {
  const root = await fixture({
    'api/local.js': `${'const harmless = 1;\n'.repeat(5_000)}require("@rest-otm/license/sign");`,
  });

  const result = await auditArtifact({ profile: 'local', root });
  assert.ok(result.findings.some(({ code }) => code === 'forbidden-local-content'));
});

test('cloud artifact local operasyon, websocket ve print bagimliliklarinda fail eder', async () => {
  const root = await fixture({
    'api/cloud.js': 'require("./modules/orders/order.routes"); initializeSocketServer(server);',
    'api/modules/local-license/runtime.js': 'module.exports = {};',
    'api/websocket/socket.server.js': 'module.exports = {};',
    'runtime/worker.js': 'require("@rest-otm/receipt-core");',
  });

  const result = await auditArtifact({ profile: 'cloud', root });
  assert.equal(result.ok, false);
  assert.ok(result.findings.some(({ code }) => code === 'forbidden-cloud-path'));
  assert.ok(result.findings.some(({ code }) => code === 'forbidden-cloud-content'));
});

test('public projection yonleri iki artifact arasinda karisamaz', async () => {
  const localRoot = await fixture({
    'api/local.js': 'require("./modules/public/public-cloud.controller");',
    'api/modules/public/public-cloud.controller.js': 'module.exports = {};',
  });
  const cloudRoot = await fixture({
    'api/cloud.js': 'require("./modules/public/local-public.routes");',
    'api/modules/public/local-public.routes.js': 'module.exports = {};',
  });

  const local = await auditArtifact({ profile: 'local', root: localRoot });
  const cloud = await auditArtifact({ profile: 'cloud', root: cloudRoot });
  assert.ok(local.findings.some(({ code }) => code === 'forbidden-local-path'));
  assert.ok(cloud.findings.some(({ code }) => code === 'forbidden-cloud-path'));
});

test('iki profil de kaynak, map, test, env, git ve allowlist disi dosyayi reddeder', async () => {
  for (const profile of ['local', 'cloud']) {
    const entry = profile === 'local' ? 'api/local.js' : 'api/cloud.js';
    const root = await fixture({
      [entry]: 'console.log("entry");\n//# sourceMappingURL=entry.js.map',
      'api/entry.js.map': '{}',
      'api/source.ts': 'export {};',
      'api/view.tsx': 'export default null;',
      'api/test/smoke.js': 'throw new Error("not for release");',
      'config/.env.production': 'SECRET=value',
      '.git/config': '[core]',
      'unknown/payload.js': 'console.log("not allowlisted");',
    });

    const result = await auditArtifact({ profile, root });
    assert.equal(result.ok, false);
    assert.ok(result.findings.some(({ code }) => code === 'forbidden-common-path'));
    assert.ok(result.findings.some(({ code }) => code === 'forbidden-common-content'));
    assert.ok(result.findings.some(({ code }) => code === 'not-allowlisted'));
  }
});

test('symlinkler ve eksik profil giris noktasi fail eder', async () => {
  const root = await fixture({ 'runtime/worker.js': 'console.log("worker");' });
  await symlink(path.join(root, 'runtime/worker.js'), path.join(root, 'runtime/link.js'));
  await mkdir(path.join(root, 'empty-but-unknown'));

  const result = await auditArtifact({ profile: 'local', root });
  assert.ok(result.findings.some(({ code }) => code === 'unsafe-file-type'));
  assert.ok(result.findings.some(({ code }) => code === 'missing-entry-point'));
  assert.ok(result.findings.some(({ code, path: findingPath }) => (
    code === 'not-allowlisted' && findingPath === 'empty-but-unknown'
  )));
});

test('CLI argumanlari fail-closed ayrisir', () => {
  assert.deepEqual(
    parseArguments(['--profile', 'local', '--root', '/tmp/stage', '--json']),
    { profile: 'local', root: '/tmp/stage', json: true },
  );
  assert.throws(() => parseArguments(['--profile', 'all', '--root', '/tmp/stage']));
  assert.throws(() => parseArguments(['--profile', 'cloud']));
  assert.throws(() => parseArguments(['--wat', 'nope']));
});
