# Local LAN connectivity

Bu modül yalnız `local` runtime'a bağlanır. Installer'ın doğruladığı
`LOCAL_LAN_HOSTNAME` ve sabit gateway portu `8787` üzerinden admin (`/`),
garson (`/garson`) ve API health (`/api/health`) adreslerini üretir.

- Yalnız aktif, non-internal RFC1918 IPv4, IPv4 link-local, IPv6 ULA ve IPv6
  link-local adresleri listelenir. Interface adı, MAC, netmask ve scope id API
  cevabına konmaz.
- URL'ler request `Host` header'ından üretilmez. QR host'u yalnız installer
  hostname'i veya o anda keşfedilmiş güvenli IP olabilir.
- QR resmi `qrcode@1.5.4` ile SVG üretilir: error correction `M`, margin `4`,
  width `320`, dark `#111827`, light `#FFFFFF`. Cevap `no-store`, CSP sandbox
  ve `nosniff` başlıkları taşır.
- `target=table-menu&slug=...&tableId=...` yalnız OWNER/ADMIN oturumuyla,
  tenant + masa DB bağı doğrulandıktan sonra `http://<LAN>:8787/menu/<slug>`
  URL'si üretir. URL'deki HMAC token kurulum başına DPAPI korumalı
  `TABLE_QR_SIGNING_SECRET` ile tenant slug + tableId'ye bağlıdır. Token süresiz
  seçilmiştir; secret rotasyonu güvenlik gereği basılmış tüm masa QR'larını
  geçersiz kılar ve yeniden basım gerektirir.
- Garson çağrısı browser'dan yalnız same-origin local `/api` yoluna gider,
  HMAC ve tenant+table DB bağı tekrar doğrulanır ve güvenilen gateway'in ezdiği
  `X-Forwarded-For` istemci IP'si üzerinden dakika başına 6 çağrı ile sınırlanır.
- `/api/local-connectivity/status` ve `/api/local-connectivity/qr.svg`
  OWNER/ADMIN authentication guard olmadan kurulamaz. Lisans recovery
  allowlist'inde yalnız bu kesin GET/HEAD yolları vardır; auth/RBAC yine
  zorunludur.
- Ağ adresi yoksa status `online:false` ve `LAN_ADDRESS_UNAVAILABLE` döndürür;
  rastgele/public bir adrese fallback yapmaz.

Bilinen ayrı işler: mDNS advertising ve Tauri/installer UI bu backend modülüne
dahil değildir ve status içinde açık blocker olarak gösterilir.
