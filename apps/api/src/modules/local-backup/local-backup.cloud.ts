import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { computeHardwareId, readStoredLicense } from '@rest-otm/license';
import type {
  BackupCloudReplicaAdapter,
  BackupDownload,
  BackupManifestV2,
} from './local-backup.runtime';

const CONTROL_REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

interface UploadTarget {
  key: string;
  url: string;
  headers: Record<string, string>;
}

interface PresignResponse {
  success: boolean;
  message?: string;
  data?: { cipher: UploadTarget; manifest: UploadTarget };
}

export interface ControlPlaneCloudBackupConfig {
  serverUrl: string;
  licenseDataDir: string;
}

function storedLicenseKey(dataDir: string): string {
  const signed = readStoredLicense(dataDir);
  if (!signed) throw new Error('CLOUD_BACKUP_LICENSE_MISSING');
  try {
    const parsed = JSON.parse(signed.payload) as { licenseKey?: unknown };
    if (typeof parsed.licenseKey !== 'string' || parsed.licenseKey.length < 8) throw new Error();
    return parsed.licenseKey;
  } catch {
    throw new Error('CLOUD_BACKUP_LICENSE_INVALID');
  }
}

function validateUploadTarget(target: UploadTarget): void {
  const url = new URL(target.url);
  if (
    url.protocol !== 'https:'
    || url.username
    || url.password
    || !url.hostname.endsWith('.backblazeb2.com')
    || !target.key.startsWith('backups/')
  ) throw new Error('CLOUD_BACKUP_UPLOAD_TARGET_INVALID');
  for (const [name, value] of Object.entries(target.headers)) {
    if (!/^(content-type|content-length|x-amz-meta-[a-z0-9-]+)$/i.test(name) || /[\r\n]/.test(value)) {
      throw new Error('CLOUD_BACKUP_UPLOAD_HEADERS_INVALID');
    }
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: 'error' });
  } finally {
    clearTimeout(timer);
  }
}

export class ControlPlaneCloudBackupAdapter implements BackupCloudReplicaAdapter {
  private readonly serverUrl: string;

  constructor(private readonly config: ControlPlaneCloudBackupConfig) {
    const url = new URL(config.serverUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('CLOUD_BACKUP_SERVER_URL_INVALID');
    }
    this.serverUrl = url.href.replace(/\/$/, '');
  }

  async upload(download: BackupDownload): Promise<void> {
    if (download.manifest.manifestVersion !== 2) throw new Error('CLOUD_BACKUP_SOURCE_INVALID');
    const manifest = download.manifest as BackupManifestV2;
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const auth = {
      licenseKey: storedLicenseKey(this.config.licenseDataDir),
      hardwareId: computeHardwareId(),
    };
    const descriptor = {
      ...auth,
      backupId: manifest.id,
      fileName: manifest.fileName,
      sizeBytes: manifest.sizeBytes,
      cipherSha256: manifest.cipherSha256,
      manifestSizeBytes: manifestBytes.length,
      manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    };
    const presignResponse = await fetchWithTimeout(
      `${this.serverUrl}/api/license/backup/presign`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(descriptor),
      },
      CONTROL_REQUEST_TIMEOUT_MS,
    );
    const presign = await presignResponse.json().catch(() => null) as PresignResponse | null;
    if (!presignResponse.ok || !presign?.success || !presign.data) {
      throw new Error('CLOUD_BACKUP_PRESIGN_FAILED');
    }
    validateUploadTarget(presign.data.cipher);
    validateUploadTarget(presign.data.manifest);

    const cipherUpload = await fetchWithTimeout(
      presign.data.cipher.url,
      {
        method: 'PUT',
        headers: presign.data.cipher.headers,
        body: createReadStream(download.absolutePath) as unknown as RequestInit['body'],
        duplex: 'half',
      } as RequestInit & { duplex: 'half' },
      UPLOAD_TIMEOUT_MS,
    );
    if (!cipherUpload.ok) throw new Error('CLOUD_BACKUP_CIPHER_UPLOAD_FAILED');

    const manifestUpload = await fetchWithTimeout(
      presign.data.manifest.url,
      {
        method: 'PUT',
        headers: presign.data.manifest.headers,
        body: manifestBytes,
      },
      UPLOAD_TIMEOUT_MS,
    );
    if (!manifestUpload.ok) throw new Error('CLOUD_BACKUP_MANIFEST_UPLOAD_FAILED');

    const complete = await fetchWithTimeout(
      `${this.serverUrl}/api/license/backup/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(descriptor),
      },
      CONTROL_REQUEST_TIMEOUT_MS,
    );
    const completeBody = await complete.json().catch(() => null) as { success?: boolean } | null;
    if (!complete.ok || completeBody?.success !== true) {
      throw new Error('CLOUD_BACKUP_COMPLETE_FAILED');
    }
  }
}
