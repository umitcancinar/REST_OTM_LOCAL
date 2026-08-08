import { type Align, type ReceiptDoc, type Scale } from './types';
/**
 * Bayt ureten komutlar — renderEscPos yalnizca bunlari kullanir.
 * Parametreleri ham bayt oldugu icin metin kodlamasindan etkilenmezler.
 */
export declare const bin: {
    /** Reset + CP857 (PC Turkish). TP850 NATIVE bu tabloyu 102. indekste sunar. */
    init: () => Uint8Array;
    align: (position: Align) => Uint8Array;
    bold: (on: boolean) => Uint8Array;
    cut: () => Uint8Array;
    /** ESC 3 n — satir araligini n noktaya sabitler. Onizleme ile eslesmenin anahtari. */
    lineSpacing: (dots: number) => Uint8Array;
    /** Kagidi verilen nokta kadar ilerletir (203 DPI). */
    feedDots: (dots: number) => Uint8Array;
    /** Karakter olcegi. GS ! n : ust 4 bit genislik, alt 4 bit yukseklik. */
    scale: (value: Scale) => Uint8Array;
    /** n adet, t*50ms sureli bip + BEL. Jenerik ESC/POS: ESC B n t */
    beep: (strong: boolean) => Uint8Array;
};
/**
 * Geriye donuk string API (agent'in invoiceInfo gibi eski akislari kullanir).
 * YENI KOD BUNU KULLANMAMALI: donen string toCP857'den gecerse parametre
 * baytlari bozulabilir. Bunun yerine `bin` kullanin.
 */
export declare const cmd: {
    init: () => string;
    align: (position: Align) => string;
    bold: (on: boolean) => string;
    cut: () => string;
    feedDots: (dots: number) => string;
    scale: (value: Scale) => string;
};
export declare function mmToDots(millimeters: number): number;
/** Logo mm genisligini 8'in kati piksele cevirir (raster komutu 8 bit hizali ister). */
export declare function logoWidthToPixels(widthMm: number, paperPixels: number): number;
/**
 * ReceiptDoc'u yaziciya gonderilecek bayt dizisine cevirir.
 * `logoBuffer` (varsa) baslik satirlarindan once basilir.
 */
export declare function renderEscPos(doc: ReceiptDoc, logoBuffer?: Uint8Array): Uint8Array;
/** Test ve karsilastirma icin: dokumani duz metne cevirir. */
export declare function renderPlain(doc: ReceiptDoc): string[];
/**
 * Fisin fiziksel yuksekligi (mm). Onizleme ile karsilastirma/dogrulama icin.
 * Satir araligi artik yaziciya acikca bildirildigi icin bu hesap kagitta
 * olculen boyla eslesir.
 */
export declare function receiptHeightMm(doc: ReceiptDoc): number;
//# sourceMappingURL=escpos.d.ts.map