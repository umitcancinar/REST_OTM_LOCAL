const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrintJobLedger } = require('../dist/print-job-ledger.js');

function temporaryLedgerDir(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'rest-otm-print-ledger-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('completed print survives agent restart and ledger is private', (t) => {
  const directory = temporaryLedgerDir(t);
  const first = new PrintJobLedger(directory);
  first.markCompleted('job-1', new Date('2026-08-09T12:00:00.000Z'));

  const restarted = new PrintJobLedger(directory);
  assert.equal(restarted.has('job-1'), true);
  assert.deepEqual(
    JSON.parse(readFileSync(path.join(directory, 'completed-print-jobs.json'), 'utf8')),
    { 'job-1': '2026-08-09T12:00:00.000Z' },
  );
  if (process.platform !== 'win32') {
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(directory, 'completed-print-jobs.json')).mode & 0o777, 0o600);
  }
});

test('corrupt ledger fails closed instead of silently risking duplicate paper', (t) => {
  const directory = temporaryLedgerDir(t);
  const ledgerPath = path.join(directory, 'completed-print-jobs.json');
  writeFileSync(ledgerPath, '{ definitely-not-json', { mode: 0o600 });
  assert.throws(() => new PrintJobLedger(directory), /mükerrer baskı riski.*agent durduruldu/);
});

test('invalid ledger entry and relative storage path are rejected', (t) => {
  const directory = temporaryLedgerDir(t);
  writeFileSync(
    path.join(directory, 'completed-print-jobs.json'),
    JSON.stringify({ 'job-1': 'not-a-date' }),
    { mode: 0o600 },
  );
  chmodSync(directory, 0o700);
  assert.throws(() => new PrintJobLedger(directory), /mükerrer baskı riski.*agent durduruldu/);
  assert.throws(() => new PrintJobLedger('relative/ledger'), /mutlak bir yol/);
});
