"use strict";
// ==========================================
// ReceiptDoc -> ESC/POS bayt akisi
// ==========================================
// Onizleme ile ayni ReceiptDoc'u kullanir; burada SADECE bicimlendirme
// komutlari eklenir, hicbir yerlesim hesabi yapilmaz.
//
// ONEMLI — iki kural bu dosyanin tamamini sekillendirir:
//
// 1) SATIR ARALIGI YAZICIYA ACIKCA SOYLENIR.
//    `ESC @` (reset) yaziciyi fabrika varsayilani olan 1/6 inc (~4.23 mm)
//    satir aralignia dondurur. Onizleme ise LINE_HEIGHT_DOTS (24 nokta =
//    3 mm) varsayar. Aralik yaziciya bildirilmezse her satir kagitta %41
//    daha uzun basilir ve sapma satir sayisiyla birlikte buyur — hicbir
//    sabit alt bosluk degeri bunu telafi edemez. Bu yuzden olcek her
//    degistiginde `ESC 3 n` ile aralik da gonderilir.
//
// 2) KOMUT BAYTLARI METIN KODLAMASINDAN GECMEZ.
//    toCP857 her karakteri CP857 tablosunda arar; komut parametreleri de
//    ayni akisin icinde string olarak tasinirsa sessizce bozulur
//    (orn. 224 -> 'a' -> 0x85, yani 28 mm'lik besleme 16.6 mm'ye duser).
//    Bu yuzden komutlar Uint8Array olarak uretilir, yalnizca gercek metin
//    toCP857'den gecer.
Object.defineProperty(exports, "__esModule", { value: true });
exports.cmd = exports.bin = void 0;
exports.mmToDots = mmToDots;
exports.logoWidthToPixels = logoWidthToPixels;
exports.renderEscPos = renderEscPos;
exports.renderPlain = renderPlain;
exports.receiptHeightMm = receiptHeightMm;
const types_1 = require("./types");
const text_1 = require("./text");
const ESC = '\x1B';
const GS = '\x1D';
/** ASCII karakterleri ve ham bayt degerlerini tek bir bayt dizisine cevirir. */
function bytesOf(...values) {
    const out = [];
    for (const value of values) {
        if (typeof value === 'number') {
            out.push(value & 0xff);
        }
        else {
            for (let index = 0; index < value.length; index += 1) {
                out.push(value.charCodeAt(index) & 0xff);
            }
        }
    }
    return Uint8Array.from(out);
}
function alignByte(position) {
    return position === 'center' ? 1 : position === 'right' ? 2 : 0;
}
function scaleByte(value) {
    return ((value - 1) << 4) | (value - 1);
}
function feedChunks(dots) {
    const out = [];
    let remaining = Math.max(0, Math.round(dots));
    let guard = 0;
    while (remaining > 0 && guard++ < 200) {
        const chunk = Math.min(255, remaining);
        out.push(0x1b, 0x4a, chunk); // ESC J n
        remaining -= chunk;
    }
    return out;
}
/**
 * Bayt ureten komutlar — renderEscPos yalnizca bunlari kullanir.
 * Parametreleri ham bayt oldugu icin metin kodlamasindan etkilenmezler.
 */
exports.bin = {
    /** Reset + CP857 (PC Turkish). TP850 NATIVE bu tabloyu 102. indekste sunar. */
    init: () => bytesOf(0x1b, 0x40, 0x1b, 0x74, 0x66),
    align: (position) => bytesOf(0x1b, 0x61, alignByte(position)),
    bold: (on) => bytesOf(0x1b, 0x45, on ? 1 : 0),
    cut: () => bytesOf(0x1d, 0x56, 0x00),
    /** ESC 3 n — satir araligini n noktaya sabitler. Onizleme ile eslesmenin anahtari. */
    lineSpacing: (dots) => bytesOf(0x1b, 0x33, Math.min(255, Math.max(0, Math.round(dots)))),
    /** Kagidi verilen nokta kadar ilerletir (203 DPI). */
    feedDots: (dots) => Uint8Array.from(feedChunks(dots)),
    /** Karakter olcegi. GS ! n : ust 4 bit genislik, alt 4 bit yukseklik. */
    scale: (value) => 
    // Bazi ucuz yazicilar GS ! yerine ESC ! honor eder; 2x icin ikisini de gonder.
    bytesOf(0x1b, 0x21, value === 2 ? 0x30 : 0x00, 0x1d, 0x21, scaleByte(value)),
    /** n adet, t*50ms sureli bip + BEL. Jenerik ESC/POS: ESC B n t */
    beep: (strong) => strong ? bytesOf(0x1b, 0x42, 0x08, 0x05, 0x07) : bytesOf(0x1b, 0x42, 0x04, 0x02, 0x07),
};
/**
 * Geriye donuk string API (agent'in invoiceInfo gibi eski akislari kullanir).
 * YENI KOD BUNU KULLANMAMALI: donen string toCP857'den gecerse parametre
 * baytlari bozulabilir. Bunun yerine `bin` kullanin.
 */
exports.cmd = {
    init: () => `${ESC}@${ESC}t\x66`,
    align: (position) => `${ESC}a${String.fromCharCode(alignByte(position))}`,
    bold: (on) => `${ESC}E${on ? '\x01' : '\x00'}`,
    cut: () => `${GS}V\x00`,
    feedDots: (dots) => feedChunks(dots).map((byte) => String.fromCharCode(byte)).join(''),
    scale: (value) => {
        const legacy = value === 2 ? `${ESC}!\x30` : `${ESC}!\x00`;
        return `${legacy}${GS}!${String.fromCharCode(scaleByte(value))}`;
    },
};
function mmToDots(millimeters) {
    return Math.round(Math.max(0, millimeters) * types_1.DOTS_PER_MM);
}
/** Logo mm genisligini 8'in kati piksele cevirir (raster komutu 8 bit hizali ister). */
function logoWidthToPixels(widthMm, paperPixels) {
    const physical = Math.round((Math.max(1, widthMm) * types_1.DOTS_PER_MM) / 8) * 8;
    return Math.min(Math.max(8, physical), paperPixels);
}
/**
 * ReceiptDoc'u yaziciya gonderilecek bayt dizisine cevirir.
 * `logoBuffer` (varsa) baslik satirlarindan once basilir.
 */
function renderEscPos(doc, logoBuffer) {
    const parts = [
        exports.bin.init(),
        exports.bin.beep(doc.strongBeep),
        exports.bin.lineSpacing(types_1.LINE_HEIGHT_DOTS),
        exports.bin.feedDots(mmToDots(doc.topMarginMm)),
    ];
    if (logoBuffer && logoBuffer.length > 0)
        parts.push(logoBuffer);
    let currentAlign = null;
    let currentBold = null;
    let currentScale = null;
    for (const line of doc.lines) {
        if (line.align !== currentAlign) {
            parts.push(exports.bin.align(line.align));
            currentAlign = line.align;
        }
        if (line.scale !== currentScale) {
            parts.push(exports.bin.scale(line.scale));
            // Buyuk yazi, satir araligi da ayni oranda buyumezse ust uste biner.
            // Onizlemedeki LINE_MM * scale ile birebir ayni yukseklik.
            parts.push(exports.bin.lineSpacing(types_1.LINE_HEIGHT_DOTS * line.scale));
            currentScale = line.scale;
        }
        if (line.bold !== currentBold) {
            parts.push(exports.bin.bold(line.bold));
            currentBold = line.bold;
        }
        parts.push((0, text_1.toCP857)(`${line.text}\n`));
    }
    parts.push(exports.bin.bold(false));
    parts.push(exports.bin.scale(1));
    parts.push(exports.bin.lineSpacing(types_1.LINE_HEIGHT_DOTS));
    parts.push(exports.bin.align('left'));
    parts.push(exports.bin.feedDots(mmToDots(doc.bottomMarginMm)));
    parts.push(exports.bin.cut());
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
        merged.set(part, offset);
        offset += part.length;
    }
    return merged;
}
/** Test ve karsilastirma icin: dokumani duz metne cevirir. */
function renderPlain(doc) {
    return doc.lines.map((line) => line.text);
}
/**
 * Fisin fiziksel yuksekligi (mm). Onizleme ile karsilastirma/dogrulama icin.
 * Satir araligi artik yaziciya acikca bildirildigi icin bu hesap kagitta
 * olculen boyla eslesir.
 */
function receiptHeightMm(doc) {
    const lineDots = doc.lines.reduce((sum, line) => sum + types_1.LINE_HEIGHT_DOTS * line.scale, 0);
    return doc.topMarginMm + lineDots / types_1.DOTS_PER_MM + doc.bottomMarginMm;
}
//# sourceMappingURL=escpos.js.map