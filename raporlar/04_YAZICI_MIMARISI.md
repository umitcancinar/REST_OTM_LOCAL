# Yazdırma Mimarisi (yeni)

## Sorun neydi?

Eskiden fiş **iki ayrı yerde** çiziliyordu:

1. `apps/admin/.../ReceiptPreview.tsx` → HTML/CSS ile ekranda
2. `apps/print-agent/src/printer/escpos.ts` → ESC/POS ile kağıtta

İki kod birbirinden habersizdi. Bir ayar değiştiğinde biri güncellenip diğeri
unutuluyordu; bu yüzden **ekranda görülen ile kağıttan çıkan hiçbir zaman
tutmuyordu.**

## Çözüm: tek render motoru

```
packages/receipt-core          ← TEK KAYNAK
   ├─ types.ts    → Layout / öğe / satır tipleri
   ├─ layout.ts   → varsayılanlar + normalizasyon + ESKİ AYAR GÖÇÜ
   ├─ text.ts     → sütun matematiği, sarma, hizalama, CP857
   ├─ build.ts    → buildReceiptDoc()  ⇐ fişi SATIR SATIR üretir
   └─ escpos.ts   → renderEscPos()     ⇐ satırları ESC/POS'a çevirir
```

Akış:

```
Admin "Çıktı Tasarımı"
      │  (layout nesnesi)
      ▼
buildReceiptDoc(layout, örnek sipariş)  ──► ReceiptDoc { lines[] }
      │                                          │
      │ ReceiptPreview.tsx                       │ print-agent
      ▼                                          ▼
 monospace <div> satırları              renderEscPos() → yazıcı
```

`ReceiptDoc.lines` içindeki her satır **zaten sarılmış, kırpılmış ve
padding'lenmiş** hâldedir. Önizleme onu olduğu gibi basar, yazıcı da olduğu
gibi basar. Bu yüzden aradaki fark sıfırdır.

## Öğe (element) sistemi

`ReceiptLayout.elements` altında 21 öğe var (`logo`, `header`, `title`,
`item`, `total`, `paymentMethod`, `cancelTitle`, `treatTitle`, `paidItems` …).
Her biri için: `visible`, `bold`, `align`, `scale` (1x/2x/3x/4x) ve isteğe
bağlı `text` (metin override'ı).

`ReceiptLayout.labels` altında kağıda basılan tüm sabit yazılar var
(`İPTAL FİŞİ`, `PAKET`, `TOPLAM`, `KALAN`, `ÜRÜN`, `ADET`, `TUTAR`,
`ÖDENEN ÜRÜNLER`, para birimi …). Hepsi admin panelinden değiştirilebilir.

## Boşluklar

| Alan | Anlamı |
|---|---|
| `topMarginMm` | Fiş başlamadan önce beslenecek kağıt (0–60 mm) |
| `bottomMarginMm` | Son satır ile kesim arasındaki kağıt (0–80 mm) |
| `deviceTopTrimMm` | Cihazın mekanik başlangıç payı; üst boşluktan düşülür |

Önizlemedeki mavi şeritler sürüklenerek 0.5 mm hassasiyetle ayarlanır.

**Varsayılanlar eski davranışı birebir korur:**
- İstasyon (Fırın/Izgara) alt boşluk `47.5 mm` = eski `feed(4) + 260 nokta`
- Adisyon/Paket alt boşluk `22.5 mm` = eski `180 nokta`
- Izgara `deviceTopTrimMm = 5` = eski `GRILL_TOP_TRIM_MM`

## Eski ayarların göçü

`normalizeLayout()` eski bayrakları otomatik çevirir; veritabanında bir şey
değiştirmeye gerek yoktur:

| Eski | Yeni |
|---|---|
| `hideLogo` | `elements.logo.visible` |
| `hideHeader` | `elements.header.visible` |
| `boldItems` | `elements.item.bold` |
| `doubleSizeItems` | `elements.item.scale = 2` |
| `doubleSizeTable` | `elements.table.scale = 2` |
| `hidePrices`, `inlineDateMasa`, `topMarginMm` | aynı isimle korundu |

## Restoran bilgisayarında güncelleme

`apps/print-agent/Baslat.bat` artık şunları sırayla yapar:

1. `git pull --ff-only`
2. `pnpm install --no-frozen-lockfile`
3. `pnpm --filter @rest-otm/receipt-core build`
4. `pnpm --filter @rest-otm/print-agent build`
5. `npm run start`

Yani **sadece `Baslat.bat`'a çift tıklamak yeterlidir.**
Kök dizindeki `Yazici_Agent_Baslat.bat` de bu dosyayı çağırır.

> Not: `dist/` klasörleri repoda takip edildiği için, internet yoksa bile
> derlenmiş hâl `git pull` ile gelir; adım 2–4 başarısız olsa da agent açılır.
