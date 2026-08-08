import { type ReceiptDoc, type ReceiptLayout } from './types';
export interface ZReportInput {
    /** Isletme adi — fisin tepesinde. */
    restaurantName: string;
    /** Rapor araligi, gosterime hazir metin olarak (orn. "05.08.2026"). */
    rangeLabel: string;
    /** Raporun alindigi an. */
    printedAt: Date;
    totalRevenue: number;
    totalOrders: number;
    avgOrderValue: number;
    /** Odeme yontemi -> tutar. Yontem anahtarlari API ile ayni. */
    paymentBreakdown: Record<string, number>;
    topSellingItems: Array<{
        name: string;
        count: number;
        revenue: number;
    }>;
    waiterPerformance: Array<{
        name: string;
        orders: number;
        revenue: number;
    }>;
}
export declare function buildZReportDoc(layout: ReceiptLayout, data: ZReportInput): ReceiptDoc;
//# sourceMappingURL=zreport.d.ts.map