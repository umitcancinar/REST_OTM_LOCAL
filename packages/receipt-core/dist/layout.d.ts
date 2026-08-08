import { type PrintLayoutKey, type ReceiptLabels, type ReceiptLayout } from './types';
export declare const PRINT_LAYOUT_KEYS: PrintLayoutKey[];
export declare const MAX_TOP_MARGIN_MM = 60;
export declare const MAX_BOTTOM_MARGIN_MM = 80;
export declare const MAX_SIDE_MARGIN_MM = 20;
export declare const DEFAULT_LABELS: ReceiptLabels;
export declare function defaultLayout(key: PrintLayoutKey): ReceiptLayout;
/**
 * Kaydedilmis (muhtemelen eski surum) bir layout nesnesini tam ve guvenli
 * bir ReceiptLayout'a cevirir. Eksik alanlar varsayilanla doldurulur.
 */
export declare function normalizeLayout(raw: unknown, key: PrintLayoutKey, restaurantName?: string): ReceiptLayout;
/** Tum sablonlari tek seferde normalize eder. */
export declare function normalizeAllLayouts(raw: unknown, restaurantName?: string): Record<PrintLayoutKey, ReceiptLayout>;
//# sourceMappingURL=layout.d.ts.map