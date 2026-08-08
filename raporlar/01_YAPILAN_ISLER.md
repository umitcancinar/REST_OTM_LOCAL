# Yapılan İşler — 04.08.2026

Konu: **Yazıcı çıktı tasarımının gerçekten çalışması ve önizleme ile fiziksel
çıktının birebir aynı olması.**

---

## 1) Yeni paket: `packages/receipt-core`

Fişin nasıl görüneceğine dair TÜM karar burada verilir. Admin önizlemesi, API
ve print-agent aynı kodu çağırır.

| Dosya | Görevi |
|---|---|
| `src/types.ts` | Layout, öğe (`ElementKey`), satır (`DocLine`), doküman (`ReceiptDoc`) tipleri |
| `src/text.ts` | Sütun matematiği, kelime sarma (`wrapText`), boşluk koruyan sarma (`hardWrap`), hizalama (`padForAlign`), CP857 dönüşümü |
| `src/layout.ts` | Şablon varsayılanları, `normalizeLayout()`, **eski (v1) ayarların otomatik göçü** |
| `src/build.ts` | `buildReceiptDoc()` — fişi satır satır üretir (tek gerçek kaynak) |
| `src/escpos.ts` | `renderEscPos()` — satırları ESC/POS baytlarına çevirir |
| `package.json` / `tsconfig.json` | CommonJS `dist` üretir; hem Node hem Next.js tüketebilir |

Notlar:
- `Buffer` yerine `Uint8Array` kullanıldı → paket tarayıcıda da güvenle import edilebiliyor.
- Kaynak dosyalarda ham kontrol karakteri yok; regex `new RegExp('[\\x00-...]')` ile kuruluyor.

## 2) `apps/print-agent`

- `src/printer/escpos.ts` **ince bir adaptöre** dönüştürüldü; yerleşim hesapları
  artık `receipt-core`'da. Dışa açık API (`escpos.kitchenTicket`, `escpos.bill`,
  `escpos.init`, `turkishToCP857`, `logoWidthToPixels` …) **aynen korundu**.
- Eski sürüm silinmedi: `apps/print-agent/legacy/escpos.v1.ts.bak`
- `Baslat.bat` artık git pull + install + build + start yapıyor
  (eski hâli: `Baslat.v1.bat.bak`).
- `package.json` → `@rest-otm/receipt-core` bağımlılığı eklendi.

## 3) `apps/api`

- `src/modules/printing/print.service.ts`: yerel `PrintLayout` tipi,
  `DEFAULT_LAYOUTS` ve `normalizeLayout()` kaldırılıp `receipt-core`'a
  devredildi. `layout.hideHeader` kullanımları
  `layout.elements.header.visible` ile değiştirildi.
- `src/config/env.ts`: üretimde varsayılan ("CHANGE-ME") sır kullanılıyorsa
  başlangıçta yüksek sesle uyarı basılıyor.
- `src/websocket/socket.server.ts`: print-agent sırrı artık sabit zamanlı
  (`timingSafeEqual`) karşılaştırılıyor.

## 4) `apps/admin`

- `src/lib/printing.ts`: tipler ve varsayılanlar `receipt-core`'dan
  yeniden dışa aktarılıyor. `mergePrintSettings()` artık merkezî
  normalizasyonu çağırıyor. Kullanılmayan eski HTML fiş üreteci
  `printing.legacy.tsx.bak` olarak saklandı.
- `.../settings/ReceiptPreview.tsx`: **tamamen yeniden yazıldı.** Artık fişi
  kendisi çizmiyor; `buildReceiptDoc()` çıktısını monospace olarak basıyor.
  Eklenenler:
  - Üst/alt boşluk için **sürüklenebilir mavi şeritler** (0.5 mm adım)
  - Kesim çizgisi göstergesi
  - `Normal / İptal / İkram` önizleme modları
  - Satır yüksekliği ve karakter genişliği gerçek yazıcı ölçüsüne (3 mm / satır) oturtuldu
  - Eski hâli: `ReceiptPreview.v1.tsx.bak`
- `.../settings/page.tsx`:
  - **Öğe Bazlı Tasarım** paneli (21 öğe × göster/kalın/punto/hizalama)
  - **Fişteki Yazılar** paneli (23 metin: İPTAL, PAKET, TOPLAM, KALAN, ÜRÜN, ADET, TUTAR, ÖDENEN ÜRÜNLER, para birimi …)
  - Alt boşluk ve cihaz üst payı alanları
  - Adet/Tutar sütun genişliği, ayraç karakterleri
  - "Ödenen ürünleri altta yaz" seçeneği
  - Kaydetme artık `mergePrintSettings()` ile merkezî normalizasyon yapıyor
  - Ölü (display:none) eski önizleme bloğu kaldırıldı; eski hâli `page.v1.tsx.bak`
- `next.config.ts`: `transpilePackages: ['@rest-otm/receipt-core']`

## 5) Mevcut derleme hataları düzeltildi (yazıcıyla ilgisiz ama build'i kırıyordu)

- `apps/admin/.../orders/page.tsx` — `lucide-react` import bloğu kapatılmamıştı (`} from 'lucide-react';` eksikti). Admin uygulaması **hiç derlenmiyordu.**
- `apps/admin/.../tables/page.tsx` — `useCallback` iki kez import edilmişti.

## 6) Dağıtım / derleme zinciri

- `pnpm-lock.yaml`: `@rest-otm/receipt-core` importer'ları elle eklendi.
- `render.yaml`: build komutuna `--no-frozen-lockfile` ve receipt-core derlemesi eklendi.
- Kök `package.json`: `build` zincirinin başına receipt-core eklendi, `build:agent` script'i eklendi.

## 7) Testler

`apps/print-agent/test/receipt-core.test.js` (yeni, 7 test):

- Önizlemedeki her satırın ESC/POS akışında **aynı sırayla** yer aldığı
- Hiçbir satırın kağıt sütun sınırını aşmadığı (58 mm ve 80 mm)
- İptal/İkram fişlerinin kendi etiketlerini kullandığı
- PAKET yazısının özelleştirilebildiği
- Gizlenen öğenin hiç satır üretmediği
- Üst/alt boşluk mm değerlerinin dokümana birebir yansıdığı
- Eski (v1) ayarların kayıpsız göç ettiği

`test/escpos.test.js` içindeki 2 test yeni (ayarlanabilir) alt boşluk modeline
göre güncellendi.

**Sonuç: 22/22 test geçiyor. api / admin / print-agent / receipt-core TypeScript derlemeleri temiz.**

---

# Ek Tur — Sistem Geneli Güvenlik Taraması (04.08.2026, aynı gün 2. oturum)

Talep: "sistemin genelini tara, hata/güvenlik açığı/istememize rağmen
yansımayan her şeyi bul ve çöz."

## Bulunup düzeltilenler

1. **[KRİTİK] `GET /api/public/fix-tables`** — kimlik doğrulama olmadan
   **tüm restoranların** masalarını tek istekte silip yeniden yazabiliyordu.
   `POST` + `SUPER_ADMIN` + tek `tenantId` zorunluluğu eklendi.
   (Detay: `02_GUVENLIK_RAPORU.md` → G-00)
2. **[YÜKSEK] Müşteri tarafı "Garson Çağır" hiç çalışmıyordu** — menü
   uygulaması var olmayan bir adrese istek atıyordu. Doğru uç nokta
   (`POST /api/public/waiter/call/:slug`) eklendi; masa-tenant eşleşmesi
   sunucu tarafında doğrulanıyor. (G-13)
3. **[YÜKSEK] Logo indirmede SSRF** — `apps/print-agent/src/printer/image.ts`
   artık indirmeden önce hostname'i çözüp özel/yerel IP aralıklarını
   reddediyor. (G-03)
4. Güvenlik raporundaki G-05 ve G-01 bulguları gerçek risk seviyesine göre
   düzeltildi/güncellendi (ilk taramada biraz abartılmıştı / eksik netti).

## Doğrulama

`packages/receipt-core`, `apps/print-agent` (22/22 test), `apps/api`,
`apps/admin`, `apps/waiter`, `apps/menu`, `apps/superadmin` — hepsinin
TypeScript derlemesi hatasız.

## Bilerek yapılmayanlar (senin onayın gerekiyor)

- `env.ts` içindeki varsayılan-sır uyarısını `throw`'a çevirmek (Y-05) —
  Render'da hangi değişkenlerin dolu olduğunu göremediğim için canlı
  sistemi düşürme riski var.
- `GET /api/public/fix-tables`'ı tamamen kaldırmak — artık güvenli ama
  hâlâ orada duruyor; işi bittiyse kaldırılabilir.
