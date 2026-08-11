import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isProduction = process.env.NODE_ENV === 'production';

function configuredConnectSources() {
  const sources = new Set(["'self'", 'https://challenges.cloudflare.com']);
  const configured = process.env.NEXT_PUBLIC_API_URL;

  if (configured) {
    try {
      const url = new URL(configured);
      sources.add(url.origin);
      if (url.protocol === 'https:') sources.add(`wss://${url.host}`);
      if (url.protocol === 'http:') sources.add(`ws://${url.host}`);
    } catch {
      // Invalid public API configuration is handled by the application. It must
      // never broaden the browser's CSP allow-list.
    }
  }

  return [...sources].join(' ');
}

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  // App Router requires its inline bootstrap. Cloudflare is restricted to the
  // Turnstile challenge origin used on the administrator login route.
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob:",
  "font-src 'self' data: https://fonts.gstatic.com",
  `connect-src ${configuredConnectSources()}`,
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  ...(isProduction ? ['upgrade-insecure-requests'] : []),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Permissions-Policy',
    value:
      'accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), browsing-topics=()',
  },
  ...(isProduction
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  async redirects() {
    return [
      { source: '/', destination: '/login', permanent: false },
      { source: '/dashboard', destination: '/admin', permanent: false },
    ];
  },
};

export default nextConfig;
