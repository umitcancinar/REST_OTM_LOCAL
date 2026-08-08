import { type ReceiptDoc, type ReceiptInput, type ReceiptLayout } from './types';
/**
 * Kalibrasyon dokumanini uretir. Gercek fislerle ayni renderEscPos akisindan
 * gecer; yani burada dogru cikan bir olcu, gercek fiste de dogru cikar.
 */
export declare function buildCalibrationDoc(layout: ReceiptLayout, kind?: ReceiptInput['kind']): ReceiptDoc;
/** Kalibrasyon fisinin cetvel araligi — testler ve loglar icin. */
export declare const CALIBRATION_INFO: {
    mmPerLine: number;
    markEvery: number;
    rulerLines: number;
    rulerSpanMm: number;
};
//# sourceMappingURL=calibration.d.ts.map