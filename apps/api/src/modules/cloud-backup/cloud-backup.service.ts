import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { cloudEnv } from '../../config/env.cloud';
import { licenseService } from '../license/license.service';
import type { CloudBackupCompleteBody, CloudBackupPresignBody } from './cloud-backup.validation';

const PRESIGN_TTL_SECONDS = 15 * 60;

interface StorageClient {
  send(command: HeadObjectCommand): Promise<HeadObjectCommandOutput>;
}

type Signer = (client: StorageClient, command: PutObjectCommand, options: { expiresIn: number }) => Promise<string>;
type Authorize = (input: { licenseKey: string; hardwareId: string }) => Promise<{ id: string; tenantId: string }>;

function objectKeys(input: CloudBackupPresignBody, license: { tenantId: string; id: string }) {
  const root = [
    cloudEnv.B2_KEY_PREFIX.replace(/\/$/, ''),
    license.tenantId,
    license.id,
    input.hardwareId,
    input.backupId,
  ].join('/');
  return {
    cipherKey: `${root}/${input.fileName}`,
    manifestKey: `${root}/${input.fileName}.manifest.json`,
  };
}

function uploadHeaders(contentType: string, length: number) {
  return {
    'content-type': contentType,
    'content-length': String(length),
  };
}

export class CloudBackupService {
  private readonly client: StorageClient;

  constructor(
    client?: StorageClient,
    private readonly signer: Signer = getSignedUrl as Signer,
    private readonly authorize: Authorize = licenseService.authorizeCloudBackup,
  ) {
    this.client = client ?? new S3Client({
      endpoint: cloudEnv.B2_S3_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com',
      region: cloudEnv.B2_REGION || 'us-east-005',
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: cloudEnv.B2_KEY_ID || 'development-not-used',
        secretAccessKey: cloudEnv.B2_APPLICATION_KEY || 'development-not-used',
      },
    });
  }

  async presign(input: CloudBackupPresignBody) {
    const license = await this.authorize(input);
    const keys = objectKeys(input, license);
    const commonMetadata = {
      'backup-id': input.backupId,
      'tenant-id': license.tenantId,
      'license-id': license.id,
      'hardware-id': input.hardwareId,
    };
    const cipherMetadata = { ...commonMetadata, sha256: input.cipherSha256, kind: 'ciphertext' };
    const manifestMetadata = { ...commonMetadata, sha256: input.manifestSha256, kind: 'manifest' };
    const cipherCommand = new PutObjectCommand({
      Bucket: cloudEnv.B2_BUCKET_NAME,
      Key: keys.cipherKey,
      ContentType: 'application/octet-stream',
      ContentLength: input.sizeBytes,
      Metadata: cipherMetadata,
    });
    const manifestCommand = new PutObjectCommand({
      Bucket: cloudEnv.B2_BUCKET_NAME,
      Key: keys.manifestKey,
      ContentType: 'application/json',
      ContentLength: input.manifestSizeBytes,
      Metadata: manifestMetadata,
    });
    const [cipherUrl, manifestUrl] = await Promise.all([
      this.signer(this.client, cipherCommand, { expiresIn: PRESIGN_TTL_SECONDS }),
      this.signer(this.client, manifestCommand, { expiresIn: PRESIGN_TTL_SECONDS }),
    ]);
    return {
      expiresInSeconds: PRESIGN_TTL_SECONDS,
      cipher: {
        key: keys.cipherKey,
        url: cipherUrl,
        // AWS presigner x-amz-meta-* alanlarini imzali query'ye tasir. Ayni
        // alanlari tekrar header olarak gondermek B2'de duplicate imza riski
        // yaratir; istemci yalniz body turu ve kesin boyutu yollar.
        headers: uploadHeaders('application/octet-stream', input.sizeBytes),
      },
      manifest: {
        key: keys.manifestKey,
        url: manifestUrl,
        headers: uploadHeaders('application/json', input.manifestSizeBytes),
      },
    };
  }

  async complete(input: CloudBackupCompleteBody) {
    const license = await this.authorize(input);
    const keys = objectKeys(input, license);
    const [cipher, manifest] = await Promise.all([
      this.client.send(new HeadObjectCommand({ Bucket: cloudEnv.B2_BUCKET_NAME, Key: keys.cipherKey })),
      this.client.send(new HeadObjectCommand({ Bucket: cloudEnv.B2_BUCKET_NAME, Key: keys.manifestKey })),
    ]);
    this.assertObject(cipher, input.sizeBytes, input.cipherSha256, input.backupId, 'ciphertext');
    this.assertObject(manifest, input.manifestSizeBytes, input.manifestSha256, input.backupId, 'manifest');
    return {
      backupId: input.backupId,
      bucketId: cloudEnv.B2_BUCKET_ID,
      cipherKey: keys.cipherKey,
      manifestKey: keys.manifestKey,
      verifiedAt: new Date().toISOString(),
    };
  }

  private assertObject(
    object: HeadObjectCommandOutput,
    expectedLength: number,
    expectedSha256: string,
    backupId: string,
    kind: string,
  ): void {
    if (
      object.ContentLength !== expectedLength
      || object.Metadata?.sha256 !== expectedSha256
      || object.Metadata?.['backup-id'] !== backupId
      || object.Metadata?.kind !== kind
    ) {
      throw Object.assign(new Error('Bulut yedeği bütünlük doğrulamasından geçemedi.'), { statusCode: 409 });
    }
  }
}

export const cloudBackupService = new CloudBackupService();
