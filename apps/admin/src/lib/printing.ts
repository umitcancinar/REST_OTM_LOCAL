// ==========================================
// Printing Utility — Dynamic Receipt Generation + API Print
// ==========================================
//
// Yazdırma mimarisi:
// 1. API çağrısı yapılır → API WebSocket üzerinden print job yayınlar
// 2. Print Agent (lokal) job'u alır → ESC/POS yazıcıya gönderir
// 3. Agent ya da yazıcı ulaşılamazsa hata kullanıcıya gösterilir.
//    Tarayıcı/macOS yazdırma diyaloğu hiçbir zaman kullanılmaz.
//
// Fırın  yazıcısı → 192.168.1.203 : 9100
// Izgara yazıcısı → 192.168.1.202 : 9100
// ==========================================

import { api } from './api';

// Fis sablonu tipleri ve varsayilanlari ARTIK @rest-otm/receipt-core icinde.
// Admin onizlemesi, API ve print-agent ayni kodu kullanir; bu sayede ekranda
// gorulen fis ile yaziciden cikan fis birebir aynidir.
export type {
  Align,
  ElementKey,
  ElementStyle,
  PaperWidth,
  PrintLayoutKey,
  ReceiptDoc,
  ReceiptLabels,
  ReceiptLayout,
  Scale,
} from '@rest-otm/receipt-core';

export {
  DEFAULT_LABELS,
  ELEMENT_KEYS,
  ELEMENT_LABELS,
  MAX_BOTTOM_MARGIN_MM,
  MAX_SIDE_MARGIN_MM,
  MAX_TOP_MARGIN_MM,
  PAPER_COLUMNS,
  PRINT_LAYOUT_KEYS,
  buildReceiptDoc,
  defaultLayout,
  normalizeAllLayouts,
  normalizeLayout,
  padForAlign,
} from '@rest-otm/receipt-core';

import {
  PRINT_LAYOUT_KEYS as LAYOUT_KEYS,
  defaultLayout as buildDefaultLayout,
  normalizeAllLayouts as normalizeAll,
  type PrintLayoutKey as LayoutKey,
  type ReceiptLayout as Layout,
} from '@rest-otm/receipt-core';

/** Geriye donuk ad: tum sablonlarin sozlugu. */
export type PrintLayout = Layout;
export type PrintSettings = Record<LayoutKey, Layout>;

export const DEFAULT_PRINT_SETTINGS: PrintSettings = LAYOUT_KEYS.reduce((result, key) => {
  result[key] = buildDefaultLayout(key);
  return result;
}, {} as PrintSettings);

/** Kaydedilmis ayarlari (eski surum dahil) tam ve guvenli sablonlara cevirir. */
export function mergePrintSettings(value: unknown): PrintSettings {
  return normalizeAll(value);
}

// ==========================================
// API-based Printing — ESC/POS via Print Agent
// ==========================================

export type PrintJobResult = {
  jobId:      string;
  printer:    string;
  ip?:        string;
  port?:      number;
  queued?:    boolean;   // true = agent veya yazıcı erişilemedi
  error?:     string;
  department?: string;
};

export type StationPrintResult = {
  success: boolean;
  queued?: boolean;
  jobs: Array<PrintJobResult & { success: boolean; itemCount: number }>;
  printedStations: Array<'KITCHEN' | 'GRILL'>;
  error?: string;
};

/**
 * FIRIN yazıcısına fiş gönder (192.168.1.203:9100).
 *
 * Akış:
 *  1. API'ye istek → API WebSocket üzerinden print agent'a job yayınlar
 *  2a. Agent varsa → ESC/POS yazıcıya gönderir → başarı
 *  2b. Agent/yazıcı yoksa hata döner. Tarayıcı yazdırma fallback'i yoktur.
 */
async function sendPrint(path: string, orderId: string): Promise<PrintJobResult> {
  const result: PrintJobResult = await api.post(path, { orderId });
  if (result?.queued) {
    throw new Error(result.error || 'Yazıcı agentı veya seçilen yazıcı yanıt vermedi.');
  }
  return result;
}

export function sendKitchenPrint(orderId: string): Promise<PrintJobResult> {
  return sendPrint('/printers/print-kitchen', orderId);
}

export function sendGrillPrint(orderId: string): Promise<PrintJobResult> {
  return sendPrint('/printers/print-grill', orderId);
}

export async function sendStationPrint(orderId: string): Promise<StationPrintResult> {
  const result: StationPrintResult = await api.post('/printers/print-stations', { orderId });
  if (!result.success) throw new Error(result.error || 'Mutfak fişlerinden biri yazdırılamadı.');
  return result;
}

export function sendBillPrint(orderId: string): Promise<PrintJobResult> {
  return sendPrint('/printers/print-bill', orderId);
}

export async function sendPaketPrint(orderId: string, printerId?: string, paymentMethod?: string): Promise<PrintJobResult> {
  const result: PrintJobResult = await api.post('/printers/print-paket', { orderId, printerId, paymentMethod });
  if (result?.queued) throw new Error(result.error || 'Yazıcı agentı veya seçilen yazıcı yanıt vermedi.');
  return result;
}
