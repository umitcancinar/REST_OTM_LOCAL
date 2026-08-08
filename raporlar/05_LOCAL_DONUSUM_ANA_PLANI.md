# REST_OTM Local-First Dönüşüm Ana Planı

Güncelleme: 08.08.2026

Bu belge, REST_OTM'nin SaaS ağırlıklı yapıdan müşteri bilgisayarında çalışan,
yerel ağdaki garson cihazlarına hizmet veren ve yalnız lisans/ortak menü için
buluta çıkan saha ürününe dönüşümünün ana kaydıdır.

## 1. Ürün hedefi

Müşteri temiz bir Windows 11 bilgisayarda tek imzalı kurulum dosyasını açar,
lisans anahtarını girer ve kurulum tamamlandığında:

- Lokal API, veritabanı ve yazdırma servisi Windows ile otomatik başlar.
- Uygulama penceresi kapansa da sipariş ve yazdırma çalışır.
- Admin paneli ana bilgisayarda açılır.
- Aynı personel Wi-Fi ağındaki telefonlar QR kod veya yerel adresle garson
  paneline bağlanır.
- İnternet kesildiğinde restoran operasyonu devam eder.
- Lisans ve ortak/public menü servisleri bulutta kalır.
- Lisans süresi uzatılırsa imzalı yoklamayla lokale otomatik yansır.

## 2. Kesin mimari kararlar

### Veritabanı: PostgreSQL

SQLite'a geçilmeyecek. Mevcut Prisma şeması PostgreSQL dizileri, enum, JSON,
indeks ve sorgu davranışlarına bağlıdır. Aynı anda birden fazla garsonun
sipariş/ödeme/stok yazdığı üretim ortamında mevcut PostgreSQL yatırımını
korumak daha güvenlidir.

Saha kurulumu:

- PostgreSQL native Windows service olarak paketlenir.
- Yalnız `127.0.0.1` üzerinde dinler; LAN'a DB portu açılmaz.
- Kurulum başına rastgele parola, `scram-sha-256` ve sıkı NTFS ACL kullanılır.
- Veri `C:\ProgramData\RESTOTM\data\postgres` altında tutulur.
- Redis mevcut kaynakta kullanılmadığı için ilk saha paketine girmez.

SQLite yalnız ileride küçük demo sürümü veya telefon outbox'ı gibi sınırlı bir
amaç için yeniden değerlendirilebilir. SQLite'ın kendi rehberi de ağ dosyası
üzerinden çok istemcili kullanımı önermiyor:
https://www.sqlite.org/whentouse.html

### Çalışma modeli: Windows service

Önerilen topoloji:

```text
İmzalı Windows Installer
  ├─ RESTOTM PostgreSQL Service
  ├─ RESTOTM Runtime Service
  │   ├─ Local API + Socket.IO
  │   ├─ Admin Next standalone
  │   ├─ Waiter Next standalone
  │   ├─ Print Agent
  │   ├─ License scheduler
  │   ├─ Menu sync/outbox worker
  │   └─ Health, backup ve update coordinator
  ├─ Tek LAN gateway
  └─ Tauri Kontrol Merkezi
      ├─ Aktivasyon / kilit
      ├─ Servis ve lisans durumu
      ├─ LAN adresi + garson QR
      ├─ Yazıcı keşfi / test
      ├─ Yedek / geri yükleme
      └─ Güncelleme
```

Tauri yalnız kontrol/tray arayüzüdür. Kapatılması operasyon servislerini
durdurmaz. Pilot installer Inno Setup ile hızlandırılabilir; üretim hedefi
repair/upgrade/rollback desteği için WiX Toolset + Burn'dür.

### Bulut ve lokal sınırı

Bulutta kalacaklar:

- Lisans control plane ve Ed25519 özel anahtarı
- Superadmin lisans/kurulum/audit yönetimi
- Ortak/public QR menü API'si ve medya
- Menü senkronizasyon uçları
- İmzalı güncelleme manifesti ve release metadata

Lokale taşınacaklar:

- Personel auth
- Masa, sipariş, ödeme, stok, reçete, rapor, müşteri, rezervasyon
- Admin ve garson uygulamaları
- Socket.IO
- Print-agent ve POS donanım erişimi
- Lokal PostgreSQL
- Yedekleme, sağlık, lisans doğrulama ve update agent

`packages/license/src/sign.ts` ve özel anahtar kullanan hiçbir bağımlılık
müşteri artifact'ine girmeyecek.

## 3. LAN standardı

Dışarı açılan tek port hedefi `8787`:

```text
http(s)://restotm-AB12.local:8787/          admin
http(s)://restotm-AB12.local:8787/garson    waiter
http(s)://restotm-AB12.local:8787/api       local API
http(s)://restotm-AB12.local:8787/socket.io realtime
```

- Firewall yalnız Windows `Private` profil ve `LocalSubnet` için açılır.
- DB ve iç uygulama portları LAN'dan bile erişilemez.
- Router DHCP reservation önerilir.
- mDNS hostname + değişen IP'yi gösteren fallback QR bulunur.
- Admin/waiter aynı origin kullanır; CORS ve Socket.IO sadeleşir.
- Personel ve misafir Wi-Fi ağları ayrılır; WPA2/3 kullanılır.

Ham IP üzerinde HTTP, gerçek PWA/service worker ve maksimum güvenlik hedefiyle
uyumlu değildir. Pilot aşamada LAN HTTP çalışabilir; üretimde yönetilen lokal
sertifika veya pinned sertifikalı ince native waiter wrapper değerlendirilir.
Service Worker güvenli bağlam gereksinimi:
https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API

## 4. Lisans protokolü

### Mevcut doğru temel

- Ed25519 imza
- Özel anahtarın yalnız bulutta kalması
- Donanım bağlama
- Aktivasyon ve heartbeat uçları
- İmzalı süre uzatmasının yoklamayla otomatik yansıması

### 08.08.2026'da kapatılan açıklar

- `license-state.json` silinince grace kontrolünün tamamen atlanması
- Başarılı heartbeat/aktivasyon yanıtının doğrulanmadan diske yazılması
- Suspend/revoke kararının istemci tarafından yok sayılması
- İki cihazın eşzamanlı ilk aktivasyon yarışı
- Lisans payload'ında runtime alan/tarih/sürüm doğrulamasının zayıflığı
- Build zincirinin license paketini açıkça derlememesi
- Aktif repodaki düz metin veritabanı bağlantı bilgisinin env kullanımına
  çevrilmesi

Lisans formatı v2, imzalı `entitlement` ve `offlineUntil` taşır.
`offlineUntil = min(subscriptionExpiresAt, issuedAt + graceDays)` kuralı
sayesinde state dosyasını silmek toleransı yenilemez ve grace ücretli bitişi
aşamaz.

### Sonraki güvenlik katmanı

- Cihaz ilk kurulumda CNG/TPM anahtar çifti üretir.
- Private device key export edilemez; TPM yoksa DPAPI + service ACL fallback.
- Heartbeat server nonce'unu cihaz private key'iyle imzalar.
- Lisans anahtarı yalnız ilk aktivasyonda kullanılır.
- Cloud kısa ömürlü, sequence/kid taşıyan imzalı lease döndürür.
- Runtime lisans kapısı REST, WebSocket ve background job seviyesinde uygulanır.
- Aktivasyon atomik ve tüm lifecycle işlemleri audit log'ludur.

DPAPI referansı:
https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata

### Süre dolduğunda davranış

Lisans dolunca restoranın verisi rehin alınmaz:

- Yeni adisyon/sipariş açma ve normal mutation işlemleri kilitlenir.
- Açık adisyonları kapatma, zorunlu fiş basma, yedek alma, veri dışa aktarma,
  destek ve yeniden aktivasyon erişilebilir kalır.
- 30/7/3/1 gün kala kalıcı uyarı gösterilir.
- İnternet yoksa yalnız imzalı offline lease sonuna kadar çalışır.

## 5. Kod koruma hedefi

Müşteri bilgisayarının administrator kullanıcısına karşı kodun matematiksel
olarak “okunamaz” olması mümkün değildir. Browser'a giden UI JavaScript'i de
istemciye teslim edilir. Güvenlik hedefi okunamazlık değil, lisans sahteciliğini
kriptografik olarak engellemek ve tersine mühendislik maliyetini yükseltmektir.

Müşteri paketinde bulunmayacaklar:

- Git geçmişi, `.ts/.tsx` kaynakları, testler ve dev bağımlılıkları
- Source map ve declaration çıktıları
- `.env`, ortak sabit sır veya cloud private key
- Lisans imzalama modülü

Uygulanacak katmanlar:

- API/print worker tek bundle, minify ve seçici obfuscation
- Next `output: standalone`
- Kritik lisans/update guard'ı Rust veya C# native service
- Node SEA yalnız paketleme katmanı; şifreleme/güvenlik sınırı sayılmaz
- Program Files salt okunur; yalnız imzalı updater yazabilir
- Her kurulumda benzersiz JWT/DB/agent sırları
- DPAPI/TPM ve sıkı service SID/NTFS ACL
- Authenticode imzalı EXE, service, installer ve update manifesti

Node SEA: https://nodejs.org/api/single-executable-applications.html

## 6. Sektör standardından alınan gereksinimler

- SambaPOS ana PC + Windows/SQL + LAN terminal modelini kullanır; REST_OTM DB'yi
  terminallere açmayacak, yalnız API gateway açacaktır:
  https://kb.sambapos.com/en/2-1-6-how-to-run-sambapos-on-multiple-computers/
- ERP12 PC POS + Android garson/mutfak ve departman yazdırmayı ürün standardı
  olarak sunar: https://www.12restoran.com/
- NarPOS local/cloud-hybrid, online/offline ve otomatik günlük yedek vurgular:
  https://narpos.com.tr/en/isletme/restoran
- Oracle Simphony offline kuyrukları bağlantı gelince replay eder:
  https://docs.oracle.com/en/industries/food-beverage/simphony/19.3/sipou/c_workstation_online_offline_modes.htm
- Lightspeed LiteServer bulut verisinin yerel kopyasıyla internet kesintisinde
  operasyonu sürdürür:
  https://resto-support.lightspeedhq.com/hc/en-us/articles/115003529548-About-the-LiteServer

REST_OTM kabul kriterleri:

- Sipariş/print job için DB-backed durable outbox
- Her komutta idempotency key; tekrar gönderim tek kayıt üretir
- Yazıcı retry/backoff, fallback printer ve reprint audit
- WAN kesilince masa/sipariş/ödeme/yazdırma çalışmaya devam eder
- Wi-Fi kopuk istemci sunucu ACK almadan siparişi başarılı göstermez
- Host reboot sonrası PostgreSQL recovery ve kuyruk replay otomatik olur

## 7. Yedek ve güncelleme

Yedek:

- Gece `pg_dump -Fc`, yoğunluğa göre 30–60 dakikalık döngüsel yedek
- 14 günlük + 8 haftalık + 12 aylık saklama
- `.partial` yazım, doğrulama sonrası atomik rename
- SHA-256 manifest ve DPAPI korumalı şifreleme anahtarı
- En az bir fiziksel olarak ayrı kopya (USB/NAS/opsiyonel cloud)
- Haftalık geçici DB'ye otomatik restore testi
- Geri yükleme öncesi safety backup

Güncelleme:

- İmzalı manifest + SHA-256 + Authenticode
- Download → stage → DB backup → maintenance → migration → healthcheck
- Versioned release dizini ve atomik `current` geçişi
- Health başarısızsa binary rollback
- Migration'lar expand/contract uyumlu
- Restoran çalışma saatinde zorunlu feature update yok

## 8. Aşamalı uygulama planı

### Faz 0 — baseline ve kritik güvenlik

- [x] Claude commit/diff denetimi
- [x] Strict TypeScript geçişini doğrulama
- [x] Lisans testleri 16/16
- [x] Print-agent testleri 26/26
- [x] State silme, signed revoke ve verify-before-write düzeltmeleri
- [x] Düz metin DB bilgisini aktif dosyadan kaldırma
- [ ] Sızmış DB parolasını bulut sağlayıcıda rotate etme
- [ ] CI ve temiz checkout build

### Faz 1 — fiziksel cloud/local ayrımı

- [x] Ayrı cloud entrypoint/artifact: license, superadmin, salt-okuma projection
- [x] Ayrı local entrypoint/artifact: operasyon, Socket.IO, backup ve printing
- [x] Tek süre kaynağı: imzalı License entitlement
- [x] Cloud private key'in local artifact'ta olmadığını fail-closed audit ile kanıtlama
- [x] Render tanımını yalnız cloud entrypoint'e indirme
- [x] Ortak/public menü projection outbox/sync uygulaması

### Faz 2 — lisans runtime ve UI

- [x] Native guard/supervisor kaynak ve fail-closed kontrat temeli
- [x] Aktivasyon ve kontrollü kilit/recovery ekranı
- [x] Global API/WS/job license gate
- [x] Jitter'lı heartbeat + imzalı lease
- [x] Superadmin License CRUD/suspend/revoke/rebind/audit UI

### Faz 3 — yerel saha runtime'ı

- [ ] Bundled loopback PostgreSQL
- [x] Admin/waiter standalone build
- [ ] Local API + Socket.IO + print-agent gerçek Windows supervision kabulü
- [x] Tek origin gateway
- [ ] Firewall, mDNS advertising ve Tauri UI (IP fallback + garson QR backend tamam)
- [x] WiX/Burn, service recovery, DPAPI, ProgramData ve firewall güvenlik iskeleti

### Faz 4 — dayanıklılık

- [x] Order/menu/print transactional outbox
- [x] Atomik PostgreSQL yedek, hash ve retention runtime
- [x] Şifreleme, ayrı klasör/volume replica ve non-destructive restore doğrulama
- [ ] İmzalı update ve rollback
- [ ] Health/readiness paneli

### Faz 5 — installer ve saha pilotu

- [ ] Temiz Windows 11 VM, Node/Git/Docker olmadan tek kurulum
- [ ] 3–5 gerçek telefon, 3 yazıcı, router/elektrik/internet kesinti testleri
- [ ] Pilot Inno installer
- [ ] Üretim WiX/MSI ve Authenticode

## 9. Claude ekran görüntüsü kontrol listesi

| İstenen | Güncel durum |
|---|---|
| Kurulum dosyası, birkaç tıkla kurulum | Planlandı, henüz yok |
| Lokal sunucunun açılması | API + gateway + native supervisor kaynağı var; gerçek Windows artifact/VM kabulü yok |
| Lokal veritabanı | PostgreSQL + yedek runtime var; Windows paketleme yok |
| Lisans anahtarı giriş ekranı | Tamamlandı; Windows temiz VM kabulü bekliyor |
| Süre bitince kilit/recovery ekranı | Tamamlandı; saha kabulü bekliyor |
| Periyodik yoklama | Saatlik runtime + retry tamamlandı |
| Kod gizleme/paketleme | Fiziksel API split ve fail-closed audit geçti; native/UI payload bundling kaldı |
| Windows otomatik başlama | WiX/service iskeleti var; imzalı supervisor ve Win11 kabulü yok |
| Print-agent pakete girsin | Durable outbox/agent çalışıyor; gerçek Windows executable/pilot kaldı |
| Garson Wi-Fi'dan bağlansın | Same-origin gateway ve güvenli IP/QR backend tamam; mDNS/Tauri ve telefon pilotu kaldı |
| Superadmin lisans üretme/yönetme | CRUD/lifecycle/audit API ve profesyonel UI tamam |

Bu tablo her faz sonunda güncellenecek; “bitti” yalnız temiz Windows VM ve gerçek
telefon/yazıcı kabul testi geçtiğinde yazılacaktır.
