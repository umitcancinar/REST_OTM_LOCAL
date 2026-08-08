import { createHash } from 'crypto';
import { z } from 'zod';

/**
 * Idempotency keys are opaque client-generated command identifiers. Keeping the
 * alphabet deliberately small makes them safe in HTTP headers, logs and unique
 * database indexes while still supporting UUID/ULID-style identifiers.
 */
export const orderIdempotencyKeySchema = z
  .string()
  .trim()
  .min(8, 'Idempotency key must contain at least 8 characters')
  .max(128, 'Idempotency key must not exceed 128 characters')
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/,
    'Idempotency key contains unsupported characters',
  );

export class IdempotencyConflictError extends Error {
  readonly statusCode = 409;
  readonly code = 'IDEMPOTENCY_KEY_REUSED';

  constructor() {
    super('Idempotency key was already used with a different order payload');
    this.name = 'IdempotencyConflictError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Stable SHA-256 digest: object key order is ignored, array order is retained. */
export function hashOrderCommand(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex');
}

export function parseOrderIdempotencyKey(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = orderIdempotencyKeySchema.safeParse(value);
  if (!parsed.success) {
    throw Object.assign(new Error(parsed.error.issues[0]?.message || 'Invalid idempotency key'), {
      statusCode: 400,
      code: 'INVALID_IDEMPOTENCY_KEY',
    });
  }
  return parsed.data;
}

export function resolveHttpOrderIdempotencyKey(
  headerValue: unknown,
  bodyValue: unknown,
): string | undefined {
  const headerKey = parseOrderIdempotencyKey(headerValue);
  const bodyKey = parseOrderIdempotencyKey(bodyValue);
  if (headerKey && bodyKey && headerKey !== bodyKey) {
    throw Object.assign(
      new Error('Idempotency-Key header and clientCommandId body field must match'),
      { statusCode: 400, code: 'IDEMPOTENCY_KEY_MISMATCH' },
    );
  }
  return headerKey ?? bodyKey;
}
