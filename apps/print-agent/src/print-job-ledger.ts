import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'fs';
import { isAbsolute, join } from 'path';

const LEDGER_FILE = 'completed-print-jobs.json';
const MAX_ENTRIES = 20_000;
const RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Durable agent-side dedupe closes the common "printed, ACK lost, retry" gap.
 * It cannot close a process/power failure between the physical printer write
 * and markCompleted; no software protocol can make that device boundary
 * exactly-once without printer-supported transaction IDs.
 */
export class PrintJobLedger {
  private readonly directoryPath: string;
  private readonly filePath: string;
  private readonly completed = new Map<string, string>();

  constructor(dataDir: string) {
    if (!isAbsolute(dataDir)) {
      throw new Error('PRINT_AGENT_DATA_DIR mutlak bir yol olmalıdır');
    }
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    chmodSync(dataDir, 0o700);
    this.directoryPath = dataDir;
    this.filePath = join(dataDir, LEDGER_FILE);
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Ledger kökü JSON object olmalıdır');
      }
      for (const [jobId, printedAt] of Object.entries(parsed)) {
        if (!jobId || typeof printedAt !== 'string' || !Number.isFinite(Date.parse(printedAt))) {
          throw new Error(`Geçersiz ledger kaydı: ${jobId || '<empty>'}`);
        }
        this.completed.set(jobId, printedAt);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(
          `Print dedupe ledger okunamadı; mükerrer baskı riski nedeniyle agent durduruldu: ${this.filePath}`,
          { cause: error },
        );
      }
    }
    this.prune();
  }

  has(jobId: string): boolean {
    return this.completed.has(jobId);
  }

  markCompleted(jobId: string, now = new Date()): void {
    this.completed.set(jobId, now.toISOString());
    this.prune(now);
    const temporary = `${this.filePath}.next`;
    let fileDescriptor: number | undefined;
    try {
      fileDescriptor = openSync(
        temporary,
        constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY,
        0o600,
      );
      writeFileSync(fileDescriptor, JSON.stringify(Object.fromEntries(this.completed)), 'utf8');
      fsyncSync(fileDescriptor);
    } finally {
      if (fileDescriptor !== undefined) closeSync(fileDescriptor);
    }
    chmodSync(temporary, 0o600);
    renameSync(temporary, this.filePath);
    chmodSync(this.filePath, 0o600);

    // POSIX'te rename'in kendisini de kalıcılaştır. Bazı platform/filesystem
    // kombinasyonlarında directory fsync desteklenmez; dosya fsync'i yine zorunlu.
    let directoryDescriptor: number | undefined;
    try {
      directoryDescriptor = openSync(this.directoryPath, constants.O_RDONLY);
      fsyncSync(directoryDescriptor);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes(code || '')) throw error;
    } finally {
      if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
    }
  }

  private prune(now = new Date()): void {
    const cutoff = now.getTime() - RETENTION_MS;
    for (const [jobId, printedAt] of this.completed) {
      if (new Date(printedAt).getTime() < cutoff) this.completed.delete(jobId);
    }
    while (this.completed.size > MAX_ENTRIES) {
      const oldest = this.completed.keys().next().value as string | undefined;
      if (!oldest) break;
      this.completed.delete(oldest);
    }
  }
}
