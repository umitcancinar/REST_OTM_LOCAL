const test = require('node:test');
const assert = require('node:assert/strict');
const { HeadObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { CloudBackupService } = require('../dist/modules/cloud-backup/cloud-backup.service.js');
const { cloudBackupPresignSchema } = require('../dist/modules/cloud-backup/cloud-backup.validation.js');

const descriptor = {
  licenseKey: 'REST-OTM-TEST-KEY',
  hardwareId: 'a'.repeat(64),
  backupId: '11111111-1111-4111-8111-111111111111',
  fileName: 'restotm-20260812T120000000Z-11111111-1111-4111-8111-111111111111.dump.enc',
  sizeBytes: 1234,
  cipherSha256: 'b'.repeat(64),
  manifestSizeBytes: 432,
  manifestSha256: 'c'.repeat(64),
};

test('descriptor dosya UUID bagini ve tek PUT boyut sinirini fail-closed dogrular', () => {
  assert.equal(cloudBackupPresignSchema.safeParse(descriptor).success, true);
  assert.equal(cloudBackupPresignSchema.safeParse({
    ...descriptor,
    backupId: '33333333-3333-4333-8333-333333333333',
  }).success, false);
  assert.equal(cloudBackupPresignSchema.safeParse({
    ...descriptor,
    sizeBytes: 5 * 1024 * 1024 * 1024 + 1,
  }).success, false);
});

test('presigned B2 yollarini tenant, lisans ve cihazla izole eder; ham lisansi yola yazmaz', async () => {
  const signed = [];
  const service = new CloudBackupService(
    { async send() { throw new Error('not called'); } },
    async (_client, command, options) => {
      assert.equal(command instanceof PutObjectCommand, true);
      assert.equal(options.expiresIn, 900);
      signed.push(command.input);
      return `https://s3.us-east-005.backblazeb2.com/signed-${signed.length}`;
    },
    async () => ({ id: 'license-1', tenantId: 'tenant-1' }),
  );

  const result = await service.presign(descriptor);
  assert.equal(signed.length, 2);
  for (const input of signed) {
    assert.match(input.Key, /^backups\/tenant-1\/license-1\/a{64}\//);
    assert.equal(input.Key.includes(descriptor.licenseKey), false);
    assert.equal(input.Metadata['backup-id'], descriptor.backupId);
    assert.equal(input.Metadata['hardware-id'], descriptor.hardwareId);
  }
  assert.equal(result.cipher.headers['content-length'], '1234');
  assert.deepEqual(Object.keys(result.cipher.headers).sort(), ['content-length', 'content-type']);
  assert.deepEqual(Object.keys(result.manifest.headers).sort(), ['content-length', 'content-type']);
});

test('complete B2 HEAD boyut ve hash metadata eslesmeden basarili saymaz', async () => {
  const responses = [
    {
      ContentLength: descriptor.sizeBytes,
      Metadata: { sha256: descriptor.cipherSha256, 'backup-id': descriptor.backupId, kind: 'ciphertext' },
    },
    {
      ContentLength: descriptor.manifestSizeBytes,
      Metadata: { sha256: descriptor.manifestSha256, 'backup-id': descriptor.backupId, kind: 'manifest' },
    },
  ];
  const service = new CloudBackupService(
    {
      async send(command) {
        assert.equal(command instanceof HeadObjectCommand, true);
        return responses.shift();
      },
    },
    async () => { throw new Error('not called'); },
    async () => ({ id: 'license-1', tenantId: 'tenant-1' }),
  );
  const result = await service.complete(descriptor);
  assert.equal(result.backupId, descriptor.backupId);

  const corrupt = new CloudBackupService(
    { async send() { return { ContentLength: 1, Metadata: {} }; } },
    async () => { throw new Error('not called'); },
    async () => ({ id: 'license-1', tenantId: 'tenant-1' }),
  );
  await assert.rejects(
    () => corrupt.complete(descriptor),
    (error) => error.statusCode === 409 && !error.message.includes(descriptor.licenseKey),
  );
});
