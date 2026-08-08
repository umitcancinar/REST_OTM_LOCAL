const test = require('node:test');
const assert = require('node:assert/strict');
const { escpos, logoWidthToPixels, turkishToCP857 } = require('../dist/printer/escpos.js');

function asBinaryText(buffer) {
  return buffer.toString('latin1');
}

function feedCommandBytes(dots) {
  const bytes = [];
  let remaining = dots;
  while (remaining > 0) {
    const chunk = Math.min(255, remaining);
    bytes.push(0x1b, 0x4a, chunk);
    remaining -= chunk;
  }
  return bytes;
}

function assertEndsWithFlushedCut(buffer, cutMode, feedDots = 180) {
  const suffix = [...feedCommandBytes(feedDots), 0x1d, 0x56, cutMode];
  assert.deepEqual([...buffer.subarray(-suffix.length)], suffix);
  const cutOffset = buffer.length - suffix.length;
  const finalLineFeed = buffer.lastIndexOf(0x0a, cutOffset - 1);
  assert.notEqual(finalLineFeed, -1, 'the footer line must be finalized before cutting');
  const trailingCommands = buffer.subarray(finalLineFeed + 1, cutOffset);
  assert.equal(trailingCommands.includes(Buffer.from([0x1b, 0x64])), false, 'no line-feed command is allowed before cutting');
  assert.equal(trailingCommands.includes(Buffer.from([0x1b, 0x4a])), false, 'no dot-feed command is allowed before cutting');
}

test('CP857 encoder preserves ESC/POS control bytes and Turkish glyph mapping', () => {
  const encoded = turkishToCP857('\x1B@ÇÜÖŞİĞçüöşığ');
  assert.equal(encoded[0], 0x1b);
  assert.equal(encoded[1], 0x40);
  assert.deepEqual(
    [...encoded.subarray(2)],
    [0x80, 0x9a, 0x99, 0x9e, 0x98, 0xa6, 0x87, 0x81, 0x94, 0x9f, 0x8d, 0xa7],
  );
  assert.equal(turkishToCP857('\xB4')[0], 0xB4);
});

test('printer initialization selects TP850 NATIVE CP857 table 102', () => {
  assert.deepEqual([...Buffer.from(escpos.init(), 'latin1')], [0x1b, 0x40, 0x1b, 0x74, 0x66]);
});

test('logo width uses physical millimeters and respects the printable head', () => {
  assert.equal(logoWidthToPixels(25, 80), 200);
  assert.equal(logoWidthToPixels(50, 80), 400);
  assert.equal(logoWidthToPixels(80, 80), 576);
  assert.equal(logoWidthToPixels(50, 58), 384);
});

test('bill honors hidden prices, paper layout and inline table metadata', async () => {
  const output = await escpos.bill({
    restaurantName: 'REST_OTM',
    orderNumber: 'TEST-001',
    tableNumber: 12,
    waiterName: 'Murat',
    items: [{ name: 'Adana Kebap', quantity: 2, price: 900 }],
    total: 900,
    timestamp: new Date('2026-07-25T08:44:00.000Z'),
    layout: {
      paperWidth: 58,
      receiptTitle: 'ÖZEL ADİSYON',
      hidePrices: true,
      boldItems: true,
      inlineDateMasa: true,
      footerText: 'YİNE BEKLERİZ',
    },
  });

  const text = asBinaryText(output);
  assert.match(text, /TEST-001/);
  assert.match(text, /MASA: 12/);
  assert.doesNotMatch(text, /900\.00/);
  assert.doesNotMatch(text, /TOPLAM/);
});

test('takeaway bill prints customer information and visible total', async () => {
  const output = await escpos.bill({
    restaurantName: 'REST_OTM',
    orderNumber: 'PKT-001',
    tableNumber: 0,
    waiterName: 'Murat',
    customer: { name: 'Ali Veli', phone: '0555 000 00 00', address: 'Örnek Mahallesi No: 12' },
    items: [{ name: 'Ayran', quantity: 1, price: 60 }],
    total: 60,
    timestamp: new Date('2026-07-25T08:44:00.000Z'),
    layout: { paperWidth: 80, receiptTitle: 'PAKET SİPARİŞ', footerText: 'AFİYET OLSUN' },
  });

  const text = asBinaryText(output);
  assert.match(text, /Ali Veli/);
  assert.match(text, /0555 000 00 00/);
  assert.match(text, /TOPLAM\s+60\.00 TL/);
  assert.ok(text.indexOf('Ali Veli') < text.indexOf('Tarih'), 'customer block must match the preview order');
});

test('kitchen layout supports double-size items without price leakage', async () => {
  const output = await escpos.kitchenTicket({
    orderNumber: 'M-001',
    tableNumber: 7,
    waiterName: 'Ayşe',
    department: 'KITCHEN',
    items: [{ menuItemName: 'Adana Kebap', quantity: 2, price: 450, portionOption: 'Normal', notes: 'Az pişmiş' }],
    timestamp: new Date('2026-07-25T08:44:00.000Z'),
    layout: {
      paperWidth: 80,
      receiptTitle: 'FIRIN FİŞİ',
      hidePrices: true,
      boldItems: true,
      doubleSizeItems: true,
    },
  });

  const text = asBinaryText(output);
  assert.match(text, /2x ADANA KEBAP/);
  assert.match(text, /!! NOT: Az pi/);
  assert.doesNotMatch(text, /900\.00/);
});

test('station ticket shows item prices and total when the preview enables them', async () => {
  const output = await escpos.kitchenTicket({
    orderNumber: 'PRICE-001',
    tableNumber: 7,
    waiterName: 'Ayşe',
    department: 'KITCHEN',
    items: [
      { menuItemName: 'Adana Kebap', quantity: 2, price: 450, portionOption: 'Normal' },
      { menuItemName: 'Ayran', quantity: 1, price: 60, portionOption: 'Normal' },
    ],
    timestamp: new Date('2026-07-25T08:44:00.000Z'),
    layout: { paperWidth: 80, hidePrices: false, footerText: 'AFİYET OLSUN' },
  });

  const text = asBinaryText(output);
  assert.match(text, /900\.00 TL/);
  assert.match(text, /60\.00 TL/);
  assert.match(text, /TOPLAM\s+960\.00 TL/);
  assert.ok(text.indexOf('TOPLAM') < text.indexOf('AF'));
});

test('layout hides restaurant name, enlarges table number and adds exact top feed', async () => {
  const output = await escpos.bill({
    restaurantName: 'GİZLENECEK İŞLETME',
    orderNumber: 'LAYOUT-001',
    tableNumber: 18,
    waiterName: 'Murat',
    items: [{ name: 'Lahmacun', quantity: 1, price: 120 }],
    total: 120,
    timestamp: new Date('2026-07-25T08:44:00.000Z'),
    layout: {
      hideHeader: true,
      doubleSizeTable: true,
      topMarginMm: 10,
    },
  });

  const text = asBinaryText(output);
  const expectedDots = Math.round((10 / 25.4) * 203);
  assert.equal(output.includes(Buffer.from([0x1b, 0x4a, expectedDots])), true);
  assert.doesNotMatch(text, /G.ZLENECEK .LETME/);
  assert.equal(output.includes(Buffer.from([0x1d, 0x21, 0x11])), true);
  assert.match(text, /Masa  : 18/);
});

test('an empty saved header never falls back to the restaurant name', async () => {
  const output = await escpos.bill({
    restaurantName: 'FİZİKSEL ÇIKTIDA OLMAMALI',
    orderNumber: 'NO-BRAND-001',
    tableNumber: 4,
    waiterName: 'Murat',
    items: [{ name: 'Ayran', quantity: 1, price: 60 }],
    total: 60,
    timestamp: new Date('2026-07-25T08:44:00.000Z'),
    layout: { headerText: '', hideHeader: false },
  });

  assert.doesNotMatch(asBinaryText(output), /F.Z.KSEL/);
});

test('station designs advance farther than bill designs before cutting', async () => {
  const baseTimestamp = new Date('2026-07-25T08:44:00.000Z');
  const stationData = {
    orderNumber: 'TEST-001',
    tableNumber: 12,
    waiterName: 'Murat',
    items: [{ menuItemName: 'Adana Kebap', quantity: 1, price: 450, portionOption: 'Normal' }],
    timestamp: baseTimestamp,
    layout: { footerText: 'FIS BITTI', hidePrices: true },
  };
  const billData = {
    restaurantName: 'REST_OTM',
    orderNumber: 'TEST-001',
    waiterName: 'Murat',
    items: [{ name: 'Adana Kebap', quantity: 1, price: 450 }],
    total: 450,
    timestamp: baseTimestamp,
    layout: { footerText: 'FIS BITTI' },
  };

  const outputs = await Promise.all([
    escpos.kitchenTicket({ ...stationData, department: 'KITCHEN' }),
    escpos.kitchenTicket({ ...stationData, department: 'GRILL' }),
    escpos.bill({ ...billData, tableNumber: 12 }),
    escpos.bill({ ...billData, tableNumber: 0, customer: { name: 'Ali Veli' } }),
  ]);

  // Yeni model: alt bosluk artik tasarimdan gelir (istasyon 47.5 mm, adisyon 22.5 mm).
  assertEndsWithFlushedCut(outputs[0], 0x00, 380);
  assertEndsWithFlushedCut(outputs[1], 0x00, 380);
  assertEndsWithFlushedCut(outputs[2], 0x00);
  assertEndsWithFlushedCut(outputs[3], 0x00);

  for (const output of outputs) {
    assert.ok(asBinaryText(output).includes('FIS BITTI\n'));
  }
});

test('inline date and enlarged table stay in preview order', async () => {
  const output = await escpos.bill({
    restaurantName: 'REST_OTM',
    orderNumber: 'INLINE-001',
    tableNumber: 12,
    waiterName: 'Murat',
    items: [{ name: 'Ayran', quantity: 1, price: 60 }],
    total: 60,
    timestamp: new Date('2026-07-25T08:44:00.000Z'),
    layout: { paperWidth: 80, inlineDateMasa: true, doubleSizeTable: true },
  });

  const text = asBinaryText(output);
  assert.ok(text.indexOf('25.07.2026') < text.indexOf('MASA: 12'));
  assert.ok(text.indexOf('MASA: 12') < text.indexOf('Fi'));
  assert.equal(output.includes(Buffer.from([0x1d, 0x21, 0x11])), true);
  assert.equal(output.includes(Buffer.from([0x1b, 0x21, 0x30])), true);
});

test('grill top calibration trims 5 mm while kitchen keeps the saved margin', async () => {
  const common = {
    orderNumber: 'TOP-001',
    tableNumber: 5,
    waiterName: 'Murat',
    items: [{ menuItemName: 'Adana Kebap', quantity: 1, portionOption: 'Normal' }],
    timestamp: new Date('2026-07-25T08:44:00.000Z'),
    layout: { topMarginMm: 10, hidePrices: true },
  };

  const kitchen = await escpos.kitchenTicket({ ...common, department: 'KITCHEN' });
  const grill = await escpos.kitchenTicket({ ...common, department: 'GRILL' });
  const kitchenDots = Math.round((10 / 25.4) * 203);
  const grillDots = Math.round((5 / 25.4) * 203);

  assert.equal(kitchen.includes(Buffer.from([0x1b, 0x4a, kitchenDots])), true);
  assert.equal(grill.includes(Buffer.from([0x1b, 0x4a, grillDots])), true);
});

test('the complete preview configuration is honored by a physical grill ticket', async () => {
  const output = await escpos.kitchenTicket({
    orderNumber: 'TEST-001',
    tableNumber: 12,
    waiterName: 'Test Kullanıcısı',
    department: 'GRILL',
    items: [
      { menuItemName: 'Adana Kebap', quantity: 2, price: 450, portionOption: 'Normal', notes: 'Az pişmiş' },
      { menuItemName: 'Ayran', quantity: 1, price: 60, portionOption: 'Normal' },
    ],
    timestamp: new Date('2026-07-25T08:44:00.000Z'),
    layout: {
      paperWidth: 80,
      logoUrl: 'https://example.com/hidden-logo.png',
      logoPosition: 'center',
      logoWidth: 25,
      headerText: 'TARİHİ ADANA KEBAPÇISI',
      receiptTitle: 'IZGARA',
      footerText: 'RESTOM',
      hideLogo: true,
      hideHeader: true,
      hidePrices: true,
      boldItems: true,
      doubleSizeItems: true,
      inlineDateMasa: true,
      doubleSizeTable: true,
      topMarginMm: 0,
    },
  });

  const text = asBinaryText(output);
  assert.doesNotMatch(text, /TAR.H. ADANA KEBAP/);
  assert.doesNotMatch(text, /900\.00|60\.00|TUTAR/);
  assert.doesNotMatch(text, /\x1dv0/, 'hidden logo must not emit a raster image');
  assert.match(text, /IZGARA/);
  assert.match(text, /MASA: 12/);
  assert.match(text, /2x ADANA KEBAP/);
  assert.match(text, /1x AYRAN/);
  assert.match(text, /!! NOT: Az pi/);
  assert.match(text, /RESTOM\n/);
  assert.ok(text.indexOf('25.07.2026') < text.indexOf('MASA: 12'));
  assert.ok(text.indexOf('MASA: 12') < text.indexOf('Fi'));
  assert.equal(output.includes(Buffer.from([0x1b, 0x21, 0x30])), true, 'table must use ESC ! 2x');
  assert.equal(output.includes(Buffer.from([0x1d, 0x21, 0x11])), true, 'table/items must use GS ! 2x');
  assertEndsWithFlushedCut(output, 0x00, 380);
});
