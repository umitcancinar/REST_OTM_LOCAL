const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveItemPrintTrigger } = require('../dist/utils/print-triggers.js');

// ─── Gercek durum degisimi -> fis basilir ────────────────────────────────────

test('aktif bir urun iptal edilince iptal fisi basilir', () => {
  assert.equal(
    resolveItemPrintTrigger({ status: 'SERVED', isTreat: false }, 'CANCELLED', false),
    'CANCEL',
  );
});

test('normal bir urun ikram yapilinca ikram fisi basilir', () => {
  assert.equal(
    resolveItemPrintTrigger({ status: 'SERVED', isTreat: false }, 'SERVED', true),
    'TREAT',
  );
});

// ─── Tekrarlanan istek -> fis BASILMAZ (asil koruma) ─────────────────────────

test('zaten iptalli urune tekrar iptal gelirse fis basilmaz', () => {
  // Yavas yanit sirasinda butona ust uste basilmasi bu senaryoyu uretir;
  // korumasiz halde her tiklama ayri bir iptal fisi cikartiyordu.
  assert.equal(
    resolveItemPrintTrigger({ status: 'CANCELLED', isTreat: false }, 'CANCELLED', false),
    null,
  );
});

test('zaten ikram olan urune tekrar ikram gelirse fis basilmaz', () => {
  assert.equal(
    resolveItemPrintTrigger({ status: 'SERVED', isTreat: true }, 'SERVED', true),
    null,
  );
});

test('ust uste bes iptal istegi yalnizca BIR fis uretir', () => {
  let previous = { status: 'SERVED', isTreat: false };
  let printed = 0;
  for (let i = 0; i < 5; i += 1) {
    if (resolveItemPrintTrigger(previous, 'CANCELLED', false)) printed += 1;
    previous = { status: 'CANCELLED', isTreat: false }; // sunucudaki yeni hal
  }
  assert.equal(printed, 1);
});

// ─── Fis gerektirmeyen durumlar ──────────────────────────────────────────────

test('siradan durum guncellemesi fis bastirmaz', () => {
  assert.equal(
    resolveItemPrintTrigger({ status: 'PENDING', isTreat: false }, 'SERVED', false),
    null,
  );
});

test('ikrami geri alma fis bastirmaz', () => {
  assert.equal(
    resolveItemPrintTrigger({ status: 'SERVED', isTreat: true }, 'SERVED', false),
    null,
  );
});

test('iptal, ikram kontrolunden once gelir', () => {
  // Ikram bir urun iptal edilirse iptal fisi basilmali, ikram fisi degil.
  assert.equal(
    resolveItemPrintTrigger({ status: 'SERVED', isTreat: true }, 'CANCELLED', true),
    'CANCEL',
  );
});
