BEGIN;

CREATE TYPE "PrintJobStatus" AS ENUM ('PENDING', 'LEASED', 'RETRY', 'PRINTED', 'DEAD');

CREATE TABLE "print_jobs" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "orderId" TEXT,
  "printerId" TEXT,
  "eventName" VARCHAR(64) NOT NULL,
  "eventKey" VARCHAR(96) NOT NULL,
  "idempotencyKey" VARCHAR(200) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "PrintJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" VARCHAR(96),
  "leaseToken" VARCHAR(64),
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "printedAt" TIMESTAMP(3),
  "deadAt" TIMESTAMP(3),
  "retainUntil" TIMESTAMP(3),
  "reprintOfId" TEXT,
  CONSTRAINT "print_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "print_jobs_attempts_check" CHECK ("attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 50)
);

CREATE TABLE "print_job_attempts" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "leaseOwner" VARCHAR(96) NOT NULL,
  "dispatchToken" VARCHAR(64) NOT NULL,
  "dispatchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMP(3),
  "success" BOOLEAN,
  "error" VARCHAR(1000),
  "ambiguousAckLoss" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "print_job_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "print_jobs_tenantId_idempotencyKey_key"
  ON "print_jobs"("tenantId", "idempotencyKey");
CREATE INDEX "print_jobs_status_nextAttemptAt_idx" ON "print_jobs"("status", "nextAttemptAt");
CREATE INDEX "print_jobs_status_leaseExpiresAt_idx" ON "print_jobs"("status", "leaseExpiresAt");
CREATE INDEX "print_jobs_tenantId_status_createdAt_idx" ON "print_jobs"("tenantId", "status", "createdAt");
CREATE INDEX "print_jobs_orderId_eventKey_idx" ON "print_jobs"("orderId", "eventKey");
CREATE INDEX "print_jobs_printerId_status_idx" ON "print_jobs"("printerId", "status");
CREATE INDEX "print_jobs_retainUntil_idx" ON "print_jobs"("retainUntil");
CREATE INDEX "print_jobs_reprintOfId_idx" ON "print_jobs"("reprintOfId");
CREATE UNIQUE INDEX "print_job_attempts_jobId_attemptNumber_key"
  ON "print_job_attempts"("jobId", "attemptNumber");
CREATE UNIQUE INDEX "print_job_attempts_jobId_dispatchToken_key"
  ON "print_job_attempts"("jobId", "dispatchToken");
CREATE INDEX "print_job_attempts_jobId_dispatchedAt_idx"
  ON "print_job_attempts"("jobId", "dispatchedAt");

ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_printerId_fkey"
  FOREIGN KEY ("printerId") REFERENCES "printer_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "print_jobs" ADD CONSTRAINT "print_jobs_reprintOfId_fkey"
  FOREIGN KEY ("reprintOfId") REFERENCES "print_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "print_job_attempts" ADD CONSTRAINT "print_job_attempts_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "print_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
