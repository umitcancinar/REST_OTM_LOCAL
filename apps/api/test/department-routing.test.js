const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePreparationDepartment } = require('../dist/utils/department-routing.js');

// ─── Basic routing ───────────────────────────────────────────────────────────

test('legacy KITCHEN items in grill categories route to GRILL', () => {
  assert.equal(resolvePreparationDepartment('KITCHEN', 'Izgara Çeşitleri'), 'GRILL');
  assert.equal(resolvePreparationDepartment('KITCHEN', 'Ocakbaşı'), 'GRILL');
  assert.equal(resolvePreparationDepartment('KITCHEN', 'IZGARA / MANGAL'), 'GRILL');
  assert.equal(resolvePreparationDepartment('KITCHEN', 'Mangal Köşesi'), 'GRILL');
});

test('legacy KITCHEN drinks route to BAR and stay off production tickets', () => {
  assert.equal(resolvePreparationDepartment('KITCHEN', 'İçecekler'), 'BAR');
  assert.equal(resolvePreparationDepartment('KITCHEN', 'Meşrubatlar'), 'BAR');
  assert.equal(resolvePreparationDepartment('KITCHEN', 'içecekler'), 'BAR');   // lowercase
  assert.equal(resolvePreparationDepartment('KITCHEN', 'IÇECEKLER'), 'BAR');  // all-caps Turkish İ
  assert.equal(resolvePreparationDepartment('KITCHEN', 'Soğuk İçecek'), 'BAR');
  assert.equal(resolvePreparationDepartment('KITCHEN', 'Çay & Kahve'), 'BAR');
});

test('explicit station choices remain authoritative', () => {
  // Stored GRILL → always GRILL regardless of category
  assert.equal(resolvePreparationDepartment('GRILL', 'Taş Fırın Ürünleri'), 'GRILL');
  assert.equal(resolvePreparationDepartment('GRILL', 'İçecekler'), 'GRILL');
  // Stored BAR → always BAR regardless of category
  assert.equal(resolvePreparationDepartment('BAR', 'Izgara Çeşitleri'), 'BAR');
  // Stored KITCHEN + non-grill category → stays KITCHEN
  assert.equal(resolvePreparationDepartment('KITCHEN', 'Taş Fırın Ürünleri'), 'KITCHEN');
  // Null/undefined stored dept → defaults to KITCHEN
  assert.equal(resolvePreparationDepartment(null, 'Taş Fırın Ürünleri'), 'KITCHEN');
  assert.equal(resolvePreparationDepartment(undefined, 'Taş Fırın Ürünleri'), 'KITCHEN');
});

test('a mixed oven, grill and beverage order is partitioned exactly once', () => {
  const routed = [
    ['KITCHEN', 'Taş Fırın Ürünleri'],
    ['KITCHEN', 'Izgara Çeşitleri'],
    ['KITCHEN', 'İçecekler'],
  ].map(([department, category]) => resolvePreparationDepartment(department, category));

  assert.deepEqual(routed, ['KITCHEN', 'GRILL', 'BAR']);
  assert.deepEqual(routed.filter((d) => d !== 'BAR'), ['KITCHEN', 'GRILL']);
});

// ─── Turkish character edge cases ─────────────────────────────────────────────

test('Turkish uppercase İ in category name maps to BAR', () => {
  // "İçecekler" — İ is U+0130 (dotted capital I), not standard ASCII
  assert.equal(resolvePreparationDepartment('KITCHEN', 'İçecekler'), 'BAR');
});

test('Turkish uppercase I without dot treated as i (no false positive)', () => {
  // Plain ASCII "I" without a dot — should NOT accidentally match içecek pattern
  // unless the word genuinely contains an içecek keyword
  assert.equal(resolvePreparationDepartment('KITCHEN', 'Tatlılar'), 'KITCHEN');
});

test('Izgara with capital I (İzgara) maps to GRILL', () => {
  // İzgara — starts with dotted İ (U+0130)
  assert.equal(resolvePreparationDepartment('KITCHEN', 'İzgara Çeşitleri'), 'GRILL');
});

test('COLD and PASTRY stored departments pass through unchanged', () => {
  assert.equal(resolvePreparationDepartment('COLD',   'Soğuk Mezeler'), 'COLD');
  assert.equal(resolvePreparationDepartment('PASTRY', 'Unlu Mamüller'), 'PASTRY');
});

test('no categoryName returns stored department without error', () => {
  assert.equal(resolvePreparationDepartment('KITCHEN', null),      'KITCHEN');
  assert.equal(resolvePreparationDepartment('KITCHEN', undefined),  'KITCHEN');
  assert.equal(resolvePreparationDepartment('KITCHEN', ''),         'KITCHEN');
});
