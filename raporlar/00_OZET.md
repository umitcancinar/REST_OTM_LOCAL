# REST_OTM · Rapor Klasörü

Bu klasör, projede yapılan işlerin, bulunan eksiklerin ve sıradaki işlerin
kaydıdır. Amaç: **projeyi hiç görmemiş bir geliştirici (veya yapay zekâ) bu
klasörü okuyup kaldığı yerden hatasız devam edebilsin.**

| Dosya | İçerik |
|---|---|
| `01_YAPILAN_ISLER.md` | 04.08.2026 tarihinde yapılan tüm değişiklikler, dosya dosya |
| `02_GUVENLIK_RAPORU.md` | Sistem genelinde bulunan güvenlik ve hata bulguları (öncelik sıralı) |
| `03_YAPILACAKLAR.md` | Sıradaki işler — her madde tek başına uygulanabilir şekilde yazıldı |
| `04_YAZICI_MIMARISI.md` | Yazdırma sisteminin nasıl çalıştığı (yeni mimari) |

## Altın kural

> Çalışan hiçbir şey silinmez. Değiştirilen dosyaların eski hâli `.bak`
> uzantısıyla yanında durur (`page.v1.tsx.bak`, `escpos.v1.ts.bak` gibi).

## Hızlı durum (04.08.2026)

- ✅ Önizleme ile fiziksel çıktı **tek motordan** üretiliyor → birebir aynı.
- ✅ Üst/alt kağıt boşluğu mm hassasiyetinde, önizlemeden sürüklenerek ayarlanıyor.
- ✅ Fişteki her öğe (fiyat, ürün adı, toplam, İPTAL, PAKET, ödenen ürünler…) tek tek ayarlanabiliyor.
- ✅ Tüm derlemeler ve 22 test geçiyor.
- ⚠️ Güvenlik bulguları için `02_GUVENLIK_RAPORU.md`.
