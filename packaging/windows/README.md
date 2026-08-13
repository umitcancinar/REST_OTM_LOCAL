# RESTOTM Windows 11 runtime ve installer temeli

Bu klasor, musteri bilgisayarinda calisacak RESTOTM yerel runtime'i icin guvenli kurulum sozlesmesini tanimlar. Hedef tek tikla calisan, Authenticode imzali bir WiX v4/Burn kurulumudur. Bu commit gercek runtime binary'si, PostgreSQL dagitimi ve kod imzalama sertifikasi icermedigi icin **musteriye verilecek installer uretmez**. Eksik veya dogrulanmamis artifact ile devam etmek yerine build fail-fast olur.

## Mimari sozlesme

| Katman | Adres / konum | Dis erisim |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:55432` | Yok |
| Local API | `127.0.0.1:4100` | Yok |
| Admin UI | `127.0.0.1:3100` | Yok |
| Garson UI | `127.0.0.1:3200` | Yok |
| QR Menü UI | `127.0.0.1:3300` | Yok |
| Print agent | `127.0.0.1:4300` | Yok |
| LAN gateway | `0.0.0.0:8787` | Yalniz Windows `Private` profil + `LocalSubnet` |
| Program binary'leri | `%ProgramFiles%\RESTOTM` | Yalniz SYSTEM + Administrators + restricted service SID |
| Canli veri | `%ProgramData%\RESTOTM\data` | SYSTEM + Administrators |
| Config ve DPAPI secret'lari | `%ProgramData%\RESTOTM\config` | SYSTEM + Administrators |
| Loglar | `%ProgramData%\RESTOTM\logs` | SYSTEM + Administrators |
| Yerel yedek | `%ProgramData%\RESTOTM\backups` | Canli veriden ayri klasor |
| Harici yedek | Kurulum sonrasi ayarlanan ikinci disk/NAS hedefi | Uretim kabulunde zorunlu |

Telefon ve tabletler PostgreSQL'e veya ic Node/Next portlarina baglanmaz. Ayni agdaki garson cihazlari yalniz `http://SUNUCU-IP:8787` gateway'ine gider. WiX yalniz bu executable/port icin tek inbound kural acar; Public ve Domain profilleri acilmaz.

Yerel veri icin PostgreSQL secimi bilincli: ayni anda kasa, garson, mutfak/print ve arka plan gorevleri yazma yapabilir; mevcut Prisma semasi PostgreSQL enum, JSON ve dizi tiplerinden yararlanir. SQLite veri miktarini tasir ama bu eszamanlilik ve sema uyumlulugu risklerini tek basina cozmez.

## Kurulum davranisi

1. Burn, imzali MSI'yi per-machine kurar.
2. Binary'ler salt-okunur Program Files altina yazilir.
3. MSI, imzali `restotm-installer-bootstrap.exe` yardimcisini deferred/LocalSystem olarak calistirir.
4. Yardimci izinli yollar disina cikmadan klasorleri ve ACL'leri kurar; her kurulum icin kriptografik secret'lar uretir ve makine kapsamli DPAPI ile korur.
5. `RESTOTMRuntime` servisi `Automatic (Delayed Start)` olarak acilir. Ilk uc arizada 15/30/60 saniyede yeniden baslatilir; restricted service SID ve 120 saniye preshutdown suresi zorunludur.
6. Runtime PostgreSQL, API, admin, garson, print, lisans yoklama, backup ve tek LAN gateway'i supervise eder. Bagimli servis bir port acmadan siradaki servis baslamaz; calisir gorunen ama portu 30 saniye boyunca cevap vermeyen child otomatik yeniden baslatilir.
7. PostgreSQL Windows kapanisinda `pg_ctl stop -m fast -w` ile guvenli kapatilir; yalniz bu basarisiz olursa process-tree sonlandirma uygulanir.
8. Host loglari en fazla 31 dosya/256 MiB tutulur; `health.json` Windows'ta write-through atomik replace ile yazilir.

PowerShell betikleri ayni politikayi kurulum oncesi kontrol, operasyonel repair ve Windows CI dogrulamasi icin ifade eder. Musteri kurulumu `ExecutionPolicy Bypass`, internetten script indirme veya kaynak kod calistirma kullanmaz. Uretim yolunda native ve imzali bootstrap yardimcisi zorunludur.

Teslim klasorunde setup ile ayni sertifikayla Authenticode imzalanmis uc destek araci bulunur. `Repair-RestOtmHost.ps1` veri/secret silmeden receipt, native bootstrap, ACL, servis recovery, dar firewall ve canli child sagligini dogrular/onarir. `Get-RestOtmDiagnosticBundle.ps1` yalniz sinirli servis/port/firewall/hash/log bilgisini toplar; lisans, e-posta, bearer, parola, token ve DB URL degerlerini ZIP olusmadan once redakte eder. `Get-RestOtmAccessAddresses.ps1` paket hazirlanan test VM'sinin adresini tasimaz; yalniz calistirildigi kurulu musteri bilgisayarinin config hostname'ini ve private IPv4 adreslerini masaustune yazar.

## Secret ve lisans siniri

- Kaynakta sabit DB parolasi, JWT/session secret'i, print secret'i veya lisans private key'i yoktur.
- Ilk provisioning'de CSPRNG ile uretilen secret'lar `secrets.json` icinde `DPAPI LocalMachine` ile sifrelenir; klasor ACL'i yalniz SYSTEM ve Administrators'a aciktir.
- Idempotent tekrar kurulum secret'lari degistirmez. `-RotateSecrets`, DB rolu ve calisan child surecleriyle atomik rotasyon backend'i tamamlanana kadar fail-closed reddedilir.
- Render'daki lisans imzalama private key'i musteri artifact'ine **asla** girmez. Yerelde yalniz public key ve imzali lease bulunur.
- DPAPI tek basina yonetici seviyesinde saldirgana karsi mutlak koruma degildir. Nihai hardening'de cihaz anahtari TPM/CNG ile uretilmeli, DPAPI fallback olarak kalmalidir.

## Yedekleme sozlesmesi

Varsayilan yerel yedek canli PostgreSQL klasorunun disindadir. Uretim kabulunde ayrica ikinci fiziksel disk veya NAS hedefi tanimlanir. Runtime tarafinin tamamlamasi gerekenler:

- gunluk `pg_dump` custom format ve transaction-consistent backup;
- AES-256-GCM sifreleme, SHA-256 manifest ve yazma sonrasi restore dogrulamasi;
- 30 gun yerel, 90 gun harici retention;
- basarisiz yedekte UI/Windows event alarmi;
- ayda bir otomatik veya kontrollu restore drill;
- 3-2-1 hedefi icin tesis disi sifreli kopya.

Uninstall yalniz uygulama binary'sini ve Windows servisini kaldirir. `ProgramDataMarkerComponent` `Permanent="yes" NeverOverwrite="yes"` oldugu ve herhangi bir `RemoveFolder`/`RemoveFile` authoring'i bulunmadigi icin musteri verisi, config, log ve yedekler varsayilan olarak korunur. Veri silme gelecekte ayri, acik hedef gosteren ve iki asamali onay isteyen bir arac olmali; uninstaller secenegi olmamali.

## Artifact sozlesmesi ve fail-fast build

Release pipeline, staging kokune gercek `artifact-manifest.json` ve `installer-contract.json` koyar. `.example.json` dosyalari yalniz sema gostergesidir ve gecerli hash icermedigi icin build'de kabul edilmez.

Canonical payload `scripts/release/assemble-windows-payload.mjs` ile yeni ve bos
bir dizine fail-closed assemble edilir. Stager audited local API closure, iki
Next standalone, gateway/print runtime ve receipt/license closure'larini alir;
native/PostgreSQL/launcher/public-key girdileri, tum PE Authenticode imzalari
ve production-ready bootstrap contract'i tamamlanmadan production manifesti
uretmez. `--fixture` ciktisi manifestte acikca isaretlidir ve installer girdisi
degildir.

Manifest her dosyanin relative path, SHA-256, rol ve PE dosyalari icin Authenticode gereksinimini tasir. Su roller zorunludur:

- `runtime-service`, `installer-bootstrap`;
- `postgres-server`, `postgres-client`;
- `local-api`, `admin-ui`, `waiter-ui`, `menu-ui`, `print-agent`, `lan-gateway`;
- `license-public-key` (yalniz Ed25519 public key; private key kesinlikle degil).

`installer-contract.json`, Rust host ile ayni `restotm-windows-host-v1` snake_case semasini; exact child sirasi/dependency'leri, sabit portlari, `values` map'li DPAPI secret store'u ve hash/ACL policy bagli bootstrap receipt'i taahhut eder. Build, contract icinde `native_bootstrap.production_ready=true` ister ve helper'i `verify-production-contract --contract ...` capability probe'u ile calistirir. Native kaynak backend strict Program Files/ProgramData siniri, reparse reddi, DPAPI LocalMachine, restricted service SID DACL'i ve atomik receipt-last rollback akisini uygular. Ancak ornek contract Windows derleme/VM kabulu yapilmadigi icin bilerek `production_ready=false` kalir ve installer uretilemez. Build ayrica `.pdb`, source-map, TypeScript kaynaklari ve `.env*` dosyalarini reddeder.

Windows build makinesinde:

```powershell
pwsh -File .\packaging\windows\scripts\Test-RestOtmPowerShellSyntax.ps1
pwsh -File .\packaging\windows\scripts\Build-RestOtmInstaller.ps1 `
  -PayloadRoot C:\release\restotm-local-x64 `
  -LicenseServerUrl https://YOUR-RENDER-CONTROL-PLANE.example `
  -CertificateThumbprint YOUR_CODE_SIGNING_CERT_THUMBPRINT
```

Build icin WiX Toolset `4.x`, `WixToolset.Util.wixext`, `WixToolset.Firewall.wixext`, `WixToolset.BootstrapperApplications.wixext`, Windows SDK `signtool.exe`, zaman damgasi erisimi ve private key iceren gecerli Code Signing EKU sertifikasi gerekir. MSI once imzalanir, sonra Burn bundle'a eklenir; bundle da ayri imzalanir ve iki imza build sonunda dogrulanir.

WiX v4/Burn secildi; Inno Setup pilotu eklenmedi. Windows Service, transactional upgrade/rollback, kalici ProgramData, makine kapsamli ACL ve firewall sahipligi tek bir kalici installer teknolojisinde tutuldu. Iki farkli installer davranisinin sahada ayrismasi engellendi.

## Kabul ve test matrisi

| Kontrol | Otomasyon | Gercek Windows 11 VM kabul kriteri |
| --- | --- | --- |
| PowerShell syntax | `Test-RestOtmPowerShellSyntax.ps1` | Parse hatasi yok |
| PowerShell contract drift | `Test-RestOtmCanonicalContract.ps1` | Installer ve Rust host schema/network/child grafigi ayni |
| Guvenli statik politika | `node --test packaging/windows/tests/windows-packaging.static.test.mjs` | Bypass/remote-code primitive yok |
| Canonical schema drift | `node --test packaging/windows/tests/canonical-contract.static.test.mjs` | Installer/Rust host topology, secret adlari ve release kapisi ayni |
| Artifact butunlugu | `Assert-RestOtmArtifactManifest` | Tum hash'ler ve PE imzalari gecerli |
| Temiz kurulum | Burn UI + MSI log | Tek tik, reboot gerektirmeden servis Running |
| Upgrade | Eski surum ustune yeni bundle | Veri korunur, downgrade reddedilir |
| Repair | Apps & Features Repair | Secret/installationId degismez |
| Uninstall | Apps & Features Uninstall | Servis/firewall gider; ProgramData ve yedek kalir |
| Servis kurtarma | Servisi kontrollu 3 kez crash et | 15/30/60 saniye politikasina gore geri gelir |
| LAN erisimi | Private Wi-Fi telefon/tablet | `SUNUCU-IP:8787` acilir |
| Public profil izolasyonu | Ag profilini Public yap | Gateway erisimi kapanir |
| Ic port izolasyonu | Baska LAN cihazindan port scan | 55432/4100/3100/3200/3300/4300 kapali |
| PostgreSQL bind | `Test-RestOtmInstallation.ps1` | Yalniz 127.0.0.1/::1:55432 |
| Secret korumasi | ACL + config testi | Plaintext secret yok; DPAPI envelope var |
| Lisans | Activate/heartbeat/revoke/clock rollback | Tek cihaz, signed lease, revoke fail-closed |
| Yedek | Backup + bozuk dosya + restore drill | Hash/AEAD/restore testi ve UI alarmi |
| Elektrik kesintisi | VM hard power-off | PostgreSQL recovery sonrasi acik hesaplar tutarli |

## Son fiziksel Windows kabul kapisi

Kaynak, paketleme, self-heal, imzali update ve sifreli yerel/harici/bulut yedek contract'i hazirdir. Yine de musteri setup'i yalniz gercek Windows x64 makinede Rust MSVC + resmi Node/PostgreSQL artifact'leriyle derlenip Authenticode imzalandiktan ve temiz Windows 11 VM kabul scripti (kurulum, reboot, servis, port, firewall, DPAPI, repair ve endpoint testleri) gectikten sonra teslim edilir. Bu kosullar yoksa build/kabul scriptleri fail-closed durur ve `01_MUSTERIYE_VERILECEK` klasorune setup kopyalamaz.

## Kaynaklar

- [WiX v4 ServiceInstall](https://docs.firegiant.com/wix/schema/wxs/serviceinstall/)
- [WiX util ServiceConfig failure actions](https://docs.firegiant.com/wix/schema/util/serviceconfig/)
- [WiX FirewallException](https://docs.firegiant.com/wix/schema/firewall/firewallexception/)
- [WiX Burn ve WixStdBA](https://docs.firegiant.com/wix/tools/burn/wixstdba/)
- [Microsoft delayed auto-start service davranisi](https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_delayed_auto_start_info)
- [Microsoft Windows Firewall LocalSubnet ornegi](https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/netsh-advfirewall-firewall-control-firewall-behavior)
