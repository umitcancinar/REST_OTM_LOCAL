# 🍽️ REST_OTM — Multi-Tenant Restaurant SaaS Platform

Modern, bulut tabanlı, çok kiracılı (Multi-Tenant) Restoran POS & ERP platformu.

## 🏗️ Mimari

```
┌──────────────────────────────────────────────────────────┐
│                     REST_OTM Monorepo                    │
├──────────────┬──────────────┬────────────┬───────────────┤
│   Admin      │  Garson PWA  │  Backend   │  Print Agent  │
│   Dashboard  │  (Offline)   │  API + WS  │  (Local)      │
│   Next.js    │  Next.js PWA │  Express   │  Node.js      │
│   :3000      │  :3001       │  :4000     │  WebSocket    │
└──────────────┴──────────────┴─────┬──────┴───────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                PostgreSQL      Redis          Socket.io
                  (RLS)        (Cache)        (Realtime)
```

## 🚀 Hızlı Başlangıç

### Ön Koşullar

- **Node.js** v18+ 
- **pnpm** v8+ (`npm install -g pnpm`)
- **Docker Desktop** (PostgreSQL & Redis için)

### 1. Projeyi Klonla

```bash
git clone <repo-url>
cd REST_OTM
```

### 2. Ortam Değişkenlerini Ayarla

```bash
cp .env.example .env
# .env dosyasını düzenleyip gerçek değerleri gir
```

### 3. Veritabanını Başlat (Docker)

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

Bu komut tüm uygulamaları paralel olarak başlatacaktır:
- **Admin Dashboard:** http://localhost:3000
- **Garson PWA:** http://localhost:3001
- **Backend API:** http://localhost:4000
- **API Health:** http://localhost:4000/api/health

## 📋 Demo Giriş Bilgileri

| Rol | Email | Şifre | PIN |
|---|---|---|---|
| Patron (Owner) | patron@lezzet.com | ! | — |
| Şef (Chef) | sef@lezzet.com | Admin123! | — |
| Kasiyer (Cashier) | kasa@lezzet.com | ! | — |
| Garson 1 | garson1@lezzet.com | Garson123! |  |
| Garson 2 | garson2@lezzet.com | Garson123! |  |

## 📁 Proje Yapısı

```
REST_OTM/
├── apps/
│   ├── api/            # Backend API + WebSocket (Express + Prisma)
│   ├── admin/          # Admin Dashboard (Next.js)
│   ├── waiter/         # Garson PWA (Next.js + PWA)
│   └── print-agent/    # Local Print Agent (Node.js)
├── packages/
│   ├── shared-types/   # Ortak TypeScript tipleri
│   ├── ui-kit/         # Paylaşılan UI bileşenleri
│   └── eslint-config/  # Paylaşılan ESLint kuralları
├── docker/             # Docker Compose konfigürasyonları
└── docs/               # Proje dokümantasyonu
```

## 🔒 Güvenlik

- ✅ Parolalar **bcrypt** ile hashlenmiş (salt: 12)
- ✅ JWT Access + Refresh token stratejisi
- ✅ PostgreSQL **Row-Level Security** ile tenant izolasyonu
- ✅ **Rate limiting** ile brute-force koruması
- ✅ **Helmet** ile HTTP güvenlik başlıkları
- ✅ **Zod** ile tüm girdiler doğrulanmış
- ✅ `.env` dosyası Git'ten hariç tutulmuş

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
