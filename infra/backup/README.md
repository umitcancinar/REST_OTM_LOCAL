# Yedekleme ve Acil Kurtarma Kılavuzu

Bu dosyayı **panik anında** okuyacaksın. O yüzden açıklama az, komut çok.
Yazdırıp bir kenarda bulundur; sunucu çöktüğünde sunucudaki dosyayı okuyamazsın.

---

## Sistem nasıl kurulu

| Katman | Nerede | Ne zaman | Geri dönüş süresi | Ne kadar veri kaybı |
|---|---|---|---|---|
| 1 — Yerel | VPS diski (`/var/lib/pgbackrest`) | Sürekli WAL + günlük yedek | **Dakikalar** | Saniyeler |
| 2 — Uzak | B2/R2, object-lock **30 gün** | Sürekli WAL + günlük yedek | ~1 saat | Saniyeler |
| 3 — Sıcak | Neon | 6 saatte bir | **~5 dakika** | En fazla 6 saat |

**Neden üçü birden:** Katman 1 hızlı ama sunucuyla birlikte ölür. Katman 2 hiçbir
koşulda silinemez ama yavaş. Katman 3 anında devralınır ama biraz veri kaybettirir.
Hangi felaket olursa olsun biri işe yarar.

---

## Önce durum tespiti

```bash
sudo -u postgres pgbackrest --stanza=rest-otm info
```

Son yedek ne zaman alınmış, iki depo da sağlıklı mı — buradan görürsün.

```bash
systemctl list-timers 'restotm-*'
sudo -u postgres pgbackrest --stanza=rest-otm check
```

---

## Senaryo 1 — "Yanlışlıkla sildim, dünkü hâline dönmeliyim"

En sık yaşanan senaryo. Belirli bir **saniyeye** dönebilirsin.

```bash
sudo systemctl stop restotm-api
sudo systemctl stop postgresql@16-main
```

```bash
sudo -u postgres pgbackrest --stanza=rest-otm --delta --type=time --target="2026-08-08 19:30:00" restore
```

```bash
sudo systemctl start postgresql@16-main
```

Postgres kurtarma modunda açılır. Veriyi kontrol et, doğruysa kurtarmayı bitir:

```bash
sudo -u postgres psql -c "SELECT pg_wal_replay_resume();"
sudo -u postgres psql -c "SELECT pg_is_in_recovery();"
```

`f` (false) dönüyorsa kurtarma tamam. Sonra API'yi başlat:

```bash
sudo systemctl start restotm-api
```

> **Dikkat:** Bu işlem hedef zamandan sonraki tüm veriyi siler. Emin değilsen
> önce Senaryo 5'teki gibi ayrı bir kopyaya geri yükleyip incele.

---

## Senaryo 2 — "Veritabanı bozuldu, son sağlam hâle dön"

```bash
sudo systemctl stop restotm-api postgresql@16-main
sudo -u postgres pgbackrest --stanza=rest-otm --delta restore
sudo systemctl start postgresql@16-main restotm-api
```

---

## Senaryo 3 — "VPS tamamen gitti" (acil devralma)

**Hedef: 5 dakikada tekrar sipariş alabilmek.** Mükemmel değil, ayakta.

1. Neon panelinden sıcak yedeğin bağlantı adresini al.
2. API'yi çalıştırabileceğin herhangi bir yerde (yeni VPS, geçici olarak Render)
   `DATABASE_URL`'i Neon adresine çevir.
3. Başlat.

```bash
DATABASE_URL="postgresql://...neon.tech/rest_otm?sslmode=require" \
  pnpm --filter @rest-otm/api start
```

**Bu noktada en fazla 6 saatlik veri kaybın var.** Müşterilere bunu söyle;
o aralıktaki siparişleri elle girmeleri gerekebilir.

Sonra acele etmeden Senaryo 4 ile tam kurtarmayı yap.

---

## Senaryo 4 — "Her şey silindi" (fidye yazılımı, hesap ele geçirme)

Uzak depo **object-lock** ile korunuyor: yazılan yedek 30 gün boyunca
silinemez. Sunucuya sızan biri de, sen de silemezsin. Kurtarıcı budur.

Yeni bir sunucuda:

```bash
sudo apt-get install -y pgbackrest postgresql-16
```

`/etc/pgbackrest/pgbackrest.conf` dosyasını **repo2 ayarlarıyla** oluştur
(şifreleme parolası dahil — parola yoksa yedekler okunamaz).

```bash
sudo -u postgres pgbackrest --stanza=rest-otm --repo=2 --delta restore
sudo systemctl start postgresql@16-main
```

---

## Senaryo 5 — "Yedeği bozmadan incelemek istiyorum"

Aylık otomatik test tam olarak bunu yapıyor, elle de çalıştırabilirsin:

```bash
sudo -u postgres TEST_PORT=5433 /usr/local/bin/restotm-restore-test
```

Canlı veritabanına dokunmaz; ayrı dizine, ayrı porta açar, satır sayılarını
karşılaştırır, sonra temizler.

---

## Aylık kontrol listesi

- [ ] `pgbackrest info` — son yedek 24 saatten yeni mi?
- [ ] Geri yükleme testi başarılı mı? (otomatik çalışıyor, uyarı geldi mi?)
- [ ] Uzak depodaki object-lock hâlâ açık mı?
- [ ] Şifreleme parolası sunucudan **ayrı** bir yerde duruyor mu?
- [ ] Neon sıcak yedeği güncel mi?

---

## Kritik uyarılar

**Şifreleme parolası (`repo2-cipher-pass`) kaybolursa uzak yedeklerin tamamı
kurtarılamaz.** Parola yöneticisinde, sunucudan bağımsız bir yerde sakla.
Bu sistemin tek geri dönüşü olmayan hatası budur.

**Uzak depo anahtarına silme yetkisi verme.** Sadece yazma ve okuma yetkisi
olsun. Sunucu ele geçirilirse saldırgan yedekleri silemesin.

**Object-lock süresi, pgBackRest saklama süresinden kısa olmalı.** Aksi hâlde
`expire` işlemi kilitli dosyaları silemeyip hata verir. Şu anki ayar:
kilit 30 gün, saklama 6 tam yedek (~6 hafta).
