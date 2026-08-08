const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IdempotencyConflictError,
  hashOrderCommand,
  parseOrderIdempotencyKey,
  resolveHttpOrderIdempotencyKey,
} = require('../dist/modules/orders/order-idempotency.policy.js');

test('canonical order hashes ignore object key order but preserve array order', () => {
  const first = { tableId: 'table-1', subChecks: [{ label: 'Genel', items: ['a', 'b'] }] };
  const same = { subChecks: [{ items: ['a', 'b'], label: 'Genel' }], tableId: 'table-1' };
  const changed = { tableId: 'table-1', subChecks: [{ label: 'Genel', items: ['b', 'a'] }] };

  assert.equal(hashOrderCommand(first), hashOrderCommand(same));
  assert.notEqual(hashOrderCommand(first), hashOrderCommand(changed));
  assert.match(hashOrderCommand(first), /^[a-f0-9]{64}$/);
});

test('idempotency keys use a bounded header-safe format', () => {
  assert.equal(parseOrderIdempotencyKey(' 01J4R3T4M8X7K2P9 '), '01J4R3T4M8X7K2P9');
  assert.equal(parseOrderIdempotencyKey(undefined), undefined);
  assert.throws(
    () => parseOrderIdempotencyKey('short'),
    (error) => error.statusCode === 400 && error.code === 'INVALID_IDEMPOTENCY_KEY',
  );
  assert.throws(() => parseOrderIdempotencyKey('bad key with spaces'));
  assert.throws(() => parseOrderIdempotencyKey('x'.repeat(129)));
});

test('HTTP header and body command IDs must agree', () => {
  assert.equal(
    resolveHttpOrderIdempotencyKey('order:device-1:42', 'order:device-1:42'),
    'order:device-1:42',
  );
  assert.equal(resolveHttpOrderIdempotencyKey(undefined, 'order:device-1:42'), 'order:device-1:42');
  assert.throws(
    () => resolveHttpOrderIdempotencyKey('order:device-1:42', 'order:device-1:43'),
    (error) => error.statusCode === 400 && error.code === 'IDEMPOTENCY_KEY_MISMATCH',
  );
});

test('payload reuse conflict is represented as HTTP 409', () => {
  const error = new IdempotencyConflictError();
  assert.equal(error.statusCode, 409);
  assert.equal(error.code, 'IDEMPOTENCY_KEY_REUSED');
});
