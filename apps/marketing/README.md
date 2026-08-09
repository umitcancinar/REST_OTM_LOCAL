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
- `src/app/api/demo-request/route.ts` — formu alır, 6 haneli doğrulama kodu gönderir
- `src/app/api/demo-request/verify/route.ts` — kodu doğrular, talebi ve iki e-posta bildirimini açar

## Demo e-posta doğrulaması

Akış kalıcı müşteri verisini marketing sunucusuna yazmaz: 10 dakika geçerli,
şifrelenmiş ve HttpOnly bir doğrulama oturumu kullanır. Kod doğru olduğunda
başvuru sahibine onay; `DEMO_NOTIFICATION_EMAIL` adresine de tam talep özeti
gönderilir. Render ortamına şu secret'ları ekleyin: `RESEND_API_KEY`,
`DEMO_EMAIL_FROM`, `DEMO_NOTIFICATION_EMAIL`, `DEMO_VERIFICATION_SECRET`.

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
