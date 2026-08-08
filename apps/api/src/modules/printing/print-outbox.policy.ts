export const PRINT_JOB_MAX_ATTEMPTS = 8;
export const PRINT_JOB_LEASE_MS = 15_000;
export const PRINT_JOB_POLL_MS = 1_000;
export const PRINTED_RETENTION_DAYS = 90;
export const DEAD_RETENTION_DAYS = 365;

export const PRINT_JOB_OPERATION_STATUSES = [
  'PENDING',
  'LEASED',
  'RETRY',
  'PRINTED',
  'DEAD',
] as const;

export type PrintJobOperationStatus = typeof PRINT_JOB_OPERATION_STATUSES[number];

export interface PrintJobListQuery {
  page: number;
  limit: number;
  status?: PrintJobOperationStatus;
}

function operationInputError(code: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode: 400, code });
}

function singleText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw operationInputError('INVALID_PRINT_OPERATION_INPUT', `${field} tek bir string olmalı`);
  }
  return value;
}

function positiveInteger(
  value: unknown,
  field: string,
  fallback: number,
  maximum: number,
): number {
  if (value === undefined) return fallback;
  const text = singleText(value, field)!;
  if (!/^[1-9]\d*$/.test(text)) {
    throw operationInputError('INVALID_PRINT_OPERATION_INPUT', `${field} pozitif tam sayı olmalı`);
  }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw operationInputError('INVALID_PRINT_OPERATION_INPUT', `${field} en fazla ${maximum} olabilir`);
  }
  return parsed;
}

export function parsePrintJobListQuery(value: unknown): PrintJobListQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw operationInputError('INVALID_PRINT_OPERATION_INPUT', 'Query object olmalı');
  }
  const query = value as Record<string, unknown>;
  const unknown = Object.keys(query).filter((key) => !['page', 'limit', 'status'].includes(key));
  if (unknown.length > 0) {
    throw operationInputError('INVALID_PRINT_OPERATION_INPUT', `Bilinmeyen query alanı: ${unknown[0]}`);
  }
  const statusText = singleText(query.status, 'status');
  if (
    statusText !== undefined
    && !PRINT_JOB_OPERATION_STATUSES.includes(statusText as PrintJobOperationStatus)
  ) {
    throw operationInputError('INVALID_PRINT_JOB_STATUS', 'Geçersiz print job status');
  }
  return {
    page: positiveInteger(query.page, 'page', 1, 100_000),
    limit: positiveInteger(query.limit, 'limit', 25, 100),
    ...(statusText ? { status: statusText as PrintJobOperationStatus } : {}),
  };
}

export function parsePrintJobId(value: unknown): string {
  const id = singleText(value, 'id');
  if (!id || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id)) {
    throw operationInputError('INVALID_PRINT_JOB_ID', 'Geçersiz print job id');
  }
  return id;
}

function parseCommandId(value: unknown): string | undefined {
  const commandId = singleText(value, 'requestCommandId');
  if (commandId === undefined) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/.test(commandId)) {
    throw operationInputError(
      'INVALID_REPRINT_COMMAND_ID',
      'request command id 8-64 karakter ve header-safe olmalı',
    );
  }
  return commandId;
}

export function resolveReprintCommandId(headerValue: unknown, bodyValue: unknown): string {
  if (bodyValue !== undefined && (
    !bodyValue
    || typeof bodyValue !== 'object'
    || Array.isArray(bodyValue)
  )) {
    throw operationInputError('INVALID_PRINT_OPERATION_INPUT', 'Reprint body object olmalı');
  }
  const body = (bodyValue ?? {}) as Record<string, unknown>;
  const unknown = Object.keys(body).filter((key) => key !== 'requestCommandId');
  if (unknown.length > 0) {
    throw operationInputError('INVALID_PRINT_OPERATION_INPUT', `Bilinmeyen body alanı: ${unknown[0]}`);
  }
  const header = parseCommandId(headerValue);
  const bodyCommand = parseCommandId(body.requestCommandId);
  if (header && bodyCommand && header !== bodyCommand) {
    throw operationInputError(
      'REPRINT_COMMAND_ID_MISMATCH',
      'Idempotency-Key ve requestCommandId aynı olmalı',
    );
  }
  const commandId = header ?? bodyCommand;
  if (!commandId) {
    throw operationInputError(
      'REPRINT_COMMAND_ID_REQUIRED',
      'Idempotency-Key header veya requestCommandId zorunludur',
    );
  }
  return commandId;
}

export function reprintIdempotencyKey(jobId: string, requestCommandId: string): string {
  return `reprint:${jobId}:${requestCommandId}`;
}

export function safePrintFailureCode(lastError: string | null | undefined): string | null {
  if (!lastError) return null;
  if (/maximum print attempts/i.test(lastError)) return 'MAX_ATTEMPTS_EXHAUSTED';
  if (/printer config changed|became inactive/i.test(lastError)) return 'PRINTER_CONFIGURATION_CHANGED';
  if (/lease expired|ack/i.test(lastError)) return 'AMBIGUOUS_AGENT_ACK';
  return 'PRINT_DELIVERY_FAILED';
}

/**
 * Retry is bounded and jittered to avoid every tenant/agent reconnecting in a
 * synchronized burst. random must return [0, 1) and is injectable for tests.
 */
export function printRetryDelayMs(attempt: number, random = Math.random): number {
  const exponent = Math.max(0, Math.min(10, attempt - 1));
  const base = Math.min(60_000, 1_000 * 2 ** exponent);
  const jitter = Math.floor(base * 0.25 * Math.max(0, Math.min(0.999999, random())));
  return base + jitter;
}

export function retentionUntil(status: 'PRINTED' | 'DEAD', now = new Date()): Date {
  const days = status === 'PRINTED' ? PRINTED_RETENTION_DAYS : DEAD_RETENTION_DAYS;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

export function isCurrentPrintLease(
  job: { status: string; attempts: number; leaseToken: string | null },
  attemptNumber: number,
  dispatchToken: string,
): boolean {
  return job.status === 'LEASED'
    && job.attempts === attemptNumber
    && job.leaseToken === dispatchToken;
}

/**
 * No retry-time printer fallback is allowed. The chosen printer/address is part
 * of the immutable snapshot and must still match an active DB config. A config
 * change requires an audited reprint, preventing customer/order data from being
 * sent to a guessed or stale LAN endpoint.
 */
export const PRINT_FALLBACK_POLICY = 'ENQUEUE_TIME_EXPLICIT_ONLY' as const;

export const PHYSICAL_PRINT_GUARANTEE =
  'AT_LEAST_ONCE_DELIVERY_WITH_AGENT_DEDUP;_PHYSICAL_EXACTLY_ONCE_NOT_GUARANTEED' as const;
