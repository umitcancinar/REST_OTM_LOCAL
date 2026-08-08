BEGIN;

CREATE TYPE "MenuProjectionOutboxStatus" AS ENUM ('PENDING', 'LEASED', 'RETRY', 'ACKED', 'DEAD');

CREATE TABLE "menu_projection_sequences" (
  "tenantId" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "menu_projection_sequences_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "menu_projection_sequences_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "menu_projection_outbox" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "MenuProjectionOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 12,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" VARCHAR(96),
  "leaseToken" VARCHAR(64),
  "leaseExpiresAt" TIMESTAMP(3),
  "lastError" VARCHAR(1000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "acknowledgedAt" TIMESTAMP(3),
  CONSTRAINT "menu_projection_outbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "menu_projection_outbox_attempts_check" CHECK (
    "version" > 0 AND "attempts" >= 0 AND "maxAttempts" BETWEEN 1 AND 50
  )
);

CREATE UNIQUE INDEX "menu_projection_outbox_tenantId_version_key"
  ON "menu_projection_outbox"("tenantId", "version");
CREATE INDEX "menu_projection_outbox_status_nextAttemptAt_idx"
  ON "menu_projection_outbox"("status", "nextAttemptAt");
CREATE INDEX "menu_projection_outbox_status_leaseExpiresAt_idx"
  ON "menu_projection_outbox"("status", "leaseExpiresAt");
CREATE INDEX "menu_projection_outbox_tenantId_createdAt_idx"
  ON "menu_projection_outbox"("tenantId", "createdAt");

CREATE TABLE "menu_publications" (
  "tenantId" TEXT NOT NULL,
  "publicId" VARCHAR(64) NOT NULL,
  "slug" VARCHAR(128) NOT NULL,
  "customDomain" VARCHAR(253),
  "version" INTEGER NOT NULL,
  "sourceChecksum" CHAR(64) NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "payload" JSONB NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "menu_publications_pkey" PRIMARY KEY ("tenantId"),
  CONSTRAINT "menu_publications_version_check" CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "menu_publications_publicId_key" ON "menu_publications"("publicId");
CREATE UNIQUE INDEX "menu_publications_slug_key" ON "menu_publications"("slug");
CREATE UNIQUE INDEX "menu_publications_customDomain_key" ON "menu_publications"("customDomain");
CREATE INDEX "menu_publications_checksum_idx" ON "menu_publications"("checksum");

ALTER TABLE "menu_projection_sequences" ADD CONSTRAINT "menu_projection_sequences_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "menu_projection_outbox" ADD CONSTRAINT "menu_projection_outbox_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
