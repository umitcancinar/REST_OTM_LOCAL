const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const {
  ControlPlaneCloudBackupAdapter,
} = require('../dist/modules/local-backup/local-backup.cloud.js');

test('lokal adaptor B2 sirri tasimadan ciphertext yukler ve complete dogrulamasi ister', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'restotm-cloud-adapter-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const licenseDir = path.join(root, 'license');
  await mkdir(licenseDir);
  await writeFile(path.join(licenseDir, 'license.json'), JSON.stringify({
    payload: JSON.stringify({ licenseKey: 'REST-OTM-LOCAL-KEY' }),
    signature: 'not-read-by-this-transport',
  }));
  const cipher = Buffer.from('ENCRYPTED-CIPHERTEXT-ONLY');
  const cipherPath = path.join(root, 'backup.dump.enc');
  await writeFile(cipherPath, cipher);
  const id = '22222222-2222-4222-8222-222222222222';
  const manifest = {
    manifestVersion: 2,
    id,
    format: 'pg_dump-custom',
    reason: 'scheduled',
    createdAt: '2026-08-12T12:00:00.000Z',
    fileName: `restotm-20260812T120000000Z-${id}.dump.enc`,
    sizeBytes: cipher.length,
    plainSizeBytes: cipher.length,
    cipherSha256: createHash('sha256').update(cipher).digest('hex'),
    encryption: {
      algorithm: 'aes-256-gcm',
      keyId: 'test-key',
      ivBase64: Buffer.alloc(12).toString('base64'),
      authTagBase64: Buffer.alloc(16).toString('base64'),
    },
  };

  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) {
      const body = JSON.parse(init.body);
      assert.equal(body.licenseKey, 'REST-OTM-LOCAL-KEY');
      assert.equal(body.B2_APPLICATION_KEY, undefined);
      return {
        ok: true,
        async json() {
          return {
            success: true,
            data: {
              cipher: {
                key: `backups/t/l/h/${id}/${manifest.fileName}`,
                url: 'https://s3.us-east-005.backblazeb2.com/cipher?signed=1',
                headers: { 'content-type': 'application/octet-stream', 'content-length': String(cipher.length) },
              },
              manifest: {
                key: `backups/t/l/h/${id}/${manifest.fileName}.manifest.json`,
                url: 'https://s3.us-east-005.backblazeb2.com/manifest?signed=1',
                headers: { 'content-type': 'application/json', 'content-length': '1' },
              },
            },
          };
        },
      };
    }
    if (calls.length === 2) {
      const chunks = [];
      for await (const chunk of init.body) chunks.push(chunk);
      assert.deepEqual(Buffer.concat(chunks), cipher);
      return { ok: true, async json() { return null; } };
    }
    if (calls.length === 3) {
      assert.equal(Buffer.isBuffer(init.body), true);
      return { ok: true, async json() { return null; } };
    }
    return { ok: true, async json() { return { success: true }; } };
  };
  t.after(() => { global.fetch = originalFetch; });

  const adapter = new ControlPlaneCloudBackupAdapter({
    serverUrl: 'https://rest-otm-control-api.onrender.com',
    licenseDataDir: licenseDir,
  });
  await adapter.upload({ manifest, absolutePath: cipherPath });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url.endsWith('/api/license/backup/presign'), true);
  assert.equal(calls[3].url.endsWith('/api/license/backup/complete'), true);
});
