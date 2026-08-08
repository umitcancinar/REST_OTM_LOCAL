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
- `BİTTİ` GitHub CI: frozen install, tüm typecheck'ler ve license/API/print
  testleri zorunlu hâle getirildi. İlk uzak CI çalışması henüz doğrulanmadı.

## Şimdi yapıyorum

### Faz 1 — cloud/local fiziksel ayrımı

- Cloud API: license, superadmin, public/common menu, update control plane.
- Local API: auth, table, order, payment, inventory, reports, printing.
- Cloud private key/signing modülünün local artifact dependency graph'ından
  çıkarılması.
- Tek abonelik/lisans süre kaynağı ve bootstrap/sync sözleşmesi.
- Render tanımının yalnız cloud servislerini çalıştırması.

### Faz 2 — lisans runtime ve ekranları

- Local runtime license manager.
- Aktivasyon/recovery uçları.
- REST, Socket.IO ve background job için merkezi lisans gate.
- Aktivasyon wizard ve kontrollü kilit ekranı.
- Superadmin License CRUD, üretme, suspend, revoke, rebind ve audit.
- TPM/CNG device key; DPAPI fallback; signed challenge heartbeat.

### Faz 3 — Windows runtime

- Portable/native PostgreSQL service.
- Local API, Next standalone admin/waiter ve print-agent supervisor.
- Tek origin gateway.
- Firewall, mDNS/IP fallback, garson QR.
- Tauri kontrol merkezi.

### Faz 4 — dayanıklılık ve saha kalitesi

- Transactional order/menu/print outbox ve idempotency.
- Otomatik yedek, hash/şifreleme, retention ve restore testi.
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
