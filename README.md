# 🍽️ REST_OTM — Yerel-Öncelikli Restoran POS & ERP

Restoranın operasyonel verisini kendi bilgisayarında tutan; patron, kasa, mutfak ve garson cihazlarını aynı yerel ağda çalıştıran restoran otomasyon platformu. Bulut tarafı yalnızca lisans yönetimi, aktivasyon/yoklama ve ortak/public menü servislerini barındırır.

## 🏗️ Mimari

```
Garson / patron / QR menü cihazları
                 │
        Private LAN TCP 8787
                 │
          REST_OTM Gateway
                 │ sabit loopback upstream'ler
     ┌───────────┼───────────┬───────────┬────────────┐
 API + WS      Admin       Garson      QR Menü     Print Agent
 :4100         :3100       :3200        :3300       :4190
     │
 PostgreSQL :55432 (loopback-only)
```

Yerel ağa yalnızca uygulama geçidi açılır; PostgreSQL ve iç servisler loopback arayüzünde kalır. Garson cihazları kurulum ekranında gösterilen yerel IP/QR adresinden bağlanır. Saatlik lisans yoklaması başarısız olsa bile imzalı çevrimdış süre dolana kadar operasyon sürer.

## 🚀 Hızlı Başlangıç

### Ön Koşullar

- **Node.js** v22+
- **pnpm** v9 (`corepack enable`)
- **Docker Desktop** (yalnızca geliştirme PostgreSQL ortamı için)

### 1. Projeyi Klonla

```bash
git clone <repo-url>
cd REST_OTM_LOCAL
```

### 2. Ortam Değişkenlerini Ayarla

```bash
cp .env.example .env
# .env dosyasını düzenleyip gerçek değerleri gir
```

### 3. Geliştirme Veritabanını Başlat

```bash
docker compose -f docker/docker-compose.yml up -d
```

### 4. Bağımlılıkları Kur

```bash
pnpm install
```

### 5. Veritabanını Hazırla

```bash
pnpm db:generate
pnpm db:migrate -- --name init
pnpm db:seed
```

### 6. Geliştirme Sunucusunu Başlat

```bash
pnpm dev
```

Bu komut geliştirme profilinde tüm uygulamaları paralel olarak başlatır:
- **Admin Dashboard:** http://localhost:3000
- **Garson PWA:** http://localhost:3001
- **Backend API:** http://localhost:4000
- **API Health:** http://localhost:4000/api/health

> Bu depo henüz son kullanıcı kurulum paketi değildir. API cloud/local artifact
> ayrımı, lisans kapısı, PostgreSQL yedek runtime'ı, LAN gateway ve imzalı
> güncellemenin güvenli staging katmanı hazırdır; native apply/health/rollback,
> paketlenmiş PostgreSQL ve temiz Windows kabulü tamamlanmadan müşteriye
> kurulamaz. Güncel durum için
> `raporlar/06_NELER_YAPTIM_NELER_YAPACAGIM.md` dosyasına bakın.

Yeni lisans/control-plane Render kurulumu mevcut müşteri API'sinden ayrıdır.
Operasyon kartı için
[`raporlar/09_RENDER_KOPYALA_YAPISTIR.md`](raporlar/09_RENDER_KOPYALA_YAPISTIR.md)
dosyasını kullanın.

## 📁 Proje Yapısı

```
REST_OTM/
├── apps/
│   ├── api/            # Backend API + WebSocket (Express + Prisma)
│   ├── admin/          # Admin Dashboard (Next.js)
│   ├── waiter/         # LAN üzerinden Garson PWA (Next.js)
│   ├── menu/           # Mevcut public/local QR menü (Next.js)
│   ├── gateway/        # LAN'da tek açık HTTP/WebSocket geçidi
│   └── print-agent/    # Local Print Agent (Node.js)
├── packages/
│   ├── shared-types/   # Ortak TypeScript tipleri
│   ├── license/        # İmzalı lisans protokolü ve istemci
│   ├── ui-kit/         # Paylaşılan UI bileşenleri
│   └── eslint-config/  # Paylaşılan ESLint kuralları
├── docker/             # Yalnızca geliştirme bađımlılıkları
├── raporlar/            # Mimari, güvenlik ve ilerleme kayıtları
└── render.yaml         # Bulut profilinin dađıtım tanımı
```

## 🔒 Güvenlik

- ✅ Parolalar **bcrypt** ile hashlenmiş (salt: 12)
- ✅ JWT Access + Refresh token stratejisi
- ✅ Uygulama katmanında tenant kapsam kontrolü
- ✅ **Rate limiting** ile brute-force koruması
- ✅ **Helmet** ile HTTP güvenlik başlıkları
- ✅ **Zod** ile tüm girdiler doğrulanmış
- ✅ `.env` dosyası Git'ten hariç tutulmuş
- ✅ Ed25519 imzalı lisans ve çevrimdış süre sınırı

Windows servis izolasyonu ve DPAPI kaynak kontratı mevcuttur; Authenticode,
TPM/CNG cihaz anahtarı, native update apply/rollback ve gerçek Windows 11 kabulü
tamamlanmadığı için ürün henüz üretime hazır kabul edilmez. Ayrıntılı tehdit
modeli ve çıkış kapısı için [SECURITY.md](SECURITY.md) dosyasına bakın.

## 🛠️ Kullanışlı Komutlar

```bash
# Tüm uygulamaları geliştirme modunda başlat
pnpm dev

# Sadece API'yi başlat
pnpm --filter api dev

# Veritabanı yönetimi
pnpm db:generate     # Prisma client oluştur
pnpm db:migrate      # Migration çalıştır
pnpm db:seed         # Demo veri yükle
pnpm db:studio       # Prisma Studio (DB arayüzü)

# Kod kalitesi
pnpm lint            # Lint kontrolü
pnpm typecheck       # TypeScript tip kontrolü
pnpm format          # Prettier ile formatlama

# Docker
docker compose -f docker/docker-compose.yml up -d    # DB başlat
docker compose -f docker/docker-compose.yml down      # DB durdur
```

## 📄 Lisans

Bu proje özel lisans altındadır. Tüm hakları saklıdır.
