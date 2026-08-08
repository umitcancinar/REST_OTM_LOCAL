const fs = require('fs');

const files = [
  'apps/admin/src/lib/printing.ts',
  'apps/superadmin/src/lib/printing.ts',
  'apps/waiter/src/lib/printing.ts'
];

files.forEach(file => {
  let content = fs.readFileSync(file, 'utf8');

  // Fix 1: Filter by department
  content = content.replace(
    /items\.filter\(\(i: any\) => i\.status !== 'CANCELLED'\)\.map\(\(item: any\) => `/g,
    `items.filter((i: any) => i.status !== 'CANCELLED' && (!isStation || i.department === type)).map((item: any) => \``
  );

  // Fix 2: hideLogo
  content = content.replace(
    /\$\{layout\.logoUrl \? \`<img src="\$\{layout\.logoUrl\}" class="logo" \/>\` : ''\}/g,
    `\${!layout.hideLogo && layout.logoUrl ? \`<img src="\${layout.logoUrl}" class="logo" />\` : ''}`
  );
  content = content.replace(
    /\(layout\.logoUrl \? \`<img src="\$\{layout\.logoUrl\}" class="logo" style="margin-bottom: 10px;" \/>\` : ''\)/g,
    `(!layout.hideLogo && layout.logoUrl ? \`<img src="\${layout.logoUrl}" class="logo" style="margin-bottom: 10px;" />\` : '')`
  );

  // Fix 3: inlineDateMasa
  const infoGridRegex = /<div class="info-grid">[\s\S]*?<\/div>/;
  const newInfoGrid = `
        <div class="info-grid">
          \${layout.inlineDateMasa ? \`
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dotted #000; padding-bottom: 4px; margin-bottom: 8px;">
              <div>Tarih: \${new Date().toLocaleDateString('tr-TR')}<br/>Saat: \${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</div>
              <div style="text-align: right;">
                <span class="order-no" style="font-size: 16px;">Fiş No: \${escapeHtml(order.orderNumber)}</span><br/>
                \${order.table ? \`<span style="font-size: 14px; font-weight: 800;">MASA: \${order.table.number}</span>\` : ''}
              </div>
            </div>
          \` : \`
            <div class="info-row"><span class="info-label">Tarih:</span> <span>\${new Date().toLocaleDateString('tr-TR')}</span></div>
            <div class="info-row"><span class="info-label">Saat:</span> <span>\${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span></div>
            <div class="order-no">Fiş No: \${escapeHtml(order.orderNumber)}</div>
            \${order.table ? \`<div style="font-size: 16px; font-weight: 800;">MASA: \${order.table.number}</div>\` : ''}
          \`}
          \${order.waiter ? \`<div style="font-size: 12px;">Garson: \${escapeHtml(order.waiter.name)}</div>\` : ''}
        </div>`;
  content = content.replace(infoGridRegex, newInfoGrid.trim());

  // Fix 4: hidePrices
  content = content.replace(
    /\$\{!isStation \? '<th style="text-align: right;">TUTAR<\/th>' : ''\}/g,
    `\${!isStation && !layout.hidePrices ? '<th style="text-align: right;">TUTAR</th>' : ''}`
  );
  content = content.replace(
    /\$\{!isStation \? \`<td style="text-align: right; font-weight: 700; font-size: 14px;">\$\{Number\(item\.totalPrice\)\.toFixed\(2\)\}<\/td>\` : ''\}/g,
    `\${!isStation && !layout.hidePrices ? \`<td style="text-align: right; font-weight: 700; font-size: 14px;">\${Number(item.totalPrice).toFixed(2)}</td>\` : ''}`
  );

  // Fix 5: boldItems and doubleSizeItems
  content = content.replace(
    /<div class="item-name">/g,
    `<div class="item-name" style="\${layout.boldItems ? 'font-weight: 900;' : ''} \${layout.doubleSizeItems ? 'font-size: 18px;' : ''}">`
  );

  fs.writeFileSync(file, content, 'utf8');
  console.log('Updated ' + file);
});
