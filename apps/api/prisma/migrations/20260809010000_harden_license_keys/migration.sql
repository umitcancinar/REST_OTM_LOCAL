-- Expand phase for zero-plaintext license storage. PostgreSQL migrations cannot
-- safely read a process environment pepper, so existing rows are deliberately
-- retained for the explicit application backfill documented in
-- prisma/preflight/license-key-hash-backfill.md. New application writes use
-- keyHash/keyLast4 only.
BEGIN;

ALTER TABLE "licenses"
  ADD COLUMN "keyHash" CHAR(64),
  ADD COLUMN "keyPepperVersion" VARCHAR(32),
  ADD COLUMN "keyLast4" CHAR(4),
  ALTER COLUMN "key" DROP NOT NULL;

CREATE UNIQUE INDEX "licenses_keyHash_key" ON "licenses"("keyHash");

ALTER TABLE "licenses"
  ADD CONSTRAINT "licenses_key_material_check"
  CHECK (
    "key" IS NOT NULL OR (
      "keyHash" IS NOT NULL AND
      "keyPepperVersion" IS NOT NULL AND
      "keyLast4" IS NOT NULL
    )
  );

-- Product rule: one local-server seat per tenant. SUSPENDED keeps the seat;
-- only an explicit REVOKED transition frees it. Abort with an actionable count
-- instead of blindly failing while creating the partial unique index.
DO $$
DECLARE
  duplicate_tenants INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_tenants
  FROM (
    SELECT 1
    FROM "licenses"
    WHERE "status" <> 'REVOKED'
    GROUP BY "tenantId"
    HAVING COUNT(*) > 1
  ) conflicts;

  IF duplicate_tenants > 0 THEN
    RAISE EXCEPTION
      'Cannot enforce one local license seat per tenant: % tenants have multiple non-revoked licenses; run prisma/preflight/license-seat-conflicts.sql',
      duplicate_tenants;
  END IF;
END $$;

CREATE UNIQUE INDEX "licenses_one_non_revoked_per_tenant_key"
  ON "licenses"("tenantId")
  WHERE "status" <> 'REVOKED';

COMMIT;
