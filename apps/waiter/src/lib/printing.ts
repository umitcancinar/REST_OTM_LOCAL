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

export interface PrintLayout {
  logoUrl?: string;
  logoPosition?: 'left' | 'center' | 'right';
  logoWidth?: number;
  paperWidth?: 58 | 80;
  headerText?: string;
  subHeaderText?: string;
  footerText?: string;
  receiptTitle?: string;
  hideLogo?: boolean;
  hideHeader?: boolean;
  hidePrices?: boolean;
  boldItems?: boolean;
  doubleSizeItems?: boolean;
  inlineDateMasa?: boolean;
  doubleSizeTable?: boolean;
  topMarginMm?: number;
}

export interface PrintSettings {
  KITCHEN?: PrintLayout;
  GRILL?: PrintLayout;
  CASHIER?: PrintLayout;
  PAKET?: PrintLayout;
}

export const DEFAULT_PRINT_SETTINGS: PrintSettings = {
  KITCHEN: {
    paperWidth: 80,
    logoPosition: 'center',
    logoWidth: 50,
    headerText: '',
    receiptTitle: 'FIRIN FİŞİ',
    footerText: 'AFİYET OLSUN',
    hidePrices: true,
    boldItems: true,
    hideHeader: false,
    doubleSizeTable: false,
    topMarginMm: 0,
  },
  GRILL: {
    paperWidth: 80,
    logoPosition: 'center',
    logoWidth: 50,
    headerText: '',
    receiptTitle: 'IZGARA FİŞİ',
    footerText: 'AFİYET OLSUN',
    hidePrices: true,
    boldItems: true,
    hideHeader: false,
    doubleSizeTable: false,
    topMarginMm: 0,
  },
  CASHIER: {
    paperWidth: 80,
    logoPosition: 'center',
    logoWidth: 50,
    headerText: 'İŞLETME ADI',
    receiptTitle: 'ADİSYON',
    footerText: 'AFİYET OLSUN YİNE BEKLERİZ',
    hideHeader: false,
    doubleSizeTable: false,
    topMarginMm: 0,
  },
  PAKET: {
    paperWidth: 80,
    logoPosition: 'center',
    logoWidth: 50,
    headerText: 'İŞLETME ADI',
    receiptTitle: 'PAKET SİPARİŞ',
    footerText: 'AFİYET OLSUN YİNE BEKLERİZ',
    hideHeader: false,
    doubleSizeTable: false,
    topMarginMm: 0,
  },
};

/** Sanitize user input to prevent XSS in receipt HTML */
function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function generateReceiptHtml(
  order: any,
  type: 'KITCHEN' | 'GRILL' | 'CASHIER' | 'PAKET',
  tenantSettings?: any
) {
  const settings: PrintSettings = tenantSettings?.printLayouts || DEFAULT_PRINT_SETTINGS;

  let layoutKey: keyof PrintSettings = type;
  if (type === 'PAKET' && !settings.PAKET) layoutKey = 'CASHIER';

  const layout: PrintLayout = {
    ...DEFAULT_PRINT_SETTINGS[layoutKey],
    ...(settings[layoutKey] || {}),
  };

  const isStation = type === 'KITCHEN' || type === 'GRILL';
  const belongsToStation = (department: string) =>
    type === 'KITCHEN'
      ? ['KITCHEN', 'COLD', 'PASTRY'].includes(department)
      : type === 'GRILL'
        ? department === 'GRILL'
        : true;
  const title =
    layout.receiptTitle ||
    (type === 'CASHIER'
      ? 'ADİSYON'
      : type === 'PAKET'
      ? 'PAKET SİPARİŞ'
      : type === 'GRILL'
      ? 'IZGARA FİŞİ'
      : 'FIRIN FİŞİ');
  const items = order.subChecks?.flatMap((sc: any) => sc.items) || [];

  const getLogoStyles = () => {
    const align = layout.logoPosition || 'center';
    const width = layout.logoWidth || 50;
    let margin = '0 auto';
    if (align === 'left') margin = '0 auto 0 0';
    if (align === 'right') margin = '0 0 0 auto';
    return `display: block; width: ${width}mm; max-width: 100%; margin: ${margin};`;
  };

  return `
    <html>
      <head>
        <title>${title} - ${order.orderNumber}</title>
        <style>
          @page { margin: 0; }
          body {
            font-family: 'Arial', sans-serif;
            width: ${layout.paperWidth === 58 ? 58 : 80}mm;
            padding: ${5 + Math.min(30, Math.max(0, Number(layout.topMarginMm) || 0))}mm 5mm 5mm;
            margin: 0;
            font-size: 13px;
            line-height: 1.4;
            color: #000;
          }
          .branding {
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            justify-content: ${layout.logoPosition === 'left' ? 'flex-start' : layout.logoPosition === 'right' ? 'flex-end' : 'center'};
            gap: 10px;
          }
          .logo { ${getLogoStyles()} }
          .brand-info { display: flex; flex-direction: column; text-align: ${layout.logoPosition || 'center'}; }
          .title { text-align: center; font-size: 18px; font-weight: 800; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 5px 0; margin: 10px 0; }
          .info-grid { margin-bottom: 10px; font-size: 12px; }
          .info-row { display: flex; justify-content: flex-start; gap: 10px; margin-bottom: 2px; }
          .info-label { width: 70px; font-weight: 600; }
          .order-no { font-size: 20px; font-weight: 900; margin: 5px 0; }
          .table-number { font-size: ${layout.doubleSizeTable ? 28 : 16}px; font-weight: 900; line-height: 1.1; }
          table { width: 100%; border-collapse: collapse; margin-top: 5px; table-layout: fixed; }
          th { text-align: left; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 5px; }
          th:nth-child(1) { width: 55%; }
          th:nth-child(2) { width: 20%; text-align: center; }
          th:nth-child(3) { width: 25%; text-align: right; }
          td { padding: 6px 0; vertical-align: top; border-bottom: 1px dashed #ccc; word-wrap: break-word; overflow-wrap: break-word; }
          .item-name { font-size: 14px; font-weight: 800; text-transform: uppercase; line-height: 1.2; padding-right: 5px; }
          .total-section { border-top: 2px solid #000; margin-top: 10px; padding-top: 8px; text-align: right; }
          .total-val { font-size: 20px; font-weight: 900; }
          .customer-box { background: #f0f0f0; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-weight: 700; word-break: break-word; }
          .notes { font-style: italic; color: #000; font-size: 13px; font-weight: 800; margin-top: 6px; border-left: 3px solid #000; padding-left: 6px; background-color: #f9f9f9; padding-top: 2px; padding-bottom: 2px; border-radius: 0 4px 4px 0; line-height: 1.3; }
          .footer { margin-top: 20px; font-size: 11px; font-weight: 700; text-align: center; border-top: 1px dashed #000; padding-top: 10px; }
        </style>
      </head>
      <body>
        ${!isStation ? `
        <div class="branding">
          ${!layout.hideLogo && layout.logoUrl ? `<img src="${layout.logoUrl}" class="logo" />` : ''}
          <div class="brand-info">
            ${!layout.hideHeader && layout.headerText ? `<div style="font-size: 18px; font-weight: 900; line-height: 1.1;">${layout.headerText}</div>` : ''}
            ${layout.subHeaderText ? `<div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; margin-top: 2px;">${layout.subHeaderText}</div>` : ''}
          </div>
        </div>
        ` : (!layout.hideLogo && layout.logoUrl ? `<img src="${layout.logoUrl}" class="logo" style="margin-bottom: 10px;" />` : '')}

        <div class="title">${title}</div>

        ${type === 'PAKET' && order.customer ? `
          <div class="customer-box">
            <div style="font-size: 16px;">${escapeHtml(order.customer.name)}</div>
            <div style="font-size: 14px;">${escapeHtml(order.customer.phone)}</div>
            <div style="font-size: 12px; margin-top: 4px;">${escapeHtml(order.customer.address || 'Adres Belirtilmemiş')}</div>
          </div>
        ` : ''}

        <div class="info-grid">
          ${layout.inlineDateMasa ? `
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #000; padding-bottom: 4px; margin-bottom: 8px;">
              <div>Tarih: ${new Date().toLocaleDateString('tr-TR')}<br/>Saat: ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
              <div style="text-align: right;">
                <span class="order-no" style="font-size: 16px;">Fiş No: ${escapeHtml(order.orderNumber)}</span><br/>
                ${order.table ? `<span class="table-number">MASA: ${order.table.number}</span>` : ''}
              </div>
            </div>
          ` : `
            <div class="info-row"><span class="info-label">Tarih:</span> <span>${new Date().toLocaleDateString('tr-TR')}</span></div>
            <div class="info-row"><span class="info-label">Saat:</span> <span>${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span></div>
            <div class="order-no">Fiş No: ${escapeHtml(order.orderNumber)}</div>
            ${order.table ? `<div class="table-number">MASA: ${order.table.number}</div>` : ''}
          `}
          ${order.waiter ? `<div style="font-size: 12px;">Garson: ${escapeHtml(order.waiter.name)}</div>` : ''}
        </div>
        <table>
          <thead>
            <tr>
              <th>ÜRÜNLER</th>
              <th style="text-align: center;">ADET</th>
              ${!isStation && !layout.hidePrices ? '<th style="text-align: right;">TUTAR</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${items
              .filter((i: any) => i.status !== 'CANCELLED' && (!isStation || belongsToStation(i.department)))
              .map(
                (item: any) => `
              <tr>
                <td>
                  <div class="item-name" style="${layout.boldItems ? 'font-weight: 900;' : ''} ${layout.doubleSizeItems ? 'font-size: 18px;' : ''}">
                    ${escapeHtml(item.menuItemName)} ${item.portionOption !== 'Normal' ? `(${escapeHtml(item.portionOption)})` : ''}
                    ${item.isTreat ? ' [İKRAM]' : ''}
                  </div>
                  ${item.notes && !item.notes.includes('[İKRAM]') ? `<div class="notes">📌 NOT: ${escapeHtml(item.notes)}</div>` : ''}
                </td>
                <td style="font-size: 18px; font-weight: 900; text-align: center;">${item.quantity}</td>
                ${!isStation && !layout.hidePrices ? `<td style="text-align: right; font-weight: 700; font-size: 14px;">${Number(item.totalPrice).toFixed(2)}</td>` : ''}
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>

        ${!isStation ? `
        <div class="total-section">
          <div style="font-size: 12px; font-weight: 700;">TOPLAM (KDV DAHİL)</div>
          <div class="total-val">₺${Number(order.grandTotal).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</div>
        </div>
        ` : ''}

        <div class="footer">
          ${layout.footerText || 'AFİYET OLSUN YİNE BEKLERİZ'}
          <div style="font-size: 8px; margin-top: 5px; opacity: 0.5;">REST_OTM v1.2</div>
        </div>

      </body>
    </html>
  `;
}

// ==========================================
// API-based Printing — ESC/POS via Print Agent
// ==========================================

export type PrintJobResult = {
  jobId:      string;
  printer:    string;
  ip?:        string;
  port?:      number;
  queued?:    boolean;
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
