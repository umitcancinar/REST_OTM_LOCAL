# REST_OTM LAN Gateway

Bu servis müşteri bilgisayarında LAN'a açılan tek HTTP yüzeyidir. Mevcut admin
ve garson uygulamalarını yeniden yazmaz; sabit loopback portlarındaki mevcut
standalone çıktıları tek origin altında yayınlar:

| Yol | Sabit upstream |
| --- | --- |
| `/api/*`, `/socket.io/*` | Local API `127.0.0.1:4100` |
| `/garson/*` | Mevcut waiter Next standalone `127.0.0.1:3200` |
| `/menu/*` | Mevcut QR menü Next standalone `127.0.0.1:3300` |
| Diğer yollar | Mevcut admin Next standalone `127.0.0.1:3100` |

Waiter build'i Next `basePath: '/garson'` kullanır. Menü cloud build'i boş
basePath ile mevcut `/<slug>` QR linklerini korur; Windows local artifact'i
`MENU_BASE_PATH=/menu` ile ayrı üretilir. Her iki uygulamanın mevcut sayfa,
navigasyon ve özellikleri değişmez. Menü child'ı veriyi yalnız HTTPS cloud
projection API'den okur; masa aksiyonu aynı origin `/api` üzerinden local API'ye
gider. Böylece tarayıcıda HTTPS-cloud -> HTTP-LAN mixed-content isteği oluşmaz.

## Güvenlik sınırı

- Upstream URL'leri yalnız kimlik bilgisiz loopback HTTP olabilir.
- İstemciden gelen `Forwarded`/`X-Forwarded-*` değerleri güvenilmez ve ezilir.
- Production'da açık `GATEWAY_ALLOWED_HOSTS` gerekir; wildcard kabul edilmez.
- RFC1918/link-local istemci Host değerleri değişen DHCP IP'si için ayrıca
  kabul edilebilir; Windows Firewall yine yalnız `Private + LocalSubnet` açar.
- Origin authority (host ve port birlikte) uyuşmayan istekler reddedilir.
- Yalnız Socket.IO yolu WebSocket upgrade alır.
- İç servis adresi veya istemci girdisiyle SSRF yapılabilecek dinamik proxy
  hedefi yoktur.
- Body limitinin birinci katmanı gateway'dir; API route limitleri ayrıca
  uygulanmaya devam eder.

## LAN discovery / mDNS

Production gateway varsayılan olarak `_rest-otm._tcp.local` DNS-SD servisini
ilan eder. İlan edilen TCP servis portu daima gateway'in tek uygulama LAN portu
`8787`'dir; API veya loopback child portları ilan edilmez ve LAN'a bind edilmez.

- Hostname installer'ın `GATEWAY_ALLOWED_HOSTS` listesindeki `.local` addresten
  türetilir veya açık `GATEWAY_MDNS_HOSTNAME` ile verilir. IP, public DNS adı,
  wildcard ve geçersiz label reddedilir; explicit hostname aynı zamanda Host
  header allowlist'inde olmak zorundadır.
- Yalnız RFC1918/link-local IPv4 ile ULA/link-local IPv6 kayıtları ilan edilir.
  Interface adı, MAC, tenant/restoran adı, lisans anahtarı/durumu, donanım veya
  cihaz kimliği TXT kayıtlarına girmez.
- TXT sözleşmesi yalnız sürüm/scope ve mevcut sabit UI yollarını taşır. Menü,
  admin ve garson UI/route davranışları değiştirilmez.
- Üç hostname probe'undan sonra ilan başlar. Aynı hostname veya servis instance
  başka bir hedefle görülürse discovery fail-closed kapanır; doğrudan
  `http://<LAN-IP>:8787` erişimi çalışmaya devam eder. UDP socket/bind/membership
  hatası da gateway HTTP sürecini sonlandırmaz ve yalnız sabit hata kodu loglar.
  Eşleşen query cevapları multicast flood/amplification riskini sınırlamak için
  saniyede en fazla bir announcement olarak throttle edilir.
- Kapanışta TTL=0 goodbye gönderilir, timer ve UDP socket'leri temizlenir.
- Lisans kilidi discovery'yi kapatmaz. Gateway adresi bulunabilir kalır;
  operasyon çağrılarını local API lisans gate'i `423` ile durdururken
  aktivasyon/recovery yolları erişilebilir kalır.

İlgili değişkenler:

```text
GATEWAY_MDNS_ENABLED=true|false       # production varsayılanı true
GATEWAY_MDNS_HOSTNAME=restotm-<id>.local
GATEWAY_MDNS_TTL_SECONDS=120          # 30..4500
```

mDNS standardı multicast discovery için UDP/5353 kullanır; bu bir REST_OTM
uygulama/upstream portu değildir. Uygulamanın LAN'a açtığı tek TCP port 8787
olarak kalır ve Private/LocalSubnet sınırı değişmez. Windows installer'ın
mevcut firewall kontratı yalnız TCP/8787'yi açtığından gerçek Windows 11 VM'de
UDP/5353 mDNS inbound davranışı ayrıca doğrulanmalı ve gerekiyorsa yalnız
Private/LocalSubnet multicast için dar bir kural eklenmelidir. Bu gateway-only
değişiklik installer firewall politikasını genişletmez.

Windows supervisor bu servisi pencere ve kullanıcı oturumundan bağımsız child
process olarak yönetir.

## Doğrulama

```bash
pnpm --filter @rest-otm/gateway test
```

Test gerçek loopback HTTP ve WebSocket sunucuları açtığı için kısıtlı sandbox
ortamlarında ağ izni gerekebilir. mDNS codec/lifecycle testleri fake UDP socket
ile çalışır; gerçek multicast kabul testi Windows 11 Private LAN VM'de yapılır.
