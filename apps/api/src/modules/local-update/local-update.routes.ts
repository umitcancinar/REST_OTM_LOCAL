import { Router, type NextFunction, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { LocalUpdateError, LocalUpdateRuntime } from './local-update.runtime';

/**
 * Update imzali ve operasyon verisinden bagimsiz bir recovery bakimidir.
 * Lisans kilidinde de OWNER/ADMIN kimligiyle kontrol/stage edilebilir; lokal
 * API hicbir zaman binary apply etmez.
 */
export const LOCAL_UPDATE_RECOVERY_RULES = [
  { path: '/api/local-update/status', methods: ['GET', 'HEAD'] as const },
  { path: '/api/local-update/check-and-stage', methods: ['POST'] as const },
] as const;

function sendUpdateError(error: LocalUpdateError, res: Response): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(error.statusCode).json({
    success: false,
    code: error.code,
    message: error.message,
    timestamp: new Date().toISOString(),
  });
}

export function createLocalUpdateRouter(
  runtime: LocalUpdateRuntime,
  authorizationGuards: readonly RequestHandler[],
): Router {
  if (authorizationGuards.length === 0) {
    throw new LocalUpdateError(
      'UPDATE_AUTH_REQUIRED',
      'Local update rotalari OWNER/ADMIN guard gerektirir.',
      500,
    );
  }
  const router = Router();
  for (const guard of authorizationGuards) router.use(guard);
  const statusLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const stageLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 6,
    standardHeaders: true,
    legacyHeaders: false,
  });

  router.get('/status', statusLimiter, async (_req, res, next: NextFunction) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: await runtime.getStatus(), timestamp: new Date().toISOString() });
    } catch (error) {
      if (error instanceof LocalUpdateError) sendUpdateError(error, res);
      else next(error);
    }
  });

  router.post('/check-and-stage', stageLimiter, async (_req, res, next: NextFunction) => {
    try {
      const result = await runtime.checkAndStage();
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.code === 'NO_UPDATE_AVAILABLE' ? 200 : 202).json({
        success: true,
        code: result.code,
        message: result.code === 'NO_UPDATE_AVAILABLE'
          ? 'Bu channel ve mevcut surum icin yeni update yok.'
          : 'Update dogrulandi ve supervisor icin stage edildi; henuz uygulanmadi.',
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof LocalUpdateError) sendUpdateError(error, res);
      else next(error);
    }
  });

  return router;
}
