"use strict";
// ==========================================
// Z Raporu — gun sonu ozeti
// ==========================================
// Kasadaki termal yaziciya basilan gun sonu dokumu: ciro, siparis
// sayilari, odeme yontemi kirilimi, en cok satan urunler ve garson
// performansi. Ekrandaki Raporlar sayfasiyla AYNI verilerden uretilir
// (apps/api -> reportService.getSummaryInRange), boylece kagit ile
// ekran birbirini tutar.
//
// Gercek fislerle ayni renderEscPos akisindan gecer; kesim payi da
// buildReceiptDoc'takiyle ayni guvenlik tabanini kullanir.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildZReportDoc = buildZReportDoc;
const types_1 = require("./types");
const build_1 = require("./build");
const text_1 = require("./text");
const PAYMENT_LABELS = {
    CASH: 'Nakit',
    CARD: 'Kredi Karti',
    IBAN: 'Havale/IBAN',
    YEMEK_SEPETI: 'Yemek Sepeti',
    TRENDYOL_GO: 'Trendyol Go',
    GETIR: 'Getir',
    UNKNOWN: 'Belirtilmemis',
};
/** Fise sigmasi icin listelerde gosterilecek azami satir sayisi. */
const MAX_ITEM_ROWS = 20;
const MAX_WAITER_ROWS = 10;
function money(amount) {
    return `${(Number.isFinite(amount) ? amount : 0).toFixed(2)} TL`;
}
function line(text, extra = {}) {
    return { text, align: 'left', bold: false, scale: 1, source: 'spacer', ...extra };
}
function buildZReportDoc(layout, data) {
    const columns = types_1.PAPER_COLUMNS[layout.paperWidth];
    const lines = [];
    const rule = () => lines.push(line('-'.repeat(columns)));
    const dotted = () => lines.push(line('.'.repeat(columns)));
    /** Etiket solda, tutar sagda; tam genislige yayilir. */
    const row = (label, value, extra = {}) => lines.push(line((0, text_1.twoColumnLine)(label, value, columns), extra));
    // ---- Baslik ----------------------------------------------------------
    if (data.restaurantName) {
        for (const text of (0, text_1.wrapText)(data.restaurantName, Math.floor(columns / 2))) {
            lines.push(line(text, { bold: true, align: 'center', scale: 2 }));
        }
    }
    rule();
    lines.push(line('Z RAPORU', { bold: true, align: 'center', scale: 2 }));
    rule();
    lines.push(line(`Donem : ${data.rangeLabel}`));
    lines.push(line(`Alindi: ${data.printedAt.toLocaleString('tr-TR')}`));
    rule();
    // ---- Ozet ------------------------------------------------------------
    lines.push(line('OZET', { bold: true }));
    dotted();
    row('Toplam Ciro', money(data.totalRevenue), { bold: true });
    row('Siparis Adedi', String(data.totalOrders));
    row('Ortalama Sepet', money(data.avgOrderValue));
    rule();
    // ---- Odeme kirilimi --------------------------------------------------
    // Toplam ciroyu yontemlere bolen kirilim; kismi odemeler (orn. 500 nakit
    // + 1000 kart) sunucuda ayri ayri toplanir, burada oldugu gibi basilir.
    const payments = Object.entries(data.paymentBreakdown).filter(([, amount]) => Number(amount) > 0);
    lines.push(line('ODEME KIRILIMI', { bold: true }));
    dotted();
    if (payments.length === 0) {
        lines.push(line('Kayit yok.'));
    }
    else {
        let paymentSum = 0;
        for (const [method, amount] of payments) {
            row(PAYMENT_LABELS[method] || method, money(Number(amount)));
            paymentSum += Number(amount) || 0;
        }
        dotted();
        row('TOPLAM', money(paymentSum), { bold: true });
    }
    rule();
    // ---- Satilan urunler -------------------------------------------------
    lines.push(line('SATILAN URUNLER', { bold: true }));
    dotted();
    if (data.topSellingItems.length === 0) {
        lines.push(line('Kayit yok.'));
    }
    else {
        // Sutunlar: ad | adet | tutar. Adet ve tutar sabit genislikte,
        // kalan yer ada birakilir ki uzun urun adlari tutari itmesin.
        const qtyWidth = 5;
        const amountWidth = 12;
        const nameWidth = Math.max(6, columns - qtyWidth - amountWidth);
        lines.push(line(`${(0, text_1.fitText)('URUN', nameWidth).padEnd(nameWidth)}${(0, text_1.fitText)('ADET', qtyWidth).padStart(qtyWidth)}${(0, text_1.fitText)('TUTAR', amountWidth).padStart(amountWidth)}`));
        let shownQty = 0;
        let shownRevenue = 0;
        for (const item of data.topSellingItems.slice(0, MAX_ITEM_ROWS)) {
            lines.push(line(`${(0, text_1.fitText)(item.name.toUpperCase(), nameWidth).padEnd(nameWidth)}`
                + `${(0, text_1.fitText)(String(item.count), qtyWidth).padStart(qtyWidth)}`
                + `${(0, text_1.fitText)(money(item.revenue), amountWidth).padStart(amountWidth)}`));
            shownQty += Number(item.count) || 0;
            shownRevenue += Number(item.revenue) || 0;
        }
        const hidden = data.topSellingItems.length - MAX_ITEM_ROWS;
        if (hidden > 0)
            lines.push(line(`... ve ${hidden} urun daha`));
        dotted();
        row(`TOPLAM (${shownQty} adet)`, money(shownRevenue), { bold: true });
    }
    rule();
    // ---- Garson performansi ----------------------------------------------
    lines.push(line('GARSON PERFORMANSI', { bold: true }));
    dotted();
    if (data.waiterPerformance.length === 0) {
        lines.push(line('Kayit yok.'));
    }
    else {
        for (const waiter of data.waiterPerformance.slice(0, MAX_WAITER_ROWS)) {
            row(`${(0, text_1.fitText)(waiter.name, Math.max(6, columns - 20))} (${waiter.orders})`, money(waiter.revenue));
        }
        const hidden = data.waiterPerformance.length - MAX_WAITER_ROWS;
        if (hidden > 0)
            lines.push(line(`... ve ${hidden} personel daha`));
    }
    rule();
    lines.push(line('Bu belge mali degeri olmayan', { align: 'center' }));
    lines.push(line('bir yonetim ozetidir.', { align: 'center' }));
    return {
        columns,
        paperWidth: layout.paperWidth,
        topMarginMm: Math.max(0, layout.topMarginMm - layout.deviceTopTrimMm),
        // Adisyon yazicisina basilir; kesim payi da adisyonla ayni taban.
        bottomMarginMm: (0, build_1.cutClearanceMm)('BILL', layout.bottomMarginMm),
        lines,
        strongBeep: false,
    };
}
//# sourceMappingURL=zreport.js.map