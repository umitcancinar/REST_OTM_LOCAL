# REST_OTM Superadmin

Bulutta yalnız lisans ve işletme yönetimi için çalışan Next.js BFF/panelidir.
Tarayıcı access/refresh token'larını okuyamaz; token'lar `HttpOnly`, `Secure`,
`SameSite=Strict` cookie olarak tutulur.

## İki aşamalı giriş

1. BFF, API'nin `/auth/superadmin/mfa/start` endpoint'ine servis secret'i ile
   bağlanır. API parolayı doğrular fakat henüz access/refresh token üretmez.
2. Tek kullanımlık kodun yalnız HMAC özeti PostgreSQL'e yazılır; plaintext kod
   Resend ile yöneticinin e-postasına gönderilmek üzere bir kez BFF'e döner.
3. Kod doğrulanınca challenge API'de atomik olarak tüketilir ve ancak bundan
   sonra token üretilir. Aynı kodun paralel/replay kullanımı oturum açamaz.

Render'da gerekli secret'lar:

- `REST_OTM_API_URL`: ör. `https://rest-otm-api.onrender.com/api`
- `RESEND_API_KEY`
- `SUPERADMIN_EMAIL_FROM`
- `SUPERADMIN_SESSION_SECRET`: yalnız BFF cookie şifrelemesi için, en az 32 karakter
- `SUPERADMIN_BFF_SERVICE_SECRET`: API ve BFF servisinde aynı, en az 32 karakter
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: admin hostname'lerini kapsayan Cloudflare site key
- `TURNSTILE_SECRET_KEY`: yalnız BFF'te kalan Cloudflare secret key
- `TURNSTILE_ALLOWED_HOSTNAMES`: virgülle ayrılmış kesin admin hostname listesi

API servisinde ayrıca farklı bir `SUPERADMIN_MFA_PEPPER` bulunmalıdır.

Üretimde Turnstile anahtarı veya hostname listesi eksikse giriş fail-closed
çalışır; parola API'ye iletilmez. Giriş tamamlanınca yalnız HttpOnly cookie ile
`/admin` açılır. `/dashboard` geriye uyumluluk için `/admin`e yönlendirilir.

## Yerel geliştirme

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
