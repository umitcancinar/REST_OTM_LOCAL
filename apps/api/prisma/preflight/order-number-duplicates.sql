-- Run before deploying 20260809003000_add_atomic_order_counters to preview
-- historical values that the migration will disambiguate. No rows are deleted:
-- the first order keeps its number and later duplicates are recorded in
-- order_number_migration_conflicts before being renamed.
SELECT
  "tenantId",
  "orderNumber",
  COUNT(*) AS duplicate_count,
  ARRAY_AGG("id" ORDER BY "createdAt", "id") AS order_ids
FROM "orders"
GROUP BY "tenantId", "orderNumber"
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, "tenantId", "orderNumber";
