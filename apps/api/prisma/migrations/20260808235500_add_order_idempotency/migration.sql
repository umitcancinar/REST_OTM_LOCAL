-- Existing orders remain valid: idempotency receipts are only created for new
-- commands that provide an Idempotency-Key/clientCommandId.
CREATE TABLE "order_commands" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "orderId" TEXT,
    "createdItemIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_commands_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "order_commands_tenantId_idempotencyKey_key"
ON "order_commands"("tenantId", "idempotencyKey");

CREATE INDEX "order_commands_orderId_idx" ON "order_commands"("orderId");
CREATE INDEX "order_commands_tenantId_createdAt_idx" ON "order_commands"("tenantId", "createdAt");

ALTER TABLE "order_commands"
ADD CONSTRAINT "order_commands_tenantId_fkey"
FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "order_commands"
ADD CONSTRAINT "order_commands_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
