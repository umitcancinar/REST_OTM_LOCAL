-- Order business dates use the UTC calendar day. Prisma DateTime values are
-- stored as UTC wall-clock timestamps in this schema, so createdAt::date is the
-- matching historical scope. New numbers include YYYYMMDD to remain globally
-- unique within a tenant even though the sequence restarts each UTC day.
BEGIN;

CREATE TABLE "order_counters" (
    "tenantId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("tenantId", "businessDate")
);

ALTER TABLE "order_counters"
ADD CONSTRAINT "order_counters_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed each scope before accepting writes. COUNT protects legacy ORD-NNN data;
-- the parsed maximum protects databases that already contain the new format.
INSERT INTO "order_counters" ("tenantId", "businessDate", "value", "updatedAt")
SELECT
    "tenantId",
    "createdAt"::date,
    GREATEST(
        COUNT(*)::integer,
        COALESCE(MAX(
            CASE
                WHEN "orderNumber" ~ '^ORD-[0-9]{8}-[0-9]{1,9}$'
                 AND SUBSTRING("orderNumber" FROM 5 FOR 8) = TO_CHAR("createdAt"::date, 'YYYYMMDD')
                THEN SUBSTRING("orderNumber" FROM 14)::integer
                ELSE 0
            END
        ), 0)
    ),
    CURRENT_TIMESTAMP
FROM "orders"
GROUP BY "tenantId", "createdAt"::date
ON CONFLICT ("tenantId", "businessDate") DO UPDATE
SET "value" = GREATEST("order_counters"."value", EXCLUDED."value"),
    "updatedAt" = CURRENT_TIMESTAMP;

-- Controlled legacy repair: keep the earliest occurrence unchanged, preserve a
-- durable old/new report, and rename only later duplicates. This avoids a blind
-- CREATE UNIQUE INDEX failure while retaining every order and its primary key.
CREATE TABLE "order_number_migration_conflicts" (
    "orderId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "oldOrderNumber" TEXT NOT NULL,
    "newOrderNumber" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_number_migration_conflicts_pkey" PRIMARY KEY ("orderId")
);

WITH ranked_orders AS (
    SELECT
        "id",
        "tenantId",
        "orderNumber",
        ROW_NUMBER() OVER (
            PARTITION BY "tenantId", "orderNumber"
            ORDER BY "createdAt", "id"
        ) AS duplicate_rank
    FROM "orders"
)
INSERT INTO "order_number_migration_conflicts" (
    "orderId", "tenantId", "oldOrderNumber", "newOrderNumber"
)
SELECT
    "id",
    "tenantId",
    "orderNumber",
    'LEGACY-DUPLICATE-' || "id"
FROM ranked_orders
WHERE duplicate_rank > 1;

UPDATE "orders" AS orders
SET "orderNumber" = conflicts."newOrderNumber"
FROM "order_number_migration_conflicts" AS conflicts
WHERE orders."id" = conflicts."orderId";

-- Defensive preflight after controlled repair. If hand-written historical data
-- collides with a generated LEGACY-DUPLICATE value, fail with a useful message
-- before attempting the unique index.
DO $$
DECLARE
    remaining_duplicate_groups INTEGER;
BEGIN
    SELECT COUNT(*) INTO remaining_duplicate_groups
    FROM (
        SELECT 1
        FROM "orders"
        GROUP BY "tenantId", "orderNumber"
        HAVING COUNT(*) > 1
    ) duplicates;

    IF remaining_duplicate_groups > 0 THEN
        RAISE EXCEPTION
            'Cannot enforce orders tenant/orderNumber uniqueness: % duplicate groups remain; run prisma/preflight/order-number-duplicates.sql',
            remaining_duplicate_groups;
    END IF;
END $$;

CREATE UNIQUE INDEX "orders_tenantId_orderNumber_key"
ON "orders"("tenantId", "orderNumber");

COMMIT;
