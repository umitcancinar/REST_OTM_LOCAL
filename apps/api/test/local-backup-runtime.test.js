const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } = require('node:fs/promises');
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

async function fixture(overrides = {}, adapterFactory) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'restotm-backup-test-'));
  const dataDir = path.join(root, 'postgres-data');
  const backupDir = path.join(root, 'backup-volume');
  await mkdir(dataDir, { recursive: true });

  const calls = [];
  const adapter = adapterFactory?.(calls) ?? {
    async run(executable, args, options) {
      calls.push({ executable, args: [...args], options });
      const fileIndex = args.indexOf('--file');
      assert.notEqual(fileIndex, -1);
      await writeFile(args[fileIndex + 1], Buffer.from('RESTOTM_TEST_CUSTOM_DUMP'));
    },
  };
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
    processTimeoutMs: 1_000,
    lockStaleMs: 2_000,
    backupIntervalMs: 1_000,
    schedulerPollMs: 1_000,
    ...overrides,
  };
  const runtime = new LocalBackupRuntime(config, adapter);
  return {
    root,
    dataDir,
    backupDir,
    runtime,
    calls,
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

test('pg_dump shell olmadan calisir; parola argv disinda kalir ve atomik manifest uretilir', async (t) => {
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

  const files = await readdir(fx.backupDir);
  assert.equal(files.some((name) => name.endsWith('.partial')), false);
  assert.equal(files.includes(manifest.fileName), true);
  assert.equal(files.includes(`${manifest.fileName}.manifest.json`), true);
  const payload = await readFile(path.join(fx.backupDir, manifest.fileName));
  assert.equal(manifest.sha256, createHash('sha256').update(payload).digest('hex'));
  assert.equal(manifest.sizeBytes, payload.length);

  const persisted = JSON.parse(
    await readFile(path.join(fx.backupDir, `${manifest.fileName}.manifest.json`), 'utf8'),
  );
  assert.deepEqual(persisted, manifest);
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
  assert.deepEqual(files, []);
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
    processTimeoutMs: 1_000,
    lockStaleMs: 2_000,
  }, { async run() {} });

  await assert.rejects(
    () => runtime.initialize(),
    (error) => error instanceof LocalBackupError && error.code === 'BACKUP_PATH_NOT_SEPARATE',
  );
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
  assert.deepEqual(files.sort(), [newest.fileName, `${newest.fileName}.manifest.json`].sort());
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
