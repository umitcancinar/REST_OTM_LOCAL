import type { Prisma } from '@prisma/client';

type ProjectionHook = (tx: Prisma.TransactionClient, tenantId: string) => Promise<unknown>;
let localProjectionHook: ProjectionHook | undefined;

/** Local profile registers this hook; cloud profile never imports the worker graph. */
export function registerTenantPublicProjectionHook(hook: ProjectionHook | undefined): void {
  localProjectionHook = hook;
}

export async function runTenantPublicProjectionHook(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<void> {
  await localProjectionHook?.(tx, tenantId);
}
