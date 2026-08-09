# Cloud signed update publisher

Bu modul yalniz `cloud` API closure'undadir. Restoran siparisi, menu veya musteri
operasyon verisi tutmaz. Windows paketlerinin byte'larini da host etmez; yalniz
allowlist'li HTTPS artifact URL, SHA-256 ve boyut metadata'sini saklar.

## Yayin zinciri

1. `SUPER_ADMIN`, `POST /api/update-admin` ile tek kullanimlik bir DRAFT olusturur.
   Artifact metadata olusturuldugu andan itibaren degistirilemez; hata varsa yeni
   version/release acilir.
2. `POST /api/update-admin/:id/publish`, DB advisory lock altinda local updater'in
   schema v1 manifestini canonical JSON'a cevirir ve ayri Ed25519 update anahtariyla
   bir kez imzalar. Exact payload, imza ve SHA-256 birlikte kalici olur.
3. Lokal coordinator `GET /api/updates/v1/manifest` isteginde
   `X-Rest-Otm-Current-Version` ve `X-Rest-Otm-Update-Channel` gonderir. Endpoint
   yalniz PUBLISHED, suresi gecmemis ve mevcut surum araligiyla uyumlu en yeni
   envelope'u verir. Uygun release yoksa gövdesiz `204 No Content` döner; local
   coordinator bunu `NO_UPDATE_AVAILABLE / IDLE` olarak işler ve state yazmaz.
4. `POST /api/update-admin/:id/revoke` feed'den kaldirir. Imzali envelope degismez;
   daha once indirilmis/stage edilmis paket icin native supervisor yeniden manifest,
   artifact hash ve recovery politikasini denetlemek zorundadir.

Admin mutation'lari gecerliligi DB'den tekrar okunan `SUPER_ADMIN` kimligi, rate
limit ve append-only audit kaydi ister. PostgreSQL trigger'lari release kimligini,
artifact metadata'sini, imzali envelope'u ve audit loglarini servis kodundan
bagimsiz korur.

## Cloud secrets

- `UPDATE_SIGNING_PRIVATE_KEY`: Ed25519 PKCS#8 PEM; yalniz Render/cloud secret.
- `UPDATE_SIGNING_PUBLIC_KEY`: ayni keypair'in Ed25519 SPKI PEM public parcasi.
- `UPDATE_ARTIFACT_ALLOWED_ORIGINS`: virgulle ayrilmis canonical HTTPS origin.

Update ve lisans anahtarlari ayni trust root olamaz. Lokal pakete yalniz
`LOCAL_UPDATE_PUBLIC_KEY` girer; private update key ve bu publisher modulu local
release artifact audit'inde yasaktir.
