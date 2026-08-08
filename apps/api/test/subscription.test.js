const test = require('node:test');
const assert = require('node:assert/strict');
const { addMonthsToExpiry } = require('../dist/utils/subscription.js');

const NOW = new Date('2026-08-06T12:00:00.000Z');

test('suresi hic ayarlanmamis tenant (null) icin bugunden baslar', () => {
  const result = addMonthsToExpiry(null, 1, NOW);
  assert.equal(result.getUTCFullYear(), 2026);
  assert.equal(result.getUTCMonth(), 8); // 0-indexli: Eylul
  assert.equal(result.getUTCDate(), 6);
});

test('suresi devam eden bir uyelik uzatilirsa MEVCUT bitis tarihinden eklenir', () => {
  // Halihazirda 20 gun sonrasi (bugunden ileride) icin bitis tarihi var.
  const current = new Date('2026-08-26T00:00:00.000Z');
  const result = addMonthsToExpiry(current, 1, NOW);
  // Bugunden degil, 26 Agustos'tan itibaren +1 ay -> 26 Eylul.
  assert.equal(result.getUTCMonth(), 8);
  assert.equal(result.getUTCDate(), 26);
});

test('suresi dolmus bir tenant icin bugunden baslar (gecmisten degil)', () => {
  const current = new Date('2026-01-01T00:00:00.000Z'); // cok once dolmus
  const result = addMonthsToExpiry(current, 1, NOW);
  // 1 Ocak'tan degil, bugunden (6 Agustos) itibaren +1 ay.
  assert.equal(result.getUTCFullYear(), 2026);
  assert.equal(result.getUTCMonth(), 8);
  assert.equal(result.getUTCDate(), 6);
});

test('negatif ay (azaltma) mevcut bitis tarihinden dogru cikarir', () => {
  const current = new Date('2026-08-26T00:00:00.000Z');
  const result = addMonthsToExpiry(current, -1, NOW);
  assert.equal(result.getUTCMonth(), 6); // Temmuz
  assert.equal(result.getUTCDate(), 26);
});

test('ust uste ekleme+azaltma birbirini geri alir', () => {
  const start = null;
  const extended = addMonthsToExpiry(start, 6, NOW);
  const reduced = addMonthsToExpiry(extended, -6, NOW);
  // Taban her ikisinde de "bugun" oldugu icin (extended, NOW'dan ileride
  // kaldigi surece) reduced == bugunun +0 ay hali olmali.
  assert.equal(reduced.getUTCFullYear(), NOW.getUTCFullYear());
  assert.equal(reduced.getUTCMonth(), NOW.getUTCMonth());
  assert.equal(reduced.getUTCDate(), NOW.getUTCDate());
});

test('12 ay (1 yil) ekleme yil atlar', () => {
  const result = addMonthsToExpiry(null, 12, NOW);
  assert.equal(result.getUTCFullYear(), 2027);
  assert.equal(result.getUTCMonth(), 7); // Agustos (0-indeksli)
});
