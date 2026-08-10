# REST_OTM Control-Plane — Render + Neon kurulum ve kabul planı

Son güncelleme: 10.08.2026

## Değiştirilmeyecek üretim sınırı

- `umitcancinar/RETS_OTM` reposundan çalışan mevcut `rest-otm-api` müşteri
  servisidir. Bu kurulum onu, ortam değişkenlerini veya veritabanını değiştirmez.
- Canlı marketing servisi `rest-otm-marketing` bu Blueprint'e dahil değildir.
- Yeni kaynakların isimleri benzersizdir: `rest-otm-control-api` ve
  `rest-otm-superadmin`.

## Hedef topoloji

1. `rest-otm-marketing`: mevcut tanıtım/demo sitesi.
2. `rest-otm-control-api`: lisans, heartbeat, ortak menü projection ve imzalı
   güncelleme metadata API'si.
3. `rest-otm-superadmin`: HttpOnly cookie + e-posta MFA kullanan yönetim BFF'i.
4. Tek Neon PostgreSQL: yalnız control-plane verileri. Müşterilerin operasyonel
   verisi bu DB'ye taşınmaz; her işletmenin lokal PostgreSQL'inde kalır.

## Veritabanı ve yedek gerçeği

Birden fazla `DATABASE_URL` yazmak yedek oluşturmaz. API yalnız tek birincil
Neon bağlantısına yazar. Güvenilir yedek sayılması için şu üç koşul birlikte
sağlanmalıdır:

- zamanlanmış snapshot/dump,
- ana hesaptan bağımsız hedef veya sağlayıcı geri dönüş noktası,
- düzenli ve kayıt altına alınmış restore testi.

Ücretsiz Neon ilk canlı kabul/staging için kullanılabilir; saklama süresi ve
kapasitesi üretim SLA'sı değildir. Ücretli müşteri lisansları açılmadan önce
sağlayıcının PITR/backups planı veya şifreli harici obje deposuna günlük dump
zorunlu üretim kapısıdır. Elde bulunan başka PostgreSQL veritabanları, otomatik
dump/restore işi ve alarm eklenmeden “yedek” olarak işaretlenmez.

## Blueprint kurulumu

Render Dashboard'da marketing ile aynı workspace/proje seçilir:

1. **Blueprints → New Blueprint**.
2. Private GitHub reposu `umitcancinar/REST_OTM_LOCAL`, dal `main` seçilir.
3. Blueprint path alanına `render.control.yaml` yazılır.
4. Render'ın istediği gizli değerler doldurulur. Hiçbiri GitHub'a yazılmaz.
5. Önce API health, sonra superadmin login/MFA doğrulanır.

### API için dışarıdan girilecek değerler

- `DATABASE_URL`: Neon pooled connection string, `sslmode=require`.
- `LICENSE_PRIVATE_KEY`: deploy secret üreticisinin özel lisans anahtarı.
- `LICENSE_KEY_PEPPERS`: deploy secret üreticisinin JSON pepper ring'i.
- `UPDATE_SIGNING_PRIVATE_KEY` ve `UPDATE_SIGNING_PUBLIC_KEY`: ayrı Ed25519 çift.
- `SUPER_ADMIN_EMAIL`: yalnız yöneticinin doğrulanmış e-posta adresi.
- `SUPER_ADMIN_PASSWORD`: parola yöneticisinde üretilmiş benzersiz güçlü parola.

### Superadmin için dışarıdan girilecek değerler

- `RESEND_API_KEY`: yalnız gönderim yetkili restricted production key.

Diğer sırlar Render tarafından üretilir. BFF service secret API'den superadmin'e
Blueprint referansıyla aktarılır; tarayıcıya açılmaz.

## Kabul sırası — Windows pilotu hariç

- [ ] Neon bağlantısı ve `prisma migrate deploy` başarılı.
- [ ] `GET /api/health` 200.
- [ ] API production config eksik secret'ta fail-closed.
- [ ] Superadmin parola sonrası e-posta kodu geliyor.
- [ ] Yanlış/eskimiş/replay MFA kodu oturum açamıyor.
- [ ] Lisans üretimi yalnız doğrulanmış SUPER_ADMIN oturumunda çalışıyor.
- [ ] Aynı lisans iki donanım parmak izine bağlanamıyor.
- [ ] Heartbeat yeni imzalı entitlement döndürüyor.
- [ ] Süre uzatma en geç sonraki heartbeat'te yansıyor.
- [ ] Suspend/revoke lokal hakkı kapatıyor; audit kaydı korunuyor.
- [ ] Public ortak menü yalnız sanitize projection döndürüyor.
- [ ] Backup/PITR hedefi ve gerçek restore testi kayıt altına alındı.
- [ ] Custom domain + TLS tamamlandı.
- [ ] Windows 11 temiz makine pilotu — bu turda bilerek ertelendi.

