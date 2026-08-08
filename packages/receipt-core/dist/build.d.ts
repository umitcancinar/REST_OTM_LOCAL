import { type ReceiptDoc, type ReceiptInput } from './types';
/**
 * Kullanicinin verdigi alt boslugu donanimsal guvenlik tabaniyla birlestirir.
 * Kalibrasyon fisi de bunu kullanir: teshis araci, teshis ettigi seyden farkli
 * davranirsa yaniltir.
 */
export declare function cutClearanceMm(kind: ReceiptInput['kind'], bottomMarginMm: number): number;
/**
 * Fisin tamamini satir modeline cevirir.
 * `kind` yalnizca varsayilan basligi ve odeme bloklarinin gosterimini etkiler.
 */
export declare function buildReceiptDoc(input: ReceiptInput): ReceiptDoc;
//# sourceMappingURL=build.d.ts.map