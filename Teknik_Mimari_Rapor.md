# REST_OTM: Teknik Mimari ve Sistem Raporu

**Proje Özeti:** REST_OTM, restoranlar için geliştirilmiş, uçtan uca otomasyon sağlayan, çok kiracılı (Multi-Tenant) bir SaaS platformudur. Sistem; sipariş yönetimi, masa takibi, mutfak operasyonları, stok yönetimi ve fiziksel donanım entegrasyonlarını (Yazıcı/POS) tek bir ekosistemde birleştirir.

---

## 1. Teknoloji Yığını (Tech Stack)

Sistem modern, ölçeklenebilir ve tip güvenliği (Type-Safety) ön planda tutularak inşa edilmiştir.

### Backend (Core API)
- **Node.js & Express:** Hızlı ve asenkron I/O işlemleri için tercih edilmiştir.
- **TypeScript:** Kod kalitesini artırmak ve runtime hatalarını minimize etmek için tüm projede zorunludur.
- **Prisma ORM:** PostgreSQL ile tip güvenli veritabanı iletişimi.
- **Socket.io:** Bulut sunucu ile yerel donanımlar arasındaki çift yönlü, gerçek zamanlı iletişim.

### Frontend (Uygulamalar)
- **Next.js (App Router):** Admin ve Garson panelleri için SEO uyumlu, hızlı ve modern SSR/CSR yapısı.
- **Vite & React:** Mutfak paneli gibi aşırı hızlı tepki vermesi gereken SPA (Single Page Application) ekranları.
- **CSS Modules:** Skoplanmış, temiz ve sürdürülebilir stil yönetimi.
- **Lucide Icons:** Modern ve tutarlı ikon seti.

### Veritabanı ve Altyapı
- **PostgreSQL (Neon DB):** İlişkisel veri yönetimi ve Row-Level Security (RLS) hazırlığı.
- **Redis:** (Opsiyonel/Hazır) Cache ve session yönetimi.
- **Railway:** API ve veritabanı orkestrasyonu (Cloud Deployment).
- **Vercel:** Frontend uygulamalarının global dağıtımı.

---

## 2. Mimari Tasarım Kararları

### Multi-Tenancy (Çok Kiracılılık)
Sistem, **"Shared Database, Discriminator Column"** mimarisini kullanır. Her tablo bir `tenantId` içerir ve tüm query'ler bu ID üzerinden filtrelenerek veri izolasyonu sağlanır. Bu, maliyet etkinliği ve merkezi yönetim kolaylığı sağlar.

### Cloud-to-Local Bridge (Yazıcı & Donanım Köprüsü)
Restoran otomasyonlarının en büyük sorunu olan "Buluttan yerel yazıcıya erişim" problemi, özgün bir **Print Agent** mimarisiyle çözülmüştür:
1. **Print Agent:** Restoranın yerel bilgisayarında çalışan hafif bir Node.js servisidir.
2. **WebSocket Tunneling:** Agent, buluttaki API'ye bir Socket.io kanalıyla bağlı kalır.
3. **Esc/Pos Driver:** Gelen JSON verilerini yerinde binary ESC/POS komutlarına dönüştürerek termal yazıcılara iletir.

---

## 3. İleri Seviye Entegrasyonlar

### POS Terminal Entegrasyonu (GMP3 Protokolü)
Sıradan ödeme sistemlerinin aksine, sistem fiziksel POS cihazlarıyla **TCP/IP** üzerinden doğrudan konuşur:
- **Binary Data Handling:** Buffer seviyesinde GMP3 paketleri (STX, ETX, LRC hesaplamaları) oluşturulur.
- **One-Click Payment:** Garson masayı kapattığında, POS cihazı otomatik olarak uyanır ve tutarı ekrana yansıtır.

### e-Dönüşüm & e-Arşiv Fatura (Uyumsoft)
Türkiye mevzuatına uygun mali mühür ve fatura süreçleri sisteme entegre edilmiştir:
- **Otomatik Fatura Kesimi:** Ödeme kapandığında Uyumsoft API üzerinden ETTN (Evrensel Tekil Tanımlama Numarası) alınır.
- **Karekodlu Bilgi Fişi:** Alınan fatura bilgileri, Print Agent aracılığıyla yazıcıdan "Doğrulanabilir QR Kod" içeren resmi bir bilgi fişi olarak dökülür.

---

## 4. Güvenlik ve Performans
- **JWT Authentication:** Access ve Refresh token mekanizmasıyla güvenli oturum yönetimi.
- **Argon2/Bcrypt:** Şifrelerin yüksek güvenlikli hashing yöntemleriyle saklanması.
- **Optimistic UI:** Garson panelinde siparişlerin anında yansıması için asenkron state güncellemeleri.
- **Database Indexing:** `tenantId` ve `createdAt` gibi sık kullanılan alanlar üzerinde indeksleme ile yüksek performanslı raporlama.

---

**Sonuç:** REST_OTM, sadece bir web yazılımı değil; bulutun esnekliği ile yerel donanımın gücünü birleştiren, düşük gecikmeli ve yüksek güvenirlikli bir endüstriyel otomasyon çözümüdür.
