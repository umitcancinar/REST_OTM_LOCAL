import { Prisma, type PrintJob } from '@prisma/client';
import prisma from '../../config/database';
import {
  PRINT_JOB_MAX_ATTEMPTS,
  reprintIdempotencyKey,
  retentionUntil,
} from './print-outbox.policy';

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface EnqueuePrintJobInput {
  id?: string;
  tenantId: string;
  orderId?: string;
  printerId?: string;
  eventName: string;
  eventKey: string;
  idempotencyKey: string;
  payload: Prisma.InputJsonValue;
  maxAttempts?: number;
  reprintOfId?: string;
  initialError?: string;
}

let kickRuntime: (() => void) | undefined;
let acknowledgeRuntime: ((
  tenantId: string,
  jobId: string,
  attemptNumber: number,
  dispatchToken: string,
  success: boolean,
  error?: string,
) => Promise<'PRINTED' | 'RETRY' | 'DEAD' | 'IGNORED' | 'NOT_FOUND'>) | undefined;

export function registerPrintOutboxKick(kick: (() => void) | undefined): void {
  kickRuntime = kick;
}

export function registerPrintOutboxAcknowledger(
  acknowledger: typeof acknowledgeRuntime,
): void {
  acknowledgeRuntime = acknowledger;
}

export async function acknowledgePrintJob(
  tenantId: string,
  jobId: string,
  attemptNumber: number,
  dispatchToken: string,
  success: boolean,
  error?: string,
) {
  if (!acknowledgeRuntime) return 'NOT_FOUND' as const;
  return acknowledgeRuntime(
    tenantId,
    jobId,
    attemptNumber,
    dispatchToken,
    success,
    error,
  );
}

export function kickPrintOutbox(): void {
  kickRuntime?.();
}

export async function enqueuePrintJob(
  input: EnqueuePrintJobInput,
  client: DbClient = prisma,
): Promise<PrintJob> {
  const job = await client.printJob.upsert({
    where: {
      tenantId_idempotencyKey: {
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
      },
    },
    update: {},
    create: {
      id: input.id,
      tenantId: input.tenantId,
      orderId: input.orderId,
      printerId: input.printerId,
      eventName: input.eventName,
      eventKey: input.eventKey,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      maxAttempts: input.maxAttempts ?? PRINT_JOB_MAX_ATTEMPTS,
      ...(input.initialError
        ? {
            status: 'DEAD' as const,
            deadAt: new Date(),
            retainUntil: retentionUntil('DEAD'),
            lastError: input.initialError.slice(0, 1000),
          }
        : {}),
    },
  });
  kickRuntime?.();
  return job;
}

/**
 * Reprint is a new auditable job, never a mutation back to PENDING. The
 * caller-supplied command id is part of the tenant unique key, so an HTTP
 * response loss can be retried without creating another physical print job.
 */
export async function reprintDeadJob(
  tenantId: string,
  jobId: string,
  requestCommandId: string,
): Promise<PrintJob> {
  const idempotencyKey = reprintIdempotencyKey(jobId, requestCommandId);
  const existingCommand = await prisma.printJob.findUnique({
    where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
  });
  if (existingCommand) {
    if (existingCommand.reprintOfId !== jobId) {
      throw Object.assign(new Error('Reprint command id başka bir işe bağlı'), { statusCode: 409 });
    }
    return existingCommand;
  }

  const original = await prisma.printJob.findFirst({ where: { id: jobId, tenantId } });
  if (!original) throw Object.assign(new Error('Print job bulunamadı'), { statusCode: 404 });
  if (original.status !== 'DEAD' && original.status !== 'PRINTED') {
    throw Object.assign(new Error('Yalnız tamamlanmış veya dead-letter iş yeniden basılabilir'), {
      statusCode: 409,
    });
  }

  return enqueuePrintJob({
    tenantId,
    orderId: original.orderId ?? undefined,
    printerId: original.printerId ?? undefined,
    eventName: original.eventName,
    eventKey: `${original.eventKey.slice(0, 88)}:REPRINT`,
    idempotencyKey,
    payload: original.payload as Prisma.InputJsonValue,
    maxAttempts: original.maxAttempts,
    reprintOfId: original.id,
  });
}
