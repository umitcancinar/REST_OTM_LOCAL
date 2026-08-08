const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ORDER_NUMBER_BUSINESS_TIME_ZONE,
  allocateOrderNumber,
  formatOrderNumber,
  resolveOrderBusinessDate,
} = require('../dist/modules/orders/order-number.policy.js');

test('order business days are explicitly UTC and change only at UTC midnight', () => {
  assert.equal(ORDER_NUMBER_BUSINESS_TIME_ZONE, 'UTC');
  assert.equal(resolveOrderBusinessDate(new Date('2026-08-09T23:59:59.999Z')), '2026-08-09');
  assert.equal(resolveOrderBusinessDate(new Date('2026-08-10T00:00:00.000Z')), '2026-08-10');
});

test('daily sequences produce tenant-safe date-qualified display numbers', () => {
  assert.equal(formatOrderNumber('2026-08-09', 1), 'ORD-20260809-001');
  assert.equal(formatOrderNumber('2026-08-09', 1007), 'ORD-20260809-1007');
  assert.notEqual(formatOrderNumber('2026-08-09', 1), formatOrderNumber('2026-08-10', 1));
  assert.throws(() => formatOrderNumber('09-08-2026', 1));
  assert.throws(() => formatOrderNumber('2026-08-09', 0));
});

test('concurrent allocations use every atomic counter result exactly once', async () => {
  const counters = new Map();
  const atomicIncrement = async (tenantId, businessDate) => {
    // Yield first so every allocation is in flight before this in-memory stand-in
    // returns the same sequence values PostgreSQL RETURNING would return.
    await new Promise((resolve) => setImmediate(resolve));
    const scope = `${tenantId}:${businessDate}`;
    const next = (counters.get(scope) || 0) + 1;
    counters.set(scope, next);
    return next;
  };
  const now = new Date('2026-08-09T12:00:00.000Z');

  const numbers = await Promise.all(
    Array.from({ length: 50 }, () => allocateOrderNumber('tenant-1', atomicIncrement, now)),
  );

  assert.equal(new Set(numbers).size, 50);
  assert.deepEqual(
    [...numbers].sort(),
    Array.from({ length: 50 }, (_, index) => `ORD-20260809-${String(index + 1).padStart(3, '0')}`),
  );
});

test('counter migration uses an atomic increment and DB uniqueness defence', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '../prisma/migrations/20260809003000_add_atomic_order_counters/migration.sql',
    ),
    'utf8',
  );
  const service = fs.readFileSync(
    path.join(__dirname, '../src/modules/orders/order.service.ts'),
    'utf8',
  );

  assert.match(service, /ON CONFLICT \("tenantId", "businessDate"\)/);
  assert.match(service, /"order_counters"\."value" \+ 1/);
  assert.match(migration, /CREATE UNIQUE INDEX "orders_tenantId_orderNumber_key"/);
  assert.match(migration, /order_number_migration_conflicts/);
});
