CREATE TABLE "superadmin_mfa_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "invalidatedAt" TIMESTAMP(3),
    "requestedIp" VARCHAR(64),
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "superadmin_mfa_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "superadmin_mfa_challenges_userId_createdAt_idx"
    ON "superadmin_mfa_challenges"("userId", "createdAt");
CREATE INDEX "superadmin_mfa_challenges_expiresAt_idx"
    ON "superadmin_mfa_challenges"("expiresAt");

-- Kullanici basina yalnizca tek etkin challenge. Prisma schema partial unique
-- index'i ifade edemedigi icin bu guvence migration'da tutulur.
CREATE UNIQUE INDEX "superadmin_mfa_one_active_per_user"
    ON "superadmin_mfa_challenges"("userId")
    WHERE "consumedAt" IS NULL AND "invalidatedAt" IS NULL;

ALTER TABLE "superadmin_mfa_challenges"
    ADD CONSTRAINT "superadmin_mfa_challenges_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
