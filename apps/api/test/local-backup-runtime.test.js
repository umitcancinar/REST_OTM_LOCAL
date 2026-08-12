const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  BackupAlreadyRunningError,
  LocalBackupError,
  LocalBackupRuntime,
  postgresConnectionFromUrl,
} = require('../dist/modules/local-backup/local-backup.runtime.js');
const {
  createLocalBackupRouter,
  LOCAL_BACKUP_RECOVERY_RULES,
} = require('../dist/modules/local-backup/local-backup.routes.js');
const { localEnv } = require('../dist/config/env.local.js');

async function fixture(overrides = {}, adapterFactory, restoreAdapterFactory) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'restotm-backup-test-'));
  const dataDir = path.join(root, 'postgres-data');
  const backupDir = path.join(root, 'backup-volume');
  const externalDir = path.join(root, 'external-volume');
  await mkdir(dataDir, { recursive: true });

  const calls = [];
  const restoreCalls = [];
  const adapter = adapterFactory?.(calls) ?? {
    async run(executable, args, options) {
      calls.push({ executable, args: [...args], options });
      const fileIndex = args.indexOf('--file');
      assert.notEqual(fileIndex, -1);
      await writeFile(args[fileIndex + 1], Buffer.from('RESTOTM_TEST_CUSTOM_DUMP'));
    },
  };
  const { externalBackupDir, ...otherOverrides } = overrides;
  const config = {
    dataDir,
    backupDir,
    connection: {
      host: '127.0.0.1',
      port: 55432,
      user: 'restotm',
      password: 'secret-that-must-not-be-an-argument',
      database: 'restotm_local',
      sslMode: 'disable',
    },
    encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef'),
    encryptionKeyId: 'test-key-2026',
    processTimeoutMs: 1_000,
    lockStaleMs: 2_000,
    backupIntervalMs: 1_000,
    schedulerPollMs: 1_000,
    ...otherOverrides,
    ...(externalBackupDir === true
      ? { externalBackupDir: externalDir }
      : externalBackupDir
        ? { externalBackupDir }
        : {}),
  };
  const restoreAdapter = restoreAdapterFactory?.(restoreCalls) ?? { async run() {} };
  const runtime = new LocalBackupRuntime(config, adapter, restoreAdapter);
  return {
    root,
    dataDir,
    backupDir,
    externalDir,
    runtime,
    calls,
    restoreCalls,
    async cleanup() { await rm(root, { recursive: true, force: true }); },
  };
}

test('DATABASE_URL parola loglamaya gerek kalmadan yapilandirilmis alanlara ayrilir', () => {
  const connection = postgresConnectionFromUrl(
    'postgresql://rest%40otm:p%40ss%3Aword@127.0.0.1:55432/rest_local?sslmode=require&schema=public',
  );
  assert.deepEqual(connection, {
    host: '127.0.0.1',
    port: 55432,
    user: 'rest@otm',
    password: 'p@ss:word',
    database: 'rest_local',
    sslMode: 'require',
  });
  assert.throws(
    () => postgresConnectionFromUrl('mysql://user:pass@localhost/database'),
    (error) => error instanceof LocalBackupError && error.code === 'INVALID_DATABASE_URL',
  );
});

test('pg_dump shell olmadan calisir; secret argv/env disinda kalir ve atomik sifreli v2 manifest uretilir', async (t) => {
  const fx = await fixture();
  t.after(() => fx.cleanup());

  const manifest = await fx.runtime.createBackup('manual');
  assert.equal(fx.calls.length, 1);
  const call = fx.calls[0];
  assert.equal(call.executable, 'pg_dump');
  assert.equal(call.args.includes('--format=custom'), true);
  assert.equal(call.args.includes('secret-that-must-not-be-an-argument'), false);
  assert.equal(call.options.env.PGPASSWORD, 'secret-that-must-not-be-an-argument');
  assert.equal(call.options.env.PGSSLMODE, 'disable');
  assert.equal(call.options.env.DATABASE_URL, undefined);
  assert.equal(call.options.env.JWT_ACCESS_SECRET, undefined);
  assert.equal(call.options.env.LOCAL_BACKUP_KEY_BASE64, undefined);

  const files = await readdir(fx.backupDir);
  assert.equal(files.some((name) => name.endsWith('.partial')), false);
  assert.equal(files.includes(manifest.fileName), true);
  assert.equal(files.includes(`${manifest.fileName}.manifest.json`), true);
  const payload = await readFile(path.join(fx.backupDir, manifest.fileName));
  assert.equal(manifest.manifestVersion, 2);
  assert.equal(manifest.cipherSha256, createHash('sha256').update(payload).digest('hex'));
  assert.equal(manifest.sizeBytes, payload.length);
  assert.equal(payload.includes(Buffer.from('RESTOTM_TEST_CUSTOM_DUMP')), false);
  assert.deepEqual(manifest.encryption.algorithm, 'aes-256-gcm');
  assert.deepEqual(manifest.encryption.keyId, 'test-key-2026');

  const persisted = JSON.parse(
    await readFile(path.join(fx.backupDir, `${manifest.fileName}.manifest.json`), 'utf8'),
  );
  assert.deepEqual(persisted, manifest);
});

test('32 byte anahtar ve guvenli keyId olmadan runtime fail-fast davranir', () => {
  const base = {
    dataDir: '/tmp/data',
    backupDir: '/tmp/backup',
    connection: { host: 'localhost', port: 5432, user: 'user', database: 'db' },
    encryptionKeyId: 'key-1',
  };
  assert.throws(
    () => new LocalBackupRuntime({ ...base, encryptionKey: Buffer.alloc(31) }),
    (error) => error instanceof LocalBackupError && error.code === 'INVALID_BACKUP_KEY',
  );
  assert.throws(
    () => new LocalBackupRuntime({ ...base, encryptionKey: Buffer.alloc(32), encryptionKeyId: '../key' }),
    (error) => error instanceof LocalBackupError && error.code === 'INVALID_BACKUP_KEY',
  );
});

test('env key provider iki runtime icin bagimsiz tek-kullanimlik kopyalar verir', () => {
  const first = localEnv.LOCAL_BACKUP_KEY();
  const second = localEnv.LOCAL_BACKUP_KEY();
  assert.equal(first.length, 32);
  assert.equal(second.length, 32);
  assert.notEqual(first, second);
  assert.deepEqual(first, second);
  const expectedSecond = Buffer.from(second);
  first.fill(0);
  assert.deepEqual(second, expectedSecond);
  expectedSecond.fill(0);
  second.fill(0);
});

test('pg_dump hatasi partial dosyayi temizler ve hassas hata metnini disari tasimaz', async (t) => {
  const fx = await fixture({}, () => ({
    async run() {
      throw new Error('failure includes super-secret-password');
    },
  }));
  t.after(() => fx.cleanup());

  await assert.rejects(
    () => fx.runtime.createBackup(),
    (error) => error instanceof LocalBackupError
      && error.code === 'BACKUP_FAILED'
      && error.message.includes('super-secret-password') === false,
  );
  const files = await readdir(fx.backupDir);
  assert.deepEqual(files, ['.restotm-replication-state.json']);
});

test('ayni proseste ikinci eszamanli yedek hemen reddedilir', async (t) => {
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => { entered = resolve; });
  const fx = await fixture({}, (calls) => ({
    async run(executable, args, options) {
      calls.push({ executable, args: [...args], options });
      entered();
      await new Promise((resolve) => { release = resolve; });
      const fileIndex = args.indexOf('--file');
      await writeFile(args[fileIndex + 1], Buffer.from('DEFERRED_DUMP'));
    },
  }));
  t.after(() => fx.cleanup());

  const first = fx.runtime.createBackup();
  await enteredPromise;
  assert.deepEqual(await fx.runtime.listBackups(), []);
  assert.deepEqual(
    (await readdir(fx.backupDir)).sort(),
    ['.restotm-backup.lock', '.restotm-replication-state.json'].sort(),
  );
  await assert.rejects(
    () => fx.runtime.createBackup(),
    (error) => error instanceof BackupAlreadyRunningError && error.statusCode === 409,
  );
  release();
  await first;
});

test('yedek dizini veri diziniyle ayni veya ic ice olamaz', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'restotm-backup-path-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  const runtime = new LocalBackupRuntime({
    dataDir,
    backupDir: path.join(dataDir, 'backups'),
    connection: { host: 'localhost', port: 5432, user: 'user', database: 'db' },
    encryptionKey: Buffer.alloc(32, 1),
    encryptionKeyId: 'test-key',
    processTimeoutMs: 1_000,
    lockStaleMs: 2_000,
  }, { async run() {} });

  await assert.rejects(
    () => runtime.initialize(),
    (error) => error instanceof LocalBackupError && error.code === 'BACKUP_PATH_NOT_SEPARATE',
  );
});

test('pg_dump plaintext hedefini symlink ile degistirirse yayin yapilmaz ve dis hedef okunmaz', async (t) => {
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'restotm-external-'));
  const externalFile = path.join(externalRoot, 'outside.dump');
  await writeFile(externalFile, Buffer.from('OUTSIDE_SECRET'));
  t.after(() => rm(externalRoot, { recursive: true, force: true }));
  const fx = await fixture({}, () => ({
    async run(_executable, args) {
      const fileIndex = args.indexOf('--file');
      await unlink(args[fileIndex + 1]);
      await symlink(externalFile, args[fileIndex + 1]);
    },
  }));
  t.after(() => fx.cleanup());

  await assert.rejects(
    () => fx.runtime.createBackup(),
    (error) => error instanceof LocalBackupError && error.code === 'INVALID_BACKUP_OUTPUT',
  );
  assert.deepEqual(await readdir(fx.backupDir), ['.restotm-replication-state.json']);
  assert.equal((await readFile(externalFile, 'utf8')), 'OUTSIDE_SECRET');
});

test('indirme once SHA-256 butunlugunu dogrular; gecersiz kimlik path traversal yapamaz', async (t) => {
  const fx = await fixture();
  t.after(() => fx.cleanup());
  const manifest = await fx.runtime.createBackup();

  const verified = await fx.runtime.getVerifiedDownload(manifest.id);
  assert.equal(verified.manifest.id, manifest.id);
  assert.equal(path.dirname(verified.absolutePath), await realpath(fx.backupDir));

  await writeFile(verified.absolutePath, Buffer.from('TAMPERED_PAYLOAD'));
  await assert.rejects(
    () => fx.runtime.getVerifiedDownload(manifest.id),
    (error) => error instanceof LocalBackupError && error.code === 'BACKUP_INTEGRITY_FAILED',
  );
  await assert.rejects(
    () => fx.runtime.getVerifiedDownload('../../etc/passwd'),
    (error) => error instanceof LocalBackupError && error.code === 'BACKUP_NOT_FOUND',
  );
});

test('sifre cozumleme guvenli tempte yapilir, pg_restore --list shell ve secret olmadan calisir', async (t) => {
  let candidatePath;
  const fx = await fixture({}, undefined, (restoreCalls) => ({
    async run(executable, args, options) {
      restoreCalls.push({ executable, args: [...args], options });
      candidatePath = args[1];
      assert.equal(executable, 'pg_restore');
      assert.deepEqual(args.slice(0, 1), ['--list']);
      assert.equal(args.includes('secret-that-must-not-be-an-argument'), false);
      assert.equal(options.env.PGPASSWORD, undefined);
      assert.equal(options.env.LOCAL_BACKUP_KEY_BASE64, undefined);
      assert.equal(await readFile(candidatePath, 'utf8'), 'RESTOTM_TEST_CUSTOM_DUMP');
      const entry = await lstat(candidatePath);
      assert.equal(entry.isFile(), true);
      assert.equal(entry.isSymbolicLink(), false);
    },
  }));
  t.after(() => fx.cleanup());
  const manifest = await fx.runtime.createBackup();
  const result = await fx.runtime.verifyRestoreCandidate(manifest.id);
  assert.equal(result.manifest.id, manifest.id);
  assert.equal(result.plainSizeBytes, Buffer.byteLength('RESTOTM_TEST_CUSTOM_DUMP'));
  assert.equal(fx.restoreCalls.length, 1);
  await assert.rejects(() => lstat(candidatePath), (error) => error.code === 'ENOENT');
});

test('manifest AAD alani degistirilirse GCM dogrulamasi restore oncesi reddeder', async (t) => {
  const fx = await fixture();
  t.after(() => fx.cleanup());
  const manifest = await fx.runtime.createBackup('manual');
  const manifestPath = path.join(fx.backupDir, `${manifest.fileName}.manifest.json`);
  const tampered = JSON.parse(await readFile(manifestPath, 'utf8'));
  tampered.reason = 'scheduled';
  await writeFile(manifestPath, `${JSON.stringify(tampered)}\n`, { mode: 0o600 });

  await assert.rejects(
    () => fx.runtime.verifyRestoreCandidate(manifest.id),
    (error) => error instanceof LocalBackupError && error.code === 'BACKUP_DECRYPTION_FAILED',
  );
  assert.equal(fx.restoreCalls.length, 0);
});

test('v2 ciphertext ve manifest harici hedefe atomik replike edilir; plaintext disari cikmaz', async (t) => {
  const fx = await fixture({ externalBackupDir: true, externalVolumePolicy: 'warn' });
  t.after(() => fx.cleanup());
  const manifest = await fx.runtime.createBackup();
  const replicationStatus = await fx.runtime.getStatus();

  assert.deepEqual(
    (await readdir(fx.externalDir)).sort(),
    [manifest.fileName, `${manifest.fileName}.manifest.json`].sort(),
    JSON.stringify(replicationStatus.externalReplication),
  );
  const localCipher = await readFile(path.join(fx.backupDir, manifest.fileName));
  const externalCipher = await readFile(path.join(fx.externalDir, manifest.fileName));
  assert.deepEqual(externalCipher, localCipher);
  assert.equal(externalCipher.includes(Buffer.from('RESTOTM_TEST_CUSTOM_DUMP')), false);
  assert.equal((await readdir(fx.externalDir)).some((name) => name.endsWith('.partial')), false);

  const status = replicationStatus;
  assert.equal(status.externalReplication.configured, true);
  assert.equal(status.externalReplication.pendingCount, 0);
  assert.equal(status.externalReplication.lastSuccess.id, manifest.id);
  assert.equal(status.externalReplication.volume.separate, false);
  assert.equal(status.externalReplication.volume.warningCode, 'BACKUP_EXTERNAL_SAME_VOLUME');
  assert.equal(status.externalReplication.alarm, 'WARNING');
});

test('harici hedef kesilirse lokal yedek kalir, hata diskte kalici olur ve retry tamamlar', async (t) => {
  const fx = await fixture({ externalBackupDir: true, externalVolumePolicy: 'warn' });
  t.after(() => fx.cleanup());
  await fx.runtime.initialize();
  const offlineDir = `${fx.externalDir}-offline`;
  await rename(fx.externalDir, offlineDir);

  const manifest = await fx.runtime.createBackup();
  assert.equal((await fx.runtime.getVerifiedDownload(manifest.id)).manifest.id, manifest.id);
  const failedStatus = await fx.runtime.getStatus();
  assert.equal(failedStatus.externalReplication.pendingCount, 1);
  assert.equal(failedStatus.externalReplication.alarm, 'ERROR');
  assert.match(failedStatus.externalReplication.lastError.code, /^BACKUP_/);
  const persisted = JSON.parse(
    await readFile(path.join(fx.backupDir, '.restotm-replication-state.json'), 'utf8'),
  );
  assert.deepEqual(persisted.pendingIds, [manifest.id]);

  await rename(offlineDir, fx.externalDir);
  const recoveredRuntime = new LocalBackupRuntime({
    dataDir: fx.dataDir,
    backupDir: fx.backupDir,
    externalBackupDir: fx.externalDir,
    externalVolumePolicy: 'warn',
    connection: {
      host: '127.0.0.1',
      port: 55432,
      user: 'restotm',
      password: 'secret-that-must-not-be-an-argument',
      database: 'restotm_local',
      sslMode: 'disable',
    },
    encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef'),
    encryptionKeyId: 'test-key-2026',
    processTimeoutMs: 1_000,
    lockStaleMs: 2_000,
    backupIntervalMs: 60_000,
    schedulerPollMs: 1_000,
  }, { async run() {} });
  await recoveredRuntime.initialize();
  const restartedStatus = await recoveredRuntime.getStatus();
  assert.equal(restartedStatus.externalReplication.pendingCount, 1);
  assert.notEqual(restartedStatus.externalReplication.lastError, null);

  recoveredRuntime.startScheduler();
  t.after(() => recoveredRuntime.stopScheduler());
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await recoveredRuntime.getStatus()).externalReplication.pendingCount === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const recoveredStatus = await recoveredRuntime.getStatus();
  assert.equal(recoveredStatus.externalReplication.pendingCount, 0);
  assert.equal(recoveredStatus.externalReplication.lastError, null);
  assert.equal(
    (await readFile(path.join(fx.externalDir, manifest.fileName))).equals(
      await readFile(path.join(fx.backupDir, manifest.fileName)),
    ),
    true,
  );
});

test('require-separate politikasi ayni fiziksel volume hedefini fail-fast reddeder', async (t) => {
  const fx = await fixture({ externalBackupDir: true, externalVolumePolicy: 'require-separate' });
  t.after(() => fx.cleanup());
  await assert.rejects(
    () => fx.runtime.initialize(),
    (error) => error instanceof LocalBackupError && error.code === 'BACKUP_EXTERNAL_SAME_VOLUME',
  );
});

test('harici hedef lokal backup altinda veya symlink olamaz', async (t) => {
  const nested = await fixture({ externalBackupDir: true, externalVolumePolicy: 'allow' });
  t.after(() => nested.cleanup());
  const nestedRuntime = new LocalBackupRuntime({
    dataDir: nested.dataDir,
    backupDir: nested.backupDir,
    externalBackupDir: path.join(nested.backupDir, 'external'),
    externalVolumePolicy: 'allow',
    connection: { host: 'localhost', port: 5432, user: 'user', database: 'db' },
    encryptionKey: Buffer.alloc(32, 7),
    encryptionKeyId: 'nested-test',
    processTimeoutMs: 1_000,
    lockStaleMs: 2_000,
  }, { async run() {} });
  await assert.rejects(
    () => nestedRuntime.initialize(),
    (error) => error instanceof LocalBackupError && error.code === 'BACKUP_EXTERNAL_PATH_NOT_SEPARATE',
  );

  const target = path.join(nested.root, 'real-external');
  const link = path.join(nested.root, 'external-link');
  await mkdir(target);
  await symlink(target, link);
  const symlinkRuntime = new LocalBackupRuntime({
    dataDir: nested.dataDir,
    backupDir: nested.backupDir,
    externalBackupDir: link,
    externalVolumePolicy: 'allow',
    connection: { host: 'localhost', port: 5432, user: 'user', database: 'db' },
    encryptionKey: Buffer.alloc(32, 8),
    encryptionKeyId: 'symlink-test',
    processTimeoutMs: 1_000,
    lockStaleMs: 2_000,
  }, { async run() {} });
  await assert.rejects(
    () => symlinkRuntime.initialize(),
    (error) => error instanceof LocalBackupError && error.code === 'INVALID_BACKUP_PATH',
  );
});

test('harici retention lokalden daha uzundur ve v1 arsivlere dokunmaz', async (t) => {
  let now = new Date('2026-08-01T03:00:00.000Z');
  const fx = await fixture({
    externalBackupDir: true,
    externalVolumePolicy: 'warn',
    retention: { daily: 1, weekly: 0, monthly: 0 },
    externalRetention: { daily: 2, weekly: 0, monthly: 0 },
    clock: () => new Date(now),
  });
  t.after(() => fx.cleanup());
  await fx.runtime.initialize();
  const legacyId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const legacyFileName = `restotm-20260701T030000000Z-${legacyId}.dump`;
  const legacyPayload = Buffer.from('LEGACY_EXTERNAL_DUMP');
  const legacyManifest = {
    manifestVersion: 1,
    id: legacyId,
    format: 'pg_dump-custom',
    reason: 'manual',
    createdAt: '2026-07-01T03:00:00.000Z',
    fileName: legacyFileName,
    sizeBytes: legacyPayload.length,
    sha256: createHash('sha256').update(legacyPayload).digest('hex'),
  };
  await writeFile(path.join(fx.externalDir, legacyFileName), legacyPayload, { mode: 0o600 });
  await writeFile(
    path.join(fx.externalDir, `${legacyFileName}.manifest.json`),
    `${JSON.stringify(legacyManifest)}\n`,
    { mode: 0o600 },
  );
  await fx.runtime.createBackup();
  now = new Date('2026-08-02T03:00:00.000Z');
  await fx.runtime.createBackup();
  now = new Date('2026-08-03T03:00:00.000Z');
  const newest = await fx.runtime.createBackup();

  assert.deepEqual((await fx.runtime.listBackups()).map((item) => item.id), [newest.id]);
  const externalManifests = (await readdir(fx.externalDir))
    .filter((name) => name.endsWith('.manifest.json'));
  assert.equal(externalManifests.length, 3);
  assert.equal((await readFile(path.join(fx.externalDir, legacyFileName))).equals(legacyPayload), true);
});

test('haftalik restore drill en yeni v2 lokal ve external arsivi dogrular, nextDue durumunu kalici tutar', async (t) => {
  const now = new Date('2026-08-09T03:00:00.000Z');
  const fx = await fixture({
    externalBackupDir: true,
    externalVolumePolicy: 'warn',
    restoreVerificationIntervalMs: 7 * 24 * 60 * 60 * 1000,
    restoreVerificationRetryMs: 60 * 60 * 1000,
    clock: () => new Date(now),
  }, undefined, (restoreCalls) => ({
    async run(executable, args, options) {
      restoreCalls.push({ executable, args: [...args], options });
      assert.equal(executable, 'pg_restore');
      assert.deepEqual(args.slice(0, 1), ['--list']);
      assert.equal(await readFile(args[1], 'utf8'), 'RESTOTM_TEST_CUSTOM_DUMP');
    },
  }));
  t.after(() => fx.cleanup());
  const backup = await fx.runtime.createBackup();

  const record = await fx.runtime.runRestoreVerificationIfDue();
  assert.equal(record.status, 'SUCCESS');
  assert.equal(record.backupId, backup.id);
  assert.equal(record.local, 'VERIFIED');
  assert.equal(record.external, 'VERIFIED');
  assert.equal(fx.restoreCalls.length, 2);
  assert.equal(await fx.runtime.runRestoreVerificationIfDue(), null);

  const status = await fx.runtime.getStatus();
  assert.equal(status.restoreVerification.alarm, 'NONE');
  assert.equal(status.restoreVerification.licenseGatePolicy, 'RECOVERY_MAINTENANCE_ALWAYS');
  assert.equal(status.restoreVerification.nextDueAt, '2026-08-16T03:00:00.000Z');
  const persisted = JSON.parse(
    await readFile(path.join(fx.backupDir, '.restotm-replication-state.json'), 'utf8'),
  );
  assert.equal(persisted.lastRestoreVerification.backupId, backup.id);
  assert.equal(persisted.nextRestoreVerificationDueAt, '2026-08-16T03:00:00.000Z');
});

test('restore drill hatasi yedegi silmez, secret sizdirmadan alarm ve kisa retry yazar', async (t) => {
  const fx = await fixture({
    restoreVerificationIntervalMs: 7_000,
    restoreVerificationRetryMs: 1_000,
  }, undefined, () => ({
    async run() {
      throw new Error('pg_restore failure contains restore-super-secret');
    },
  }));
  t.after(() => fx.cleanup());
  const backup = await fx.runtime.createBackup();
  const record = await fx.runtime.runRestoreVerificationIfDue(true);

  assert.equal(record.status, 'FAILED');
  assert.equal(record.local, 'FAILED');
  assert.equal(record.code, 'BACKUP_VERIFY_FAILED');
  assert.equal(JSON.stringify(record).includes('restore-super-secret'), false);
  assert.equal((await fx.runtime.getStatus()).restoreVerification.alarm, 'ERROR');
  assert.equal((await fx.runtime.getVerifiedDownload(backup.id)).manifest.id, backup.id);
});

test('restore drill process ve dosya kilidiyle backup ile ayni anda calismaz', async (t) => {
  let releaseRestore;
  let enteredRestore;
  const entered = new Promise((resolve) => { enteredRestore = resolve; });
  const fx = await fixture({}, undefined, () => ({
    async run() {
      enteredRestore();
      await new Promise((resolve) => { releaseRestore = resolve; });
    },
  }));
  t.after(() => fx.cleanup());
  await fx.runtime.createBackup();

  const drill = fx.runtime.runRestoreVerificationIfDue(true);
  await entered;
  await assert.rejects(
    () => fx.runtime.createBackup(),
    (error) => error instanceof BackupAlreadyRunningError,
  );
  releaseRestore();
  assert.equal((await drill).status, 'SUCCESS');
});

test('restart sonrasi overdue restore drill scheduler ilk turda otomatik calisir', async (t) => {
  let now = new Date('2026-08-01T03:00:00.000Z');
  const fx = await fixture({
    backupIntervalMs: 30 * 24 * 60 * 60 * 1000,
    restoreVerificationIntervalMs: 7 * 24 * 60 * 60 * 1000,
    restoreVerificationRetryMs: 60 * 60 * 1000,
    clock: () => new Date(now),
  });
  t.after(() => fx.cleanup());
  const backup = await fx.runtime.createBackup();
  await fx.runtime.runRestoreVerificationIfDue(true);
  now = new Date('2026-08-09T03:00:00.000Z');

  const calls = [];
  const restarted = new LocalBackupRuntime({
    dataDir: fx.dataDir,
    backupDir: fx.backupDir,
    connection: { host: 'localhost', port: 5432, user: 'user', database: 'db' },
    encryptionKey: Buffer.from('0123456789abcdef0123456789abcdef'),
    encryptionKeyId: 'test-key-2026',
    processTimeoutMs: 1_000,
    lockStaleMs: 2_000,
    backupIntervalMs: 30 * 24 * 60 * 60 * 1000,
    schedulerPollMs: 1_000,
    restoreVerificationIntervalMs: 7 * 24 * 60 * 60 * 1000,
    restoreVerificationRetryMs: 60 * 60 * 1000,
    clock: () => new Date(now),
  }, { async run() {} }, {
    async run(executable, args) {
      calls.push({ executable, args: [...args] });
    },
  });
  restarted.startScheduler();
  t.after(() => restarted.stopScheduler());
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = await restarted.getStatus();
    if (status.restoreVerification.lastRestoreVerification?.verifiedAt === now.toISOString()) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const status = await restarted.getStatus();
  assert.equal(status.restoreVerification.lastRestoreVerification.backupId, backup.id);
  assert.equal(status.restoreVerification.lastRestoreVerification.verifiedAt, now.toISOString());
  assert.equal(calls.length, 1);
});

test('v1 plaintext manifestler salt-okuma olarak listelenir ve restore adayi dogrulanabilir', async (t) => {
  const fx = await fixture({}, undefined, () => ({
    async run(_executable, args) {
      assert.equal(await readFile(args[1], 'utf8'), 'LEGACY_CUSTOM_DUMP');
    },
  }));
  t.after(() => fx.cleanup());
  await fx.runtime.initialize();
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const fileName = `restotm-20260801T030000000Z-${id}.dump`;
  const payload = Buffer.from('LEGACY_CUSTOM_DUMP');
  const manifest = {
    manifestVersion: 1,
    id,
    format: 'pg_dump-custom',
    reason: 'manual',
    createdAt: '2026-08-01T03:00:00.000Z',
    fileName,
    sizeBytes: payload.length,
    sha256: createHash('sha256').update(payload).digest('hex'),
  };
  await writeFile(path.join(fx.backupDir, fileName), payload, { mode: 0o600 });
  await writeFile(
    path.join(fx.backupDir, `${fileName}.manifest.json`),
    `${JSON.stringify(manifest)}\n`,
    { mode: 0o600 },
  );

  assert.deepEqual((await fx.runtime.listBackups()).map((item) => item.id), [id]);
  assert.equal((await fx.runtime.verifyRestoreCandidate(id)).manifest.manifestVersion, 1);
});

test('retention gunluk kovada yalniz en yeni yedegi tutar', async (t) => {
  let now = new Date('2026-08-01T03:00:00.000Z');
  const fx = await fixture({
    retention: { daily: 1, weekly: 0, monthly: 0 },
    clock: () => new Date(now),
  });
  t.after(() => fx.cleanup());

  await fx.runtime.createBackup();
  now = new Date('2026-08-02T03:00:00.000Z');
  await fx.runtime.createBackup();
  now = new Date('2026-08-03T03:00:00.000Z');
  const newest = await fx.runtime.createBackup();

  const backups = await fx.runtime.listBackups();
  assert.deepEqual(backups.map((item) => item.id), [newest.id]);
  const files = await readdir(fx.backupDir);
  assert.deepEqual(
    files.sort(),
    [newest.fileName, `${newest.fileName}.manifest.json`, '.restotm-replication-state.json'].sort(),
  );
});

test('recovery yuzeyi sadece status/list/export/download saglar ve router guardsiz kurulamaz', async () => {
  assert.deepEqual(
    LOCAL_BACKUP_RECOVERY_RULES.map((rule) => `${rule.methods.join(',')}:${rule.path}`),
    [
      'GET,HEAD:/api/backup/status',
      'GET,HEAD:/api/backup',
      'POST:/api/backup/export',
      'GET,HEAD:/api/backup/download',
    ],
  );
  assert.equal(LOCAL_BACKUP_RECOVERY_RULES.some((rule) => rule.path.includes('restore')), false);
  assert.equal(LOCAL_BACKUP_RECOVERY_RULES.some((rule) => rule.path.includes('import')), false);

  const fx = await fixture();
  try {
    assert.throws(
      () => createLocalBackupRouter(fx.runtime, []),
      (error) => error instanceof LocalBackupError && error.code === 'BACKUP_AUTH_REQUIRED',
    );
  } finally {
    await fx.cleanup();
  }
});

test('bulut yedegi sifreli kaynagi kalici kuyrukla retry eder ve basarida saglikli olur', async (t) => {
  let attempts = 0;
  const uploaded = [];
  const cloudReplica = {
    async upload(download) {
      attempts += 1;
      assert.equal(download.manifest.manifestVersion, 2);
      assert.equal(download.absolutePath.endsWith('.dump.enc'), true);
      if (attempts === 1) throw new Error('network secret must not escape');
      uploaded.push(download.manifest.id);
    },
  };
  const fx = await fixture({ cloudReplica });
  t.after(() => fx.cleanup());

  const backup = await fx.runtime.createBackup();
  const failed = await fx.runtime.getStatus();
  assert.equal(failed.cloudReplication.configured, true);
  assert.equal(failed.cloudReplication.pendingCount, 1);
  assert.equal(failed.cloudReplication.alarm, 'ERROR');
  assert.equal(failed.cloudReplication.lastError.code, 'BACKUP_CLOUD_UPLOAD_FAILED');
  assert.equal(JSON.stringify(failed).includes('network secret'), false);

  await fx.runtime.retryCloudReplication();
  const recovered = await fx.runtime.getStatus();
  assert.deepEqual(uploaded, [backup.id]);
  assert.equal(recovered.cloudReplication.pendingCount, 0);
  assert.equal(recovered.cloudReplication.healthy, true);
  assert.equal(recovered.cloudReplication.alarm, 'NONE');
  assert.equal(recovered.cloudReplication.encryption, 'AES-256-GCM_BEFORE_UPLOAD');
  assert.equal(recovered.cloudReplication.credentialPolicy, 'SHORT_LIVED_PRESIGNED_URL');
});
