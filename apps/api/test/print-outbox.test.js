const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const {
  DEAD_RETENTION_DAYS,
  PHYSICAL_PRINT_GUARANTEE,
  PRINTED_RETENTION_DAYS,
  PRINT_FALLBACK_POLICY,
  isCurrentPrintLease,
  printRetryDelayMs,
  retentionUntil,
} = require('../dist/modules/printing/print-outbox.policy.js');

test('print retry is bounded exponential backoff with 25% jitter', () => {
  assert.equal(printRetryDelayMs(1, () => 0), 1_000);
  assert.equal(printRetryDelayMs(2, () => 0), 2_000);
  assert.equal(printRetryDelayMs(8, () => 0), 60_000);
  assert.equal(printRetryDelayMs(8, () => 0.999999), 74_999);
});

test('retention periods and physical delivery contract are explicit', () => {
  const now = new Date('2026-08-09T00:00:00.000Z');
  assert.equal(
    retentionUntil('PRINTED', now).getTime() - now.getTime(),
    PRINTED_RETENTION_DAYS * 86_400_000,
  );
  assert.equal(
    retentionUntil('DEAD', now).getTime() - now.getTime(),
    DEAD_RETENTION_DAYS * 86_400_000,
  );
  assert.equal(PRINT_FALLBACK_POLICY, 'ENQUEUE_TIME_EXPLICIT_ONLY');
  assert.match(PHYSICAL_PRINT_GUARANTEE, /PHYSICAL_EXACTLY_ONCE_NOT_GUARANTEED/);
});

test('only the active attempt and unpredictable lease token can acknowledge a job', () => {
  const job = { status: 'LEASED', attempts: 3, leaseToken: 'random-dispatch-token' };
  assert.equal(isCurrentPrintLease(job, 3, 'random-dispatch-token'), true);
  assert.equal(isCurrentPrintLease(job, 2, 'random-dispatch-token'), false);
  assert.equal(isCurrentPrintLease(job, 3, 'stale-dispatch-token'), false);
  assert.equal(isCurrentPrintLease({ ...job, status: 'RETRY' }, 3, 'random-dispatch-token'), false);
});

test('migration enforces idempotency, attempt audit and tenant deletion restriction', () => {
  const migration = readFileSync(
    path.resolve(__dirname, '../prisma/migrations/20260809020000_add_durable_print_outbox/migration.sql'),
    'utf8',
  );
  assert.match(migration, /CREATE UNIQUE INDEX "print_jobs_tenantId_idempotencyKey_key"/);
  assert.match(migration, /CREATE UNIQUE INDEX "print_job_attempts_jobId_dispatchToken_key"/);
  assert.match(migration, /FOREIGN KEY \("tenantId"\).*ON DELETE RESTRICT/);
  assert.match(migration, /"maxAttempts" BETWEEN 1 AND 50/);
});

test('runtime claims concurrently and exhausts each row against its own maximum', () => {
  const runtime = readFileSync(
    path.resolve(__dirname, '../src/modules/printing/print-outbox.runtime.ts'),
    'utf8',
  );
  assert.match(runtime, /FOR UPDATE SKIP LOCKED/);
  assert.match(runtime, /"attempts" >= "maxAttempts"/);
  assert.match(runtime, /dispatchToken, acknowledgedAt: null/);
  assert.match(runtime, /changed\.count !== 1/);
});
