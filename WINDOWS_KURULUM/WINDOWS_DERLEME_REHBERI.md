# Windows derleme ve kabul rehberi

## 1. Derleme bilgisayarını hazırlayın

Windows 11 x64 kullanın. Şunları kurun:

- Git;
- Node.js 22 LTS x64 ve Corepack;
- PowerShell 7 x64;
- Rust stable MSVC (en az Rust 1.82);
- Visual Studio 2022 Build Tools: “Desktop development with C++” ve Windows 11 SDK;
- WiX Toolset v4 CLI ve projede kullanılan WiX v4 uzantıları;
- Windows SDK `signtool.exe`;
- geçerli Code Signing sertifikası. Private key içeren sertifika Windows Certificate Store'da olmalı.

Node ve PostgreSQL runtime ZIP dosyalarını resmi üretici kaynağından indirin, üretici hash/imzasını doğrulayın. Private key veya `.env` dosyasını repo içine koymayın.

## 2. Adayı derleyin

PowerShell'i normal kullanıcı olarak açın, repo köküne gidin. Aşağıdaki örnekte yolları kendi dosyalarınıza göre değiştirin:

```powershell
Set-ExecutionPolicy -Scope Process RemoteSigned
& .\WINDOWS_KURULUM\02_WINDOWS_DERLEME\ADAYI-DERLE.ps1 `
  -Version '1.0.2' `
  -CertificateThumbprint 'SERTIFIKA_THUMBPRINT' `
  -NodeWindowsX64Zip 'C:\GuvenliGirdiler\node-v22-win-x64.zip' `
  -PostgreSqlWindowsX64Zip 'C:\GuvenliGirdiler\postgresql-win-x64-binaries.zip' `
  -LicensePublicKey 'C:\GuvenliGirdiler\license-public-key.pem' `
  -UpdatePublicKey 'C:\GuvenliGirdiler\update-public-key.pem'
```

Script kaynakları derler, API'nin tam npm/Prisma çalışma closure'ını çıkarır, Rust servis/bootstrap/launcher PE dosyalarını üretir, kendi PE dosyalarını imzalar, üçüncü taraf PE imzalarını denetler, payload'ı denetler ve MSI + imzalı Burn setup üretir. Güvenli onarım, sırları ayıklayan tanı ve kurulu bilgisayarın gerçek LAN adreslerini gösteren araçlar da setup ile aynı sertifikayla imzalanır. Bir adım başarısızsa müşteri dosyası üretmez.

Çıktı: `WINDOWS_KURULUM\04_ADAY_CIKTISI\<sürüm>\RESTOTM-Setup-<sürüm>-x64.exe`.

## 3. Temiz Windows kabulü

Yeni bir Windows 11 x64 sanal makine açın. Bu VM'de daha önce REST_OTM kurulu olmamalı.

1. Aday setup'ı VM'ye kopyalayın.
2. Sağ tıklayıp yönetici olarak kurun.
3. Kurulum bitince VM'yi yeniden başlatın.
4. Repo/kabul scriptleri VM'de erişilebilirken yönetici PowerShell açın.
5. Şunu çalıştırın:

```powershell
Set-ExecutionPolicy -Scope Process RemoteSigned
& .\WINDOWS_KURULUM\03_WINDOWS_KABUL\KONTROL-ET-VE-MUSTERIYE-KOPYALA.ps1 `
  -SetupPath '.\WINDOWS_KURULUM\04_ADAY_CIKTISI\1.0.2\RESTOTM-Setup-1.0.2-x64.exe' `
  -CleanWindowsVm `
  -RebootCompleted
```

Bu test servis, delayed auto-start, restricted service SID, 120 saniye preshutdown, restart politikası, DPAPI secret envelope, hash bağlı bootstrap receipt, dar firewall, yalnız-loopback iç servisler, PostgreSQL `pg_ctl` kapanışı, gateway ve web endpointlerini kontrol eder. Başarılı olursa aynı imzalı setup ile aynı yayımcı tarafından imzalanmış onarım/tanı/adres araçları `01_MUSTERIYE_VERILECEK` klasörüne kopyalanır.

## 4. Müşteriye verilecekler

Yalnız `WINDOWS_KURULUM\01_MUSTERIYE_VERILECEK` klasörünü verin. Bu klasörde setup, SHA-256, kabul raporu, müşteri rehberi, imzalı güvenli onarım aracı, redaksiyonlu tanı aracı ve yalnız kurulduğu bilgisayarın gerçek LAN adreslerini gösteren araç bulunur. Kaynak kod, `build`, sertifika, PFX, private key, `.env`, veritabanı veya ham log klasörünü vermeyin.

Müşteriye ayrıca SuperAdmin panelinden üretilen tek kullanımlık gösterilen `RSTO-XXXX-XXXX-XXXX` lisans anahtarını güvenli kanaldan iletin. Anahtar ikinci cihazda kullanılamaz.
