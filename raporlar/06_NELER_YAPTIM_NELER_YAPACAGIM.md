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

### Üçüncü kilometre taşı — dayanıklı operasyon ve üretim sınırları

- `BİTTİ` Mevcut admin/garson/menu UI, navigasyon ve iş akışları korunarak
  yalnız aktivasyon/lisans gizliliği, erişilebilirlik ve `/garson` base-path
  regresyonları düzeltildi. Admin 18, garson 8 ve menu 3 production route'u
  başarıyla derlendi; ekranlar sıfırdan yazılmadı.
- `BİTTİ` Lisans anahtarları rotasyonlu sunucu pepper'ı ile HMAC-SHA-256
  `keyHash` olarak saklanıyor; yeni kayıtlarda plaintext yok. Maskeli liste,
  legacy backfill aracı ve tek non-revoked seat DB indeksi eklendi.
- `AŞAMALI DIŞ İŞ` Mevcut cloud DB'de backfill sıfır kayıt doğrulanmadan legacy
  plaintext `key` kolonu silinmeyecek. Bu expand/backfill/contract sırası kasıtlı
  fail-safe migration politikasıdır.
- `BİTTİ` Yerel yedek V2: AES-256-GCM şifreleme, AAD, SHA-256 manifest,
  atomic/fsync yayın, ayrı klasöre şifreli replica, kalıcı retry ve haftalık
  non-destructive `pg_restore --list` restore drill.
- `BİTTİ` Aynı fiziksel diskte ikinci klasör sıradan kurulumları durdurmuyor;
  görünür uyarı veriyor. `require-separate` politikası USB/NAS/ikinci disk isteyen
  kurulumlarda fiziksel ayrımı zorunlu kılıyor.
- `BİTTİ` Sipariş/iptal/ikram/fatura/paket/mutfak/ızgara/Z raporu yazdırmaları
  DB-backed durable print outbox'a taşındı. Lease token, bounded retry+jitter,
  dead-letter, attempt audit ve agent-side kalıcı dedupe ledger eklendi.
- `BİTTİ` ADMIN/OWNER için payload/PII sızdırmayan print queue list/detail/summary
  ve idempotent audited reprint API'si eklendi; eski `/printers/status` alanları
  geriye uyumlu tutuldu.
- `BİTTİ` Ortak/public menü için transactional local outbox ve outbound-only
  HTTPS cloud projection uygulandı. Cloud istemci tenant kimliğine güvenmiyor;
  HMAC publicId ve cloud-owned name/slug/domain kullanıyor. Public API yalnız
  sanitize edilmiş `MenuPublication` okuyor.
- `BİTTİ` Tek `8787` LAN gateway API/Socket.IO, `/garson` ve admin trafiğini
  sabit loopback upstream'lere yönlendiriyor; Host/Origin/upgrade ve forwarded
  header politikaları fail-closed.
- `BİTTİ` OWNER/ADMIN-only LAN status ve garson QR SVG backend'i eklendi;
  yalnız RFC1918/link-local/ULA adresleri gösteriliyor, MAC/interface bilgisi
  sızmıyor. mDNS yayını ve Tauri ekranı hâlâ ayrı blocker.
- `BİTTİ (KAYNAK/KONTRAT)` Native Rust Windows supervisor/bootstrap temeli,
  SCM/Job Object/crash-loop/DPAPI okuma ve canonical installer kontratı eklendi.
  Native ACL + CryptProtectData yazma backend'i hazır olmadığı için bootstrap
  production'da bilinçli olarak false success vermiyor.
- `BİTTİ` Fail-closed Windows payload assembler kaynak/map/env/test/private key,
  symlink, case collision ve imzasız PE'yi reddediyor; gerçek üretim girdileri
  eksikken installer üretmiyor.
- `GEÇTİ` Birleşik doğrulama: Prisma validate; 11 workspace typecheck; API
  98/98, license 16/16, print-agent 29/29, gateway 5/5, waiter 1/1, menu 2/2,
  release 16/16, Windows 13/13 ve Rust kaynak politikası 6/6.
- `GEÇTİ` Admin, waiter, menu ve superadmin production build; local artifact
  102 dosya ve cloud artifact 48 dosya fail-closed audit'ten geçti.

### Dördüncü kilometre taşı — gerçek masa QR'ı ve imzalı bakım zinciri

- `BİTTİ` Mevcut QR menü UI/CSS/navigation aynen korunarak local build
  `/menu/<slug>` altında gateway'e bağlandı. Cloud build eski `/<slug>`
  adreslerini koruyor; tek kaynak iki açık build profiliyle çalışıyor.
- `BİTTİ` Menü child yalnız `127.0.0.1:3300` üzerinde çalışıyor; dış LAN'da
  hâlâ yalnız `8787` var. Menü verisi server-side HTTPS cloud projection'dan,
  garson çağrısı same-origin local API'den geçiyor; mixed-content yok.
- `BİTTİ` Masa QR'ı kurulum başına ayrı HMAC secret ile tenant slug + gerçek
  tableId'ye bağlandı. QR üretiminde ve çağrıda tenant/masa DB doğrulanıyor;
  istemci IP'si başına dakika 6 çağrı sınırı var. Secret rotasyonu eski QR'ları
  kasıtlı olarak geçersiz kılıyor.
- `BİTTİ (STAGE-ONLY)` Ayrı Ed25519 update güven kökü, canonical imzalı manifest,
  artifact origin/size/SHA-256, anti-rollback/equivocation, atomic high-water ve
  supervisor handoff uygulandı. Local API hiçbir zaman update'i uygulanmış gibi
  göstermiyor; yalnız `STAGED_AWAITING_SUPERVISOR` döndürüyor.
- `BİTTİ (KAYNAK)` Native Windows bootstrap exact Program Files/ProgramData,
  junction/reparse reddi, CSPRNG, DPAPI LocalMachine, SYSTEM/Admin/restricted
  service SID DACL, atomic write-through ve receipt-last hash doğrulaması
  uyguluyor.
- `BİTTİ` Windows canonical topoloji 7 child'a çıktı; menu `3300` ve ayrı
  `license-public-key.pem` / `update-public-key.pem` payload rolleri eklendi.
  Private/non-Ed25519 veya aynı anahtarın iki rolde kullanımı fail-closed.
- `GEÇTİ (BİRLEŞİK KONTROL)` 11 workspace typecheck; API 110/110, license
  16/16, menu 4/4, waiter 1/1, gateway 5/5, release 18/18, Windows packaging
  15/15 ve Windows host kaynak 7/7. Cloud ve local menu production build'leri
  geçti; cloud artifact 48, local artifact 107 dosya ile fail-closed audit'ten
  geçti.
- `ORTAM NOTU` Bu son ana ajan turunda loopback portu isteyen gateway/print
  testlerini yeniden açma izni kota nedeniyle verilemedi. Gateway'in 5/5 sonucu
  ajan koşusundan; print-agent'in aynı kod için son tam sonucu 29/29'dur. Bu
  turdaki sandbox print koşusunda 28 test geçti, yalnız `listen EPERM` alan ağ
  testi çalışamadı; ürün hatası olarak yorumlanmadı.
- `KALDI` Native supervisor staged update'i tekrar doğrulayıp safety backup,
  migration, atomik replace, health gate ve rollback ile gerçekten uygulamalı.
- `KALDI` Rust/MSVC ve PowerShell derleme/testi ile temiz Windows 11,
  PostgreSQL, gerçek telefon ve yazıcı kabulü; bu Mac'te cargo/rustc/pwsh yok.

## Şimdi yapıyorum

### Faz 1 — cloud/local fiziksel ayrımı

- `BİTTİ` Cloud API: license, superadmin ve salt-okuma public projection.
- `BİTTİ` Local API: auth, table, order, payment, inventory, reports, Socket.IO,
  backup ve printing yüzeyleri.
- `BİTTİ` Cloud private key/signing modülü local artifact dependency graph'ından
  fiziksel olarak çıkarıldı.
- `BİTTİ` Tek abonelik/lisans süre kaynağı imzalı License entitlement oldu.
- `BİTTİ` Render yalnız `cloud.ts` girişini çalıştırıyor.
- `BİTTİ` Ortak menü projection outbox/sync protokolü uygulandı; TPM/CNG
  challenge ve custom-domain DNS sahiplik doğrulaması sertleştirme olarak kaldı.

### Faz 2 — lisans runtime ve ekranları

- `BİTTİ` Local runtime license manager ve aktivasyon/recovery uçları.
- `BİTTİ` REST, Socket.IO ve background job için merkezi lisans gate.
- `BİTTİ` Aktivasyon wizard, kontrollü kilit ekranı ve superadmin License CRUD.
- `KALDI` TPM/CNG device key; DPAPI fallback; signed challenge heartbeat.

### Faz 3 — Windows runtime

- `BİTTİ (İSKELET)` WiX/Burn, Windows service, DPAPI, veri dizini ve firewall
  kurulum sözleşmesi.
- `BİTTİ (KAYNAK/KONTRAT)` Native supervisor/bootstrap temeli ve canonical
  topoloji var; Windows'ta derleme/SCM/Job Object/ACL kabulü kaldı.
- `KALDI` Paketlenmiş PostgreSQL service ve gerçek Windows executable seti.
- `KALDI` Local API, Next standalone admin/waiter ve print-agent gerçek payload.
- `BİTTİ` Tek-origin gateway ile güvenli IP fallback/garson QR backend'i.
- `KALDI` mDNS advertising ve Tauri kontrol merkezi.

### Faz 4 — dayanıklılık ve saha kalitesi

- `BİTTİ` Transactional order/menu/print outbox ve idempotency temelleri.
- `BİTTİ` Şifreli otomatik yedek + hash + retention + external replica +
  otomatik restore drill. Windows DPAPI/BitLocker anahtar provisioning ve gerçek
  ikinci disk/NAS saha kabulü kaldı.
- `BİTTİ (STAGE-ONLY)` İmzalı update manifesti/indirme/handoff; native apply,
  health gate ve rollback kaldı.
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
- [x] Print queue retry/dead-letter/reprint audit (gerçek yazıcı pilotu kaldı)
- [x] Şifreli otomatik yedek ve non-destructive restore doğrulama
- [ ] İmzasız/bozuk update reddi ve rollback
- [ ] Source map/kaynak/cloud private key içermeyen release artifact
- [ ] Gerçek restoran pilotu

Bu kapılar tamamlanmadan ürün “nihai” olarak işaretlenmez.
