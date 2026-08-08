# Yapılacaklar

Her madde tek başına, bağlamsız uygulanabilecek şekilde yazıldı.
Sıra: yukarıdan aşağıya.

---

## Y-01 · CI'da tip kontrolü ve testleri zorunlu kıl
**Neden:** 04.08.2026'da admin uygulaması iki syntax hatası yüzünden hiç
derlenmiyordu ve kimse fark etmemişti.
**Nasıl:** `.github/workflows/ci.yml` ekle:
```yaml
- run: pnpm install --no-frozen-lockfile
- run: pnpm --filter @rest-otm/receipt-core build
- run: pnpm -r run typecheck
- run: pnpm --filter @rest-otm/print-agent test
```
**Bitti sayılır:** PR açıldığında bu üç adım otomatik koşuyor.

---

## Y-02 · `pnpm-lock.yaml` dosyasını gerçek `pnpm install` ile yenile
**Neden:** `@rest-otm/receipt-core` girdileri elle eklendi (internet erişimi
olmayan bir ortamda çalışıldığı için).
**Nasıl:** Proje kökünde `pnpm install` çalıştır, oluşan lock dosyasını commit et.
**Bitti sayılır:** `pnpm install --frozen-lockfile` hatasız geçiyor.

---

## Y-03 · `waiter` ve `superadmin` fiş tiplerini merkezîleştir
**Neden:** `apps/waiter/src/lib/printing.ts` ve
`apps/superadmin/src/lib/printing.ts` hâlâ eski `PrintLayout` kopyasını içeriyor.
**Nasıl:** `apps/admin/src/lib/printing.ts` dosyasının ilk bölümündeki
`export type { ... } from '@rest-otm/receipt-core'` bloğunu bu iki dosyaya
uyarla; `sendXPrint()` fonksiyonlarına dokunma. İlgili `package.json`'lara
`"@rest-otm/receipt-core": "workspace:*"` ekle.
**Bitti sayılır:** Üç uygulamada da tek tip tanımı var, `pnpm -r typecheck` temiz.

---

## Y-04 · [KISMEN YAPILDI] Logo indirmede SSRF korumasını sıkılaştır (G-03)
**Durum:** Temel koruma (DNS çöz + özel IP reddi) eklendi. Kalan: DNS
rebinding'e karşı indirmeyi çözülen IP'ye yapıp `Host` header ile göndermek,
ve `Content-Length`/boyut sınırı eklemek.

**Nerede:** `apps/print-agent/src/printer/image.ts`
**Nasıl:** `Jimp.read` öncesi hostname'i `dns.lookup` ile çöz; sonuç
`10.x`, `172.16-31.x`, `192.168.x`, `127.x`, `169.254.x`, `::1` ise hata fırlat.
Ayrıca `Content-Length` üst sınırı (örn. 2 MB) uygula.
**Bitti sayılır:** `http://192.168.1.1/logo.png` reddediliyor, test yazıldı.

---

## Y-05 · Üretimde varsayılan sırlarla başlatmayı engelle (G-01) — ÖNCE RENDER'I KONTROL ET
**Nerede:** `apps/api/src/config/env.ts` (uyarı bloğu hazır, `console.error` yapıyor)
**Nasıl:** `console.error` yerine `throw new Error(...)`.
**Önce:** Render panelinde `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
`PRINT_AGENT_SECRET`, `SUPER_ADMIN_PASSWORD` değerlerinin dolu olduğunu doğrula.
**Bitti sayılır:** Değişken eksikken uygulama açılmıyor, doluyken normal açılıyor.

---

## Y-06 · [YAPILDI 06.08.2026] Tenant başına print-agent sırrı (G-02 / G-15)
Uygulandı: `Tenant.printAgentSecret`, tenant oluşturmada otomatik üretim,
`socket.server.ts`'de DB'den dogrulama + global sırra geriye dönük düşme,
Ayarlar → Yazıcılar'da göster/kopyala/yenile kartı
(`POST /tenants/:id/regenerate-print-secret`).

---

## Y-14 · login()'deki tenant'sız email aramasını netleştir
**Neden:** `apps/api/src/modules/auth/auth.service.ts` `login()`, `slug`
gönderilmezse `prisma.user.findFirst({ where: { email } } )` ile tenant
filtresiz arama yapıyor. `@@unique([tenantId, email])` oldugu için aynı
email birden fazla tenant'ta olabilir; bu durumda hangi kaydın
döneceği belirsiz. G-14 düzeltmesiyle (register artık keyfi tenant'a
kullanıcı eklemeyi engelliyor) pratik istismar riski büyük ölçüde
azaldı, ama kök belirsizlik hâlâ duruyor.
**Nasıl:** Admin/waiter login ekranlarına restoran slug'ı sorulması
(veya subdomain/customDomain'den otomatik çözülmesi) zorunlu kılınabilir;
ya da `findFirst` yerine, birden fazla eşleşme varsa 409 dönüp
kullanıcıdan slug istenmesi.
**Bitti sayılır:** Aynı email iki farklı tenant'ta varken login,
hangi hesaba girildiğini asla varsaymıyor.

---

## Y-15 · `apps/superadmin` bağımsız uygulaması kullanılmıyor
**Neden:** Gerçek "Sistem Yönetimi" ekranı `apps/admin/src/app/(dashboard)/super-admin/page.tsx`
içinde yaşıyor ve production'da bu kullanılıyor. Ayrı `apps/superadmin`
(port 3003) uygulamasındaki `tenants/page.tsx` içindeki "Yeni Müşteri
Ekle" ve düzenleme butonlarının hiç `onClick`'i yok — yarım kalmış bir
kopya. Kafa karıştırıyor (hangi ekran gerçek diye tekrar araştırmak
gerekti), fonksiyonel bir zarar vermiyor.
**Nasıl:** Ya tamamen kaldırılmalı (silme yetkisi istenmediği için
yapılmadı), ya da `apps/admin/.../super-admin` ile aynı özelliklere
kavuşturulup asıl kullanılacak uygulama netleştirilmeli.
**Bitti sayılır:** Tek bir "Sistem Yönetimi" ekranı kalıyor.

---

## Y-07 · Yazdırma uç noktalarına oran sınırı (G-05)
**Nerede:** `apps/api/src/modules/printing/print.routes.ts`
**Not:** Rol kontrolüne gerek yok (authMiddleware zaten personel girişi
şart koşuyor). Sadece `rateLimiter.middleware.ts` içindeki `orderLimiter`
benzeri bir `printLimiter` (ör. kullanıcı başına dakikada 30) ekle.

---

## Y-08 · Fiş şablonu içe/dışa aktarma (JSON)
**Neden:** Bir şubede hazırlanan tasarımı diğerine taşımak.
**Nasıl:** Ayarlar → Çıktı Tasarımı'na "Dışa Aktar / İçe Aktar" butonları;
içe aktarırken `normalizeLayout()` üzerinden geçir.

---

## Y-09 · "Bu tasarımla test fişi bas" butonu
**Neden:** Kaydetmeden önce gerçek kağıtta görmek.
**Nasıl:** `POST /printers/:id/test` zaten var; gövdeye o anki (kaydedilmemiş)
layout'u ekleyip `printService.testPrint` içinde `normalizeLayout` ile kullan.

---

## Y-10 · Repo kökünü temizle (G-10)
`fix.js`, `update_printing.js`, `query_users.ts`, kullanılmayan büyük PNG →
`scripts/` altına taşı. **Silmeden önce sahibine sor.**

---

## Y-11 · `.bak` dosyalarını gözden geçir
Bu çalışmada bilinçli olarak saklanan yedekler:
```
apps/print-agent/legacy/escpos.v1.ts.bak
apps/print-agent/Baslat.v1.bat.bak
Yazici_Agent_Baslat.v1.bat.bak
apps/admin/src/lib/printing.legacy.tsx.bak
apps/admin/src/app/(dashboard)/settings/ReceiptPreview.v1.tsx.bak
apps/admin/src/app/(dashboard)/settings/page.v1.tsx.bak
_to_delete/_probe.ts
```
Yeni sistem sahada 1–2 hafta sorunsuz çalıştıktan sonra bunlar silinebilir.


---

## Y-12 · `GET /api/public/fix-tables` route'unu tamamen kaldır (opsiyonel)
**Durum:** Artık güvenli (SUPER_ADMIN + POST + tek tenant) ama bu bir kerelik
göç betiğiydi. İşini gördüyse `public.controller.ts`'ten `fixTables` ve
`public.routes.ts`'ten ilgili satırı kaldırabilirsin. Silme işlemini
bilinçli olarak sana bıraktım.

## Y-13 · Eski `POST /api/waiter/call` (personel) rotasını gözden geçir
**Durum:** Kimse çağırmıyor ama bozuk da değil (auth'lu, doğru çalışıyor).
İleride personel panelinden manuel "garson çağır" tetiklemek istenirse
kullanılabilir; istenmiyorsa kaldırılabilir.
