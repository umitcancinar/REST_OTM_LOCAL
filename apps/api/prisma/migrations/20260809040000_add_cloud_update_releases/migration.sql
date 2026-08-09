-- Cloud-only signed update release registry. Artifact bytes remain on an
-- allowlisted HTTPS object origin; this database stores immutable metadata and
-- the exact canonical JSON envelope signed by the cloud control plane.

CREATE TYPE "UpdateReleaseStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'REVOKED');
CREATE TYPE "UpdateReleaseAuditAction" AS ENUM ('CREATED', 'PUBLISHED', 'REVOKED');

CREATE TABLE "update_releases" (
    "id" TEXT NOT NULL,
    "version" VARCHAR(128) NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "minCurrentVersion" VARCHAR(128) NOT NULL,
    "maxCurrentVersion" VARCHAR(128) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "migration" JSONB NOT NULL,
    "status" "UpdateReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "manifestPayload" TEXT,
    "signature" VARCHAR(128),
    "manifestSha256" CHAR(64),
    "createdBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "update_releases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "update_releases_signed_state_check" CHECK (
      ("status" = 'DRAFT' AND "manifestPayload" IS NULL AND "signature" IS NULL
        AND "manifestSha256" IS NULL AND "publishedAt" IS NULL AND "revokedAt" IS NULL)
      OR
      ("status" = 'PUBLISHED' AND "manifestPayload" IS NOT NULL AND "signature" IS NOT NULL
        AND "manifestSha256" ~ '^[0-9a-f]{64}$' AND "publishedAt" IS NOT NULL
        AND "revokedAt" IS NULL)
      OR
      ("status" = 'REVOKED' AND "manifestPayload" IS NOT NULL AND "signature" IS NOT NULL
        AND "manifestSha256" ~ '^[0-9a-f]{64}$' AND "publishedAt" IS NOT NULL
        AND "revokedAt" IS NOT NULL)
    )
);

CREATE TABLE "update_release_artifacts" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "fileName" VARCHAR(128) NOT NULL,
    "platform" VARCHAR(32) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "sourceUrl" VARCHAR(2048) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "update_release_artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "update_release_artifact_position_check" CHECK ("position" >= 0),
    CONSTRAINT "update_release_artifact_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "update_release_artifact_size_check" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 4294967296)
);

CREATE TABLE "update_release_audit_logs" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "action" "UpdateReleaseAuditAction" NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "update_release_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "update_releases_channel_version_key" ON "update_releases"("channel", "version");
CREATE INDEX "update_releases_channel_status_issuedAt_idx" ON "update_releases"("channel", "status", "issuedAt");
CREATE INDEX "update_releases_status_expiresAt_idx" ON "update_releases"("status", "expiresAt");
CREATE UNIQUE INDEX "update_release_artifacts_releaseId_position_key" ON "update_release_artifacts"("releaseId", "position");
CREATE UNIQUE INDEX "update_release_artifacts_releaseId_fileName_key" ON "update_release_artifacts"("releaseId", "fileName");
CREATE INDEX "update_release_artifacts_releaseId_idx" ON "update_release_artifacts"("releaseId");
CREATE INDEX "update_release_audit_logs_releaseId_timestamp_idx" ON "update_release_audit_logs"("releaseId", "timestamp");
CREATE INDEX "update_release_audit_logs_operatorId_timestamp_idx" ON "update_release_audit_logs"("operatorId", "timestamp");

ALTER TABLE "update_release_artifacts" ADD CONSTRAINT "update_release_artifacts_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "update_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "update_release_audit_logs" ADD CONSTRAINT "update_release_audit_logs_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "update_releases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION rest_otm_reject_update_release_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'update releases are append-only';
  END IF;

  IF OLD."version" IS DISTINCT FROM NEW."version"
    OR OLD."channel" IS DISTINCT FROM NEW."channel"
    OR OLD."minCurrentVersion" IS DISTINCT FROM NEW."minCurrentVersion"
    OR OLD."maxCurrentVersion" IS DISTINCT FROM NEW."maxCurrentVersion"
    OR OLD."issuedAt" IS DISTINCT FROM NEW."issuedAt"
    OR OLD."expiresAt" IS DISTINCT FROM NEW."expiresAt"
    OR OLD."migration" IS DISTINCT FROM NEW."migration"
    OR OLD."createdBy" IS DISTINCT FROM NEW."createdBy"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'update release identity and policy are immutable';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'PUBLISHED' THEN
    IF NEW."manifestPayload" IS NULL OR NEW."signature" IS NULL
      OR NEW."manifestSha256" IS NULL OR NEW."publishedAt" IS NULL THEN
      RAISE EXCEPTION 'published release requires a complete signed envelope';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD."status" = 'PUBLISHED' AND NEW."status" = 'REVOKED' THEN
    IF OLD."manifestPayload" IS DISTINCT FROM NEW."manifestPayload"
      OR OLD."signature" IS DISTINCT FROM NEW."signature"
      OR OLD."manifestSha256" IS DISTINCT FROM NEW."manifestSha256"
      OR OLD."publishedAt" IS DISTINCT FROM NEW."publishedAt"
      OR NEW."revokedAt" IS NULL THEN
      RAISE EXCEPTION 'revocation cannot alter the signed envelope';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid update release state transition';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "update_releases_append_only"
BEFORE UPDATE OR DELETE ON "update_releases"
FOR EACH ROW EXECUTE FUNCTION rest_otm_reject_update_release_mutation();

CREATE OR REPLACE FUNCTION rest_otm_protect_update_artifact()
RETURNS TRIGGER AS $$
DECLARE release_status "UpdateReleaseStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'update artifact metadata is immutable';
  END IF;
  SELECT "status" INTO release_status FROM "update_releases" WHERE "id" = NEW."releaseId" FOR UPDATE;
  IF release_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'artifacts can only be attached while release is created';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "update_release_artifacts_immutable"
BEFORE INSERT OR UPDATE OR DELETE ON "update_release_artifacts"
FOR EACH ROW EXECUTE FUNCTION rest_otm_protect_update_artifact();

CREATE OR REPLACE FUNCTION rest_otm_reject_update_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'update release audit log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "update_release_audit_append_only"
BEFORE UPDATE OR DELETE ON "update_release_audit_logs"
FOR EACH ROW EXECUTE FUNCTION rest_otm_reject_update_audit_mutation();
