import { randomUUID } from 'crypto';
import { Prisma, type PrintJob } from '@prisma/client';
import prisma from '../../config/database';
import { logger } from '../../utils/logger';
import {
  PHYSICAL_PRINT_GUARANTEE,
  PRINT_JOB_LEASE_MS,
  PRINT_JOB_POLL_MS,
  isCurrentPrintLease,
  printRetryDelayMs,
  retentionUntil,
} from './print-outbox.policy';
import {
  registerPrintOutboxAcknowledger,
  registerPrintOutboxKick,
} from './print-outbox.service';

type ClaimedPrintJob = PrintJob & { recoveredLease: boolean; leaseToken: string };

export interface PrintOutboxRuntimeOptions {
  emit(tenantId: string, eventName: string, payload: Record<string, unknown>): void;
  assertOperationalLicense?: () => void;
  workerId?: string;
  now?: () => Date;
  random?: () => number;
}

export class PrintOutboxRuntime {
  private readonly workerId: string;
  private readonly now: () => Date;
  private readonly random: () => number;
  private timer?: NodeJS.Timeout;
  private ticking = false;

  constructor(private readonly options: PrintOutboxRuntimeOptions) {
    this.workerId = options.workerId ?? `print-outbox-${randomUUID()}`;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
  }

  start(): void {
    if (this.timer) return;
    logger.info(`Print outbox baslatildi (${PHYSICAL_PRINT_GUARANTEE})`);
    registerPrintOutboxKick(() => this.kick());
    registerPrintOutboxAcknowledger((...args) => this.acknowledge(...args));
    this.timer = setInterval(() => this.kick(), PRINT_JOB_POLL_MS);
    this.timer.unref?.();
    this.kick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    registerPrintOutboxKick(undefined);
    registerPrintOutboxAcknowledger(undefined);
  }

  kick(): void {
    if (this.ticking) return;
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      this.options.assertOperationalLicense?.();
      await this.markExhaustedDead();
      for (let index = 0; index < 10; index += 1) {
        const job = await this.claimNext();
        if (!job) break;
        await this.dispatch(job);
      }
      await prisma.printJob.deleteMany({
        where: {
          status: { in: ['PRINTED', 'DEAD'] },
          retainUntil: { lte: this.now() },
        },
      });
    } catch (error) {
      // A locked local license pauses delivery without consuming attempts.
      logger.warn(`Print outbox tick ertelendi: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  private async claimNext(): Promise<ClaimedPrintJob | null> {
    const now = this.now();
    const leaseExpiresAt = new Date(now.getTime() + PRINT_JOB_LEASE_MS);
    const leaseToken = randomUUID();
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<ClaimedPrintJob[]>(Prisma.sql`
        WITH candidate AS (
          SELECT "id", ("status" = 'LEASED') AS "recoveredLease"
          FROM "print_jobs"
          WHERE "attempts" < "maxAttempts"
            AND (
              ("status" IN ('PENDING', 'RETRY') AND "nextAttemptAt" <= ${now})
              OR ("status" = 'LEASED' AND "leaseExpiresAt" <= ${now})
            )
          ORDER BY "nextAttemptAt", "createdAt"
          FOR UPDATE SKIP LOCKED
          LIMIT 1
        )
        UPDATE "print_jobs" AS job
        SET "status" = 'LEASED',
            "attempts" = job."attempts" + 1,
            "leaseOwner" = ${this.workerId},
            "leaseToken" = ${leaseToken},
            "leaseExpiresAt" = ${leaseExpiresAt},
            "updatedAt" = ${now}
        FROM candidate
        WHERE job."id" = candidate."id"
        RETURNING job.*, candidate."recoveredLease"
      `);
      const job = rows[0];
      if (!job) return null;

      if (job.recoveredLease && job.attempts > 1) {
        await tx.printJobAttempt.updateMany({
          where: { jobId: job.id, attemptNumber: job.attempts - 1, acknowledgedAt: null },
          data: { ambiguousAckLoss: true, error: 'Lease expired without ACK; physical result unknown' },
        });
      }
      await tx.printJobAttempt.create({
        data: {
          jobId: job.id,
          attemptNumber: job.attempts,
          leaseOwner: this.workerId,
          dispatchToken: job.leaseToken,
          dispatchedAt: now,
        },
      });
      return job;
    });
  }

  private async dispatch(job: ClaimedPrintJob): Promise<void> {
    const payload = job.payload as Record<string, unknown>;
    if (job.printerId) {
      const printer = await prisma.printerConfig.findFirst({
        where: { id: job.printerId, tenantId: job.tenantId, isActive: true },
        select: { ipAddress: true, port: true },
      });
      const snapshotIp = payload.ipAddress;
      const snapshotPort = payload.port;
      if (
        !printer ||
        printer.ipAddress !== snapshotIp ||
        (printer.port || 9100) !== snapshotPort
      ) {
        await this.deadLetter(job, 'Printer config changed or became inactive; audited reprint required');
        return;
      }
    }

    this.options.emit(job.tenantId, job.eventName, {
      ...payload,
      jobId: job.id,
      attemptNumber: job.attempts,
      dispatchToken: job.leaseToken,
    });
  }

  async acknowledge(
    tenantId: string,
    jobId: string,
    attemptNumber: number,
    dispatchToken: string,
    success: boolean,
    error?: string,
  ): Promise<'PRINTED' | 'RETRY' | 'DEAD' | 'IGNORED' | 'NOT_FOUND'> {
    const now = this.now();
    const safeError = error?.slice(0, 1000) || 'Print agent reported failure';
    const outcome = await prisma.$transaction(async (tx) => {
      const job = await tx.printJob.findFirst({ where: { id: jobId, tenantId } });
      if (!job) return 'NOT_FOUND' as const;
      if (job.status === 'PRINTED') return 'PRINTED' as const;

      const isCurrentLease = isCurrentPrintLease(job, attemptNumber, dispatchToken);
      if (!isCurrentLease) {
        await tx.printJobAttempt.updateMany({
          where: { jobId, attemptNumber, dispatchToken, acknowledgedAt: null },
          data: {
            acknowledgedAt: now,
            success,
            error: success ? 'Stale success ACK; current lease left unchanged' : safeError,
            ambiguousAckLoss: true,
          },
        });
        return 'IGNORED' as const;
      }

      const currentLeaseWhere = {
        id: jobId,
        tenantId,
        status: 'LEASED' as const,
        attempts: attemptNumber,
        leaseToken: dispatchToken,
      };
      let nextStatus: 'PRINTED' | 'RETRY' | 'DEAD';
      let changed: { count: number };
      if (success) {
        nextStatus = 'PRINTED';
        changed = await tx.printJob.updateMany({
          where: currentLeaseWhere,
          data: {
            status: 'PRINTED',
            printedAt: now,
            retainUntil: retentionUntil('PRINTED', now),
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: null,
          },
        });
      } else if (job.attempts >= job.maxAttempts) {
        nextStatus = 'DEAD';
        changed = await tx.printJob.updateMany({
          where: currentLeaseWhere,
          data: {
            status: 'DEAD',
            deadAt: now,
            retainUntil: retentionUntil('DEAD', now),
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: safeError,
          },
        });
      } else {
        nextStatus = 'RETRY';
        changed = await tx.printJob.updateMany({
          where: currentLeaseWhere,
          data: {
            status: 'RETRY',
            nextAttemptAt: new Date(now.getTime() + printRetryDelayMs(job.attempts, this.random)),
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: safeError,
          },
        });
      }

      if (changed.count !== 1) {
        await tx.printJobAttempt.updateMany({
          where: { jobId, attemptNumber, dispatchToken, acknowledgedAt: null },
          data: {
            acknowledgedAt: now,
            success,
            error: 'ACK lost lease race; current state left unchanged',
            ambiguousAckLoss: true,
          },
        });
        return 'IGNORED' as const;
      }
      await tx.printJobAttempt.updateMany({
        where: { jobId, attemptNumber, dispatchToken, acknowledgedAt: null },
        data: { acknowledgedAt: now, success, error: success ? null : safeError },
      });
      return nextStatus;
    });
    if (outcome === 'RETRY') this.kick();
    return outcome;
  }

  private async deadLetter(job: Pick<PrintJob, 'id' | 'attempts'>, error: string): Promise<void> {
    const now = this.now();
    await prisma.printJob.update({
      where: { id: job.id },
      data: {
        status: 'DEAD',
        deadAt: now,
        retainUntil: retentionUntil('DEAD', now),
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: error.slice(0, 1000),
      },
    });
    await prisma.printJobAttempt.updateMany({
      where: { jobId: job.id, attemptNumber: job.attempts, acknowledgedAt: null },
      data: { acknowledgedAt: now, success: false, error: error.slice(0, 1000) },
    });
  }

  private async markExhaustedDead(): Promise<void> {
    const now = this.now();
    const retainUntil = retentionUntil('DEAD', now);
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "print_jobs"
      SET "status" = 'DEAD',
          "deadAt" = ${now},
          "retainUntil" = ${retainUntil},
          "leaseOwner" = NULL,
          "leaseToken" = NULL,
          "leaseExpiresAt" = NULL,
          "lastError" = 'Maximum print attempts exhausted',
          "updatedAt" = ${now}
      WHERE "status" IN ('PENDING', 'RETRY', 'LEASED')
        AND "attempts" >= "maxAttempts"
    `);
  }
}
