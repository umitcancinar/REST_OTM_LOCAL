/**
 * Order-number business-day policy.
 *
 * Until a validated tenant timezone is persisted in the API database, an
 * order business day is the UTC calendar day. Do not use the host's local
 * timezone here: cloud and on-premise processes must derive the same scope.
 */
export const ORDER_NUMBER_BUSINESS_TIME_ZONE = 'UTC' as const;

const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function resolveOrderBusinessDate(now: Date = new Date()): string {
  if (Number.isNaN(now.getTime())) throw new RangeError('Invalid order timestamp');
  return now.toISOString().slice(0, 10);
}

export function formatOrderNumber(businessDate: string, sequence: number): string {
  if (!UTC_DAY_PATTERN.test(businessDate)) {
    throw new RangeError('Order business date must use YYYY-MM-DD');
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new RangeError('Order sequence must be a positive safe integer');
  }

  return `ORD-${businessDate.replaceAll('-', '')}-${String(sequence).padStart(3, '0')}`;
}

export type IncrementOrderCounter = (
  tenantId: string,
  businessDate: string,
) => Promise<number>;

/** Keep date/format policy independently testable from the PostgreSQL store. */
export async function allocateOrderNumber(
  tenantId: string,
  incrementCounter: IncrementOrderCounter,
  now: Date = new Date(),
): Promise<string> {
  const businessDate = resolveOrderBusinessDate(now);
  const sequence = await incrementCounter(tenantId, businessDate);
  return formatOrderNumber(businessDate, sequence);
}
