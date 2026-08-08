// ==========================================
// Rate Limiter Middleware
// ==========================================

import rateLimit from 'express-rate-limit';

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

/** Auth endpoints — stricter: 10 attempts per 15 minutes */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again later.',
  },
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
