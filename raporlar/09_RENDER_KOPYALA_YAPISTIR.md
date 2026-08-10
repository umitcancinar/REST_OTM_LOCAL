# Render + Neon Kopyala/Yapıştır Kurulum Kartı

Bu kart yalnız yeni REST_OTM kontrol düzlemini kurar. Müşterinin kullandığı
`rest-otm-api` / `umitcancinar/RETS_OTM` servisine, marketing servisine veya
onların veritabanına hiçbir işlem yapılmaz.

## 0. Üretimden önce zorunlu parola döndürme

Sohbete yapıştırılan Neon bağlantı adresinin parolası artık gizli kabul
edilemez. İlk migration tamamlanmıştır; son Render kurulumu öncesinde:

1. Neon Console'da ilgili project → **Roles & Databases** açılır.
2. `neondb_owner` rolünün parolası **Reset password** ile değiştirilir.
3. **Connect** → pooled connection seçilir.
4. Yeni `postgresql://...` adresi parola yöneticisine alınır.
5. Eski bağlantı adresi hiçbir Render servisine girilmez.

Yeni bağlantı adresi şu özellikleri taşımalıdır:

- pooled Neon hostname,
- veritabanı `neondb`,
- `sslmode=require`,
- yalnız Render secret store içinde saklanma.

## 1. Hazır secret dosyası

Bu Mac'te tek kullanımlık dosya hazırdır:

```text
/private/tmp/rest-otm-control-plane-secrets.env
```

Dosya izni `0600`'dür. Değerler GitHub'a, sohbete veya ekran görüntüsüne
konulmaz. Dosyadaki `ALAN=değer` satırından yalnız `=` işaretinin sağ tarafı
Render'daki aynı isimli alana kopyalanır.

## 2. Render Blueprint oluşturma

1. Mevcut müşterinin API hesabına değil, yeni kontrol düzleminin kurulacağı
   Render workspace'ine girilir.
2. **New +** → **Blueprint** seçilir.
3. GitHub repo: `umitcancinar/REST_OTM_LOCAL`.
4. Branch: `main`.
5. Blueprint file path: `render.control.yaml`.
6. Render'ın göstereceği servis adları aynen şunlar olmalıdır:
   - `rest-otm-control-api`
   - `rest-otm-superadmin`
7. Aşağıdaki dış değerler girilmeden **Apply** yapılmaz.

### `rest-otm-control-api` alanları

| Render key | Girilecek değer |
|---|---|
| `DATABASE_URL` | Adım 0'da parolası döndürülmüş **yeni** pooled Neon URL |
| `LICENSE_PRIVATE_KEY` | Geçici dosyadaki aynı adlı satırın değeri |
| `LICENSE_KEY_PEPPERS` | Geçici dosyadaki aynı adlı satırın değeri |
| `UPDATE_SIGNING_PRIVATE_KEY` | Geçici dosyadaki aynı adlı satırın değeri |
| `UPDATE_SIGNING_PUBLIC_KEY` | Geçici dosyadaki aynı adlı satırın değeri |
| `SUPER_ADMIN_EMAIL` | Yalnız patronun kullandığı doğrulanmış e-posta |
| `SUPER_ADMIN_PASSWORD` | Parola yöneticisinde üretilmiş en az 20 karakter benzersiz parola |

### `rest-otm-superadmin` alanı

| Render key | Girilecek değer |
|---|---|
| `RESEND_API_KEY` | Resend'de yalnız gönderim yetkili restricted production key |

Blueprint'in otomatik ürettiği `JWT_*`, `MENU_PUBLIC_ID_SECRET`,
`SUPERADMIN_MFA_PEPPER`, `SUPERADMIN_SESSION_SECRET` ve BFF servis sırrı elle
değiştirilmez. BFF sırrı Blueprint referansıyla iki servise aynı secret olarak
aktarılır ve browser JavaScript'ine açılmaz.

## 3. İlk deploy kabulü

Önce yalnız Render adresleriyle test edilir; DNS henüz değiştirilmez.

1. API event/log içinde migration ve uygulama başlangıcı hatasız olmalı.
2. `https://rest-otm-control-api.onrender.com/api/ready` HTTP 200 dönmeli;
   bu yanıt PostgreSQL sorgusu geçmeden başarı vermez.
3. `https://rest-otm-superadmin.onrender.com` giriş ekranı açılmalı.
4. Yanlış parola kullanıcı var/yok bilgisini sızdırmayan genel hata vermeli.
5. Doğru parola sonrası patron e-postasına 6 haneli tek kullanımlık kod gelmeli.
6. Yanlış, süresi geçmiş ve tekrar kullanılan kod reddedilmeli.
7. Giriş sonrası tenant ve lisans ekranı açılmalı.

Bu kabul bitmeden `panel.restoranyonetim.com`,
`yonetim.restoranyonetim.com` veya `api.restoranyonetim.com` DNS kayıtları
değiştirilmez. Özellikle mevcut müşteri API'sinin domain/servis bağlantısı
kesinlikle yeni servise yönlendirilmez.

## 4. Custom domain'e geçerken değişecek alanlar

Superadmin için seçilen gerçek domain örneğin
`yonetim.restoranyonetim.com` ise:

- API `CORS_ORIGIN`:
  `https://rest-otm-superadmin.onrender.com,https://yonetim.restoranyonetim.com`
- Superadmin `SUPERADMIN_PUBLIC_URL`:
  `https://yonetim.restoranyonetim.com`
- Superadmin `SUPERADMIN_ALLOWED_ORIGINS`:
  `https://rest-otm-superadmin.onrender.com,https://yonetim.restoranyonetim.com`

API custom domain ancak tüm istemciler ve mevcut müşteri ayrımı kesin olarak
doğrulandıktan sonra eklenir. Domain değişiminden sonra iki servis yeniden
deploy edilir ve MFA + lisans uçtan uca kabulü tekrar koşulur.

## 5. Yedek üretim kapısı

Birden fazla `DATABASE_URL` yazmak yedek değildir. Ücretsiz Neon kısa süreli
PITR/snapshot imkânı sağlayabilir; ancak müşteri üretimi öncesinde aşağıdakiler
olmadan sistem “yedekli” sayılmaz:

- en az günlük şifreli dump veya sağlayıcı PITR politikası,
- birincil Neon projeden bağımsız hedef,
- tanımlı saklama süresi,
- gerçek boş veritabanına restore testi,
- restore süresi ve kanıt kaydı.

## 6. Secret dosyasını kapatma

Render alanları doldurulduktan ve public lisans/update anahtarları ilerideki
Windows paketi için parola yöneticisine alındıktan sonra geçici dosya güvenli
biçimde kaldırılır. Private key'ler Windows paketine veya GitHub'a konulmaz.
