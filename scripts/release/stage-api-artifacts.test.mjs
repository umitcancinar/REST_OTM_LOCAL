import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { auditArtifact } from './audit-artifact.mjs';
import { parseStageArguments, stageApiProfile } from './stage-api-artifacts.mjs';

async function fakeBuild() {
  const root = await mkdtemp(path.join(tmpdir(), 'rest-otm-stage-test-'));
  const dist = path.join(root, 'dist');
  const out = path.join(root, 'stage');
  await mkdir(path.join(dist, 'runtime'), { recursive: true });
  await writeFile(path.join(dist, 'local.js'), 'require("./runtime/local.runtime");\n');
  await writeFile(path.join(dist, 'cloud.js'), 'require("./runtime/cloud.runtime");\n');
  await writeFile(path.join(dist, 'runtime/local.runtime.js'), 'require("express");\n');
  await writeFile(path.join(dist, 'runtime/cloud.runtime.js'), 'require("express");\n');
  await writeFile(path.join(dist, 'unreachable.js'), 'throw new Error("must not ship");\n');
  return { root, dist, out };
}

test('stager yalniz entrypoint dependency closure dosyalarini kopyalar', async () => {
  const { dist, out } = await fakeBuild();
  const result = await stageApiProfile({ profile: 'local', dist, out });
  assert.equal(result.audit.ok, true);
  await access(path.join(result.root, 'api/local.js'));
  await access(path.join(result.root, 'api/runtime/local.runtime.js'));
  await assert.rejects(access(path.join(result.root, 'api/cloud.js')));
  await assert.rejects(access(path.join(result.root, 'api/unreachable.js')));

  const dependencies = JSON.parse(
    await readFile(path.join(result.root, 'metadata/dependencies.json'), 'utf8'),
  );
  assert.deepEqual(dependencies.npmExternals, ['express']);
  assert.equal((await auditArtifact({ profile: 'local', root: result.root })).ok, true);
});

test('stager iki profili ayni output base icinde ayri tutar', async () => {
  const { dist, out } = await fakeBuild();
  const cloud = await stageApiProfile({ profile: 'cloud', dist, out });
  const local = await stageApiProfile({ profile: 'local', dist, out });
  assert.notEqual(cloud.root, local.root);
  assert.equal((await auditArtifact({ profile: 'cloud', root: cloud.root })).ok, true);
  assert.equal((await auditArtifact({ profile: 'local', root: local.root })).ok, true);
});

test('stager dinamik require ve guvensiz profil degerini reddeder', async () => {
  const { dist, out } = await fakeBuild();
  await writeFile(path.join(dist, 'local.js'), 'require(process.env.MODULE);\n');
  await assert.rejects(
    stageApiProfile({ profile: 'local', dist, out }),
    /Dinamik require/,
  );
  assert.throws(() => parseStageArguments(['--profile', 'desktop']));
});
