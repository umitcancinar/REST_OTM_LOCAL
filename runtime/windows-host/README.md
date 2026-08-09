# RESTOTM native Windows runtime host

Bu crate, musteri Windows 11 bilgisayarinda RESTOTM'nin yerel PostgreSQL, API, admin, garson, print ve LAN gateway sureclerini tek bir Windows servisi altinda yonetmek icin native Rust temelidir.

Iki binary hedefi vardir:

- `restotm-runtime-service.exe`: `RESTOTMRuntime` Windows service/console host;
- `restotm-installer-bootstrap.exe`: installer provisioning sozlesmesinin native giris noktasi.

## Guvenlik ve calisma modeli

Host baslamadan once uc dosyayi birlikte dogrular:

1. `runtime.json`, `deny_unknown_fields` semasi ve tum path/network/child kurallari;
2. `secrets.json`, yalniz `dpapi-local-machine-v1` envelope'lari;
3. `bootstrap-receipt.json`, installation ID, config SHA-256, secret-store SHA-256 ve `restotm-windows-acl-v1` politikasini birbirine baglar.

Dosya eksikligi, hash farki, bilinmeyen config alani, LAN'a acik ic port, duplicate port, traversal path, dependency cycle, secret'in komut satirinda/static env'de bulunmasi veya DPAPI acma hatasi host'u fail-closed durdurur.

Render lisans private key'i veya musteri lisans anahtari bu crate'e gomulmez. Child secret'lari config'de deger olarak bulunmaz; yalniz `secret_environment` icindeki isim referanslari kullanilir. Supervisor DPAPI ile cozulmus degeri child environment'ina verir ve arguman/loglara yazmaz. Lisans Ed25519 public key'i gibi public ama dosyada tutulmasi gereken degerler `file_environment` ile salt-okunur Program Files altindan en fazla 64 KiB olarak okunur; private-key isareti bulunan dosya reddedilir.

## Network kontrati

| Servis | Zorunlu bind |
| --- | --- |
| PostgreSQL | loopback, varsayilan `127.0.0.1:55432` |
| Local API | loopback `127.0.0.1:4100` |
| Admin | loopback `127.0.0.1:3100` |
| Garson | loopback `127.0.0.1:3200` |
| QR Menü | loopback `127.0.0.1:3300` |
| Print agent | loopback `127.0.0.1:4300` |
| Tek LAN gateway | `0.0.0.0:8787`, firewall kontrati `Private/LocalSubnet` |

Host firewall kurali acmaz; bu installer'in sahipligindedir. Host config validator, installer kontratindan daha genis bir gateway tanimini kabul etmez. Child'lar `env_clear()` ile baslar; yalniz Windows icin gerekli `SystemRoot/WINDIR/TEMP/TMP`, onayli static env ve DPAPI secret env aktarilir.

## Windows service ve supervision

- `windows-service 0.8.1` ile SCM dispatcher ve Stop/Shutdown/Preshutdown olaylari;
- StartPending, Running, StopPending ve Stopped durum bildirimi;
- dependency graph uzerinden deterministik ilk baslatma sirasi;
- her child icin `KILL_ON_JOB_CLOSE` Windows Job Object;
- beklenmeyen cikista sinirli exponential backoff;
- kayan zaman penceresinde crash-loop tespiti ve quarantine;
- essential child crash-loop'unda tum host'un hata ile kapanmasi; SCM recovery servisi yeniden baslatir;
- loopback, bearer-token'li internal HTTP graceful shutdown; sure sonunda process tree force-stop;
- gunluk NDJSON structured host logu ve atomic'e yakin structured `health.json` durumu.

Host loglari executable argumanlarini, environment degerlerini veya secret payload'larini kaydetmez. Health error metinleri kontrol karakterlerinden arindirilir ve 512 karakterle sinirlanir.

## Komutlar

Platform bagimsiz cekirdek kontrolu:

```bash
cd runtime/windows-host
cargo fmt --check
cargo check --all-targets
cargo test --all-targets
```

Windows MSVC hedefi ve release:

```powershell
rustup target add x86_64-pc-windows-msvc
cargo check --target x86_64-pc-windows-msvc --all-targets
cargo test --target x86_64-pc-windows-msvc --all-targets
cargo build --release --target x86_64-pc-windows-msvc
```

Console modu yalniz tanilama/VM testi icindir:

```powershell
.\restotm-runtime-service.exe console --config C:\ProgramData\RESTOTM\config\runtime.json
```

Uretimde SCM, ayni binary'yi su sekilde baslatir:

```text
restotm-runtime-service.exe service --config C:\ProgramData\RESTOTM\config\runtime.json
```

[config.example.json](./config.example.json) semayi gosterir; gercek release dosyasi degildir.

## Packaging kontratiyla entegrasyon notu

`packaging/windows` artik ayni `restotm-windows-host-v1` snake_case semasini uretir: exact top-level alanlar, yedi child'in sirali dependency grafigi, `environment/file_environment/secret_environment`, sabit portlar, `values` map'li DPAPI store ve config/secret SHA-256 + ACL policy bagli `bootstrap-receipt.json` birebir eslestirildi. Node statik contract testi iki ornek topology arasindaki drift'i yakalar.

Bu uyum sema seviyesindedir; PowerShell provisioner operasyonel/reference aracidir. Uretim WiX yolu yalniz native helper `production_ready` contract'ini ve `verify-production-contract` capability probe'unu gercekten sagladiginda acilir. Gevsek parser veya ikinci bir config semasi kabul edilmez.

## Bootstrap helper durumu

Helper su installer argumanlarini katı bicimde parse eder:

```text
provision
  --install-root <path>
  --program-data-root <path>
  --license-server-url <https-url>
  --postgres-port 55432
  --api-port 4100
  --admin-port 3100
  --waiter-port 3200
  --menu-port 3300
  --print-port 4300
  --gateway-port 8787
```

Bilinmeyen/duplicate flag, traversal, credential/query iceren URL, duplicate/privileged port veya sabit port kontrati ihlali reddedilir.

Windows build'i native provisioning backend'ine sahiptir: hedefleri tam olarak
64-bit `Program Files\RESTOTM` ve `ProgramData\RESTOTM` ile sinirlar; tum
mevcut path bilesenlerinde junction/reparse point reddeder; signed payload
rollerini arar; secret'lari `BCryptGenRandom` ile uretip
`CryptProtectData(LocalMachine)` ile zarflar. Program Files ve ProgramData
agaclarinin DACL'i yalniz LocalSystem, Administrators ve
`NT SERVICE\RESTOTMRuntime` restricted service SID'ine verilir ve tekrar
okunarak dogrulanir. Secret store ve runtime config
`fsync + MOVEFILE_WRITE_THROUGH` ile yeni dosya olarak atomik yayinlanir;
receipt en son yazilir ve iki dosyanin SHA-256'sini installation ID/ACL policy
ile baglar. Kismi hata yeni dosya ve bos klasorleri rollback eder; mevcut
secret'i otomatik rotate etmez, kismi bootstrap'i veya bagimsiz eski veriyi
fail-closed reddeder.

`verify-production-contract --contract <absolute-path>` strict installer
contract'ini native binary icinde de dogrular. Windows disindaki build
provisioning ve capability probe icin exit 78 donmeye devam eder. Ornek
contract bilerek `production_ready=false` kalir: bu kaynak bu Mac'te Rust ve
Windows arac zinciri bulunmadigi icin henuz derlenmedi ve clean Windows 11 VM
kabul testinden gecmedi.

## Test kapsami

Rust unit testleri su cekirdegi kapsar:

- loopback-only network ve dar gateway validator;
- secret arguman/static env reddi;
- dependency-cycle reddi ve topological order;
- exponential backoff, cap, stable reset ve crash-loop quarantine;
- bootstrap CLI'nin exact/unknown/duplicate flag davranisi;
- Windows disi unavailable backend'in false success vermemesi;
- native source-policy'de DPAPI LocalMachine, restricted service SID DACL,
  reparse reddi, write-through atomik yayin ve installer ordering kontrati;
- structured health dosyasi ve hata sanitization.

Gercek kabul testleri Windows 11 clean VM'de ayrica kosulmalidir: SCM lifecycle, Preshutdown, Job Object process-tree kill, DPAPI LocalMachine, restrictive DACL, 15/30/60 service recovery, hard power-off, PostgreSQL crash recovery ve Authenticode.

## Acik uretim blocker'lari

- Native provisioning kaynak backend'i tamamlandi; ancak Windows MSVC
  derlemesi, imzali artifact ve clean Windows 11 VM'de DPAPI/DACL/rollback
  kabul testi yok.
- Job Object atamasi `std::process` spawn'undan hemen sonra yapiliyor. Tam process-escape engeli icin suspended `CreateProcessW` + `PROC_THREAD_ATTRIBUTE_JOB_LIST` backend'i gerekli.
- PostgreSQL icin `pg_ctl stop` tabanli ozel graceful shutdown adapter'i eklenmeli; ornek su an timeout sonrasi job termination kullanir.
- Child readiness probe/dependency health gate'i yok; ilk spawn dependency'nin hazir oldugunu kanitlamiyor.
- Windows Event Log sink, log retention/ACL dogrulamasi ve disk-dolu davranisi tamamlanmadi.
- Kod imzalama sertifikasi, release artifact'leri ve Authenticode build pipeline'i yok.
- PostgreSQL/API/admin/waiter/menu/print/gateway gercek Windows artifact seti yok; LAN gateway executable'i henuz uretilmedi.
- Local API'nin `/internal/runtime/shutdown` token endpoint'i ve print-agent installation/tenant provisioning contract'i tamamlanmadi.
- `Cargo.lock`, Rust toolchain pin'i ve Windows CI dependency audit'i henuz uretilmedi.
- Bu macOS ortaminda Rust toolchain bulunmadigi icin `cargo check/test` calistirilamadi.

Bu maddeler kapanmadan crate "musteriye hazir native runtime" sayilamaz ve release manifestindeki zorunlu binary rolleri gercek artifact olarak isaretlenmemelidir.

## Teknik kaynaklar

- [windows-service 0.8.1 service implementation](https://docs.rs/windows-service/latest/windows_service/)
- [windows-service control handler](https://docs.rs/windows-service/latest/windows_service/service_control_handler/)
- [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Microsoft CryptProtectData](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)
- [tracing-subscriber JSON logs](https://docs.rs/tracing-subscriber/latest/tracing_subscriber/fmt/format/struct.Json.html)
