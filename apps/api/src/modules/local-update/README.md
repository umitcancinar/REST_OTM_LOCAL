# Local signed update coordinator

Bu modül yalnızca `local` API closure'ındadır. Cloud tarafında kalan güncelleme
metadata endpoint'inden lisans anahtarı, donanım kimliği, tenant kimliği veya
operasyon verisi göndermeden imzalı manifest alır.

Güvenlik sözleşmesi:

- Manifest endpoint'i credentials/query/hash içermeyen HTTPS URL'dir. Manifest
  isteği yalnız mevcut uygulama sürümü ve channel header'larını taşır.
- Cloud feed uygun daha yeni release yoksa gövdesiz `204 No Content` döner;
  coordinator bunu imzalı manifest gibi yorumlamaz, state yazmaz ve açık
  `NO_UPDATE_AVAILABLE / IDLE` sonucu üretir. Mevcut staged handoff varken boş
  feed gelmesi çelişkidir ve operatör incelemesi için fail-closed olur.
- Manifest canonical JSON'dur ve ayrı update Ed25519 public key'i ile doğrulanır.
  İmzalı alanlar; hedef sürüm/channel, kabul edilen mevcut sürüm aralığı,
  issued/expires zamanları, migration uyumluluğu ve artifact URL/boyut/SHA-256
  listesidir.
- Artifact URL'leri HTTPS ve açık allowlist origin içindedir. Presigned query
  kabul edilir; credentials/hash ve redirect reddedilir. İndirme `.partial`
  dosyasına yapılır, ilan edilen boyut aşılırsa anında kesilir, boyut ve SHA-256
  doğrulanmadan fsync/rename yapılmaz.
- `update-high-water.json` aynı sürüm equivocation ve sürüm/issuedAt rollback'ini
  reddeder. Bozuk/symlink state sıfırlanmaz; fail-closed hata olur. State ve
  handoff 0600, fsync ve atomik rename ile yazılır. Data root bir kez
  `realpath` ile canonical hale getirilir; stage symlink/reparse hedefi kabul
  edilmez. Artifact adları Windows case-insensitive olarak global benzersizdir,
  device/reserved isimler reddedilir.
- Lisans politikası `RECOVERY_MAINTENANCE_ALWAYS`: kilitli kurulum güvenlik
  güncellemesini stage edebilir, fakat rotalar yine OWNER/ADMIN authentication
  ister. Bu ayrıcalık sipariş/veritabanı operasyonu açmaz.
- Lokal API'nin sonucu her zaman `STAGED_AWAITING_SUPERVISOR` ve
  `applySupportedByLocalApi:false` değeridir. Supervisor manifest imzasını ve
  artifact'leri tekrar doğrulamak, migration öncesi yedek almak, atomik replace,
  health check ve rollback yapmak zorundadır.

## Bilerek açık blocker

Windows supervisor'ın gerçek binary replacement, PostgreSQL migration,
health-check ve rollback state machine'i bu modülde yoktur. Bu zincir native
Windows host'ta tamamlanıp gerçek Windows VM'de test edilmeden ürün update'i
"uygulandı" sayılamaz. Handoff contract version `1` yalnız güvenli sınırı ve
beklenen yetenekleri tanımlar; sahte başarı üretmez.

Stage dizini fsync edildikten sonra high-water, ardından sabit handoff dosyası
yazılır. İki yazı arasındaki process/power kaybında sistem eski sürüme dönmez;
aynı sürümü otomatik yeniden kabul etmek yerine update koordinatörü bloke olur
ve operatör uzlaştırması ister. Bu bilinçli fail-closed crash ordering'dir.
`rename` ile mevcut state dosyasını atomik değiştirme davranışı ayrıca gerçek
Windows/NTFS ve antivirüs açık saha VM'inde kanıtlanmalıdır; bu test kapanmadan
native supervisor production-ready sayılamaz.
