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

### Bot ve abuso koruması

Demo formu Cloudflare Turnstile ile tarayıcıda challenge üretir ve bu tokenı
sunucuda Siteverify uç noktasına doğrulatır. Production'da anahtar veya izinli
hostname listesi eksikse istek **fail-closed** reddedilir. Render'a ayrıca:

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — Turnstile widget site key
- `TURNSTILE_SECRET_KEY` — yalnızca sunucuda kalan secret key
- `TURNSTILE_ALLOWED_HOSTNAMES` — virgülle ayrılmış
  `restoranyonetim.com,www.restoranyonetim.com,rest-otm-marketing.onrender.com`

değerlerini girin. Yerel geliştirmede değişkenler boş bırakılırsa Cloudflare'ın
resmi always-pass test anahtarları kullanılır; bu anahtarlar production'da asla
kabul edilmez.

Turnstile öncesi IP limiti, doğrulamadan sonra IP/e-posta gönderim limiti ve
60 saniyelik e-posta cooldown uygulanır. Kod deneme sayısı artık yalnızca geri
oynatılabilen tarayıcı çerezinden değil, sunucudaki yetkili kayıttan takip edilir;
doğru kod işlenirken ikinci paralel istek kilitlenir ve tamamlanan istek yeniden
kullanılamaz. Render free servisi tek instance olduğu sürece bu kayıt süreç
belleğinde güvenlidir. İleride birden fazla marketing instance açılırsa aynı
arayüz Redis/KV gibi paylaşımlı ve TTL destekli bir store'a taşınmalıdır.

Doğrulama e-postası saatte IP başına en fazla 5, e-posta başına en fazla 3 kez
gönderilir. Form alanları hem HTML hem sunucuda uzunluk ve kontrol karakteri
sınırından geçirilir. İşletme sahibine gelen bildirimde `Reply-To` doğrulanmış
müşteri adresidir; doğrudan Yanıtla ile müşteriye dönülür.

Güvenlik testleri:

```bash
pnpm --filter @rest-otm/marketing test
```

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
