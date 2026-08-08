// Onizleme ile fiziksel ciktinin BIREBIR ayni oldugunu dogrular.
// Admin paneli buildReceiptDoc'un dondurdugu satirlari ekrana basar;
// bu test ayni satirlarin ESC/POS akisinda ayni sirayla yer aldigini kanitlar.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LINE_HEIGHT_DOTS,
  bin,
  buildCalibrationDoc,
  buildReceiptDoc,
  mmToDots,
  normalizeLayout,
  receiptHeightMm,
  renderEscPos,
  toCP857,
} = require('@rest-otm/receipt-core');

function sampleInput(overrides = {}) {
  return {
    kind: 'BILL',
    layout: normalizeLayout({}, 'CASHIER', 'REST_OTM'),
    orderNumber: 'TEST-001',
    tableNumber: 12,
    waiterName: 'Murat',
    timestamp: new Date(2026, 6, 25, 11, 44),
    items: [
      { name: 'Adana Kebap', quantity: 2, price: 450, portionOption: 'Normal', notes: 'Az pişmiş' },
      { name: 'Ayran', quantity: 1, price: 60, portionOption: 'Normal' },
    ],
    total: 960,
    ...overrides,
  };
}

test('onizlemedeki her satir ESC/POS akisinda ayni sirayla yer alir', () => {
  const doc = buildReceiptDoc(sampleInput());
  const bytes = Buffer.from(renderEscPos(doc));

  let cursor = 0;
  for (const line of doc.lines) {
    if (!line.text) continue;
    const encoded = Buffer.from(toCP857(line.text));
    const found = bytes.indexOf(encoded, cursor);
    assert.notEqual(found, -1, `satir ciktida bulunamadi: "${line.text}"`);
    cursor = found + encoded.length;
  }
});

test('her satir kagit sutun sinirini asmaz', () => {
  for (const paperWidth of [58, 80]) {
    const layout = normalizeLayout({ paperWidth }, 'CASHIER', 'REST_OTM');
    const doc = buildReceiptDoc(sampleInput({ layout }));
    for (const line of doc.lines) {
      const limit = Math.floor(doc.columns / line.scale);
      assert.ok(line.text.length <= limit, `${paperWidth}mm: "${line.text}" (${line.text.length} > ${limit})`);
    }
  }
});

test('iptal ve ikram fisleri kendi etiketlerini kullanir', () => {
  const cancel = buildReceiptDoc(sampleInput({ isCancel: true }));
  const treat = buildReceiptDoc(sampleInput({ isTreat: true }));
  assert.ok(cancel.lines.some((line) => line.source === 'cancelTitle'));
  assert.ok(treat.lines.some((line) => line.source === 'treatTitle'));
  assert.equal(cancel.strongBeep, true);
});

test('paket fisi PAKET yazisini basar ve ozellestirilebilir', () => {
  const layout = normalizeLayout({ labels: { takeaway: 'GEL AL' } }, 'PAKET', 'REST_OTM');
  const doc = buildReceiptDoc(sampleInput({ layout, tableNumber: 0 }));
  assert.ok(doc.lines.some((line) => line.text.includes('GEL AL')));
});

test('oge gizlenince ilgili satirlar hic uretilmez', () => {
  const layout = normalizeLayout({ elements: { waiter: { visible: false }, total: { visible: false } } }, 'CASHIER', 'REST_OTM');
  const doc = buildReceiptDoc(sampleInput({ layout }));
  assert.equal(doc.lines.some((line) => line.source === 'waiter'), false);
  assert.equal(doc.lines.some((line) => line.source === 'total'), false);
});

test('ust ve alt bosluk mm degerleri dokumana birebir yansir', () => {
  const layout = normalizeLayout({ topMarginMm: 12, bottomMarginMm: 30, deviceTopTrimMm: 5 }, 'CASHIER', 'REST_OTM');
  const doc = buildReceiptDoc(sampleInput({ layout }));
  assert.equal(doc.topMarginMm, 7);
  assert.equal(doc.bottomMarginMm, 30);
});

test('eski ayarlar (v1) yeni semaya kayipsiz tasinir', () => {
  const layout = normalizeLayout({
    hideLogo: true, hideHeader: true, boldItems: true, doubleSizeItems: true, doubleSizeTable: true,
  }, 'CASHIER', 'REST_OTM');
  assert.equal(layout.elements.logo.visible, false);
  assert.equal(layout.elements.header.visible, false);
  assert.equal(layout.elements.item.bold, true);
  assert.equal(layout.elements.item.scale, 2);
  assert.equal(layout.elements.table.scale, 2);
});

// ─── Onizleme = kagit: fiziksel olcu testleri ────────────────────────────
// Bu iki test, "ekranda gordugum kagitta cikmiyor" sorununun iki kok
// nedenini kilitler. Biri kirilirsa cikti yine ekrandan sapmaya baslar.

test('satir araligi yaziciya bildirilir (ESC 3) ve olcekle birlikte buyur', () => {
  const doc = buildReceiptDoc(sampleInput());
  const bytes = Buffer.from(renderEscPos(doc));

  // ESC @ (reset) yaziciyi 1/6 inc (~34 nokta) araliga dondurur; onizleme
  // ise 24 nokta varsayar. Aralik gonderilmezse fis kagitta %41 uzar.
  const base = Buffer.from([0x1b, 0x33, LINE_HEIGHT_DOTS]);
  assert.notEqual(bytes.indexOf(base), -1, 'ESC 3 24 hic gonderilmemis');

  // Olcekli satirlarin araligi da ayni oranda buyumeli, yoksa ust uste biner.
  for (const scale of new Set(doc.lines.map((line) => line.scale))) {
    const expected = Buffer.from([0x1b, 0x33, LINE_HEIGHT_DOTS * scale]);
    assert.notEqual(bytes.indexOf(expected), -1, `${scale}x satir icin ESC 3 ${LINE_HEIGHT_DOTS * scale} yok`);
  }
});

test('besleme mesafesi hicbir mm degerinde bozulmaz', () => {
  // toCP857 komut parametrelerini de haritalarsa (orn. 224 -> 0x85) besleme
  // sessizce kisalir: 28 mm istenip 16.6 mm beslenir. Tum yarim-mm
  // degerlerinde gonderilen nokta sayisinin tam istenen kadar oldugunu dogrula.
  for (let mm = 0; mm <= 80; mm += 0.5) {
    const expected = mmToDots(mm);
    const bytes = Buffer.from(bin.feedDots(expected));

    let sent = 0;
    for (let i = 0; i < bytes.length; i += 3) {
      assert.equal(bytes[i], 0x1b, `${mm}mm: ESC bekleniyordu`);
      assert.equal(bytes[i + 1], 0x4a, `${mm}mm: J bekleniyordu`);
      sent += bytes[i + 2];
    }
    assert.equal(sent, expected, `${mm}mm: ${expected} nokta istendi, ${sent} gonderildi`);
  }
});

test('kalibrasyon fisi gercek fisle AYNI kesim payini kullanir', () => {
  // Teshis araci, teshis ettigi seyden farkli davranirsa yaniltir:
  // ilk surumde kalibrasyon guvenlik tabanini uygulamiyordu ve kullanicinin
  // 4mm'lik ayariyla basip son satirlari yazicinin icinde birakti.
  const layout = normalizeLayout({ bottomMarginMm: 4 }, 'CASHIER', 'REST_OTM');
  const gercek = buildReceiptDoc(sampleInput({ layout }));
  const kalibrasyon = buildCalibrationDoc(layout, 'BILL');

  assert.equal(kalibrasyon.bottomMarginMm, gercek.bottomMarginMm);
  assert.ok(kalibrasyon.bottomMarginMm >= 22.5, 'kesim payi donanimsal tabanin altinda');

  // Istasyon yazicilarinin bicagi daha uzakta — kalibrasyon da bunu bilmeli.
  const istasyon = buildCalibrationDoc(normalizeLayout({ bottomMarginMm: 4 }, 'GRILL', 'REST_OTM'), 'STATION');
  assert.ok(istasyon.bottomMarginMm >= 47.5);
});

test('fisin fiziksel boyu onizlemenin hesapladigi boyla ayni', () => {
  const layout = normalizeLayout({ topMarginMm: 10, bottomMarginMm: 30 }, 'CASHIER', 'REST_OTM');
  const doc = buildReceiptDoc(sampleInput({ layout }));

  // Onizlemenin ciziminde kullandigi hesabin birebir aynisi (ReceiptPreview:
  // ust bosluk + her satir icin LINE_MM * scale + alt bosluk).
  const previewMm = doc.topMarginMm
    + doc.lines.reduce((sum, line) => sum + 3 * line.scale, 0)
    + doc.bottomMarginMm;

  assert.ok(
    Math.abs(receiptHeightMm(doc) - previewMm) < 0.5,
    `kagit ${receiptHeightMm(doc).toFixed(1)}mm, onizleme ${previewMm.toFixed(1)}mm`,
  );
});
