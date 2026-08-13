const test = require('node:test');
const assert = require('node:assert/strict');

const { toReceiptLine } = require('../dist/modules/printing/receipt-line.js');

test('adisyon satiri toplam fiyati ikinci kez birim fiyat gibi carpmaz', () => {
  const line = toReceiptLine({
    menuItemName: 'Fuse Tea',
    quantity: 5,
    unitPrice: 85,
    // Gercek DB nesnesinde bulunur; helper bunu bilerek kullanmamalidir.
    totalPrice: 425,
    notes: null,
  });

  assert.deepEqual(line, {
    name: 'Fuse Tea',
    quantity: 5,
    price: 85,
    notes: undefined,
  });
  assert.equal(line.quantity * line.price, 425);
});

test('adisyon satiri porsiyon ve ekstra dahil etkin birim fiyatini korur', () => {
  const line = toReceiptLine({
    menuItemName: 'Buyuk Pizza + Ekstra Peynir',
    quantity: 2,
    unitPrice: 90,
    totalPrice: 240,
    notes: 'Ekstra peynir',
  });

  assert.equal(line.price, 120);
  assert.equal(line.quantity * line.price, 240);
});
