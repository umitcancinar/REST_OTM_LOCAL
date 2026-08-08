// ==========================================
// Printing Utility — Dynamic Receipt Generation
// ==========================================

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
  hidePrices?: boolean;
  boldItems?: boolean;
  doubleSizeItems?: boolean;
  inlineDateMasa?: boolean;
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
  },
  CASHIER: {
    paperWidth: 80,
    logoPosition: 'center',
    logoWidth: 50,
    headerText: 'İŞLETME ADI',
    receiptTitle: 'ADİSYON',
    footerText: 'AFİYET OLSUN YİNE BEKLERİZ',
  },
  PAKET: {
    paperWidth: 80,
    logoPosition: 'center',
    logoWidth: 50,
    headerText: 'İŞLETME ADI',
    receiptTitle: 'PAKET SİPARİŞ',
    footerText: 'AFİYET OLSUN YİNE BEKLERİZ',
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
  
  // Map internal types to settings keys — each type uses its own layout
  let layoutKey: keyof PrintSettings = type;
  // Fallback: if PAKET layout doesn't exist, use CASHIER
  if (type === 'PAKET' && !settings.PAKET) layoutKey = 'CASHIER';

  const layout: PrintLayout = { 
    ...DEFAULT_PRINT_SETTINGS[layoutKey], 
    ...(settings[layoutKey] || {}) 
  };

  const isStation = type === 'KITCHEN' || type === 'GRILL';
  const title = layout.receiptTitle || (type === 'CASHIER' ? 'ADİSYON' : type === 'PAKET' ? 'PAKET SİPARİŞ' : 'MUTFAK FİŞİ');
  
  const items = order.subChecks?.flatMap((sc: any) => sc.items) || [];

  // Helper for logo positioning
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
            padding: 5mm; 
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
          .brand-info {
            display: flex;
            flex-direction: column;
            text-align: ${layout.logoPosition || 'center'};
          }
          
          .title { text-align: center; font-size: 18px; font-weight: 800; border-top: 2px solid #000; border-bottom: 2px solid #000; padding: 5px 0; margin: 10px 0; }
          
          .info-grid { margin-bottom: 10px; font-size: 12px; }
          .info-row { display: flex; justify-content: flex-start; gap: 10px; margin-bottom: 2px; }
          .info-label { width: 70px; font-weight: 600; }
          
          .order-no { font-size: 20px; font-weight: 900; margin: 5px 0; }
          
          table { width: 100%; border-collapse: collapse; margin-top: 5px; }
          th { text-align: left; font-size: 12px; border-bottom: 1px solid #000; padding-bottom: 5px; }
          td { padding: 6px 0; vertical-align: top; border-bottom: 0.5px solid #eee; }
          
          .total-section { border-top: 2px solid #000; margin-top: 10px; padding-top: 8px; text-align: right; }
          .total-val { font-size: 20px; font-weight: 900; }
          
          .customer-box { background: #f0f0f0; padding: 8px; border-radius: 4px; margin-bottom: 10px; font-weight: 700; }
          .notes { font-style: italic; color: #333; font-size: 11px; margin-top: 4px; border-left: 2px solid #000; padding-left: 5px; }
          .footer { margin-top: 20px; font-size: 11px; font-weight: 700; text-align: center; border-top: 1px dashed #000; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="branding">
          ${!layout.hideLogo && layout.logoUrl ? `<img src="${layout.logoUrl}" class="logo" />` : ''}
          <div class="brand-info">
            ${layout.headerText ? `<div style="font-size: 18px; font-weight: 900; line-height: 1.1;">${layout.headerText}</div>` : ''}
            ${layout.subHeaderText ? `<div style="font-size: 11px; font-weight: 800; letter-spacing: 1px; margin-top: 2px;">${layout.subHeaderText}</div>` : ''}
          </div>
        </div>

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
                ${order.table ? `<span style="font-size: 14px; font-weight: 800;">MASA: ${order.table.number}</span>` : ''}
              </div>
            </div>
          ` : `
            <div class="info-row"><span class="info-label">Tarih:</span> <span>${new Date().toLocaleDateString('tr-TR')}</span></div>
            <div class="info-row"><span class="info-label">Saat:</span> <span>${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span></div>
            <div class="order-no">Fiş No: ${escapeHtml(order.orderNumber)}</div>
            ${order.table ? `<div style="font-size: 16px; font-weight: 800;">MASA: ${order.table.number}</div>` : ''}
          `}
          ${order.waiter ? `<div style="font-size: 12px;">Garson: ${escapeHtml(order.waiter.name)}</div>` : ''}
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 50%">ÜRÜNLER</th>
              <th style="width: 20%; text-align: center;">ADET</th>
              ${!isStation && !layout.hidePrices ? '<th style="width: 30%; text-align: right;">TUTAR</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${items.filter((i: any) => i.status !== 'CANCELLED' && (!isStation || i.department === type)).map((item: any) => `
              <tr>
                <td>
                  <div style="font-size: 14px; font-weight: 800; text-transform: uppercase;">
                    ${escapeHtml(item.menuItemName)} ${item.portionOption !== 'Normal' ? `(${escapeHtml(item.portionOption)})` : ''}
                    ${item.isTreat ? ' [İKRAM]' : ''}
                  </div>
                  ${item.notes ? `<div class="notes">NOT: ${escapeHtml(item.notes)}</div>` : ''}
                </td>
                <td style="font-size: 18px; font-weight: 900; text-align: center;">${item.quantity}</td>
                ${!isStation && !layout.hidePrices ? `<td style="text-align: right; font-weight: 700; font-size: 14px;">${Number(item.totalPrice).toFixed(2)}</td>` : ''}
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div class="total-section">
          <div style="font-size: 12px; font-weight: 700;">TOPLAM (KDV DAHİL)</div>
          <div class="total-val">₺${order.grandTotal.toLocaleString('tr-TR', { minimumFractionDigits: 2 })}</div>
        </div>

        <div class="footer">
          ${layout.footerText || 'AFİYET OLSUN YİNE BEKLERİZ'}
          <div style="font-size: 8px; margin-top: 5px; opacity: 0.5;">REST_OTM v1.1</div>
        </div>

      </body>
    </html>
  `;
}
