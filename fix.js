const fs = require('fs');

const paths = [
  '/Users/umitcancinar/Desktop/x/projeler/RESTORAN/REST_OTM/apps/waiter/src/components/OrderItemModal.tsx',
  '/Users/umitcancinar/Desktop/x/projeler/RESTORAN/REST_OTM/apps/admin/src/components/OrderItemModal.tsx',
];

paths.forEach(p => {
  if (!fs.existsSync(p)) return;
  let code = fs.readFileSync(p, 'utf-8');

  // Replace DECIMAL_STEPS and formatQty block
  code = code.replace(/\/\/ Decimal quantity steps.*?MAX_QUICK_QTY = 12;/s, 'const MAX_QUICK_QTY = 20;');
  code = code.replace(/function formatQty\(n: number\): string \{[\s\S]*?\}\n/s, '');
  
  // Waiter has formatQty, Admin might have formatFrac
  code = code.replace(/function formatFrac\(n: number\): string \{[\s\S]*?\}\n/s, '');

  // Remove states
  code = code.replace(/const \[useDecimal, setUseDecimal\] = useState\(false\);\n\s*const \[decimalQty, setDecimalQty\] = useState\(0\.25\);/g, '');
  
  // Remove resets in useEffect
  code = code.replace(/setUseDecimal\(false\);\n\s*setDecimalQty\(0\.25\);/g, '');
  
  // Update effectiveQty
  code = code.replace(/const effectiveQty = useDecimal \? decimalQty : qty;/g, 'const effectiveQty = qty;');

  // Update footer button text in Waiter (has {}) and Admin (no {})
  code = code.replace(/\{useDecimal \? `\$\{decimalQty\} Porsiyon` : `\$\{qty\} Adet`\} Ekle/g, '{qty} Adet Ekle');

  // Replace decrement/increment functions
  code = code.replace(/\/\/ Integer qty controls\n\s*const decrementQty = \(\) => setQty\(\(q\) => Math\.max\(1, q - 1\)\);\n\s*const incrementQty = \(\) => setQty\(\(q\) => Math\.min\(MAX_QUICK_QTY, q \+ 1\)\);/g, 
`  const decrementQty = () => setQty((prev) => {
    if (prev <= 0.25) return 0.25;
    if (prev <= 1) return prev - 0.25;
    if (prev <= 2) return prev - 0.5;
    return prev - 1;
  });

  const incrementQty = () => setQty((prev) => {
    if (prev < 1) return prev + 0.25;
    if (prev < 2) return prev + 0.5;
    return Math.min(MAX_QUICK_QTY, prev + 1);
  });`);

  // In admin: it might have inline math for qty: setQty(Math.max(1, qty - 1))
  code = code.replace(/setQty\(Math\.max\(1, qty - 1\)\)/g, 'decrementQty()');
  code = code.replace(/setQty\(Math\.min\(50, qty \+ 1\)\)/g, 'incrementQty()');

  // Delete everything related to useDecimal UI
  // The toggle block
  code = code.replace(/\{\/\* Toggle.*?<\/div>\n\s*<\/div>\n\s*\{\!useDecimal \? \(/s, '</div>\n');
  
  // Admin toggle block
  code = code.replace(/\{\/\* Toggle \*\/\}.*?\{\!useDecimal \? \(/s, '');
  
  // Waiter Decimal UI end
  code = code.replace(/\) : \([\s\S]*?\/\* Decimal quantity grid \*\/[\s\S]*?\}\n\s*<\/div>\n\s*\)\}/s, '}');

  // Admin Decimal UI end
  code = code.replace(/\) : \([\s\S]*?\/\* Decimal \*\/\s*<div[\s\S]*?<\/div>\n\s*<\/div>\n\s*\)\}/s, '}');
  
  // Check if we need to remove remaining toggle/decimal logic for admin
  const adminToggleStart = code.indexOf('{/* Toggle */}');
  if (adminToggleStart !== -1) {
      const adminDecimalEnd = code.indexOf(')}', adminToggleStart);
      if(adminDecimalEnd !== -1) {
          // just remove the whole useDecimal block in Admin manually here
      }
  }

  fs.writeFileSync(p, code);
  console.log('Processed', p);
});
