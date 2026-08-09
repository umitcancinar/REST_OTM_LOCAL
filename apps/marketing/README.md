# @rest-otm/marketing

restoranyonetim.com — tanıtım sitesi. Render'da bulut tarafıyla birlikte
yayınlanır; müşteri verisi veya lisans mantığı içermez.

## Yerelde çalıştırma

```bash
pnpm --filter @rest-otm/marketing dev
```

http://localhost:3004 adresinde açılır.

## Yapı

- `src/app/page.tsx` — tüm bölümlerin birleştirildiği ana sayfa
- `src/components/` — her bölüm ayrı bileşen (Hero, FeatureGrid, PackagesSection...)
- `src/app/api/demo-request/route.ts` — demo formu; `DEMO_REQUEST_WEBHOOK_URL`
  tanımlanmadan basvurular yalnızca sunucu logunda görünür (bkz. dosya içi not)

## Tasarım yönü

"Operational Atelier": sıcak kağıt renkli içerik bantları + neredeyse siyah
"night" hero/kapanış bantları. Kullanıcı temasına göre değişen bir karanlık
mod anahtarı yok — bilinçli sabit bir yön (qrmenulerim ile aynı kimlik).

## Dürüstlük notları (bilerek yapılmayanlar)

- **Fiyat rakamı yok.** Paketler bölümü özellik listesiyle ayrılır, "Fiyat
  Teklifi Alın" CTA'sına yönlendirir. Uydurma TL tutarı yazılmadı.
- **Sahte müşteri yorumu yok.** "Neden REST_OTM" bölümü erken aşama
  olduğunu açıkça söyler; hiçbir kişiye atfedilen uydurma alıntı yok.
- **"Arayüzden bir kesit" gerçek ekran görüntüsü değildir.** Gerçek admin
  panelinin renk/tipografi diline sadık, şematik bir önizlemedir; metinde
  bunu "screenshot" diye sunan hiçbir ifade yok.
