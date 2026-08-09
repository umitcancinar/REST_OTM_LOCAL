# REST_OTM Güvenlik Politikası ve Tehdit Modeli

Bu belge ürünün güvenlik sınırını tanımlar. Bir kontrol gerçek Windows kabul
testinden geçmediyse yalnız kaynakta bulunması üretime hazır sayılması için
yeterli değildir.

## Güven sınırları

- İşletme verisi, siparişler, personel, stok, raporlar, yazdırma kuyruğu ve
  yedekler müşteri bilgisayarındaki PostgreSQL/veri dizininde kalır.
- Bulut yalnız lisans kontrol düzlemi, superadmin, imzalı güncelleme metadatası
  ve yayınlanması açık ortak menü projeksiyonunu taşır.
- Lokal sistemden buluta doğru menü yayını outbound-only çalışır. Bulut,
  işletmenin operasyon veritabanına veya LAN servislerine bağlanamaz.
- LAN'da tek giriş noktası TCP `8787`'dir. API, admin, garson, menü ve yazdırma
  child servisleri yalnız loopback üzerinde dinler.

## Kimlik, lisans ve anahtarlar

- Lisans ve güncelleme için birbirinden ayrı Ed25519 güven kökleri kullanılır.
  Private anahtarlar yalnız cloud release/signing ortamında bulunur; müşteri
  paketine ve git deposuna girmez.
- Lisans anahtarları sunucuda rotasyonlu pepper ile HMAC-SHA-256 olarak saklanır.
  Aynı non-revoked lisans için veritabanı seviyesinde tek cihaz koltuğu vardır.
- Lokal entitlement imza, cihaz bağı, süre, entitlement durumu ve offline grace
  alanları doğrulanmadan kabul edilmez. Saat geri alma ve state silme fail-closed
  ele alınır.
- Kurulum secret'ları CSPRNG ile makine başına üretilir, Windows DPAPI
  LocalMachine ile korunur ve yalnız SYSTEM, Administrators ve kısıtlı servis
  SID'inin okuyabildiği DACL ile yazılır.

## Veri dayanıklılığı

- PostgreSQL yalnız loopback üzerinde ve ayrı servis hesabıyla çalışır.
- Yedekler `pg_dump -Fc`, AES-256-GCM, AAD ve SHA-256 manifest ile hazırlanır;
  atomik yayımlanır ve ayrı hedefe kopyalanır.
- Ana veri ve yedek hedefinin aynı fiziksel diskte olması görünür bir risktir.
  Kritik kurulumlarda `require-separate` politikası USB, NAS veya ikinci disk
  olmadan kurulumu tamamlamaz.
- Haftalık doğrulama yedeği değiştirmeden `pg_restore --list` ile yapılır. Saha
  kabulünde ayrıca boş veritabanına gerçek restore ve uygulama smoke testi
  zorunludur.

## Ağ ve tarayıcı güvenliği

- Firewall yalnız Private profile + LocalSubnet + TCP `8787` kuralı açar.
- Gateway Host, Origin, WebSocket upgrade ve forwarded header kontrollerini
  fail-closed uygular; upstream hedefleri sabit loopback URL'leridir.
- Masa QR'ı tenant slug, tableId ve kurulum secret'ına bağlı HMAC token taşır.
  Sunucu tenant/masa varlığını tekrar doğrular ve garson çağrısını IP bazında
  sınırlar.
- mDNS ilanı tenant, lisans, cihaz parmak izi, MAC ve operasyon verisi taşımaz.
  mDNS başarısızsa güvenli doğrudan LAN IP/QR fallback'i kullanılır.

## Güncelleme zinciri

- Manifest canonical JSON olarak Ed25519 ile imzalanır; channel, sürüm aralığı,
  zaman penceresi, migration politikası ve her artifact için HTTPS origin,
  boyut ve SHA-256 içerir.
- Lokal API yalnız doğrulanmış artifact'leri stage eder. Kurulmuş gibi raporlamaz
  ve çalışan binary'leri değiştirme yetkisi yoktur.
- Native supervisor manifesti ve artifact hash'lerini tekrar doğrulamalı; safety
  backup, migration, atomik replace, health gate ve rollback tamamlanmadan yeni
  sürümü başarılı saymamalıdır.
- Anti-rollback high-water state ve aynı sürüm/farklı manifest equivocation
  kontrolü atlanamaz.

## Kod ve paket güvenliği

- Müşteri artifact'i TypeScript kaynak, source map, test, `.env`, private key ve
  cloud signing/admin modüllerini içeremez. Cloud artifact'i operasyon, backup,
  print, Socket.IO ve local runtime modüllerini içeremez.
- Release denetimi dependency closure'u ve dosya içeriğini fail-closed tarar.
  PE dosyaları ve installer üretimde Authenticode ile imzalanmalıdır.
- Müşteri cihazındaki çalıştırılabilir kodun tersine mühendisliği mutlak olarak
  engellenemez. Güvenlik; gizli anahtar gömmemek, minimum artifact, source-map
  kapatma, imza doğrulama, OS ACL/DPAPI ve sunucu tarafı yetkilendirme üzerine
  kuruludur. Obfuscation yalnız ek maliyet oluşturur, güven sınırı değildir.

## Üretime çıkış kapısı

Aşağıdakiler tamamlanmadan ürün `production_ready` veya “nihai ürün” olarak
işaretlenmez:

1. Windows MSVC native build ve Authenticode imzalı MSI/Burn zinciri.
2. Temiz Windows 11 VM'de install/reboot/uninstall/data-preservation testi.
3. Gerçek PostgreSQL migration, backup/restore ve bozuk update rollback testi.
4. En az 3 telefon, farklı router koşulları ve gerçek ağ yazıcısı kabul matrisi.
5. Lisans activate/extend/expire/suspend/revoke/rebind ve internet kesintisi.
6. Dışarıdan erişim/port taraması, secret ve release artifact denetimleri.

Güvenlik açığı şüphesinde ilgili anahtar/parola önce rotate edilir; etkilenen
lisans veya release revoke edilir; audit kayıtları korunur ve temiz, daha yüksek
sürümlü imzalı release yayınlanır. Canlı kimlik bilgileri issue, log, ekran
görüntüsü veya git geçmişine yazılmaz.
