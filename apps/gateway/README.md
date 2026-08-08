# REST_OTM LAN Gateway

Bu servis müşteri bilgisayarında LAN'a açılan tek HTTP yüzeyidir. Mevcut admin
ve garson uygulamalarını yeniden yazmaz; sabit loopback portlarındaki mevcut
standalone çıktıları tek origin altında yayınlar:

| Yol | Sabit upstream |
| --- | --- |
| `/api/*`, `/socket.io/*` | Local API `127.0.0.1:4100` |
| `/garson/*` | Mevcut waiter Next standalone `127.0.0.1:3200` |
| Diğer yollar | Mevcut admin Next standalone `127.0.0.1:3100` |

Waiter build'i Next `basePath: '/garson'` kullanır; mevcut sayfa, navigasyon ve
özellikleri değişmez. Public QR menü control-plane/projection sınırında bulutta
kalır ve gateway'in upstream listesine alınmaz.

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

Production örnek değişkenleri `.env.example` içindedir. Windows supervisor bu
servisi pencere ve kullanıcı oturumundan bağımsız child process olarak yönetir.

## Doğrulama

```bash
pnpm --filter @rest-otm/gateway test
```

Test gerçek loopback HTTP ve WebSocket sunucuları açtığı için kısıtlı sandbox
ortamlarında ağ izni gerekebilir.
