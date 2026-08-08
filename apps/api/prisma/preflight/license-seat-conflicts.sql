-- Must return zero rows before 20260809010000_harden_license_keys is deployed.
-- Resolve deliberately by revoking obsolete seats through the audited admin
-- lifecycle; never delete licenses or audit history.
SELECT
  "tenantId",
  COUNT(*) AS occupied_seats,
  ARRAY_AGG("id" ORDER BY "createdAt", "id") AS license_ids,
  ARRAY_AGG("status" ORDER BY "createdAt", "id") AS statuses
FROM "licenses"
WHERE "status" <> 'REVOKED'
GROUP BY "tenantId"
HAVING COUNT(*) > 1
ORDER BY occupied_seats DESC, "tenantId";
