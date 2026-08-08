import { Router, type NextFunction, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import {
  LocalConnectivityError,
  LocalConnectivityRuntime,
  type LocalConnectivityTarget,
} from './local-connectivity.runtime';

export const LOCAL_CONNECTIVITY_RECOVERY_RULES = [
  { path: '/api/local-connectivity/status', methods: ['GET', 'HEAD'] as const },
  { path: '/api/local-connectivity/qr.svg', methods: ['GET', 'HEAD'] as const },
] as const;

function sendError(error: LocalConnectivityError, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    timestamp: new Date().toISOString(),
  });
}

export function createLocalConnectivityRouter(
  runtime: LocalConnectivityRuntime,
  authorizationGuards: readonly RequestHandler[],
): Router {
  if (authorizationGuards.length === 0) {
    throw new LocalConnectivityError(
      'LAN_CONNECTIVITY_AUTH_REQUIRED',
      'LAN connectivity rotalari OWNER/ADMIN guard gerektirir.',
      500,
    );
  }
  const router = Router();
  for (const guard of authorizationGuards) router.use(guard);
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.get('/status', limiter, (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: true, data: runtime.getStatus(), timestamp: new Date().toISOString() });
  });

  router.get('/qr.svg', limiter, async (req, res, next: NextFunction) => {
    try {
      const rawTarget = Array.isArray(req.query.target) ? req.query.target[0] : req.query.target;
      const rawHost = Array.isArray(req.query.host) ? req.query.host[0] : req.query.host;
      const target = (typeof rawTarget === 'string' && rawTarget ? rawTarget : 'waiter') as LocalConnectivityTarget;
      const host = typeof rawHost === 'string' ? rawHost : undefined;
      const qr = await runtime.createQrSvg(target, host);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Rest-Otm-Qr-Target', qr.url);
      res.status(200).send(qr.svg);
    } catch (error) {
      if (error instanceof LocalConnectivityError) sendError(error, res);
      else next(error);
    }
  });

  return router;
}
