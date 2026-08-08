// ==========================================
// ESC/POS Adaptoru
// ==========================================
// Yerlesim/kolon hesaplari artik @rest-otm/receipt-core icinde yapilir.
// Bu dosya sadece agent'in bekledigi arayuzu (kitchenTicket / bill / ...)
// ortak motora baglar. Boylece admin onizlemesi ile fiziksel cikti
// BIREBIR ayni satirlardan olusur.
//
// Eski (v1) surum referans olarak legacy/escpos.v1.ts.bak icinde durmaktadir.

import {
  PAPER_PIXELS,
  buildCalibrationDoc,
  buildZReportDoc,
  type ZReportInput,
  buildReceiptDoc,
  cmd,
  logoWidthToPixels as coreLogoWidthToPixels,
  normalizeLayout,
  receiptHeightMm,
  renderEscPos,
  toCP857,
  type PaperWidth,
  type PrintLayoutKey,
  type ReceiptDoc,
  type ReceiptItemInput,
  type ReceiptLayout,
} from '@rest-otm/receipt-core';
import { createRasterImageBuffer } from './image';

/**
 * Ciktinin fiziksel olcusunu konsola yazar. Onizlemedeki fis boyu ile
 * karsilastirilabilsin diye; "ekranda baska, kagitta baska" sikayetinde
 * tahmin yurutmek yerine buradaki sayilara bakilir.
 */
function logMeasurements(label: string, doc: ReceiptDoc): void {
  console.log(
    `   📐 ${label}: ${doc.lines.length} satır | üst ${doc.topMarginMm}mm | ` +
    `alt ${doc.bottomMarginMm}mm | toplam ${receiptHeightMm(doc).toFixed(1)}mm`,
  );
}

/** Agent'a WebSocket ile gelen ham layout nesnesi (kismi olabilir). */
export type PrintLayout = Partial<ReceiptLayout> & Record<string, unknown>;

const ESC = '\x1B';
const GS = '\x1D';

/** Geriye donuk uyumluluk: mm -> yazici pikseli. */
export function logoWidthToPixels(value: unknown, paperWidth: PaperWidth): number {
  const widthMm = Math.min(paperWidth, Math.max(1, Number(value) || Math.min(50, paperWidth)));
  return coreLogoWidthToPixels(widthMm, PAPER_PIXELS[paperWidth]);
}

/** Geriye donuk uyumluluk: UTF-8 -> CP857 Buffer. */
export function turkishToCP857(text: string): Buffer {
  return Buffer.from(toCP857(text));
}

async function logoBufferFor(layout: ReceiptLayout): Promise<Buffer> {
  if (!layout.elements.logo.visible || !layout.logoUrl) return Buffer.alloc(0);
  return createRasterImageBuffer(
    layout.logoUrl,
    logoWidthToPixels(layout.logoWidth, layout.paperWidth),
    layout.logoPosition,
  );
}

export const escpos = {
  init: (): string => cmd.init(),
  align: (position: 'left' | 'center' | 'right'): string => cmd.align(position),
  bold: (on: boolean): string => cmd.bold(on),
  doubleSize: (on: boolean): string => `${GS}!${on ? '\x11' : '\x00'}`,
  quadSize: (on: boolean): string => `${GS}!${on ? '\x33' : '\x00'}`,
  giantSize: (on: boolean): string => `${ESC}!${on ? '\x30' : '\x00'}${GS}!${on ? '\x22' : '\x00'}`,
  underline: (on: boolean): string => `${ESC}-${on ? '\x01' : '\x00'}`,
  feed: (lines = 1): string => `${ESC}d${String.fromCharCode(Math.max(0, Math.min(255, lines)))}`,
  feedDots: (dots: number): string => cmd.feedDots(dots),
  cut: (): string => cmd.cut(),
  partialCut: (): string => `${GS}V\x01`,
  separator: (char = '-', width = 32): string => char.repeat(width) + '\n',

  /** Mutfak / izgara istasyon fisi. */
  async kitchenTicket(data: {
    orderNumber: string;
    tableNumber: number;
    waiterName?: string;
    department: 'KITCHEN' | 'GRILL';
    items: Array<{
      menuItemName: string;
      quantity: number;
      price?: number;
      portionOption: string;
      notes?: string | null;
    }>;
    timestamp: Date;
    layout?: PrintLayout;
    isCancel?: boolean;
    isTreat?: boolean;
  }): Promise<Buffer> {
    const key: PrintLayoutKey = data.department === 'GRILL' ? 'GRILL' : 'KITCHEN';
    const layout = normalizeLayout(data.layout, key);
    const items: ReceiptItemInput[] = data.items.map((item) => ({
      name: item.menuItemName,
      quantity: item.quantity,
      price: item.price,
      portionOption: item.portionOption,
      notes: item.notes,
    }));

    const doc = buildReceiptDoc({
      kind: 'STATION',
      layout,
      orderNumber: data.orderNumber,
      tableNumber: data.tableNumber,
      waiterName: data.waiterName,
      timestamp: data.timestamp,
      items,
      isCancel: data.isCancel,
      isTreat: data.isTreat,
    });

    logMeasurements(key, doc);
    return Buffer.from(renderEscPos(doc, await logoBufferFor(layout)));
  },

  /** Adisyon / paket fisi. */
  async bill(data: {
    restaurantName: string;
    orderNumber: string;
    tableNumber: number;
    waiterName: string;
    customer?: { name: string; phone?: string | null; address?: string | null };
    items: Array<{ name: string; quantity: number; price: number; notes?: string; isPaid?: boolean }>;
    total: number;
    timestamp: Date;
    payments?: Array<{ method: string; amount: number }>;
    layout?: PrintLayout;
    paymentMethod?: string | null;
    notes?: string | null;
    isCancel?: boolean;
    isTreat?: boolean;
  }): Promise<Buffer> {
    const key: PrintLayoutKey = data.tableNumber ? 'CASHIER' : 'PAKET';
    const layout = normalizeLayout(data.layout, key, data.restaurantName);

    const doc = buildReceiptDoc({
      kind: 'BILL',
      layout,
      orderNumber: data.orderNumber,
      tableNumber: data.tableNumber,
      waiterName: data.waiterName,
      timestamp: data.timestamp,
      items: data.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        notes: item.notes,
        isPaid: item.isPaid,
      })),
      total: data.total,
      payments: data.payments,
      paymentMethod: data.paymentMethod,
      customer: data.customer,
      notes: data.notes,
      isCancel: data.isCancel,
      isTreat: data.isTreat,
    });

    logMeasurements(key, doc);
    return Buffer.from(renderEscPos(doc, await logoBufferFor(layout)));
  },

  /** Kalibrasyon fisi — kendi beklenen olculerini kagida basar. */
  calibration(key: PrintLayoutKey, rawLayout?: PrintLayout): Buffer {
    const layout = normalizeLayout(rawLayout, key);
    // Istasyon yazicilarinin bicagi baski kafasindan daha uzakta; kalibrasyon
    // da gercek fisle ayni kesim payini kullanmali.
    const kind = key === 'KITCHEN' || key === 'GRILL' ? 'STATION' : 'BILL';
    const doc = buildCalibrationDoc(layout, kind);
    logMeasurements(`${key} kalibrasyon`, doc);
    return Buffer.from(renderEscPos(doc));
  },

  /** Z raporu — gun sonu ozeti (kasa yazicisina). */
  zReport(data: ZReportInput & { layout?: PrintLayout }): Buffer {
    const layout = normalizeLayout(data.layout, 'CASHIER', data.restaurantName);
    const doc = buildZReportDoc(layout, {
      ...data,
      // WebSocket uzerinden gelen tarih string'e donusur; Date'e geri cevir.
      printedAt: new Date(data.printedAt),
    });
    logMeasurements('Z raporu', doc);
    return Buffer.from(renderEscPos(doc));
  },

  /** e-Arsiv fatura bilgi fisi (degismedi). */
  invoiceInfo(data: {
    orderNumber: string;
    uuid: string;
    invoiceNo: string;
    totalAmount: number;
    customerName: string;
    pdfUrl?: string;
  }): string {
    let output = '';
    output += cmd.init();
    output += '\x07';
    output += cmd.align('center');
    output += cmd.bold(true);
    output += `${GS}!\x11`;
    output += 'e-Arşiv Fatura Bilgi Fişi\n';
    output += `${GS}!\x00`;
    output += cmd.bold(false);
    output += '='.repeat(32) + '\n';

    output += cmd.align('left');
    output += `Sayın: ${data.customerName}\n`;
    output += `Tarih: ${new Date().toLocaleString('tr-TR')}\n`;
    output += '-'.repeat(32) + '\n';
    output += `Fatura No : ${data.invoiceNo}\n`;
    output += `ETTN      : ${data.uuid}\n`;
    output += `Tutar     : ${data.totalAmount.toFixed(2)} TL\n`;
    output += '-'.repeat(32) + '\n';

    output += cmd.align('center');
    if (data.pdfUrl) {
      const urlLength = data.pdfUrl.length + 3;
      const pL = urlLength % 256;
      const pH = Math.floor(urlLength / 256);
      output += `\x1D\x28\x6B\x04\x00\x31\x41\x32\x00`;
      output += `\x1D\x28\x6B\x03\x00\x31\x43\x06`;
      output += `\x1D\x28\x6B\x03\x00\x31\x45\x31`;
      output += `\x1D\x28\x6B${String.fromCharCode(pL)}${String.fromCharCode(pH)}\x31\x50\x30${data.pdfUrl}`;
      output += `\x1D\x28\x6B\x03\x00\x31\x51\x30`;
      output += `${ESC}d\x01`;
      output += 'QR Kodu okutarak faturanizi\ngoruntuleyebilirsiniz.\n';
    }

    output += cmd.feedDots(180);
    output += cmd.cut();
    return output;
  },
};
