import type { Align, Scale } from './types';
/** Kontrol karakterlerini temizler; ESC/POS akisinin bozulmasini engeller. */
export declare function sanitize(value: unknown): string;
export declare function fitText(value: unknown, width: number): string;
export declare function wrapText(value: unknown, width: number): string[];
/** Sol/sag iki sutunu tam genislige yayar. */
export declare function twoColumnLine(left: unknown, right: unknown, columns: number): string;
/** Urun satiri: ad / adet / tutar. Fiyat gizliyse tutar sutunu hic acilmaz. */
export declare function itemColumns(name: string, qty: string, price: string, columns: number, qtyWidth: number, priceWidth: number): string;
/**
 * Bosluklari KORUYARAK sabit genislikte boler.
 * Etiketli satirlarda ("Saat  : 11:44") hizalamanin bozulmamasi icin gerekir.
 */
export declare function hardWrap(value: unknown, width: number): string[];
/** Bir olcek icin kullanilabilir sutun sayisi (2x yazi yari sutuna sigar). */
export declare function scaledColumns(columns: number, scale: Scale): number;
/** Onizlemede satiri kagit genisligine hizalar (ESC a ile ayni sonuc). */
export declare function padForAlign(text: string, columns: number, align: Align): string;
/**
 * UTF-8 metni CP857 (PC Turkish) bayt dizisine cevirir.
 * ESC/POS yazicilar UTF-8 anlamaz; bu donusum olmadan Turkce karakterler bozulur.
 */
export declare function toCP857(text: string): Uint8Array;
//# sourceMappingURL=text.d.ts.map