// ==========================================
// Rate Limiter Middleware
// ==========================================

import rateLimit from 'express-rate-limit';
import { createHash } from 'crypto';

/** General API rate limiter — 500 requests per 15 minutes */
export const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

/** Public CMS endpoints — very generous: 2000 requests per 15 minutes
 *  These are read-only endpoints called by every visitor on page load.
 *  Each page load triggers ~8 parallel requests, so the limit must be high. */
export const publicCmsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.',
  },
});

/** Auth endpoints — strict: five attempts per IP / 15 minutes. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.',
  },
});

function opaqueRateKey(value: unknown, prefix: string): string {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return `${prefix}:${createHash('sha256').update(normalized || 'missing').digest('hex')}`;
}

/**
 * Render'daki Next.js BFF isteklerinin tamami ayni outbound IP'den gelebilir.
 * Bu nedenle superadmin MFA limitleri IP'ye baglanmaz: start kullanici
 * e-postasina, verify challenge kimligine gore ayrilir. Endpoint'ler bundan
 * once service-auth middleware'i calistirdigi icin bu anahtarlar disaridan
 * yetkisiz sekilde doldurulamaz. Kalici deneme/start limitleri ayrica DB'dedir.
 */
export const superAdminMfaStartLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const clientKey = req.get('x-rest-otm-client-key');
    const trustedClientKey = clientKey && /^[a-f0-9]{64}$/.test(clientKey) ? clientKey : 'missing';
    return opaqueRateKey(`${req.body?.email || ''}:${trustedClientKey}`, 'superadmin-mfa-start');
  },
  message: { success: false, message: 'Too many verification requests.' },
});

export const superAdminMfaVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => opaqueRateKey(req.body?.challengeId, 'superadmin-mfa-verify'),
  message: { success: false, message: 'Too many verification attempts.' },
});

export const superAdminSessionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => opaqueRateKey(req.body?.refreshToken, 'superadmin-session'),
  message: { success: false, message: 'Too many session requests.' },
});

/** Order creation — 50 per minute (high throughput needed) */
export const orderLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Order rate limit exceeded.',
  },
});
