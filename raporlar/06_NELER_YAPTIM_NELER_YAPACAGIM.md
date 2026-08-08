# Neler Yaptım / Neler Yapacağım

Bu dosya aktif devir günlüğüdür. Her çalışma turunda güncellenir. Bir madde
yalnız kodu, testi ve gerekli kabul kontrolü tamamlandığında `BİTTİ` olur.

Son güncelleme: 08.08.2026

## Nihai hedef

Temiz Windows 11 bilgisayarda Node, Git, pnpm veya Docker kurulu olmadan tek
imzalı installer ile kurulan; lisans anahtarı girildiğinde otomatik başlayan;
uygulama penceresi kapansa bile Windows service olarak çalışan; aynı yerel
ağdaki garson telefonlarına ve yazıcılara hizmet veren profesyonel REST_OTM.

## Bu turda yaptım

### Devir ve doğrulama

- `BİTTİ` Claude'un son dört lisans commit'i ve commitlenmemiş strict TypeScript
  düzeltmeleri incelendi.
- `BİTTİ` Claude ekran görüntülerindeki %10–15 durum listesi ana kabul listesine
  dönüştürüldü.
- `BİTTİ` `qrmenulerim` tasarım dili ve HorizonX genel motion/layout prensipleri
  incelendi. Ücretli asset/kod kopyalanmayacak; özgün “Operational Atelier”
  sistemi uygulanacak.
- `BİTTİ` Yerel çalışan rakip/benzer ürünler ve resmi dokümanlar araştırıldı:
  SambaPOS, ERP12, NarPOS, Adisyo, Simpra, Sentez LiveREST, Oracle Simphony,
  Toast ve Lightspeed LiteServer.

### Mimari kararlar

- `BİTTİ` SQLite yerine native, loopback-only PostgreSQL seçildi.
- `TEYİT` Veri hacmi küçük olsa da çoklu garson/kasa/yazıcı eşzamanlılığı ve
  mevcut PostgreSQL enum/JSON/String[] şeması nedeniyle 08.08.2026'da bu karar
  kullanıcıyla yeniden değerlendirildi ve PostgreSQL'de kalındı.
- `BİTTİ` Docker Desktop'ın müşteri paketine girmemesi kararlaştırıldı.
- `BİTTİ` Windows Service + Tauri kontrol merkezi + WiX/Inno installer topolojisi
  belirlendi.
- `BİTTİ` Bulutta kalacak ve lokale taşınacak servis sınırı çıkarıldı.
- `BİTTİ` Tek LAN gateway, firewall Private/LocalSubnet ve mDNS/IP fallback
  modeli belirlendi.
- `BİTTİ` Ana mimari ve kabul planı
  `raporlar/05_LOCAL_DONUSUM_ANA_PLANI.md` içine yazıldı.

### Güvenlik

- `BİTTİ` Repoda düz metin canlı PostgreSQL bağlantı bilgisi taşıyan test dosyası
  env tabanlı güvenli bağlantı testine çevrildi.
- `ACİL DIŞ İŞ` Sızan veritabanı parolası git geçmişindedir. Render/PostgreSQL
  sağlayıcısında rotate edilmeden risk kapanmış sayılmaz.
- `BİTTİ` Lisans formatı v2 yapıldı.
- `BİTTİ` İmzalı `entitlement` eklendi; suspend/revoke/tenant-disabled kararı
  lokal istemcide uygulanabilir hâle geldi.
- `BİTTİ` İmzalı `offlineUntil` eklendi ve ücretli bitiş tarihini aşması
  engellendi.
- `BİTTİ` `license-state.json` silerek grace kontrolünü atlama açığı kapatıldı.
- `BİTTİ` Aktivasyon/heartbeat yanıtı doğrulanmadan diske yazılmıyor.
- `BİTTİ` Lisans dosyaları temp + atomic rename ile yazılıyor.
- `BİTTİ` Payload sürüm/alan/tarih/features/grace doğrulamaları sıkılaştırıldı.
- `BİTTİ` Eşzamanlı iki cihaz ilk aktivasyon yarışı conditional update ile
  kapatıldı.
- `BİTTİ` License client ana paket girişinden export edildi.
- `BİTTİ` Kök build zincirine license derlemesi eklendi.

### Testler

- `GEÇTİ` License: 16/16.
- `GEÇTİ` API strict TypeScript typecheck.
- `GEÇTİ` Admin typecheck.
- `GEÇTİ` Waiter typecheck.
- `GEÇTİ` Menu typecheck.
- `GEÇTİ` Print-agent: 26/26; gerçek loopback network transport testi dahil.
- `BİTTİ (LOKAL)` GitHub CI tanımı: frozen install, tüm typecheck'ler ve
  license/API/print testleri hazırlandı. HTTPS GitHub kimliğinde `workflow`
  scope olmadığı için `.github/workflows/ci.yml` henüz uzak dala gönderilemedi;
  uzakta CI çalıştı denemez.
- `GEÇTİ` API: 57/57 (lisans admin/runtime, yedek, idempotency, atomik sipariş
  numarası ve public sınır dahil).
- `GEÇTİ` Release/staging sınırı: 12/12.
- `GEÇTİ` Windows paketleme güvenlik iskeleti statik kontrolleri: 8/8.
- `GEÇTİ` Monorepo TypeScript: 10 proje.

### İkinci kilometre taşı — çalışan runtime yüzeyleri

- `BİTTİ` `RUNTIME_MODE=cloud/local/all` mantıksal route ayrımı ve Render
  `start:cloud` girişi.
- `BİTTİ` Müşteri paketi için env ile cloud/all'a çevrilemeyen ayrı
  `local.ts`; Render için ayrı `cloud.ts` başlangıcı.
- `BİTTİ` Production localde Ed25519 public key ve HTTPS lisans sunucusu;
  cloud'da Ed25519 private key fail-fast doğrulaması.
- `BİTTİ` REST, Socket.IO paketleri ve background job için fail-closed lokal
  lisans kapısı; geçişte mevcut socketlerin kapatılması.
- `BİTTİ` Saatlik heartbeat, kilitliyken kontrollü retry, aktivasyon/status
  rotaları ve güvenli process shutdown.
- `BİTTİ` Profesyonel `/activate` aktivasyon/kilit ekranı ve 423 yönlendirmesi.
- `BİTTİ` Superadmin lisans kasası: create/extend/suspend/resume/revoke/reset/
  rebind, tek seferlik tam anahtar, maskeli liste ve audit.
- `BİTTİ` Lisans activate/heartbeat TOCTOU yarışları kapatıldı; PENDING kayıt
  aktif entitlement olarak imzalanamıyor.
- `BİTTİ` Audit tablosu append-only trigger + restrict ilişki; restoran silme
  finansal/audit geçmişini koruyan soft-disable oldu.
- `BİTTİ` `subscriptionExpiresAt` auth kilidi kaldırıldı; çalışma süresinin tek
  karar noktası imzalı License entitlement oldu.
- `BİTTİ` Yerel PostgreSQL yedek runtime: `pg_dump -Fc`, partial+fsync+SHA-256,
  atomik rename, tek işlem kilidi, günlük/haftalık/aylık retention ve OWNER-only
  recovery rotaları.
- `BİTTİ` Admin/garson API ve Socket varsayılanları `localhost` yerine aynı
  LAN originine çevrildi; telefonda kendi localhost'una gitme hatası kapandı.
- `BİTTİ` Next admin/waiter/menu standalone çıktı ayarı.
- `BİTTİ` Cloud public router'dan yıkıcı `fix-tables` çıkarıldı ve regresyon
  testi eklendi.
- `BİTTİ` Cloud menu/public projection ve outbound-only sync tasarımı
  `raporlar/07_CLOUD_MENU_SYNC_TASARIMI.md` içine yazıldı.
- `BİTTİ` Kaynak, source map, test, private key ve yanlış profile ait modül
  taşıyan release artifact'ini reddeden fail-closed denetim.
- `BİTTİ` Cloud ve local API için gerçek CommonJS dependency closure staging:
  cloud artifact 42 dosya, local artifact 91 dosya; iki artifact de sınır
  denetiminden geçti. Localde signing/private-key kodu, cloud'da operasyon,
  Socket.IO, backup ve print kodu bulunmuyor.
- `BİTTİ` Sipariş açma komutlarına tenant-scoped idempotency anahtarı ve payload
  hash kontrolü eklendi; aynı komut tekrarında sipariş/yazdırma/stok yan etkisi
  tekrarlanmıyor.
- `BİTTİ` Sipariş numarası `ORD-YYYYMMDD-NNN` formatında transaction içi atomik
  PostgreSQL sayacına taşındı; tenant + orderNumber unique constraint ve legacy
  çakışma raporu eklendi.
- `BİTTİ` WiX v4/Burn Windows kurulum sözleşmesi, delayed-auto/recovery service,
  DPAPI secret provisioning, ProgramData veri koruması, loopback iç portları ve
  yalnız Private+LocalSubnet `8787` firewall politikası eklendi.

## Şimdi yapıyorum

### Faz 1 — cloud/local fiziksel ayrımı

- `BİTTİ` Cloud API: license, superadmin ve salt-okuma public projection.
- `BİTTİ` Local API: auth, table, order, payment, inventory, reports, Socket.IO,
  backup ve printing yüzeyleri.
- `BİTTİ` Cloud private key/signing modülü local artifact dependency graph'ından
  fiziksel olarak çıkarıldı.
- `BİTTİ` Tek abonelik/lisans süre kaynağı imzalı License entitlement oldu.
- `BİTTİ` Render yalnız `cloud.ts` girişini çalıştırıyor.
- `KALDI` Ortak menü projection outbox/sync protokolünün uygulanması.

### Faz 2 — lisans runtime ve ekranları

- `BİTTİ` Local runtime license manager ve aktivasyon/recovery uçları.
- `BİTTİ` REST, Socket.IO ve background job için merkezi lisans gate.
- `BİTTİ` Aktivasyon wizard, kontrollü kilit ekranı ve superadmin License CRUD.
- `KALDI` TPM/CNG device key; DPAPI fallback; signed challenge heartbeat.

### Faz 3 — Windows runtime

- `BİTTİ (İSKELET)` WiX/Burn, Windows service, DPAPI, veri dizini ve firewall
  kurulum sözleşmesi.
- `KALDI` İmzalı native supervisor/bootstrap ve paketlenmiş PostgreSQL service.
- `KALDI` Local API, Next standalone admin/waiter ve print-agent gerçek payload.
- `KALDI` Tek origin gateway, mDNS/IP fallback, garson QR ve Tauri kontrol merkezi.

### Faz 4 — dayanıklılık ve saha kalitesi

- Transactional order/menu/print outbox ve idempotency.
- Otomatik yedek + hash + retention tamam; DPAPI/BitLocker anahtar koruması,
  ayrı fiziksel kopya ve otomatik restore testi kaldı.
- İmzalı update manifesti, health gate ve rollback.
- Profesyonel ortak UI package ve mobile-first waiter sıcak akışı.
- Self-host fontlar, reduced-motion, erişilebilir dialog/bottom-sheet.

### Faz 5 — installer ve kabul

- Temiz Windows 11 VM'de tek installer.
- Reboot ve kullanıcı login olmadan servis başlangıcı.
- 3–5 telefon ve gerçek yazıcı test matrisi.
- WAN/LAN/router/elektrik kesinti senaryoları.
- Lisans expiry/suspend/revoke/rebind testleri.
- Backup/restore ve bozuk update rollback.
- Authenticode imzalı üretim WiX/MSI.

## “Patron bitti” demek için geçmesi gereken kapılar

- [ ] Temiz Windows 11'de tek installer
- [ ] Node/Git/pnpm/Docker gerektirmiyor
- [ ] Reboot sonrası otomatik ve kararlı çalışma
- [ ] Pencere kapalıyken sipariş/yazdırma
- [ ] Aynı LAN'da QR ile garson bağlantısı
- [ ] İnternet yokken temel operasyonun tamamı
- [ ] DB/API iç portlarının LAN'a kapalı olması
- [ ] Lisans state silme/clock/replay/clone saldırı testleri
- [ ] Suspend/revoke'in tüm REST/WS/job yollarını kilitlemesi
- [ ] Açık adisyon kapatma, yedek ve export'un lisans kilidinde kalması
- [ ] Print queue retry/fallback/audit
- [ ] Doğrulanmış otomatik yedek ve geri yükleme
- [ ] İmzasız/bozuk update reddi ve rollback
- [ ] Source map/kaynak/cloud private key içermeyen release artifact
- [ ] Gerçek restoran pilotu

Bu kapılar tamamlanmadan ürün “nihai” olarak işaretlenmez.
