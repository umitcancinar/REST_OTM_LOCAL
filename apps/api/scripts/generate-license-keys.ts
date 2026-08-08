// ==========================================
// Lisans imza anahtar cifti uretimi
// ==========================================
// BIR KEZ calistirilir. Uretilen cift:
//
//   OZEL anahtar  -> yalnizca bulut API'sinin LICENSE_PRIVATE_KEY ortam
//                    degiskenine konur. Repoya, musteri paketine veya
//                    loglara ASLA girmez.
//   ACIK anahtar  -> musteriye giden pakete gomulur. Gizli degildir;
//                    yalnizca dogrulama yapar, lisans uretemez.
//
// Ozel anahtar kaybolursa mevcut lisanslar dogrulanmaya devam eder ama
// YENI lisans uretilemez. Sizarsa herkes kendine sinirsiz lisans
// uretebilir — o durumda anahtar cifti yenilenip tum musterilere yeni
// surum dagitilmasi gerekir.
//
// Kullanim:
//   npx ts-node scripts/generate-license-keys.ts

import { generateKeyPair } from '@rest-otm/license/sign';

const { publicKeyPem, privateKeyPem } = generateKeyPair();

const line = '='.repeat(72);

console.log(`\n${line}`);
console.log(' OZEL ANAHTAR — yalnizca bulut sunucusunun ortam degiskenine');
console.log(' Render > Environment > LICENSE_PRIVATE_KEY');
console.log(' Parola yoneticisinde de bir yedegini sakla.');
console.log(line);
console.log(privateKeyPem.trim());

console.log(`\n${line}`);
console.log(' ACIK ANAHTAR — musteri paketine gomulecek');
console.log(' packages/license/src/public-key.ts icine yazilir');
console.log(line);
console.log(publicKeyPem.trim());

console.log(`\n${line}`);
console.log(' Render ortam degiskenine yapistirmak icin tek satirlik hali:');
console.log(line);
console.log(JSON.stringify(privateKeyPem));
console.log();
