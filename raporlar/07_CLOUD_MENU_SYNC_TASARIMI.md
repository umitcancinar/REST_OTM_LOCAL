# Bulut QR Menü ve Lokal Senkronizasyon Tasarımı

**Durum:** Mimari karar kaydı — uygulama sırası ve kabul ölçütleri tanımlandı
**Tarih:** 8 Ağustos 2026
**Temel karar:** Restoran operasyonunun tek yazma kaynağı işletmedeki lokal PostgreSQL'dir. Render yalnız lisans yönetimi, cihazların başlattığı lisans yoklaması ve internete açık QR menünün yayınlanmış görünümünü barındırır.

## 1. Değişmez sistem sınırı

| Alan | Asıl veri / çalışma yeri | Bulutta bulunabilecek veri |
|---|---|---|
| Sipariş, adisyon, ödeme, stok, reçete, fire, yazıcı kuyruğu | Yalnız lokal | Yok |
| Kullanıcı, PIN, oturum, müşteri, rezervasyon | Yalnız lokal | Yok |
| Masa durumu ve iç yerleşim | Yalnız lokal | Yok |
| Menü/CMS düzenleme | Lokal admin paneli | Yalnız yayınlanmış public projection |
| QR menü okuma | Render + CDN/object storage | Yayınlanmış kategori, ürün ve tanıtım içeriği |
| Lisans üretme/uzatma/askıya alma | Render superadmin | Lisans ve audit kayıtları |
| Lisans kontrolü | Lokal ajan tarafından başlatılan HTTPS isteği | İmzalı entitlement yanıtı |
| Garson çağrısı | Lokal sistemde sonuçlanır | En fazla kısa ömürlü, PII içermeyen relay olayı |

Render veritabanı hiçbir koşulda lokal PostgreSQL'in replikası değildir. Bulut tarafı sipariş işleyemez, lokal ağdaki veritabanına bağlanamaz ve restoran bilgisayarına inbound port açılmasını gerektiremez.

## 2. Mevcut kodun kesin veri envanteri

### Bulutta kalmaya uygun salt-okunur public içerik

- `GET /public/tenant`: `Tenant.name`, `slug`, `customDomain`, `logo`, `address`, `phone`, `email` alanları public olabilir. Ancak mevcut `Tenant.settings` serbest biçimli JSON olarak bütünüyle dönüyor; secret, entegrasyon ayarı veya iç operasyon anahtarı içermediği doğrulanmadan buluta kopyalanmamalıdır. Allowlist projection zorunludur.
- `GET /public/menu/:slug`: `MenuCategory` ve `MenuItem` okuyor. Public projection için ürün adı, açıklama, görsel, satış fiyatı, porsiyon, müşteri tarafından seçilebilir ekler, alerjen, kalori, rozet ve sıralama uygundur.
- `GET /public/cms/settings/:slug` ve `/navlinks/:slug`: yalnız açıkça tanımlanmış tema, iletişim, çalışma saatleri ve navigasyon alanları yayınlanmalıdır; ham `settings` JSON yayınlanmamalıdır.
- `GET /public/cms/gallery/:slug`: `GalleryImage` yayın görünümüne uygundur.
- `GET /public/cms/stories/:slug`: aktif/süresi dolmamış `Story` yayın görünümüne uygundur.
- `GET /public/cms/reviews/:slug`: yalnız `isApproved=true` olan `Review` yayın görünümüne uygundur.

Public menüye şu iç alanlar varsayılan olarak çıkmamalıdır: `tenantId`, veritabanı iç kimlikleri (gerekmiyorsa), KDV muhasebe oranı, hazırlık departmanı, iç hazırlık süresi, reçete/maliyet/stok bağlantısı, oluşturma-güncelleme audit zamanları. Arayüzde gösterilmesi istenen hazırlık süresi ayrı bir `displayPreparationMinutes` public alanı olmalıdır.

### Kesinlikle lokal operasyon verisi olan mevcut public uçlar

- `GET /public/cms/reservations/:slug`: `Reservation.id`, `tableId`, tarih, kişi sayısı ve durum döndürüyor. Gelecekteki doluluk ve iç masa kimliklerini internete açar; Render public API'den kaldırılmalıdır.
- `GET /public/cms/tablemap/:slug`: `RestaurantTable` kaydının tamamını döndürüyor. Masa durumu, koordinatlar ve zaman damgaları lokal operasyon verisidir; Render public API'den kaldırılmalıdır.
- `POST /public/waiter/call/:slug`: lokal `RestaurantTable` sorgusu ve lokal Socket.IO odası gerektiriyor. Cloud process içinde aynı controller'ın çalışması mimari olarak yanlıştır; aşağıdaki relay/direct modele ayrılmalıdır.
- Legacy `GET /public/menu?tenantId=...`: ham tenant kimliğiyle okuma yapar ve yayın revizyonu sınırını atlar. İstemci geçişinden sonra kaldırılmalı, yalnız slug/custom-domain üzerinden aktif publication okunmalıdır.
- `fixTables`: masa açan, yeniden adlandıran ve silen bakım işlemi public controller içindeydi. Route kaydı bu çalışma kapsamında tamamen kaldırıldı. Böyle bir bakım gerekiyorsa lokal, authenticated, owner-confirmed bir migration/CLI olmalı; HTTP public router'a geri dönmemelidir.

### Operasyonel Prisma modelleri — buluta senkronlanmayacak kesin liste

`User`, `RefreshToken`, `Customer`, `RestaurantTable`, `Reservation`, `Order`, `OrderItem`, ödeme kayıtları, `InventoryItem`, `Recipe`, reçete bileşenleri, `WasteLog`, `PrinterConfig`, `Invoice` ve bunların kimlik/ilişki/audit alanları yalnız lokaldedir. `MenuItem` ile ilişkili `Recipe` hiçbir public projection'a dahil edilmez.

`Tenant` modeli iki farklı güven alanını aynı kayıtta topladığı için aynen kopyalanmaz. Cloud lisans tenant'ı ile public site profili ayrı projection'lardır. Lokal `Tenant.printAgentSecret`, iç ayarlar ve operasyon abonelik kopyaları public site profiline giremez.

## 3. Önerilen public projection şeması

Cloud için operasyon şemasından bağımsız, dar bir şema kullanılmalıdır:

- `PublicSite`: `tenantPublicId`, `slug`, `customDomain`, yayın adı, logo asset kimliği, iletişim allowlist'i, tema allowlist'i, `activeRevisionId`, `publishedAt`, `disabledAt`.
- `PublicRevision`: değişmez `revisionId`, `tenantPublicId`, `sourceInstallationId`, monoton `sourceVersion`, `manifestSha256`, `schemaVersion`, `createdAt`, `activatedAt`.
- `PublicCategory`: revision, stabil public kimlik, ad/açıklama, sıralama, görsel asset kimliği.
- `PublicMenuItem`: revision, stabil public kimlik, kategori public kimliği, müşteri görünür alanlar, para birimi ve **kuruş cinsinden integer** fiyat, sıralama/aktiflik.
- `PublicCmsBlock`: revision, tip (`settings`, `gallery`, `story`, `review`, `navigation`) ve tipe göre doğrulanmış JSON payload.
- `PublicAsset`: içerik hash'i, object-storage key, MIME, byte boyutu, boyutlar, oluşturma zamanı, tarama durumu.
- `SyncInstallation`: lisansla bağlı installation/device public key, son epoch/sequence, son görüldüğü zaman, disabled zamanı.
- `SyncInbox`: `(installationId, idempotencyKey)` unique, body hash, sequence, alınma/uygulanma durumu ve hata özeti.

Bu tabloların hiçbiri lokal operasyon tablolarına foreign key ile bağlanmaz. Public kimlikler tahmin edilemeyen UUID/ULID olabilir; lokal iç kimlikler yayın payload'ına taşınmaz.

## 4. Lokal → bulut, yalnız outbound imzalı yayın protokolü

### İstek güvenliği

Aktivasyonda lokal kurulum cihaz anahtarı üretir. Tercih Windows CNG/TPM'de non-exportable ECDSA P-256 anahtardır; TPM yoksa private key DPAPI machine-scope ile korunur. Lisans sunucusu public key'i lisansın bağlı installation kaydına yazar.

Her sync isteğinde şu alanlar imzalanır:

```text
method + canonicalPath + tenantPublicId + installationId +
epoch + sequence + timestamp + nonce + bodySha256
```

Header'lar: `X-Resto-Installation`, `X-Resto-Key-Id`, `X-Resto-Epoch`, `X-Resto-Sequence`, `X-Resto-Timestamp`, `X-Resto-Nonce`, `Digest`, `X-Resto-Signature`, `Idempotency-Key`.

Cloud tarafı TLS yanında imzayı, lisans-device bağını, entitlement durumunu, beş dakikalık zaman penceresini, nonce tekrarını ve monoton sequence değerini doğrular. Aynı idempotency key + aynı hash önceki cevabı döndürür; aynı anahtar + farklı hash `409` üretir. Askıya alınmış/iptal edilmiş lisans yeni publication aktive edemez.

Lokal veritabanı ve firewall inbound cloud bağlantısı kabul etmez. Sync worker, heartbeat ve waiter relay bağlantılarının hepsi lokal servisten internete doğru başlatılır.

### Outbox ve atomik yayın

1. Admin menü/CMS değişikliğini lokal PostgreSQL transaction'ında kaydeder.
2. Aynı transaction içinde `PublicSyncOutbox` kaydı oluşturulur; böylece veri değişip yayın olayının kaybolması mümkün olmaz.
3. Worker allowlist projection üretir, canonical JSON'a çevirir, manifest hash'ini çıkarır ve gerekiyorsa asset upload işlerini tamamlar.
4. `POST /api/cloud-sync/v1/publications` değişmez tam snapshot'ı alır. Menü boyutu küçük olduğu için ilk sürümde delta yerine tam revision kullanmak daha güvenlidir.
5. Cloud staging transaction'ında payload şemasını ve tüm asset referanslarını doğrular; revision'ı oluşturur ve `PublicSite.activeRevisionId` değerini tek atomik işlemle değiştirir.
6. Başarılı ACK yalnız revision aktif olduktan sonra döner. Lokal outbox `ACKED` olur. Timeout sonrası aynı idempotency key ile tekrar güvenlidir.

Outbox durumları `PENDING → UPLOADING_ASSETS → READY → SENT → ACKED` ve `RETRY/DEAD_LETTER` olmalıdır. Exponential backoff + jitter uygulanır; sonsuz hızlı retry yapılmaz. Son başarılı yayın lokal arayüzde tarih/hash/revision olarak görünür. İnternet kesilince restoran operasyonu etkilenmez; bulutta son başarılı menü yayında kalır.

### Sürüm ve çatışma kuralı

Menü/CMS için tek yazar lokal kurulumdur; cloud superadmin bu içeriği düzenlemez. Böylece çift yönlü merge yoktur. `(epoch, sequence)` leksikografik olarak büyür:

- Normal değişiklikte sequence artar.
- Lokal restore/reinstall sonrası cloud'dan alınan signed reset izniyle epoch artar, sequence sıfırlanır.
- Eski epoch veya düşük sequence reddedilir.
- Aynı sequence farklı manifest hash'i kritik güvenlik/audit olayıdır.

Revision'lar immutable tutulur; son bilinen iyi revision'a atomik rollback yapılabilir. Rollback yeni lokal gerçeği olarak kabul edilecekse yeni sequence ile yeniden yayınlanır.

## 5. Medya yönetimi

Render'ın ephemeral diski medya deposu olarak kullanılmamalıdır. S3 uyumlu object storage + CDN kullanılır. Akış:

1. Lokal dosya kaynak kopyası `data/media` altında tutulur ve lokal yedeğe girer.
2. Worker SHA-256, gerçek MIME sniffing, boyut/pixel sınırı ve güvenli dosya adı kontrolü yapar.
3. Cloud kısa süreli presigned upload URL üretir; lokal ajan dosyayı doğrudan object storage'a yollar.
4. Cloud doğrulama/tarama tamamlanmadan asset `READY` olmaz ve revision aktive edilmez.
5. Asset key içerik hash'inden türetilir; aynı içerik deduplicate edilir. Public URL'de kullanıcı dosya adı veya lokal yol bulunmaz.
6. Artık referanslanmayan asset'ler bir bekleme süresinden sonra garbage collection ile temizlenir; aktif ve rollback revision'larının asset'leri korunur.

SVG varsayılan olarak reddedilmeli veya sunucu tarafında sanitize edilmelidir. HTML çalıştırabilen dosyalar `Content-Disposition: attachment`, doğru `Content-Type` ve `X-Content-Type-Options: nosniff` ile servis edilir. Görsel/video boyut limitleri tenant kotasına bağlanır.

## 6. Garson çağrısının güvenli lokal teslimi

Cloud QR sayfasının `https://` içinden `http://192.168.x.x` çağırması mixed-content ve Private Network Access kuralları nedeniyle güvenilir değildir. Ham IP'ye CORS açmak sektör standardında üretim çözümü sayılmaz. İki çalışma yolu gerekir:

### A. On-prem doğrudan yol — tercih edilen

Restoran Wi-Fi'sinde QR, lokal gateway'in HTTPS/mDNS adresini açar. Gateway aynı public menu projection'ın lokal kopyasını sunar. QR içindeki masa tanıtıcısı iç `tableId` değil, en az 128 bit rastgele `publicTableToken` olur. Lokal gateway token'ı çözer, IP/device rate limit uygular, çağrıyı kalıcı lokal event tablosuna yazar ve Socket.IO ile garsonlara iletir. İşletme interneti olmasa da çalışır.

Lokal HTTPS sertifika dağıtımı güvenilir biçimde çözülemiyorsa kurulum aracı işletme cihazlarına CA yükleme iddiasında bulunmamalıdır. Bu durumda müşteri QR'ları lokal HTTP sayfasını baştan açabilir; bir HTTPS cloud sayfasından HTTP API'ye geçiş yapılmaz.

### B. Cloud relay — internet QR menüsü için

`POST /public/v1/sites/:slug/waiter-calls` yalnız opaque, aktif `publicTableToken`, çağrı türü ve istemci nonce kabul eder. Cloud:

- token bucket rate limit (token, IP ve tenant bazlı), kısa duplicate penceresi ve abuse telemetry uygular;
- müşteri adı/telefonu, masa iç kimliği veya rezervasyon verisi tutmaz;
- olayı en fazla 5 dakika saklar ve tek kullanımlık delivery sequence verir;
- “garson çağrıldı” cevabını ancak lokal ajan ACK verdiyse kesin başarı olarak gösterir; aksi halde “iletiliyor/iletilemedi” durumu döndürür.

Lokal runtime outbound WebSocket/SSE açar veya kısa aralıklı long-poll yapar, imzalı relay olayını alır, token'ı lokal masaya çözer, event'i lokal DB'ye yazar, lokal Socket.IO yayını yapar ve imzalı ACK yollar. Cloud lokalde port açmaz. Lisans askıda/iptal ise relay teslimi durur; fakat restoranın açık adisyon kapatma/backup gibi güvenli kapanış işlevleri lisans politikasına göre lokal kalır.

## 7. Render API'nin kesin sınırı

Render artifact'ında bulunacak route grupları:

- `/api/health`
- `/api/license/activate`, `/api/license/heartbeat`
- `/api/license-admin/**` (SUPER_ADMIN + audit)
- `/api/cloud-sync/v1/**` (device-signature auth; kullanıcı JWT'si değil)
- `/api/public/v1/sites/**` salt-okunur publication API
- `/api/public/v1/sites/:slug/waiter-calls` sadece rate-limited relay

Render artifact'ında bulunmayacak route grupları: `/orders`, `/tables`, `/inventory`, `/reports`, `/printers`, `/reservations`, `/customers`, `/pos`, `/staff`, lokal `/auth`, CMS/menu CRUD ve operasyon WebSocket odaları. Yalnız route mount etmemek nihai koruma değildir; cloud build artifact'ı bu modülleri ve Prisma operasyon client'ını fiziksel olarak içermemelidir.

Public response'larda `Cache-Control`, ETag/revision hash, CSP, HSTS, doğru CORS allowlist ve CDN cache uygulanır. Mutation endpoint'lerinde global/body limit, JSON schema validation, per-tenant kota, audit ve structured security log zorunludur.

## 8. Aşamalı migration

1. **Sınır dondurma:** Public router'dan bakım/mutation kaçaklarını çıkar; `fix-tables` geri dönmeme testi ekle. Mevcut `/cms/reservations` ve `/cms/tablemap` uçlarını deprecated ilan et.
2. **Projection sözleşmesi:** Versioned JSON Schema ve allowlist mapper oluştur. Ham Prisma kaydını spread ederek yayınlamayı yasakla; contract test ekle.
3. **Cloud tabloları:** Operasyon şemasından bağımsız public revision/sync inbox/installation tablolarını migration ile ekle. Cloud API yalnız bunları okusun.
4. **Lokal outbox:** Menü/CMS transaction'larına outbox ekle; worker, retry, idempotency ve yayın durum ekranını tamamla.
5. **Cihaz imzası:** Aktivasyona device public key registration, CNG/TPM + DPAPI fallback ve request replay koruması ekle.
6. **Medya:** Object storage/presigned upload, validation, quota ve orphan cleanup ekle. Render diskine yazmayı kapat.
7. **Public API geçişi:** QR uygulamasını `/public/v1/sites/:slug/publication` sözleşmesine geçir; ETag/revision destekle. Legacy tenantId endpoint'ini kaldır.
8. **Operasyon kaçaklarını kapatma:** `/cms/reservations` ve `/cms/tablemap` cloud route'larını kaldır. CMS/menu mutation sadece lokal profile'da kalır.
9. **Garson çağrısı:** `publicTableToken`, doğrudan lokal yol ve kısa ömürlü cloud relay/ACK akışını ekle; eski controller-to-cloud-Socket.IO yolunu kaldır.
10. **Fiziksel artifact ayrımı:** `cloud` build'i operasyon modülleri olmadan, `local` build'i license signing private key ve superadmin olmadan üret. SBOM/secret scan ile doğrula.
11. **Geçiş/cutover:** Her tenant için ilk full snapshot yayınla, hash ve görsel doğrulaması yap, eski endpoint telemetry'si sıfıra düşünce kaldır.
12. **Felaket testi:** İnternet kesintisi, duplicate upload, sıra dışı sequence, cloud timeout, restore sonrası epoch, object storage kesintisi ve eski revision rollback senaryolarını otomatik test et.

## 9. Kabul ölçütleri

- Cloud veritabanında hiçbir sipariş, müşteri, rezervasyon, masa durumu, kullanıcı/PIN veya yazıcı verisi yoktur.
- Cloud process lokal PostgreSQL bağlantı bilgisine sahip değildir; lokal firewall inbound internet kuralı açmaz.
- Aynı sync isteği yüz kez tekrarlansa yalnız bir revision aktive olur.
- Eski/replay edilmiş veya farklı cihazla imzalanmış istek reddedilir ve audit edilir.
- Lokal menü değişikliği ile outbox kaydı aynı transaction'dadır; güç kesintisi yayını kaybettirmez.
- İnternet yokken POS, garson, mutfak, yazıcı ve lokal menü çalışır; bulut son başarılı QR menüyü göstermeye devam eder.
- Public API ham `Tenant.settings`, iç `tableId`, rezervasyon/doluluk, department/reçete/maliyet veya lokal dosya yolu döndürmez.
- Garson çağrısı yanlış tenant/masa için üretilemez, rate limitlidir, en geç beş dakikada silinir ve ACK olmadan kesin başarı göstermez.
- Render deploy paketi operasyon route/model kodu ve lisans private key dışındaki lokal secret'ları içermez; lokal paket lisans imzalama private key'i içermez.
