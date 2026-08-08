const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const {
  parsePrintJobId,
  parsePrintJobListQuery,
  reprintIdempotencyKey,
  resolveReprintCommandId,
  safePrintFailureCode,
} = require('../dist/modules/printing/print-outbox.policy.js');
const { rbac } = require('../dist/middlewares/rbac.middleware.js');

function source(relativePath) {
  return readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');
}

test('print job pagination, enum and identifiers are strict and bounded', () => {
  assert.deepEqual(parsePrintJobListQuery({}), { page: 1, limit: 25 });
  assert.deepEqual(
    parsePrintJobListQuery({ page: '2', limit: '100', status: 'DEAD' }),
    { page: 2, limit: 100, status: 'DEAD' },
  );
  for (const query of [
    { page: '0' },
    { page: '1.5' },
    { limit: '101' },
    { status: 'dead' },
    { status: ['DEAD'] },
    { cursor: 'hidden' },
  ]) {
    assert.throws(() => parsePrintJobListQuery(query), (error) => error.statusCode === 400);
  }
  assert.equal(parsePrintJobId('kitchen-job_123'), 'kitchen-job_123');
  assert.throws(() => parsePrintJobId('../tenant-b/job'));
  assert.throws(() => parsePrintJobId('bad id'));
  assert.throws(() => parsePrintJobId('x'.repeat(97)));
});

test('reprint command is required, header-safe and stable across response loss', () => {
  const command = 'device-01:reprint:000042';
  assert.equal(resolveReprintCommandId(command, {}), command);
  assert.equal(resolveReprintCommandId(undefined, { requestCommandId: command }), command);
  assert.equal(resolveReprintCommandId(command, { requestCommandId: command }), command);
  assert.equal(
    reprintIdempotencyKey('dead-job-1', command),
    reprintIdempotencyKey('dead-job-1', command),
  );
  assert.notEqual(
    reprintIdempotencyKey('dead-job-1', command),
    reprintIdempotencyKey('dead-job-1', 'device-01:reprint:000043'),
  );
  assert.throws(
    () => resolveReprintCommandId(undefined, {}),
    (error) => error.statusCode === 400 && error.code === 'REPRINT_COMMAND_ID_REQUIRED',
  );
  assert.throws(() => resolveReprintCommandId('bad key', {}));
  assert.throws(() => resolveReprintCommandId(command, { requestCommandId: `${command}-other` }));
  assert.throws(() => resolveReprintCommandId(command, { payload: {} }));
});

test('operational failures expose fixed codes rather than raw payload or PII text', () => {
  const sensitive = 'Müşteri Ayşe 0555 000 00 00 Example Mahallesi No 12';
  assert.equal(safePrintFailureCode(sensitive), 'PRINT_DELIVERY_FAILED');
  assert.equal(safePrintFailureCode(sensitive).includes('Ayşe'), false);
  assert.equal(safePrintFailureCode('Maximum print attempts exhausted'), 'MAX_ATTEMPTS_EXHAUSTED');
  assert.equal(safePrintFailureCode(null), null);

  const service = source('src/modules/printing/print.service.ts');
  const start = service.indexOf('async getOperationsSummary');
  const end = service.indexOf('async testPrinter', start);
  assert.ok(start > 0 && end > start);
  const operations = service.slice(start, end);
  for (const forbidden of [
    /\bpayload\s*:/,
    /\bcustomer\s*:/,
    /\bphone\s*:/,
    /\baddress\s*:/,
    /\bdispatchToken\s*:/,
    /\bleaseOwner\s*:/,
    /\bidempotencyKey\s*:/,
  ]) {
    assert.doesNotMatch(operations, forbidden);
  }
  assert.match(operations, /where: \{ id: jobId, tenantId \}/);
  assert.match(operations, /attemptsAudit:[\s\S]*ambiguousAckLoss: true/);
});

test('WAITer cannot access operations while ADMIN and OWNER can', () => {
  function invoke(role) {
    let nextCalled = false;
    let statusCode;
    const req = { user: { role, tenantId: 'tenant-a', userId: 'user-a' } };
    const res = {
      status(code) { statusCode = code; return this; },
      json() { return this; },
    };
    rbac('ADMIN', 'OWNER')(req, res, () => { nextCalled = true; });
    return { nextCalled, statusCode };
  }
  assert.deepEqual(invoke('WAITER'), { nextCalled: false, statusCode: 403 });
  assert.deepEqual(invoke('ADMIN'), { nextCalled: true, statusCode: undefined });
  assert.deepEqual(invoke('OWNER'), { nextCalled: true, statusCode: undefined });
});

test('routes are rate-limited and existing printer workflows remain registered', () => {
  const routes = source('src/modules/printing/print.routes.ts');
  assert.match(routes, /const operationsAccess = rbac\('ADMIN', 'OWNER'\)/);
  assert.match(routes, /max: 120/);
  assert.match(routes, /max: 10/);
  assert.match(routes, /router\.get\('\/jobs\/summary', operationsAccess, operationsReadLimiter/);
  assert.match(routes, /router\.get\('\/jobs\/:id', operationsAccess, operationsReadLimiter/);
  assert.match(routes, /router\.post\('\/jobs\/:id\/reprint', operationsAccess, reprintLimiter/);

  for (const legacyRoute of [
    "router.get('/', printController.getPrinters)",
    "router.get('/status', operationsAccess, operationsReadLimiter, printController.getStatus)",
    "router.post('/:id/test', minRole('ADMIN'), printController.testPrinter)",
    "router.post('/:id/calibrate', minRole('ADMIN'), printController.calibratePrinter)",
    "router.post('/print-kitchen', printController.printKitchen)",
    "router.post('/print-grill',   printController.printGrill)",
    "router.post('/print-stations', printController.printProductionStations)",
    "router.post('/print-paket',   printController.printPaket)",
    "router.post('/print-bill',    printController.printBill)",
    "router.post('/print-zreport', minRole('ADMIN'), printController.printZReport)",
  ]) {
    assert.equal(routes.includes(legacyRoute), true, `legacy route missing: ${legacyRoute}`);
  }

  const service = source('src/modules/printing/print.service.ts');
  assert.match(service, /agentConnected: sockets\.size > 0/);
  assert.match(service, /agentCount: sockets\.size/);
  assert.match(service, /checkedAt: new Date\(\)\.toISOString\(\)/);
  assert.match(service, /pending: counts\.PENDING/);
  assert.match(service, /retry: counts\.RETRY/);
  assert.match(service, /dead: counts\.DEAD/);
  assert.match(service, /ambiguous: ambiguousJobs/);
});

test('reprint service uses tenant-scoped unique command and creates an audit child', () => {
  const outbox = source('src/modules/printing/print-outbox.service.ts');
  assert.match(outbox, /tenantId_idempotencyKey: \{ tenantId, idempotencyKey \}/);
  assert.match(outbox, /findFirst\(\{ where: \{ id: jobId, tenantId \} \}\)/);
  assert.match(outbox, /reprintOfId: original\.id/);
  assert.match(outbox, /idempotencyKey,/);
  assert.doesNotMatch(outbox, /reprint:\$\{original\.id\}:\$\{randomUUID\(\)\}/);
});
