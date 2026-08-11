# REST_OTM Windows teslim akışı

Bu klasör güvenli teslim kapısıdır. Kaynak kod hazırlandı; gerçek Windows PE derlemesi, Authenticode imzası ve temiz Windows sanal makine kabulü Windows üzerinde yapılır.

Sıra değiştirilemez:

1. [00_GEREKEN_DOSYALAR](./00_GEREKEN_DOSYALAR/README.txt) içindeki resmi runtime dosyalarını ve iki public key'i hazırlayın.
2. Windows derleme makinesinde `02_WINDOWS_DERLEME\ADAYI-DERLE.ps1` çalıştırın.
3. `04_ADAY_CIKTISI` altındaki imzalı adayı temiz Windows 11 x64 sanal makineye kurun.
4. Sanal makineyi yeniden başlatın.
5. Aynı kaynak ağacında `03_WINDOWS_KABUL\KONTROL-ET-VE-MUSTERIYE-KOPYALA.ps1` çalıştırın.
6. Yalnız `01_MUSTERIYE_VERILECEK` klasörünün son halini müşteriye verin.

Scriptler hata alırsa onu atlamayın, `production_ready` veya imza denetimini elle gevşetmeyin. Müşteriye gidecek klasöre gerçek `.exe`, SHA-256 ve kabul raporu yalnız tüm kontroller geçince otomatik kopyalanır.

Kontrol API adresi varsayılan olarak `https://rest-otm-control-api.onrender.com` değerine sabitlenmiştir. Lisans private key'i ve update private key'i Windows paketine hiçbir zaman girmez.
