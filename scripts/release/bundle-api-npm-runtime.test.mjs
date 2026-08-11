import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { bundleApiNpmRuntime } from './bundle-api-npm-runtime.mjs';

async function put(root, relativePath, content) {
  const target = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

test('local API runtime exact transitif npm closure ve Prisma varliklarini bundle eder', async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'restotm-api-runtime-'));
  const deployRoot = path.join(temporaryRoot, 'deploy');
  const stageRoot = path.join(temporaryRoot, 'stage');

  await put(deployRoot, 'package.json', JSON.stringify({ name: 'deploy-fixture', private: true }));
  await put(deployRoot, 'node_modules/alpha/package.json', JSON.stringify({
    name: 'alpha', version: '1.0.0', main: 'index.js', dependencies: { bravo: '2.0.0' },
  }));
  await put(deployRoot, 'node_modules/alpha/index.js', 'module.exports = require("bravo");');
  await put(deployRoot, 'node_modules/alpha/README.md', '-----BEGIN PRIVATE KEY----- ornek dokuman');
  await put(deployRoot, 'node_modules/bravo/package.json', JSON.stringify({
    name: 'bravo', version: '2.0.0', main: 'index.js',
  }));
  await put(deployRoot, 'node_modules/bravo/index.js', 'module.exports = 42;');
  await put(deployRoot, 'node_modules/prisma/package.json', JSON.stringify({
    name: 'prisma', version: '6.0.0', main: 'index.js',
  }));
  await put(deployRoot, 'node_modules/prisma/index.js', 'module.exports = {};');
  await put(deployRoot, 'node_modules/.prisma/client/default.js', 'module.exports = {};');

  await put(stageRoot, 'api/local.js', 'module.exports = require("alpha");');
  await put(stageRoot, 'metadata/dependencies.json', JSON.stringify({ npmExternals: ['alpha'] }));
  await put(stageRoot, 'metadata/dependency-graph.json', '{}');
  await put(stageRoot, 'manifest.json', JSON.stringify({
    schemaVersion: 1,
    profile: 'local',
    entryPoint: 'api/local.js',
    files: 4,
    npmDependenciesBundled: false,
    workspaceDependenciesPruned: true,
  }));

  const result = await bundleApiNpmRuntime({ deployRoot, stageRoot });
  const manifest = JSON.parse(await readFile(path.join(stageRoot, 'manifest.json'), 'utf8'));
  assert.equal(manifest.npmDependenciesBundled, true);
  assert.ok(result.packages >= 3);
  assert.equal(await readFile(path.join(stageRoot, 'api/node_modules/bravo/index.js'), 'utf8'), 'module.exports = 42;');
  assert.equal(await readFile(path.join(stageRoot, 'api/node_modules/.prisma/client/default.js'), 'utf8'), 'module.exports = {};');
  await assert.rejects(readFile(path.join(stageRoot, 'api/node_modules/alpha/README.md')));
});
