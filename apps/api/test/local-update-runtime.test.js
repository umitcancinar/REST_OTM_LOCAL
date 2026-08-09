const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createHash, sign } = require('node:crypto');
const { mkdir, mkdtemp, readFile, readdir, symlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const {
  canonicalJson,
  compareVersions,
  parseAndVerifySignedManifest,
  validateArtifactUrl,
  validateUpdateEndpoint,
} = require('../dist/modules/local-update/local-update.contract.js');
const {
  LOCAL_UPDATE_INTERNAL_CONTRACT,
  LOCAL_UPDATE_LICENSE_GATE_POLICY,
  LocalUpdateError,
  LocalUpdateRuntime,
} = require('../dist/modules/local-update/local-update.runtime.js');
const {
  createLocalUpdateRouter,
  LOCAL_UPDATE_RECOVERY_RULES,
} = require('../dist/modules/local-update/local-update.routes.js');

const NOW = new Date('2026-08-09T10:00:00.000Z');

function keyPair() {
  const pair = generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicPem: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function manifestFor(artifact, overrides = {}) {
  return {
    schemaVersion: 1,
    version: '1.2.0',
    channel: 'stable',
    minCurrentVersion: '1.0.0',
    maxCurrentVersion: '1.1.9',
    issuedAt: '2026-08-09T09:55:00.000Z',
    expiresAt: '2026-08-16T09:55:00.000Z',
    migration: {
      contractVersion: 1,
      minCurrentSchemaVersion: 1,
      maxCurrentSchemaVersion: 1,
      targetSchemaVersion: 1,
      mode: 'none',
      requiresBackup: false,
      rollbackSupported: true,
    },
    artifacts: [{
      role: 'windows-payload',
      fileName: 'restotm-update.zip',
      platform: 'win32-x64',
      sizeBytes: artifact.length,
      sha256: createHash('sha256').update(artifact).digest('hex'),
      url: 'https://updates.example/artifacts/restotm-update.zip?token=signed',
    }],
    ...overrides,
  };
}

function envelopeFor(manifest, privateKey) {
  const payload = canonicalJson(manifest);
  return {
    payload,
    signature: sign(null, Buffer.from(payload), privateKey).toString('base64url'),
  };
}

async function fixture(options = {}) {
  const artifact = options.artifact || Buffer.from('signed windows payload');
  const pair = keyPair();
  const manifest = manifestFor(artifact, options.manifest || {});
  const envelope = envelopeFor(manifest, pair.privateKey);
  const root = await mkdtemp(path.join(tmpdir(), 'restotm-update-test-'));
  const calls = [];
  let activeEnvelope = envelope;
  let activeArtifact = artifact;
  let noUpdate = Boolean(options.noUpdate);
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === 'https://updates.example/api/updates/v1/manifest') {
      if (noUpdate) return new Response(null, { status: 204 });
      return new Response(JSON.stringify(activeEnvelope), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.startsWith('https://updates.example/artifacts/')) {
      return new Response(activeArtifact, {
        status: 200,
        headers: {
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(activeArtifact.length),
        },
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };
  const runtime = new LocalUpdateRuntime({
    runtimeMode: 'local',
    dataDir: root,
    manifestUrl: 'https://updates.example/api/updates/v1/manifest',
    publicKeyPem: pair.publicPem,
    currentVersion: '1.0.0',
    channel: 'stable',
    currentDatabaseSchemaVersion: 1,
    allowedArtifactOrigins: ['https://updates.example'],
    clock: () => new Date(NOW),
  }, fetchImpl);
  await runtime.initialize();
  return {
    root,
    artifact,
    pair,
    manifest,
    envelope,
    runtime,
    calls,
    setEnvelope(value) { activeEnvelope = value; },
    setArtifact(value) { activeArtifact = value; },
    setNoUpdate(value) { noUpdate = value; },
  };
}

test('endpoint HTTPS ve credentials/query/hash olmadan kabul edilir; artifact presigned query kullanabilir', () => {
  assert.equal(
    validateUpdateEndpoint('https://updates.example/api/updates/v1/manifest').href,
    'https://updates.example/api/updates/v1/manifest',
  );
  for (const invalid of [
    'http://updates.example/api/manifest',
    'https://user:pass@updates.example/api/manifest',
    'https://updates.example/api/manifest?channel=stable',
    'https://updates.example/api/manifest#latest',
    'https://updates.example/',
  ]) assert.throws(() => validateUpdateEndpoint(invalid));
  const artifact = validateArtifactUrl(
    'https://cdn.example/update.zip?expires=1&signature=abc',
    new Set(['https://cdn.example']),
  );
  assert.equal(artifact.search, '?expires=1&signature=abc');
  assert.throws(() => validateArtifactUrl(
    'https://evil.example/update.zip',
    new Set(['https://cdn.example']),
  ));
});

test('semver siralamasi prerelease dahil deterministik ve build metadata kapali', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.2.0-rc.2', '1.2.0-rc.10'), -1);
  assert.equal(compareVersions('1.2.0', '1.2.0-rc.10'), 1);
  assert.throws(() => compareVersions('1.2.0+rebuilt', '1.2.0'));
  assert.throws(() => compareVersions('1.2.0-01', '1.2.0-1'));
});

test('yalniz Ed25519 imzali ve tam canonical manifest kabul edilir', () => {
  const pair = keyPair();
  const artifact = Buffer.from('payload');
  const manifest = manifestFor(artifact);
  const envelope = envelopeFor(manifest, pair.privateKey);
  const verified = parseAndVerifySignedManifest(envelope, pair.publicKey);
  assert.equal(verified.manifest.version, '1.2.0');

  const tampered = { ...envelope, payload: envelope.payload.replace('1.2.0', '1.2.1') };
  assert.throws(() => parseAndVerifySignedManifest(tampered, pair.publicKey), /imza/);

  const nonCanonicalPayload = JSON.stringify(manifest, null, 2);
  const nonCanonical = {
    payload: nonCanonicalPayload,
    signature: sign(null, Buffer.from(nonCanonicalPayload), pair.privateKey).toString('base64url'),
  };
  assert.throws(() => parseAndVerifySignedManifest(nonCanonical, pair.publicKey), /canonical/);

  for (const fileName of ['signed-manifest.json', 'CON.zip', 'payload.']) {
    const reserved = manifestFor(artifact, {
      artifacts: [{ ...manifest.artifacts[0], fileName }],
    });
    assert.throws(() => parseAndVerifySignedManifest(
      envelopeFor(reserved, pair.privateKey),
      pair.publicKey,
    ));
  }
  const duplicateNames = manifestFor(artifact, {
    artifacts: [
      manifest.artifacts[0],
      { ...manifest.artifacts[0], role: 'menu', fileName: 'RESTOTM-UPDATE.ZIP' },
    ],
  });
  assert.throws(() => parseAndVerifySignedManifest(
    envelopeFor(duplicateNames, pair.privateKey),
    pair.publicKey,
  ));
});

test('imzali artifact temp dosyada boyut/hash dogrulanip yalnız supervisor icin stage edilir', async () => {
  const fx = await fixture();
  const result = await fx.runtime.checkAndStage();
  assert.equal(result.code, 'UPDATE_STAGED_NOT_APPLIED');
  assert.equal(result.state, 'STAGED_AWAITING_SUPERVISOR');
  assert.equal(result.applySupportedByLocalApi, false);
  assert.equal('apply' in fx.runtime, false);

  const downloaded = await readFile(path.join(result.stageDirectory, 'restotm-update.zip'));
  assert.deepEqual(downloaded, fx.artifact);
  const signedManifest = JSON.parse(
    await readFile(path.join(result.stageDirectory, 'signed-manifest.json'), 'utf8'),
  );
  assert.deepEqual(signedManifest, fx.envelope);

  const handoff = JSON.parse(await readFile(path.join(fx.root, 'pending-handoff.json'), 'utf8'));
  assert.equal(handoff.contractVersion, 1);
  assert.equal(handoff.state, 'STAGED_AWAITING_SUPERVISOR');
  assert.equal(handoff.localApiApplySupported, false);
  assert.equal(handoff.operationalDataIncluded, false);
  assert.equal(handoff.verification.supervisorMustReverifyManifestAndArtifacts, true);
  assert.equal(handoff.requirements.atomicReplaceRequired, true);
  assert.equal(handoff.requirements.healthCheckAndRollbackRequired, true);

  const state = JSON.parse(await readFile(path.join(fx.root, 'update-high-water.json'), 'utf8'));
  assert.equal(state.highestAcceptedVersion, '1.2.0');
  assert.equal(state.highestAcceptedManifestSha256, result.manifestSha256);
  const manifestRequest = fx.calls[0];
  const headers = new Headers(manifestRequest.init.headers);
  assert.equal(headers.get('X-Rest-Otm-Current-Version'), '1.0.0');
  assert.equal(headers.get('X-Rest-Otm-Update-Channel'), 'stable');
  const serializedHeaders = JSON.stringify([...headers.entries()]).toLowerCase();
  assert.equal(serializedHeaders.includes('license'), false);
  assert.equal(serializedHeaders.includes('hardware'), false);
  assert.equal(serializedHeaders.includes('tenant'), false);

  const status = await fx.runtime.getStatus();
  assert.equal(status.coordinatorState, 'STAGED_AWAITING_SUPERVISOR');
  assert.equal(status.applySupportedByLocalApi, false);
  assert.equal(status.licenseGatePolicy, 'RECOVERY_MAINTENANCE_ALWAYS');
});

test('cloud 204 no-update cevabi state yazmadan acik IDLE sonucu olur', async () => {
  const fx = await fixture({ noUpdate: true });
  const result = await fx.runtime.checkAndStage();
  assert.deepEqual(result, {
    code: 'NO_UPDATE_AVAILABLE',
    state: 'IDLE',
    currentVersion: '1.0.0',
    channel: 'stable',
    applySupportedByLocalApi: false,
  });
  const files = await readdir(fx.root);
  assert.equal(files.includes('update-high-water.json'), false);
  assert.equal(files.includes('pending-handoff.json'), false);
  assert.equal((await fx.runtime.getStatus()).coordinatorState, 'IDLE');
});

test('mevcut staged handoff varken bos feed yaniltici IDLE uretmez', async () => {
  const fx = await fixture();
  await fx.runtime.checkAndStage();
  fx.setNoUpdate(true);
  await assert.rejects(
    () => fx.runtime.checkAndStage(),
    (error) => error instanceof LocalUpdateError && error.code === 'UPDATE_PENDING_BUT_FEED_EMPTY',
  );
});

test('ayni imzali manifest idempotent; daha dusuk veya ayni surum farkli manifest reddedilir', async () => {
  const fx = await fixture();
  const first = await fx.runtime.checkAndStage();
  const second = await fx.runtime.checkAndStage();
  assert.equal(second.commandId, first.commandId);
  assert.equal(fx.calls.filter((call) => call.url.includes('/artifacts/')).length, 1);

  const lowerManifest = manifestFor(fx.artifact, { version: '1.1.0' });
  fx.setEnvelope(envelopeFor(lowerManifest, fx.pair.privateKey));
  await assert.rejects(
    () => fx.runtime.checkAndStage(),
    (error) => error instanceof LocalUpdateError && error.code === 'UPDATE_ROLLBACK_REJECTED',
  );

  const equivocationManifest = manifestFor(fx.artifact, {
    version: '1.2.0',
    expiresAt: '2026-08-17T09:55:00.000Z',
  });
  fx.setEnvelope(envelopeFor(equivocationManifest, fx.pair.privateKey));
  await assert.rejects(
    () => fx.runtime.checkAndStage(),
    (error) => error instanceof LocalUpdateError && error.code === 'UPDATE_EQUIVOCATION_REJECTED',
  );

  const tampered = await fixture();
  const staged = await tampered.runtime.checkAndStage();
  await writeFile(
    path.join(staged.stageDirectory, 'restotm-update.zip'),
    Buffer.alloc(tampered.artifact.length, 0x78),
  );
  await assert.rejects(
    () => tampered.runtime.checkAndStage(),
    (error) => error instanceof LocalUpdateError && error.code === 'UPDATE_STAGE_INTEGRITY_FAILED',
  );
});

test('artifact boyut/hash uyusmazliginda partial, high-water ve handoff birakilmaz', async () => {
  const fx = await fixture();
  fx.setArtifact(Buffer.from('tampered payload with another size'));
  await assert.rejects(
    () => fx.runtime.checkAndStage(),
    (error) => error instanceof LocalUpdateError
      && ['UPDATE_ARTIFACT_SIZE_MISMATCH', 'UPDATE_ARTIFACT_INTEGRITY_FAILED'].includes(error.code),
  );
  const entries = await readdir(fx.root);
  assert.equal(entries.includes('update-high-water.json'), false);
  assert.equal(entries.includes('pending-handoff.json'), false);
  const stageEntries = await readdir(path.join(fx.root, 'stages'));
  assert.deepEqual(stageEntries, []);
});

test('bozuk high-water sessizce sifirlanmaz ve migration uyumsuzlugu indirmeden durur', async () => {
  const fx = await fixture();
  await writeFile(path.join(fx.root, 'update-high-water.json'), '{broken', { mode: 0o600 });
  await assert.rejects(
    () => fx.runtime.getStatus(),
    (error) => error instanceof LocalUpdateError && error.code === 'UPDATE_STATE_CORRUPT',
  );

  const clean = await fixture({
    manifest: {
      migration: {
        contractVersion: 1,
        minCurrentSchemaVersion: 2,
        maxCurrentSchemaVersion: 2,
        targetSchemaVersion: 3,
        mode: 'offline-required',
        requiresBackup: true,
        rollbackSupported: false,
      },
    },
  });
  await assert.rejects(
    () => clean.runtime.checkAndStage(),
    (error) => error instanceof LocalUpdateError && error.code === 'UPDATE_DATABASE_SCHEMA_INCOMPATIBLE',
  );
  assert.equal(clean.calls.filter((call) => call.url.includes('/artifacts/')).length, 0);
});

test('data root canonicalize edilir; root/stages symlink veya reparse hedefi reddedilir', async () => {
  const pair = keyPair();
  const parent = await mkdtemp(path.join(tmpdir(), 'restotm-update-path-test-'));
  const target = path.join(parent, 'target');
  const linkedRoot = path.join(parent, 'linked-root');
  await mkdir(target);
  await symlink(target, linkedRoot, 'dir');
  const config = {
    runtimeMode: 'local',
    dataDir: linkedRoot,
    manifestUrl: 'https://updates.example/api/updates/v1/manifest',
    publicKeyPem: pair.publicPem,
    currentVersion: '1.0.0',
    channel: 'stable',
    currentDatabaseSchemaVersion: 1,
  };
  const linkedRuntime = new LocalUpdateRuntime(config, async () => { throw new Error('unused'); });
  await assert.rejects(
    () => linkedRuntime.initialize(),
    (error) => error instanceof LocalUpdateError && error.code === 'UPDATE_DATA_DIR_UNSAFE',
  );

  const realRoot = path.join(parent, 'real-root');
  const outsideStage = path.join(parent, 'outside-stage');
  await mkdir(realRoot);
  await mkdir(outsideStage);
  await symlink(outsideStage, path.join(realRoot, 'stages'), 'dir');
  const stageRuntime = new LocalUpdateRuntime(
    { ...config, dataDir: realRoot },
    async () => { throw new Error('unused'); },
  );
  await assert.rejects(
    () => stageRuntime.initialize(),
    (error) => error instanceof LocalUpdateError && error.code === 'UPDATE_DATA_DIR_UNSAFE',
  );
});

test('license recovery yuzeyi kesin ve router guardsiz kurulamaz', async () => {
  assert.equal(LOCAL_UPDATE_LICENSE_GATE_POLICY, 'RECOVERY_MAINTENANCE_ALWAYS');
  assert.deepEqual(
    LOCAL_UPDATE_RECOVERY_RULES.map((rule) => `${rule.methods.join(',')}:${rule.path}`),
    [
      'GET,HEAD:/api/local-update/status',
      'POST:/api/local-update/check-and-stage',
    ],
  );
  const fx = await fixture();
  assert.throws(
    () => createLocalUpdateRouter(fx.runtime, []),
    (error) => error instanceof LocalUpdateError && error.code === 'UPDATE_AUTH_REQUIRED',
  );
  assert.deepEqual(LOCAL_UPDATE_INTERNAL_CONTRACT, {
    stateFile: 'update-high-water.json',
    handoffFile: 'pending-handoff.json',
    manifestCanonicalization: 'sorted-json-v1',
    signatureAlgorithm: 'Ed25519',
    applySupportedByLocalApi: false,
    operationalDataIncluded: false,
  });
});
