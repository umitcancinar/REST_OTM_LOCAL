-- CreateEnum
CREATE TYPE "LicenseAuditAction" AS ENUM (
  'CREATED',
  'UPDATED',
  'EXTENDED',
  'SUSPENDED',
  'RESUMED',
  'REVOKED',
  'ACTIVATION_RESET',
  'REBOUND'
);

-- CreateTable
CREATE TABLE "license_audit_logs" (
  "id" TEXT NOT NULL,
  "licenseId" TEXT NOT NULL,
  "operatorId" TEXT NOT NULL,
  "action" "LicenseAuditAction" NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "license_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "license_audit_logs_licenseId_timestamp_idx"
  ON "license_audit_logs"("licenseId", "timestamp");

-- CreateIndex
CREATE INDEX "license_audit_logs_operatorId_timestamp_idx"
  ON "license_audit_logs"("operatorId", "timestamp");

-- AddForeignKey
ALTER TABLE "license_audit_logs"
  ADD CONSTRAINT "license_audit_logs_licenseId_fkey"
  FOREIGN KEY ("licenseId") REFERENCES "licenses"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Audit olaylari uygulama DB kullanicisi tarafindan degistirilemez/silinemez.
-- PostgreSQL owner acil durumda trigger'i yonetebilir; normal control-plane
-- akisi append-only kalir.
CREATE FUNCTION "prevent_license_audit_mutation"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'license_audit_logs is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "license_audit_logs_append_only"
BEFORE UPDATE OR DELETE ON "license_audit_logs"
FOR EACH ROW EXECUTE FUNCTION "prevent_license_audit_mutation"();
