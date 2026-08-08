"use strict";
// ==========================================
// REST_OTM · Fiş Render Çekirdeği — Tipler
// ==========================================
// Bu paket, admin panelindeki ÖNİZLEME ile yazıcıdan çıkan FİZİKSEL FİŞ'in
// birebir aynı olmasını garanti eder. Her iki taraf da aynı `ReceiptDoc`
// nesnesini kullanır: önizleme onu HTML'e, print-agent ESC/POS'a çevirir.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ELEMENT_LABELS = exports.ELEMENT_KEYS = exports.PRINTABLE_MM = exports.PAPER_PIXELS = exports.PAPER_COLUMNS = exports.LINE_HEIGHT_DOTS = exports.DOTS_PER_MM = exports.RENDER_ENGINE_VERSION = void 0;
/**
 * Render motoru sürümü. Print-agent açılışta bunu basar; sahada "güncelledim
 * ama değişmedi" durumunda agent'ın gerçekten yeni kodu çalıştırıp
 * çalıştırmadığı tahminle değil, konsoldan bakılarak anlaşılır.
 * Çıktının fiziksel ölçüsünü etkileyen her değişiklikte artırılmalı.
 */
exports.RENDER_ENGINE_VERSION = 2;
/** 203 DPI termal yazıcı: 1 mm ≈ 8 nokta */
exports.DOTS_PER_MM = 203 / 25.4;
/** ESC/POS varsayılan satır yüksekliği (nokta). Önizleme ile ortak. */
exports.LINE_HEIGHT_DOTS = 24;
exports.PAPER_COLUMNS = { 58: 32, 80: 48 };
exports.PAPER_PIXELS = { 58: 384, 80: 576 };
/** Basilabilir alan (mm): 58 mm kagitta ~48 mm, 80 mm kagitta ~72 mm. Onizleme ile ortak. */
exports.PRINTABLE_MM = { 58: 48, 80: 72 };
exports.ELEMENT_KEYS = [
    'logo', 'header', 'subHeader', 'title', 'customer', 'orderNote',
    'dateTime', 'table', 'orderNo', 'waiter', 'columnsHeader', 'item',
    'itemNote', 'total', 'paymentMethod', 'payments', 'remaining',
    'paidItems', 'cancelTitle', 'treatTitle', 'footer',
];
/** Kullanıcıya gösterilen Türkçe öğe adları (admin UI için). */
exports.ELEMENT_LABELS = {
    logo: 'Logo',
    header: 'İşletme Adı (Başlık)',
    subHeader: 'Alt Başlık',
    title: 'Fiş Başlığı (ADİSYON / FIRIN FİŞİ / İPTAL …)',
    customer: 'Müşteri Bilgileri (Paket)',
    orderNote: 'Sipariş Notu',
    dateTime: 'Tarih & Saat',
    table: 'Masa No / PAKET Yazısı',
    orderNo: 'Fiş No',
    waiter: 'Garson',
    columnsHeader: 'Sütun Başlıkları (ÜRÜN / ADET / TUTAR)',
    item: 'Ürün Satırları',
    itemNote: 'Ürün Notu',
    total: 'TOPLAM',
    paymentMethod: 'Ödeme Tipi (NAKİT / KART …)',
    payments: 'Tahsilat Satırları',
    remaining: 'KALAN',
    paidItems: 'Ödenen Ürünler (altta liste)',
    cancelTitle: 'İPTAL FİŞİ Yazısı',
    treatTitle: 'İKRAM FİŞİ Yazısı',
    footer: 'Alt Bilgi (Footer)',
};
//# sourceMappingURL=types.js.map