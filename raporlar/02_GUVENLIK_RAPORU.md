# Güvenlik ve Hata Raporu — 04.08.2026 (güncellendi: 06.08.2026, 3. tarama)

Öncelik sırasına göre. Her madde: **Bulgu → Neden önemli → Nerede → Ne yapılmalı.**

> 2. tarama sistem genelinde yapıldı: yetkilendirme, tenant izolasyonu, tüm
> `router.*` tanımları, SSRF, XSS, secret sızıntısı, müşteri tarafı (menu app)
> akışları. Bulunan en kritik iki sorun bu turda **düzeltildi** (G-00, G-13).
>
> 3. tarama (06.08.2026) iki paralel derin izolasyon denetimi + manuel
> doğrulamayla yapıldı: yeni bir **KRİTİK** açık (G-14) ve Y-06'da zaten
> "yapılmadı" olarak işaretli olan print-agent sır paylaşımı (G-15) bu
> turda düzeltildi. Ayrıca üyelik süresi (superadmin'den uzatma/azaltma,
> restoran panelinde kalan süre gösterimi) altyapısı eklendi.

---

## 🔴 KRİTİK

### G-14 · [DÜZELTİLDİ 06.08.2026] `POST /auth/register` — tenantId enjeksiyonu ile tam izolasyon kırılması
- **Nerede:** `apps/api/src/modules/auth/auth.routes.ts` (route'ta `tenantMiddleware` yoktu), `auth.validation.ts` (`registerSchema.tenantId` istek gövdesinden alınıyordu), `auth.service.ts` `register()`.
- **Bulgu:** Route `rbac('OWNER', 'SUPER_ADMIN')` istiyordu ama `tenantMiddleware` uygulanmamıştı. `registerSchema` `tenantId`'yi body'den alıyor, `authService.register()` bunu hiç doğrulamadan `prisma.user.create()`'e veriyordu. Sonuç: **herhangi bir restoranın OWNER'ı**, kendi geçerli girişiyle, gövdeye başka bir restoranın `tenantId`'sini yazarak o restorana **OWNER rolünde** kullanıcı ekleyebiliyordu — çok kiracılı izolasyonun tam kırılması.
- **✅ Düzeltildi:**
  1. `registerSchema`'dan `tenantId` alanı tamamen kaldırıldı.
  2. Route'a `tenantMiddleware` eklendi.
  3. `controller.register()` artık hedef tenant'ı `getTenantId(req)` ile (OWNER için her zaman kendi tenant'ı; SUPER_ADMIN için mevcut `x-tenant-id` header override deseni) belirliyor.

### G-15 · [DÜZELTİLDİ 06.08.2026] Print-agent tek global sır paylaşıyordu (Y-06'nın uygulanması)
- **Nerede:** `apps/api/src/websocket/socket.server.ts` (~satır 42-70).
- **Bulgu:** Tüm restoranlar `env.PRINT_AGENT_SECRET` adında **tek bir ortak sırla** doğrulanıyordu; agent kendi `tenantId`'sini bildiriyor, DB'de var mı diye bakılmıyordu. Sırrı ele geçiren biri, `tenantId` alanına başka bir restoranın ID'sini yazarak o restoranın sipariş/fiş odasına katılabilir, sahte `payment:completed` tetikleyebilirdi.
- **✅ Düzeltildi:** `Tenant` modeline `printAgentSecret String?` eklendi; her yeni tenant kendi rastgele sırrıyla (`crypto.randomBytes(24)`) oluşturuluyor. Socket auth artık bildirilen `tenantId`'yi DB'den çekip **o tenant'ın kendi sırrıyla** karşılaştırıyor (`safeCompare`). **Geriye dönük uyumluluk:** `printAgentSecret` henüz `null` olan (migration öncesi) tenant'lar için global sırra düşülüyor — mevcut canlı kurulum kırılmadı. Admin panelinde Ayarlar → Yazıcılar'a sırrı gösteren/kopyalayan/yenileyen bir kart eklendi (`POST /tenants/:id/regenerate-print-secret`, sır her zaman sunucuda üretilir, istemciden asla kabul edilmez).

### G-16 · [DÜZELTİLDİ 06.08.2026] `refreshToken()` tenant durumunu hiç kontrol etmiyordu
- **Nerede:** `apps/api/src/modules/auth/auth.service.ts` `refreshToken()`.
- **Bulgu:** Sadece `User.isActive` kontrol ediliyordu. Bir restoran pasife alınsa veya üyeliği dolsa bile, zaten oturumu açık kullanıcılar token yenileyerek sınırsız erişmeye devam edebiliyordu — `login()`'deki koruma sadece yeni girişleri kapsıyordu.
- **✅ Düzeltildi:** `refreshToken()` artık `login()` ile aynı kontrolü (tenant `isActive` + `subscriptionExpiresAt` süresi) tekrarlıyor, kendi mesaj/statusCode'larıyla.

**Bilinçli olarak bu turda çözülmeyen (spekülatif/düşük öncelik):** `login()`'deki tenant'sız email araması (`findFirst({email})`, `slug` gönderilmezse belirsiz sonuç — aynı email birden fazla tenant'ta olabilir çünkü `@@unique([tenantId, email])`). G-14 düzeltmesi bunun pratik istismar edilebilirliğini büyük ölçüde azalttı (saldırgan artık keyfi tenant'a çakışan email ile kullanıcı ekleyemiyor), ama kök neden (belirsiz `findFirst`) hâlâ duruyor. Ayrı bir iyileştirme olarak `03_YAPILACAKLAR.md`'ye eklendi (Y-14).

---

### G-00 · [DÜZELTİLDİ] Kimlik doğrulaması olmadan TÜM restoranların masaları tek istekte silinip yeniden yazılabiliyordu
- **Nerede:** `apps/api/src/modules/public/public.routes.ts` → `GET /api/public/fix-tables`
- **Bulgu:** Bu uç nokta **hiçbir kimlik doğrulaması gerektirmiyordu** ve
  çağrıldığında **veritabanındaki her tenant'ı** tek tek gezip masalarını
  sabit bir şablona (`MS1-24`, `MT25-40`, `VIP1-20`) göre siliyor, yeniden
  adlandırıyor veya yeniden oluşturuyordu. Tarayıcıdan bu adresi ziyaret
  etmek (`GET`, link paylaşımı, bir arama motoru taraması, hatta bir
  önizleme botu) bile tetiklemeye yeterliydi.
- **Neden kritik:** İnterneti olan **herkes**, platformdaki **tüm
  restoranların** masa düzenini tek istekle bozabilir/silebilirdi. Kimlik
  doğrulama yok, tenant sınırı yok, geri alma yok. Bu, bulunan en ciddi açıktı.
- **Kanıt:** `apps/api/src/modules/public/public.routes.ts` içinde route,
  `authMiddleware` olmadan `router.get('/fix-tables', ...)` şeklinde
  tanımlıydı; controller içinde `prisma.tenant.findMany()` (filtresiz —
  yani TÜM tenant'lar) ile başlıyordu.
- **✅ Düzeltildi (04.08.2026):**
  1. `GET` → `POST` (yan etkisi olan işlem artık GET ile tetiklenemez)
  2. `authMiddleware` + `rbac('SUPER_ADMIN')` zorunlu
  3. Artık TÜM tenant'lar değil, istekte **açıkça belirtilen tek bir
     `tenantId`** üzerinde çalışıyor
  4. Eski hâli `public.controller.v1.ts.bak` ve `public.routes.v1.ts.bak`
     içinde saklı (referans için)
- **Önerilen ek adım:** Bu bir kerelik göç betiğiydi; artık işini gördüyse
  route tamamen kaldırılabilir. Kaldırmadım çünkü "çalışan bir şeyi silme"
  ilkesine göre bu karar sana ait — istersen söyle, kaldırayım.

### G-13 · [DÜZELTİLDİ] Müşteri tarafında "Garson Çağır" hiç çalışmıyordu
- **Nerede:** `apps/menu` (müşteri menü uygulaması) → `MenuClient.tsx`
- **Bulgu:** Buton, `POST /api/public/waiter/call/:slug` adresine istek
  atıyordu ama bu adres **hiç tanımlı değildi** (404). Gerçek çalışan uç
  nokta `POST /api/waiter/call` idi ama o da `authMiddleware` beklemeden
  `tenantMiddleware` kullandığından (ki bu middleware `req.user` şart
  koşuyor) her zaman 401 dönüyordu — yani hangi yoldan gidilse **buton
  müşteri için hiçbir zaman çalışmıyordu.**
- **Neden önemli:** Bu, senin "bizim istememize rağmen yansımayan" dediğin
  türden bir hataydı — arayüzde buton var, tıklanıyor, ama restorana hiçbir
  sinyal gitmiyordu.
- **✅ Düzeltildi:** `public.controller.ts` içine, kimlik doğrulama
  gerektirmeyen ama **masanın gerçekten o restorana ait olduğunu
  doğrulayan** yeni bir `callWaiter` eklendi; route
  `POST /api/public/waiter/call/:slug` olarak tanımlandı — menü
  uygulamasının zaten çağırdığı adresle birebir eşleşiyor.
- **Not:** Eski `POST /api/waiter/call` (personel tarafı, auth'lu) dokunulmadan
  kaldı; hâlâ kullanılmıyor ama bozuk da değil, birinin faydalanmak
  isteyebileceği ihtimaline karşı silinmedi.

### G-01 · Üretimde varsayılan (herkesçe bilinen) sırlar kullanılabiliyor
- **Nerede:** `apps/api/src/config/env.ts`
- **Bulgu:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `PRINT_AGENT_SECRET`,
  `SUPER_ADMIN_PASSWORD` için kaynak kodda `...-CHANGE-ME` varsayılanları var.
  Ortam değişkeni tanımlanmazsa uygulama sessizce bu değerlerle çalışır.
- **Neden önemli:** Bu değerler herkese açık repoda. Bilen biri geçerli JWT
  üretip **herhangi bir işletmenin verisine tam erişebilir.**
- **Şimdilik yapıldı:** Üretimde başlangıçta yüksek sesle konsol uyarısı basılıyor.
- **Bilerek yapılmadı:** Uygulamayı `throw` ile başlatmama adımını şimdi
  uygulamadım — sistem şu an canlı ve Render panelinde bu değişkenlerin dolu
  olup olmadığını göremiyorum; eğer biri eksikse `throw` canlı sistemi anında
  düşürür. Önce Render → Environment sekmesinden 4 değişkenin de dolu olduğunu
  doğrula, sonra Y-05'i uygula.
- **Yapılmalı:** Değerler doğrulandıktan sonra `NODE_ENV=production` iken
  varsayılan kullanılıyorsa uygulama **başlamamalı** (`throw`). Bkz. `03_YAPILACAKLAR.md` Y-05.

### G-02 · Print-agent sırrı ile tenant kimliği doğrulanmıyor
- **Nerede:** `apps/api/src/websocket/socket.server.ts` (~satır 42-60)
- **Bulgu:** Agent, `tenantId`'yi **kendisi bildiriyor** ve API bunu doğrulamıyor.
  Tek bir `PRINT_AGENT_SECRET` tüm işletmeler için ortak.
- **Neden önemli:** Bir restoranın agent sırrını ele geçiren kişi, başka bir
  restoranın odasına katılıp o işletmenin **tüm sipariş/fiş verisini** okuyabilir.
- **Yapılmalı:** Her tenant için ayrı agent sırrı (DB'de `PrinterConfig` veya
  `Tenant.agentSecret`), ya da sır + tenantId çiftinin DB'den doğrulanması.
- **Şimdilik yapıldı:** Sır karşılaştırması sabit zamanlı (`timingSafeEqual`) hâle getirildi.

---

## 🟠 YÜKSEK

### G-03 · [DÜZELTİLDİ] Logo URL'i üzerinden SSRF (iç ağ taraması)
- **Nerede:** `apps/print-agent/src/printer/image.ts` → `Jimp.read(url)`
- **Bulgu:** Admin panelinden girilen `logoUrl`, restoranın **yerel ağındaki**
  agent tarafından indiriliyor. `http://192.168.1.1/...` gibi bir adres girilebilir.
- **Neden önemli:** Yetkili bir kullanıcı (veya hesabı ele geçirilmiş bir admin)
  restoranın iç ağını tarayabilir; router/kamera arayüzlerine istek atabilir.
- **✅ Düzeltildi:** İndirmeden önce hostname DNS ile çözülüyor; sonuç IP
  özel aralıklardan biriyse (`10/8`, `172.16/12`, `192.168/16`, `127/8`,
  `169.254/16`, `::1`, `fc00::/7`, `fe80::/10`) indirme reddediliyor. Eski
  hâli `image.v1.ts.bak` içinde.
- **Kalan risk (düşük):** DNS-çözümle-sonra-indir arasında TOCTOU penceresi
  var (DNS rebinding). Restoran logosu gibi düşük hassasiyetli bir alan
  için kabul edilebilir; tam çözüm için indirmeyi doğrudan çözülen IP'ye
  yapıp `Host` header'ı ayrı göndermek gerekir (Y-04'e not düşüldü).

### G-04 · Admin uygulaması derlenmiyordu
- **Nerede:** `apps/admin/.../orders/page.tsx`, `.../tables/page.tsx`
- **Bulgu:** Kapatılmamış import bloğu ve çift `useCallback` importu.
- **Durum:** ✅ **Düzeltildi.**
- **Ders:** CI'da `pnpm -r typecheck` zorunlu hâle getirilmeli (bkz. Y-01).

---

## 🟡 ORTA

### G-05 · [DÜZELTME: DÜŞÜK ÖNCELİK] Yazdırma uç noktalarında ayrı rol kontrolü yok
- **Nerede:** `apps/api/src/modules/printing/print.routes.ts`
- **Düzeltme:** İlk taramada "rol kontrolü yok, kim olsa basar" olarak
  yazılmıştı — bu yanıltıcıydı. `authMiddleware` zaten geçerli bir personel
  girişi (en düşük rol `WAITER`) şart koşuyor; sistemde rolsüz/anonim bir
  kullanıcı zaten fiş basamıyor. Gerçek eksik **rol** değil, **oran
  sınırı** (bir kullanıcı saniyede yüzlerce fiş isteği atabilir).
- **Yapılmalı:** `printLimiter` adında kullanıcı başına dakikada ~30 istekle
  sınırlı bir `rateLimiter` eklenmesi (bkz. Y-07, güncellendi).

### G-06 · `express.json({ limit: '10mb' })` tüm uçlarda geçerli
- **Nerede:** `apps/api/src/app.ts:179`
- **Etki:** Kimliği doğrulanmış bir kullanıcı 10 MB'lık gövdelerle bellek/CPU
  tüketebilir.
- **Yapılmalı:** Varsayılan `256kb`, sadece dosya/görsel yükleyen uçlarda büyük limit.

### G-07 · `logoUrl` uzunluğu 2048 karakter ve `data:` engellenmiyor (API tarafında)
- **Nerede:** `packages/receipt-core/src/layout.ts` → `logoUrl`
- **Bulgu:** Agent tarafında `http(s)` şartı var (iyi), fakat API kaydederken
  şema kontrolü yok. Panelde kırık/kötü niyetli URL saklanabiliyor.
- **Yapılmalı:** Kaydetme sırasında `https?://` şeması ve maksimum uzunluk doğrulaması.

### G-08 · Ödeme/tahsilat toplamı istemciden geliyor olabilir
- **Nerede:** `apps/api/src/modules/printing/print.service.ts` (bill akışı)
- **Bulgu:** Fişe basılan `total` ve `payments` değerlerinin sunucuda yeniden
  hesaplandığı doğrulanmalı; aksi hâlde yanlış tutarlı fiş bastırılabilir.
- **Yapılmalı:** Toplam her zaman DB'deki `order.grandTotal`'dan alınmalı.

---

## 🟢 DÜŞÜK / HİJYEN

### G-09 · `dist/` klasörleri repoda takip ediliyor
- **Nerede:** `.gitignore` (`dist/` bilinçli olarak hariç tutulmamış)
- **Etki:** Kaynak ile derlenmiş çıktı birbirinden ayrı düşebilir; "kod
  değişti ama davranış değişmedi" hataları doğar.
- **Not:** Restoran bilgisayarında internet olmadan çalışabilmesi için şu an
  faydalı. Kalıcı çözüm: agent için imzalı bir sürüm paketi (release zip).

### G-10 · Repo kökünde dağınık dosyalar
- `fix.js`, `update_printing.js`, `query_users.ts`,
  `Gemini_Generated_Image_n5jlren5jlren5jl.png` (0.9 MB)
- **Yapılmalı:** `scripts/` altına taşınmalı veya kaldırılmalı. (Bu iş
  yapılmadı — silme yetkisi istenmediği için.)

### G-11 · `waiter` ve `superadmin` uygulamalarında fiş tipi kopyaları duruyor
- **Nerede:** `apps/waiter/src/lib/printing.ts`, `apps/superadmin/src/lib/printing.ts`
- **Bulgu:** Bu dosyalar hâlâ eski `PrintLayout` tanımını içeriyor. Şu an
  yalnızca `sendXPrint()` fonksiyonları kullanıldığı için **zarar vermiyor**,
  ama ileride kafa karıştırır.
- **Yapılmalı:** `admin` gibi `@rest-otm/receipt-core`'dan yeniden dışa aktarılmalı (bkz. Y-03).

### G-12 · `.env` dosyası çalışma dizininde duruyor
- `.gitignore` doğru şekilde hariç tutuyor (✅ commit edilmemiş), fakat
  yedekleme/senkronizasyon araçlarına karşı dikkatli olunmalı.
