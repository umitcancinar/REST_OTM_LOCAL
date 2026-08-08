"use strict";
// ==========================================
// Metin yardimcilari — onizleme ve ESC/POS ortak kullanir.
// Sutun matematigi burada TEK yerde yapilir; bu yuzden ekranda gorulen
// satir ile kagida basilan satir ayni karakterlerden olusur.
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitize = sanitize;
exports.fitText = fitText;
exports.wrapText = wrapText;
exports.twoColumnLine = twoColumnLine;
exports.itemColumns = itemColumns;
exports.hardWrap = hardWrap;
exports.scaledColumns = scaledColumns;
exports.padForAlign = padForAlign;
exports.toCP857 = toCP857;
// Kontrol karakterleri (NUL..US ve DEL). RegExp literal yerine string ile
// kuruluyor ki kaynak dosyada ham kontrol baytu bulunmasin.
const CONTROL_CHARS = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', 'g');
/** Kontrol karakterlerini temizler; ESC/POS akisinin bozulmasini engeller. */
function sanitize(value) {
    if (value === null || value === undefined)
        return '';
    return String(value).replace(CONTROL_CHARS, '');
}
function fitText(value, width) {
    const text = sanitize(value).replace(/\s+/g, ' ').trim();
    if (width <= 0)
        return '';
    if (text.length <= width)
        return text;
    return width <= 3 ? text.slice(0, width) : `${text.slice(0, width - 3)}...`;
}
function wrapText(value, width) {
    const text = sanitize(value).replace(/\s+/g, ' ').trim();
    if (!text || width <= 0)
        return [];
    const lines = [];
    let remaining = text;
    let guard = 0;
    while (remaining.length > width && guard++ < 500) {
        const candidate = remaining.slice(0, width + 1);
        const breakAt = candidate.lastIndexOf(' ');
        const take = breakAt > Math.floor(width / 2) ? breakAt : width;
        lines.push(remaining.slice(0, take).trim());
        remaining = remaining.slice(take).trim();
    }
    if (remaining)
        lines.push(remaining);
    return lines;
}
/** Sol/sag iki sutunu tam genislige yayar. */
function twoColumnLine(left, right, columns) {
    const rightText = fitText(right, columns);
    const availableLeft = Math.max(0, columns - rightText.length - 1);
    const leftText = fitText(left, availableLeft);
    const gap = Math.max(1, columns - leftText.length - rightText.length);
    return `${leftText}${' '.repeat(gap)}${rightText}`;
}
/** Urun satiri: ad / adet / tutar. Fiyat gizliyse tutar sutunu hic acilmaz. */
function itemColumns(name, qty, price, columns, qtyWidth, priceWidth) {
    const safeQty = Math.max(1, Math.min(Math.max(1, columns - 2), qtyWidth));
    const safePrice = Math.max(0, Math.min(Math.max(0, columns - safeQty - 2), priceWidth));
    const nameWidth = Math.max(1, columns - safeQty - safePrice);
    const namePart = fitText(name, nameWidth).padEnd(nameWidth);
    const qtyPart = fitText(qty, safeQty).padStart(safeQty);
    const pricePart = safePrice > 0 ? fitText(price, safePrice).padStart(safePrice) : '';
    return `${namePart}${qtyPart}${pricePart}`;
}
/**
 * Bosluklari KORUYARAK sabit genislikte boler.
 * Etiketli satirlarda ("Saat  : 11:44") hizalamanin bozulmamasi icin gerekir.
 */
function hardWrap(value, width) {
    const text = sanitize(value).replace(/[\r\n\t]+/g, ' ');
    if (!text.trim() || width <= 0)
        return [];
    const lines = [];
    for (let index = 0; index < text.length; index += width) {
        lines.push(text.slice(index, index + width));
    }
    return lines;
}
/** Bir olcek icin kullanilabilir sutun sayisi (2x yazi yari sutuna sigar). */
function scaledColumns(columns, scale) {
    return Math.max(1, Math.floor(columns / scale));
}
/** Onizlemede satiri kagit genisligine hizalar (ESC a ile ayni sonuc). */
function padForAlign(text, columns, align) {
    if (text.length >= columns)
        return text;
    const space = columns - text.length;
    if (align === 'right')
        return ' '.repeat(space) + text;
    if (align === 'center')
        return ' '.repeat(Math.floor(space / 2)) + text;
    return text;
}
const CP857_MAP = {
    'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ä': 0x84, 'à': 0x85, 'å': 0x86, 'ç': 0x87,
    'ê': 0x88, 'ë': 0x89, 'è': 0x8a, 'ï': 0x8b, 'î': 0x8c, 'ı': 0x8d, 'Ä': 0x8e, 'Å': 0x8f,
    'É': 0x90, 'æ': 0x91, 'Æ': 0x92, 'ô': 0x93, 'ö': 0x94, 'ò': 0x95, 'û': 0x96, 'ù': 0x97,
    'İ': 0x98, 'Ö': 0x99, 'Ü': 0x9a, 'ø': 0x9b, '£': 0x9c, 'Ø': 0x9d, 'Ş': 0x9e, 'ş': 0x9f,
    'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'Ğ': 0xa6, 'ğ': 0xa7,
    '¿': 0xa8, '®': 0xa9, '¬': 0xaa, '½': 0xab, '¼': 0xac, '¡': 0xad, '«': 0xae, '»': 0xaf,
};
/**
 * UTF-8 metni CP857 (PC Turkish) bayt dizisine cevirir.
 * ESC/POS yazicilar UTF-8 anlamaz; bu donusum olmadan Turkce karakterler bozulur.
 */
function toCP857(text) {
    const bytes = [];
    for (const ch of text) {
        const mapped = CP857_MAP[ch];
        if (mapped !== undefined) {
            bytes.push(mapped);
            continue;
        }
        const code = ch.charCodeAt(0);
        // ESC/POS komut parametreleri 127 ustunde olabilir; ham bayt korunur.
        bytes.push(code <= 0xff ? code : 0x3f);
    }
    return Uint8Array.from(bytes);
}
//# sourceMappingURL=text.js.map